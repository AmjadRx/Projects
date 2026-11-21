'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, ImageOff, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import Icon from '@/components/sheet/Icon';
import { aspectOf, type ResolvedImage, type ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import { useMotionOk } from '@/lib/useMotionOk';
import { cn } from '@/lib/utils';
import DownloadLink, { failureText } from '../shared/DownloadLink';
import Poster, { canOptimize } from '../shared/Poster';
import ViewerErrorBoundary from '../shared/ViewerErrorBoundary';
import { useFocusTrap } from '../shared/hooks';
import type { ModelView } from '../types';
import { ARRIVAL_STYLE, usePhotoArrival } from './arrival';
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
 * The lightbox (bundle Lightbox, app/sheet.css 18; ARCHITECTURE.md 13A): a focus-trapped dialog
 * on night in both themes over a list of items. Close sits in the top right corner; Previous, the
 * count, and Next sit centered at the foot, with the caption and the download link under them.
 * One item: no Previous, Next, or count. Escape and Close close it, focus returns to the opener,
 * and the page behind does not scroll (docs/V3_PLAN.md D-63).
 *
 * Photos zoom with the buttons in the top left corner, the wheel, a pinch, a double click or
 * double tap, and the keys plus, minus, and 0, and pan by dragging or with the arrow keys while
 * zoomed. The left and right keys move between items when the photo is not zoomed, and the list
 * wraps around (Phase 3). Every photo goes through next/image, here too, so a large original is
 * never sent whole (docs/V3_PLAN.md R-16). A full-size file that does not load shows the words,
 * the alt text, and Try again. A video or a 3D model opens its own viewer, whose code loads only
 * when such an item is shown.
 *
 * It renders inside LazyLightbox's layer on <body> (useLightbox.tsx), which fades it in and out.
 * A photo on its way leaves the stage empty; after 600 ms a 2 px line runs along the stage's foot,
 * and the photo fades in over 200 ms once it has decoded (motion sheet 6.4; arrival.tsx).
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
    <p className={styles.loading} role="status">
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
  const [photoFailed, setPhotoFailed] = useState(false);
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
      setPhotoFailed(false);
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
  const zoomable = isPhoto && !photoFailed;
  // No empty caption row: a file that is not offered for download has no link (R-16). A video or
  // a model shows its caption and download link in its own frame.
  const hasCaption = !isPlayer && (!!item.caption || !!item.file.downloadHref);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label ?? UI.viewers.image.lightbox}
      aria-describedby={hintId}
      tabIndex={-1}
      className={cn('ar-lightbox', count < 2 && 'ar-lightbox--one', styles.dialog)}
      onKeyDown={onKeyDown}
    >
      <p id={hintId} className="ar-sr">
        {count > 1 ? UI.viewers.image.keysMany : UI.viewers.image.keysOne}
      </p>

      <div className={cn('ar-lightbox__top', styles.top)}>
        {zoomable ? (
          <div className={styles.group}>
            <LightboxButton
              label={UI.viewers.zoomOut}
              disabled={!zoomed}
              onPress={() => zoomRef.current?.zoomBy(1 / 1.5)}
            >
              <Icon icon={ZoomOut} size={20} />
            </LightboxButton>
            <LightboxButton
              label={UI.viewers.fitToFrame}
              text={UI.viewers.fit}
              disabled={!zoomed}
              onPress={() => zoomRef.current?.reset()}
            />
            <LightboxButton
              label={UI.viewers.zoomIn}
              disabled={atMax}
              onPress={() => zoomRef.current?.zoomBy(1.5)}
            >
              <Icon icon={ZoomIn} size={20} />
            </LightboxButton>
          </div>
        ) : (
          <span />
        )}
        <button
          ref={closeRef}
          type="button"
          className="ar-iconbtn"
          onClick={onClose}
          aria-label={UI.viewers.close}
          title={UI.viewers.close}
        >
          <Icon icon={X} size={20} />
        </button>
      </div>

      <div className={cn('ar-lightbox__stage', styles.stage)}>
        {isPhoto && still ? (
          photoFailed ? (
            <PhotoFailed alt={item.alt} onRetry={() => setPhotoFailed(false)} />
          ) : (
            <PhotoStage
              key={`${index}-${item.file.src}`}
              media={item}
              still={still}
              onController={onController}
              onScale={setScale}
              onSwipe={count > 1 ? go : undefined}
              onFail={() => {
                setPhotoFailed(true);
                setScale(1);
              }}
            />
          )
        ) : isPlayer ? (
          // Only the item the lightbox opened on takes focus; paging leaves focus where it was.
          <PlayerItem key={`${index}-${item.file.src}`} item={item} takeFocus={!moved} />
        ) : (
          <OtherItem key={`${index}-${item.file.src}`} item={item} />
        )}
      </div>

      <div className={cn('ar-lightbox__bottom', styles.bottom)}>
        {count > 1 && (
          <div className={styles.nav}>
            <LightboxButton label={UI.viewers.previous} disabled={false} onPress={() => go(-1)}>
              <Icon icon={ChevronLeft} size={20} />
            </LightboxButton>
            <p className="ar-lightbox__count" aria-live="polite">
              {UI.viewers.itemOf(index + 1, count)}
            </p>
            <LightboxButton label={UI.viewers.next} disabled={false} onPress={() => go(1)}>
              <Icon icon={ChevronRight} size={20} />
            </LightboxButton>
          </div>
        )}
        {hasCaption && (
          <p className={styles.caption}>
            {item.caption && <span className={styles.captionText}>{item.caption}</span>}
            <DownloadLink file={item.file} onNight />
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A control on night that stays focusable at its limit (aria-disabled, not disabled), so keyboard
 * focus is never dropped when a press reaches the end of the zoom range. With `text` it is the
 * bundle's text button ("Fit"), named by its words.
 */
function LightboxButton({
  label,
  text,
  disabled,
  onPress,
  children,
}: {
  label: string;
  text?: string;
  disabled: boolean;
  onPress: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn('ar-iconbtn', text && styles.textButton)}
      aria-label={text ? undefined : label}
      title={label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onPress();
      }}
    >
      {text ?? children}
    </button>
  );
}

/** The full-size file did not load: the image-off mark, the words, the alt text, and Try again (bundle). */
function PhotoFailed({ alt, onRetry }: { alt: string; onRetry: () => void }) {
  return (
    <div className="ar-lightbox__msg" role="group">
      <span className="ar-lightbox__icon" aria-hidden="true">
        <Icon icon={ImageOff} size={28} />
      </span>
      <p className="ar-lightbox__said">{UI.placeholder.didNotLoad}</p>
      {alt ? <p className="ar-lightbox__alt">{alt}</p> : null}
      <button type="button" className="ar-lightbox__retry" onClick={onRetry}>
        {UI.placeholder.tryAgain}
      </button>
    </div>
  );
}

/** One photo: fitted to the stage at no more than its natural size, then zoomed and panned. */
function PhotoStage({
  media,
  still,
  onController,
  onScale,
  onSwipe,
  onFail,
}: {
  media: ResolvedMedia;
  still: ResolvedImage;
  onController: (zp: ZoomPan | null) => void;
  onScale: (scale: number) => void;
  onSwipe?: (direction: 1 | -1) => void;
  onFail: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [fit, setFit] = useState<Rect | null>(null);
  const [sharpness, setSharpness] = useState(1);
  const natural = naturalSizeOf(still);
  const ratio = natural ? natural.width / natural.height : aspectOf(media, 4 / 3);
  // The photo mounts once the stage is measured; from then on it arrives (arrival.tsx).
  const motionOk = useMotionOk();
  const arrival = usePhotoArrival(imageRef, motionOk, fit !== null);

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
              ref={imageRef}
              src={still.src}
              alt={media.alt}
              fill
              sizes={`${Math.ceil(fit.width * sharpness)}px`}
              loading="eager"
              unoptimized={!canOptimize(still.src)}
              draggable={false}
              className={cn(styles.img, 'mm-photo')}
              data-arrive={arrival.attr}
              style={ARRIVAL_STYLE}
              onLoad={arrival.onLoad}
              onError={() => {
                arrival.onError();
                onFail();
              }}
            />
          </div>
        )}
      </div>
      {/* The stage stays empty while the photo is on its way; the bundle's line runs along its foot. */}
      {arrival.waiting && <span className="ar-lightbox__bar" aria-hidden="true" />}
    </div>
  );
}

/** A video, an embed, or a 3D model: its own viewer, sized to fit the stage. */
function PlayerItem({ item, takeFocus }: { item: ResolvedMedia; takeFocus: boolean }) {
  const aspect = aspectOf(item, item.kind === 'model' ? 16 / 10 : 16 / 9);
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
      <div className={cn('ar-mv__well', styles.other)} style={style}>
        <Poster media={item} sizes="(min-width: 1024px) 900px, 100vw" />
      </div>
      <p className={styles.caption}>
        <span className={styles.captionText}>{failureText(item.file)}</span>
        <DownloadLink file={item.file} onNight />
      </p>
    </div>
  );
}

/** Any other kind: its poster or the placeholder; the download link sits under the stage. */
function OtherItem({ item }: { item: ResolvedMedia }) {
  const style = { aspectRatio: String(aspectOf(item, 4 / 3)) } as CSSProperties;
  return (
    <div className={styles.playerArea}>
      <div className={cn('ar-mv__well', styles.other)} style={style}>
        <Poster media={item} sizes="(min-width: 1024px) 900px, 100vw" />
      </div>
      {item.alt && <p className="ar-sr">{item.alt}</p>}
    </div>
  );
}
