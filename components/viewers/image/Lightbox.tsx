'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { aspectOf, type ResolvedImage, type ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import DownloadLink, { failureText } from '../shared/DownloadLink';
import Poster, { canOptimize } from '../shared/Poster';
import ViewerErrorBoundary from '../shared/ViewerErrorBoundary';
import { useFocusTrap } from '../shared/hooks';
import type { ModelView } from '../types';
import styles from './Lightbox.module.css';
import { naturalSizeOf, stillOf } from './still';
import {
  ZoomPan,
  bindGestures,
  containRect,
  sharpnessStep,
  transformOf,
  zoomKey,
  type Rect,
} from './zoomPan';

/**
 * The lightbox (ARCHITECTURE.md 13A, DESIGN_DIRECTION.md 11): a focus-trapped dialog over a list
 * of items. Escape and the close button close it, focus returns to the opener, and the page
 * behind does not scroll (docs/V3_PLAN.md D-63).
 *
 * Photos zoom with the buttons, the wheel, a pinch, a double click or double tap, and the keys
 * plus, minus, and 0, and pan by dragging or with the arrow keys while zoomed. The previous and
 * next buttons are always shown (D-67), and the left and right keys move between items when
 * the photo is not zoomed. Every photo goes through next/image, here too, so a large original is
 * never sent whole (docs/V3_PLAN.md R-16). A video or a 3D model opens its own viewer, whose code
 * loads only when such an item is shown.
 */
export interface LightboxProps {
  items: ResolvedMedia[];
  /** The index of the item shown first. */
  start: number;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label?: string;
  /** Called once the dialog is on screen (the loading cover in useLightbox.tsx then goes). */
  onShown?: () => void;
}

const VideoPlayer = dynamic(() => import('../video/VideoPlayer'), {
  ssr: false,
  loading: LoadingNote,
});
const ModelViewer = dynamic(() => import('../model/ModelViewer'), {
  ssr: false,
  loading: LoadingNote,
});

/** A model in a gallery has no block settings: every view, and the exploded view when it has parts. */
const GALLERY_MODEL_VIEWS: ModelView[] = ['realistic', 'blueprint', 'thermal'];

const MAX_PHOTO_SCALE = 4;

function LoadingNote() {
  return (
    <p className="data p-4 text-sm" role="status">
      {UI.viewers.loading}
    </p>
  );
}

const wrapIndex = (index: number, count: number) =>
  count > 0 ? ((index % count) + count) % count : 0;

/** Keys that the focused element needs for itself (a slider, a text field, a player). */
const OWNS_KEYS =
  'input, textarea, select, [contenteditable="true"], [role="slider"], video, audio, iframe, canvas, [data-lightbox-player]';

export default function Lightbox({ items, start, onClose, label, onShown }: LightboxProps) {
  const count = items.length;
  const [index, setIndex] = useState(() => wrapIndex(start, count));
  /** The visitor moved off the item the lightbox opened on. */
  const [moved, setMoved] = useState(false);
  const [scale, setScale] = useState(1);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const zoomRef = useRef<ZoomPan | null>(null);
  const hintId = useId();

  useFocusTrap(dialogRef, true, onClose, { initialFocus: closeRef });

  // Runs after the trap above has moved focus into the dialog.
  const shown = useRef(onShown);
  useEffect(() => {
    shown.current?.();
  }, []);

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      setIndex((current) => wrapIndex(current + delta, count));
      setMoved(true);
      setScale(1);
    },
    [count],
  );

  // After a move, keep focus inside the dialog: the element that had it may belong to the old item.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
  }, [index]);

  const item = items[index];
  const still = item ? stillOf(item) : null;
  const isPhoto = !!item && item.kind === 'image' && !!still;
  const isPlayer =
    !!item && (item.kind === 'video' || item.kind === 'embed' || item.kind === 'model');

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(OWNS_KEYS)) return;
    const zp = zoomRef.current;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (
      plain &&
      count > 1 &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      !zp?.zoomed
    ) {
      event.preventDefault();
      go(event.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (zp && zoomKey(event, zp)) event.preventDefault();
  };

  const onController = useCallback((zp: ZoomPan | null) => {
    zoomRef.current = zp;
  }, []);

  if (!item) return null;
  const zoomed = scale > 1.001;
  const atMax = scale >= MAX_PHOTO_SCALE - 0.001;
  const hasControls = count > 1 || isPhoto;
  // No empty caption row: a file that is not offered for download has no link (R-16).
  const hasCaption = !isPlayer && (!!item.caption || !!item.file.downloadHref);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label ?? UI.viewers.image.lightbox}
      aria-describedby={hintId}
      tabIndex={-1}
      className={styles.dialog}
      onKeyDown={onKeyDown}
    >
      <p id={hintId} className="sr-only">
        {count > 1 ? UI.viewers.image.keysMany : UI.viewers.image.keysOne}
      </p>

      <div className={styles.bar}>
        {count > 1 ? (
          <p className={cn('data', styles.count)} aria-live="polite">
            {UI.viewers.itemOf(index + 1, count)}
          </p>
        ) : (
          <span />
        )}
        <button
          ref={closeRef}
          type="button"
          className={styles.button}
          onClick={onClose}
          aria-label={UI.viewers.close}
          title={UI.viewers.close}
        >
          <X size={20} aria-hidden />
        </button>
      </div>

      <div className={styles.stage}>
        {isPhoto && still ? (
          <PhotoStage
            key={`${index}-${item.file.src}`}
            media={item}
            still={still}
            onController={onController}
            onScale={setScale}
            onSwipe={count > 1 ? go : undefined}
          />
        ) : isPlayer ? (
          // Only the item the lightbox opened on takes focus; paging leaves focus where it was.
          <PlayerItem key={`${index}-${item.file.src}`} item={item} takeFocus={!moved} />
        ) : (
          <OtherItem key={`${index}-${item.file.src}`} item={item} />
        )}
      </div>

      {(hasControls || hasCaption) && (
        <div className={styles.footer}>
          {hasControls && (
            <div className={styles.controls}>
              {count > 1 ? (
                <div className={styles.group}>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => go(-1)}
                    aria-label={UI.viewers.previous}
                    title={UI.viewers.previous}
                  >
                    <ChevronLeft size={20} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => go(1)}
                    aria-label={UI.viewers.next}
                    title={UI.viewers.next}
                  >
                    <ChevronRight size={20} aria-hidden />
                  </button>
                </div>
              ) : (
                <span />
              )}
              {isPhoto && (
                <div className={styles.group}>
                  <ZoomButton
                    label={UI.viewers.zoomOut}
                    disabled={!zoomed}
                    onPress={() => zoomRef.current?.zoomBy(1 / 1.5)}
                  >
                    <ZoomOut size={20} aria-hidden />
                  </ZoomButton>
                  <ZoomButton
                    label={UI.viewers.resetView}
                    disabled={!zoomed}
                    onPress={() => zoomRef.current?.reset()}
                  >
                    <RotateCcw size={18} aria-hidden />
                  </ZoomButton>
                  <ZoomButton
                    label={UI.viewers.zoomIn}
                    disabled={atMax}
                    onPress={() => zoomRef.current?.zoomBy(1.5)}
                  >
                    <ZoomIn size={20} aria-hidden />
                  </ZoomButton>
                </div>
              )}
            </div>
          )}
          {/* A video or a model shows its caption and download link in its own frame. */}
          {hasCaption && (
            <div className={styles.caption}>
              {item.caption && <span className={styles.captionText}>{item.caption}</span>}
              <DownloadLink file={item.file} />
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * A control that stays focusable at its limit (aria-disabled, not disabled), so keyboard focus
 * is never dropped when a press reaches the end of the zoom range.
 */
function ZoomButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onPress();
      }}
    >
      {children}
    </button>
  );
}

/** One photo: fitted to the stage at no more than its natural size, then zoomed and panned. */
function PhotoStage({
  media,
  still,
  onController,
  onScale,
  onSwipe,
}: {
  media: ResolvedMedia;
  still: ResolvedImage;
  onController: (zp: ZoomPan | null) => void;
  onScale: (scale: number) => void;
  onSwipe?: (direction: 1 | -1) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Rect | null>(null);
  const [sharpness, setSharpness] = useState(1);
  const natural = naturalSizeOf(still);
  const ratio = natural ? natural.width / natural.height : aspectOf(media, 4 / 3);

  // Callbacks in refs, so a new function from the parent never rebuilds the controller.
  const callbacks = useRef({ onController, onScale, onSwipe });
  callbacks.current = { onController, onScale, onSwipe };
  const naturalWidth = natural?.width;
  const naturalHeight = natural?.height;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const box = boxRef.current;
    if (!stage || !box) return undefined;
    let frame = 0;
    const size =
      naturalWidth && naturalHeight ? { width: naturalWidth, height: naturalHeight } : undefined;
    const zp = new ZoomPan({
      maxScale: MAX_PHOTO_SCALE,
      apply: (view) => {
        box.style.transform = transformOf(view);
        stage.dataset.zoomed = view.scale > 1.001 ? 'true' : 'false';
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          callbacks.current.onScale(view.scale);
          const step = sharpnessStep(view.scale);
          setSharpness((current) => Math.max(current, step));
        });
      },
    });
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const rect = containRect(width, height, ratio, size);
      setFit(rect);
      zp.layout(width, height, rect);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    const unbind = bindGestures(stage, zp, {
      wheelZooms: () => true,
      doubleTapScale: 2.5,
      onSwipe: (direction) => callbacks.current.onSwipe?.(direction),
    });
    callbacks.current.onController(zp);
    return () => {
      observer.disconnect();
      unbind();
      cancelAnimationFrame(frame);
      callbacks.current.onController(null);
    };
  }, [ratio, naturalWidth, naturalHeight]);

  const photoStyle: CSSProperties | undefined = fit
    ? { left: fit.x, top: fit.y, width: fit.width, height: fit.height }
    : undefined;

  return (
    <div ref={stageRef} className={styles.photoStage} data-zoomed="false">
      <div ref={boxRef} className={styles.box}>
        {fit && (
          <div className={styles.photo} style={photoStyle}>
            <Image
              src={still.src}
              alt={media.alt}
              fill
              sizes={`${Math.ceil(fit.width * sharpness)}px`}
              loading="eager"
              unoptimized={!canOptimize(still.src)}
              draggable={false}
              className={styles.img}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** A video, an embed, or a 3D model: its own viewer, sized to fit the stage. */
function PlayerItem({ item, takeFocus }: { item: ResolvedMedia; takeFocus: boolean }) {
  const aspect = aspectOf(item, item.kind === 'model' ? 4 / 3 : 16 / 9);
  const style = { '--player-aspect': String(aspect) } as CSSProperties;
  return (
    <div className={styles.playerArea} data-lightbox-player="">
      <div className={styles.player} style={style}>
        <ViewerErrorBoundary fallback={<PlayerFailed item={item} />}>
          {item.kind === 'model' ? (
            <ModelViewer
              media={item}
              views={GALLERY_MODEL_VIEWS}
              explode
              callouts={[]}
              inLightbox
            />
          ) : (
            <VideoPlayer media={item} inLightbox takeFocus={takeFocus} />
          )}
        </ViewerErrorBoundary>
      </div>
    </div>
  );
}

/** A viewer that could not load: the poster, a short message, and the download link. */
function PlayerFailed({ item }: { item: ResolvedMedia }) {
  const style = { aspectRatio: String(aspectOf(item, 16 / 9)) } as CSSProperties;
  return (
    <div>
      <div className={styles.other} style={style}>
        <Poster media={item} sizes="(min-width: 1024px) 900px, 100vw" />
      </div>
      <div className={styles.caption}>
        <span className={styles.captionText}>{failureText(item.file)}</span>
        <DownloadLink file={item.file} />
      </div>
    </div>
  );
}

/** Any other kind: its poster or the placeholder; the download link sits in the footer. */
function OtherItem({ item }: { item: ResolvedMedia }) {
  const style = { aspectRatio: String(aspectOf(item, 4 / 3)) } as CSSProperties;
  return (
    <div className={styles.playerArea}>
      <div className={styles.other} style={style}>
        <Poster media={item} sizes="(min-width: 1024px) 900px, 100vw" />
      </div>
      {item.alt && <p className="sr-only">{item.alt}</p>}
    </div>
  );
}
