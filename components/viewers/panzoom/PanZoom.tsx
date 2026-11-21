'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { ZoomIn, ZoomOut } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Icon from '@/components/sheet/Icon';
import { aspectOf, extensionOf } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { naturalSizeOf, stillOf } from '../image/still';
import { failureText } from '../shared/DownloadLink';
import Poster, { canOptimize } from '../shared/Poster';
import TapToLoad from '../shared/TapToLoad';
import ViewerErrorBoundary from '../shared/ViewerErrorBoundary';
import ViewerFrame from '../shared/ViewerFrame';
import { BODY_SIZES } from '../shared/sizes';
import { useViewerActivation } from '../shared/useViewerActivation';
import type { PanZoomProps } from '../types';
import type { PanZoomHandle } from './PanZoomEngine';
import styles from './PanZoom.module.css';

/** The pan, zoom, and overview code: a separate chunk, loaded when the viewer comes into view. */
const PanZoomEngine = dynamic(() => import('./PanZoomEngine'), { ssr: false });

const SIZES = BODY_SIZES;
const MAX_SCALE = 8;
/** A drawing is never taller than this share of the window; a tall one gets a narrower frame. */
const MAX_VH = 80;

type Action = 'in' | 'out' | 'reset';

/**
 * Pan and zoom for a schematic or a drawing (bundle DrawingViewer; ARCHITECTURE.md 13A): the bar
 * holds zoom out, zoom in, Fit, and the hint "Drag to pan"; the mini-map sits in the well's
 * bottom right corner while zoomed in.
 *
 * The drawing itself is the poster and paints with the page: an SVG through a plain image
 * element (which never runs scripts) at its own resolution, a raster drawing through next/image.
 * When the viewer comes into view (or on a tap, on a slow connection) the engine loads: drag to
 * pan, zoom at the pointer with the wheel or a pinch, double click or double tap, the buttons,
 * the keys (plus, minus, 0, and the arrows), an overview with the visible rectangle, and full
 * screen through the frame.
 *
 * Touch: one finger always scrolls the page until the visitor zooms in (with two fingers, a
 * double tap, or the buttons); while zoomed in, one finger pans. A mouse wheel zooms only once
 * the visitor has selected the drawing or zoomed in; Ctrl with the wheel, or a trackpad pinch,
 * always zooms.
 *
 * A PDF page as the source is not drawn with pdf.js yet: a PDF pans and zooms its poster image
 * (the first page, captured at upload), or shows the placeholder, with the download link.
 */
export default function PanZoom({ media }: PanZoomProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const { active, requiresTap, activate } = useViewerActivation(stageRef, 'view');
  const [handle, setHandle] = useState<PanZoomHandle | null>(null);
  const [scale, setScale] = useState(1);
  const [sharpness, setSharpness] = useState(1);
  const pending = useRef<Action | null>(null);

  const still = stillOf(media);
  const natural = naturalSizeOf(still);
  const ratio = natural ? natural.width / natural.height : aspectOf(media, 3 / 2);
  const vector = still ? extensionOf(still.src) === 'svg' : false;
  const unoptimized = still ? !canOptimize(still.src) : true;

  const onScale = useCallback((next: number) => {
    setScale(next);
    setSharpness((current) =>
      Math.max(current, next > 4.4 ? 8 : next > 2.2 ? 4 : next > 1.1 ? 2 : 1),
    );
  }, []);

  // A button pressed before the engine arrived acts as soon as it does.
  useEffect(() => {
    if (!handle || !pending.current) return;
    run(handle, pending.current);
    pending.current = null;
  }, [handle]);

  const press = (action: Action) => {
    if (handle) {
      run(handle, action);
      return;
    }
    pending.current = action;
    activate();
  };

  const zoomed = scale > 1.001;
  const atMax = scale >= MAX_SCALE - 0.001;
  const ready = !!handle;

  // Raster drawings ask for a sharper file once zoomed in; an SVG is drawn at every scale.
  const sizes =
    sharpness === 1
      ? SIZES
      : `(min-width: 1312px) ${800 * sharpness}px, (min-width: 1024px) calc((66.67vw - 75px) * ${sharpness}), calc((100vw - 40px) * ${sharpness})`;

  const caps: string[] = [`calc(${MAX_VH}vh * ${ratio.toFixed(5)})`];
  if (natural && !vector) caps.push(`${natural.width}px`);
  const wrapperStyle: CSSProperties = {
    maxWidth: caps.length > 1 ? `min(${caps.join(', ')})` : caps[0],
  };

  const toolbar = still ? (
    <>
      <ToolButton
        label={UI.viewers.zoomOut}
        disabled={!ready || !zoomed}
        onPress={() => press('out')}
      >
        <Icon icon={ZoomOut} size={18} />
      </ToolButton>
      <ToolButton label={UI.viewers.zoomIn} disabled={ready && atMax} onPress={() => press('in')}>
        <Icon icon={ZoomIn} size={18} />
      </ToolButton>
      <ToolButton
        label={UI.viewers.fitToFrame}
        text={UI.viewers.fit}
        disabled={!ready || !zoomed}
        onPress={() => press('reset')}
      />
      <span className="ar-mv__hint">{UI.viewers.panzoom.hint}</span>
    </>
  ) : undefined;

  return (
    <div className={styles.frame} style={wrapperStyle}>
      <ViewerFrame
        label={UI.viewers.panzoom.label}
        kind={UI.viewers.kind.drawing}
        aspect={ratio}
        caption={media.caption}
        fileName={media.file.name}
        downloads={[{ file: media.file }]}
        toolbar={toolbar}
        allowFullscreen={!!still}
        maxWellHeight={`${MAX_VH}vh`}
      >
        {still ? (
          <div
            ref={stageRef}
            className={styles.stage}
            tabIndex={0}
            role="group"
            aria-label={UI.viewers.panzoom.label}
            aria-describedby={hintId}
            data-zoomed="false"
          >
            <div ref={boxRef} className={styles.box}>
              {vector ? (
                // A plain image element: an SVG shown this way never runs scripts, and it stays
                // sharp at every zoom because the browser draws it again at each scale.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={still.src}
                  alt={media.alt}
                  width={natural?.width}
                  height={natural?.height}
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                  className={styles.drawing}
                />
              ) : (
                <Image
                  src={still.src}
                  alt={media.alt}
                  fill
                  sizes={sizes}
                  unoptimized={unoptimized}
                  draggable={false}
                  className={styles.drawing}
                />
              )}
            </div>
            {active && (
              <ViewerErrorBoundary fallback={<p className="ar-mv__note">{failureText(media.file)}</p>}>
                <PanZoomEngine
                  stageRef={stageRef}
                  boxRef={boxRef}
                  ratio={ratio}
                  maxScale={MAX_SCALE}
                  overview={{ src: still.src, vector, unoptimized }}
                  onReady={setHandle}
                  onScale={onScale}
                />
              </ViewerErrorBoundary>
            )}
            {requiresTap && !active && (
              <TapToLoad
                label={UI.viewers.loadViewer}
                onActivate={() => {
                  // The button goes once the engine loads; focus stays in the viewer, on the drawing.
                  stageRef.current?.focus({ preventScroll: true });
                  activate();
                }}
              />
            )}
            <p id={hintId} className="ar-sr">
              {UI.viewers.panzoom.keys}
            </p>
          </div>
        ) : (
          <div ref={stageRef} className={styles.stage}>
            <Poster media={media} />
            {media.alt && <p className="ar-sr">{media.alt}</p>}
          </div>
        )}
      </ViewerFrame>
    </div>
  );
}

function run(handle: PanZoomHandle, action: Action) {
  if (action === 'in') handle.zoomIn();
  else if (action === 'out') handle.zoomOut();
  else handle.reset();
}

/**
 * A bar button (bundle .ar-mv__btn) that stays focusable at a limit (aria-disabled), so focus is
 * never dropped mid-use. With `text` it is the bundle's text button ("Fit"), named by its words.
 */
function ToolButton({
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
      className={cn('ar-mv__btn', text && 'ar-mv__btn--text')}
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
