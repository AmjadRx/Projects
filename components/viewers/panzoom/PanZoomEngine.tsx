'use client';

import Image from 'next/image';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { UI } from '@/lib/strings';
import {
  IGNORE_GESTURES_ATTRIBUTE,
  ZoomPan,
  bindGestures,
  containRect,
  transformOf,
  zoomKey,
  type VisibleRect,
} from '../image/zoomPan';
import { useViewerFrame } from '../shared/ViewerFrame';
import styles from './PanZoom.module.css';

/** What the toolbar of the pan and zoom viewer can ask of the engine. */
export interface PanZoomHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

export interface PanZoomEngineProps {
  /** The focusable stage and the layer inside it that carries the drawing (owned by PanZoom). */
  stageRef: RefObject<HTMLDivElement>;
  boxRef: RefObject<HTMLDivElement>;
  /** The drawing's width over its height. */
  ratio: number;
  maxScale: number;
  /** The image the overview shows. */
  overview: { src: string; vector: boolean; unoptimized: boolean };
  onReady: (handle: PanZoomHandle | null) => void;
  onScale: (scale: number) => void;
}

const FITTED: VisibleRect = { x0: 0, y0: 0, x1: 1, y1: 1 };
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The interactive part of the pan and zoom viewer, loaded on demand. It drives the drawing that
 * PanZoom already painted (no second image, so nothing flashes), and draws the overview while
 * zoomed in: the whole drawing with the visible rectangle; select or drag in it to move there.
 */
export default function PanZoomEngine({
  stageRef,
  boxRef,
  ratio,
  maxScale,
  overview,
  onReady,
  onScale,
}: PanZoomEngineProps) {
  const { isFullscreen } = useViewerFrame();
  const fullscreen = useRef(isFullscreen);
  fullscreen.current = isFullscreen;
  const zpRef = useRef<ZoomPan | null>(null);
  const callbacks = useRef({ onReady, onScale });
  callbacks.current = { onReady, onScale };
  const [view, setView] = useState<{ scale: number; rect: VisibleRect }>({
    scale: 1,
    rect: FITTED,
  });
  const dragging = useRef<number | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const box = boxRef.current;
    if (!stage || !box) return undefined;
    let frame = 0;
    // Until the visitor zooms in, one finger scrolls the page; two fingers reach the drawing.
    // In full screen there is no page to scroll, so the drawing takes every touch.
    const touchAction = (scale: number) =>
      scale > 1.001 || fullscreen.current ? 'none' : 'pan-x pan-y';

    const zp = new ZoomPan({
      maxScale,
      apply: (next) => {
        box.style.transform = transformOf(next);
        stage.style.touchAction = touchAction(next.scale);
        stage.dataset.zoomed = next.scale > 1.001 ? 'true' : 'false';
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          setView({ scale: next.scale, rect: zp.visible() });
          callbacks.current.onScale(next.scale);
        });
      },
    });
    zpRef.current = zp;

    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      if (width > 0 && height > 0) zp.layout(width, height, containRect(width, height, ratio));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);

    const unbind = bindGestures(stage, zp, {
      // A plain wheel scrolls the page until the visitor selects the drawing or zooms in.
      wheelZooms: () => zp.zoomed || fullscreen.current || stage.contains(document.activeElement),
      doubleTapScale: 3,
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== stage) return;
      if (zoomKey(event, zp)) event.preventDefault();
    };
    stage.addEventListener('keydown', onKeyDown);

    callbacks.current.onReady({
      zoomIn: () => zp.zoomBy(1.5),
      zoomOut: () => zp.zoomBy(1 / 1.5),
      reset: () => zp.reset(),
    });

    return () => {
      observer.disconnect();
      unbind();
      stage.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(frame);
      box.style.transform = '';
      stage.style.touchAction = '';
      stage.dataset.zoomed = 'false';
      zpRef.current = null;
      callbacks.current.onReady(null);
    };
  }, [stageRef, boxRef, ratio, maxScale]);

  useEffect(() => {
    const stage = stageRef.current;
    const zp = zpRef.current;
    if (stage && zp) stage.style.touchAction = zp.zoomed || isFullscreen ? 'none' : 'pan-x pan-y';
  }, [isFullscreen, stageRef]);

  if (view.scale <= 1.001) return null;

  const jump = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    zpRef.current?.centerOn(
      clamp01((event.clientX - rect.left) / rect.width),
      clamp01((event.clientY - rect.top) / rect.height),
    );
  };

  const { x0, y0, x1, y1 } = view.rect;
  return (
    <div
      className={styles.overview}
      style={{ aspectRatio: String(ratio) }}
      title={UI.viewers.panzoom.minimap}
      aria-hidden="true"
      {...{ [IGNORE_GESTURES_ATTRIBUTE]: '' }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        dragging.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        jump(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current === event.pointerId) jump(event);
      }}
      onPointerUp={(event) => {
        if (dragging.current === event.pointerId) dragging.current = null;
      }}
      onPointerCancel={() => {
        dragging.current = null;
      }}
    >
      {overview.vector ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={overview.src} alt="" draggable={false} className={styles.overviewImage} />
      ) : (
        <Image
          src={overview.src}
          alt=""
          fill
          sizes="180px"
          unoptimized={overview.unoptimized}
          draggable={false}
          className={styles.overviewImage}
        />
      )}
      <span
        className={styles.overviewView}
        style={{
          left: `${x0 * 100}%`,
          top: `${y0 * 100}%`,
          width: `${Math.max(0, x1 - x0) * 100}%`,
          height: `${Math.max(0, y1 - y0) * 100}%`,
        }}
      />
    </div>
  );
}
