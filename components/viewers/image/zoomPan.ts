/**
 * Zoom and pan for the lightbox and the pan and zoom viewer: a small controller that holds a
 * scale and an offset, plus the pointer, wheel, and key bindings that drive it. No library and
 * no animation: every change is applied at once, so reduced motion needs nothing extra.
 *
 * Geometry. The stage is the visible area. The box is a layer the size of the stage that is
 * transformed by `translate(x, y) scale(scale)` from its top left corner. The content (a photo
 * or a drawing) sits inside the box at its fit rectangle, the place it has when not zoomed.
 *
 * This module is imported only by code that loads on demand (the lightbox and the pan and zoom
 * engine), so it is never part of a page's first load.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZoomPanView {
  scale: number;
  x: number;
  y: number;
}

/** The visible part of the content, as fractions from 0 to 1 of its width and height. */
export interface VisibleRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The largest rectangle with the given ratio (width over height) that fits the area, centered.
 * With `natural`, the rectangle is never larger than the content's own size in CSS pixels
 * (docs/V3_PLAN.md R-15: small photos are never enlarged past their natural size).
 */
export function containRect(
  width: number,
  height: number,
  ratio: number,
  natural?: { width: number; height: number },
): Rect {
  let w = width;
  let h = width / ratio;
  if (h > height) {
    h = height;
    w = height * ratio;
  }
  if (natural && natural.width > 0 && natural.height > 0 && w > natural.width) {
    w = natural.width;
    h = natural.width / ratio;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export class ZoomPan {
  scale = 1;
  x = 0;
  y = 0;
  readonly maxScale: number;
  private viewWidth = 0;
  private viewHeight = 0;
  private fit: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private readonly apply: (view: ZoomPanView) => void;

  constructor(options: { maxScale: number; apply: (view: ZoomPanView) => void }) {
    this.maxScale = Math.max(1, options.maxScale);
    this.apply = options.apply;
  }

  get zoomed(): boolean {
    return this.scale > 1.001;
  }

  get width(): number {
    return this.viewWidth;
  }

  get height(): number {
    return this.viewHeight;
  }

  private get ready(): boolean {
    return this.viewWidth > 0 && this.viewHeight > 0 && this.fit.width > 0 && this.fit.height > 0;
  }

  /**
   * Sets the stage size and the content's fit rectangle. When the stage changes size while zoomed
   * (a rotated phone, full screen), the point at the center of the view stays at the center.
   */
  layout(width: number, height: number, fit: Rect): void {
    if (width <= 0 || height <= 0 || fit.width <= 0 || fit.height <= 0) return;
    const center =
      this.ready && this.zoomed ? this.pointAt(this.viewWidth / 2, this.viewHeight / 2) : null;
    this.viewWidth = width;
    this.viewHeight = height;
    this.fit = { ...fit };
    if (center) {
      this.place(center.nx, center.ny);
    } else {
      this.scale = 1;
      this.x = 0;
      this.y = 0;
    }
    this.clampOffsets();
    this.emit();
  }

  /** The content point under a stage point, as fractions of the content's width and height. */
  pointAt(stageX: number, stageY: number): { nx: number; ny: number } {
    const boxX = (stageX - this.x) / this.scale;
    const boxY = (stageY - this.y) / this.scale;
    return { nx: (boxX - this.fit.x) / this.fit.width, ny: (boxY - this.fit.y) / this.fit.height };
  }

  /** Zooms to `scale`, keeping the content point under the stage point (px, py) in place. */
  zoomAt(px: number, py: number, scale: number): void {
    this.transform(px, py, scale / this.scale, 0, 0);
  }

  /** Zooms by a factor around the center of the view, or around a stage point. */
  zoomBy(factor: number, px = this.viewWidth / 2, py = this.viewHeight / 2): void {
    this.transform(px, py, factor, 0, 0);
  }

  panBy(dx: number, dy: number): void {
    this.transform(0, 0, 1, dx, dy);
  }

  /** One step of a pinch: zoom by `factor` around (px, py), then move by (dx, dy). */
  transform(px: number, py: number, factor: number, dx: number, dy: number): void {
    if (!this.ready) return;
    const next = clamp(this.scale * factor, 1, this.maxScale);
    const k = next / this.scale;
    this.x = px - (px - this.x) * k + dx;
    this.y = py - (py - this.y) * k + dy;
    this.scale = next;
    this.clampOffsets();
    this.emit();
  }

  /** Moves the view so the content point (nx, ny), in fractions, sits at the center. */
  centerOn(nx: number, ny: number): void {
    if (!this.ready) return;
    this.place(nx, ny);
    this.clampOffsets();
    this.emit();
  }

  reset(): void {
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.clampOffsets();
    this.emit();
  }

  /** The part of the content inside the view, as fractions of its size. */
  visible(): VisibleRect {
    const left = this.x + this.fit.x * this.scale;
    const top = this.y + this.fit.y * this.scale;
    const width = this.fit.width * this.scale || 1;
    const height = this.fit.height * this.scale || 1;
    return {
      x0: clamp(-left / width, 0, 1),
      y0: clamp(-top / height, 0, 1),
      x1: clamp((this.viewWidth - left) / width, 0, 1),
      y1: clamp((this.viewHeight - top) / height, 0, 1),
    };
  }

  private place(nx: number, ny: number): void {
    this.x = this.viewWidth / 2 - (this.fit.x + nx * this.fit.width) * this.scale;
    this.y = this.viewHeight / 2 - (this.fit.y + ny * this.fit.height) * this.scale;
  }

  /** Content smaller than the view is centered; larger content always covers the view. */
  private clampOffsets(): void {
    const s = this.scale;
    const w = this.fit.width * s;
    const h = this.fit.height * s;
    if (w <= this.viewWidth) this.x = (this.viewWidth - w) / 2 - this.fit.x * s;
    else
      this.x = clamp(this.x, this.viewWidth - (this.fit.x + this.fit.width) * s, -this.fit.x * s);
    if (h <= this.viewHeight) this.y = (this.viewHeight - h) / 2 - this.fit.y * s;
    else
      this.y = clamp(this.y, this.viewHeight - (this.fit.y + this.fit.height) * s, -this.fit.y * s);
  }

  private emit(): void {
    this.apply({ scale: this.scale, x: this.x, y: this.y });
  }
}

/** The CSS transform for a view. Plain 2D, so browsers raster the content again at the new scale. */
export function transformOf(view: ZoomPanView): string {
  return `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

export interface GestureOptions {
  /** True when a plain wheel zooms. A wheel with Ctrl held (also a trackpad pinch) always zooms. */
  wheelZooms: () => boolean;
  /** A quick horizontal swipe by touch or pen while not zoomed: 1 for the next item, -1 for the previous. */
  onSwipe?: (direction: 1 | -1) => void;
  /** The visitor started to zoom (a pinch, a wheel zoom, a double tap, a double click). */
  onEngage?: () => void;
  /** The scale a double click or a double tap zooms to from the fitted view. */
  doubleTapScale: number;
}

/** Pointer events on an element inside one of these are left to that element (the overview). */
export const IGNORE_GESTURES_ATTRIBUTE = 'data-gestures-ignore';

interface TrackedPointer {
  x: number;
  y: number;
  type: string;
}

interface SinglePointer {
  id: number;
  type: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  time: number;
  moved: boolean;
}

interface SafariGestureEvent extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

/**
 * Binds drag to pan (while zoomed), pinch to zoom, the wheel, double click, double tap, a swipe,
 * and the Safari trackpad pinch to a stage. Returns the function that removes every listener.
 * Touch scrolling of the page is governed by the stage's `touch-action`, which the caller sets.
 */
export function bindGestures(stage: HTMLElement, zp: ZoomPan, options: GestureOptions): () => void {
  const pointers = new Map<number, TrackedPointer>();
  let rect = stage.getBoundingClientRect();
  let pinch: { distance: number; midX: number; midY: number } | null = null;
  let single: SinglePointer | null = null;
  let lastTap: { time: number; x: number; y: number } | null = null;
  let lastPointerType = 'mouse';
  let gestureStartScale = 1;

  const local = (event: { clientX: number; clientY: number }) => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
  const ignored = (event: Event) =>
    event.target instanceof Element &&
    event.target.closest(`[${IGNORE_GESTURES_ATTRIBUTE}]`) !== null;

  const startPinch = () => {
    const [a, b] = Array.from(pointers.values());
    pinch = {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  };

  const toggleZoom = (x: number, y: number) => {
    if (zp.zoomed) {
      zp.reset();
    } else {
      options.onEngage?.();
      zp.zoomAt(x, y, options.doubleTapScale);
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    lastPointerType = event.pointerType;
    if (ignored(event)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    rect = stage.getBoundingClientRect();
    const point = local(event);
    pointers.set(event.pointerId, { ...point, type: event.pointerType });
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; nothing to do.
    }
    if (pointers.size === 1) {
      single = {
        id: event.pointerId,
        type: event.pointerType,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        time: performance.now(),
        moved: false,
      };
    } else if (pointers.size === 2) {
      single = null;
      lastTap = null;
      startPinch();
      options.onEngage?.();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const known = pointers.get(event.pointerId);
    if (!known) return;
    const point = local(event);
    known.x = point.x;
    known.y = point.y;
    if (pointers.size >= 2 && pinch) {
      const [a, b] = Array.from(pointers.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      zp.transform(
        pinch.midX,
        pinch.midY,
        distance / pinch.distance,
        midX - pinch.midX,
        midY - pinch.midY,
      );
      pinch = { distance, midX, midY };
      return;
    }
    if (!single || single.id !== event.pointerId) return;
    if (!single.moved && Math.hypot(point.x - single.startX, point.y - single.startY) > 6)
      single.moved = true;
    if (zp.zoomed) zp.panBy(point.x - single.lastX, point.y - single.lastY);
    single.lastX = point.x;
    single.lastY = point.y;
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      // Released already.
    }
    if (pointers.size === 1) {
      // A pinch lost one finger: the other one goes on panning from where it is.
      const [id, rest] = Array.from(pointers.entries())[0];
      single = {
        id,
        type: rest.type,
        startX: rest.x,
        startY: rest.y,
        lastX: rest.x,
        lastY: rest.y,
        time: performance.now(),
        moved: true,
      };
      pinch = null;
      return;
    }
    if (pointers.size === 0) pinch = null;
    const ended = single;
    single = null;
    if (!ended || ended.id !== event.pointerId || event.type === 'pointercancel') return;
    const point = local(event);
    if (!ended.moved) {
      if (ended.type === 'mouse') return; // the mouse uses dblclick
      const now = performance.now();
      if (
        lastTap &&
        now - lastTap.time < 320 &&
        Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 32
      ) {
        lastTap = null;
        toggleZoom(point.x, point.y);
      } else {
        lastTap = { time: now, x: point.x, y: point.y };
      }
      return;
    }
    const dx = point.x - ended.startX;
    const dy = point.y - ended.startY;
    if (
      options.onSwipe &&
      !zp.zoomed &&
      ended.type !== 'mouse' &&
      Math.abs(dx) > 48 &&
      Math.abs(dx) > Math.abs(dy) * 1.5 &&
      performance.now() - ended.time < 800
    ) {
      options.onSwipe(dx < 0 ? 1 : -1);
    }
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (lastPointerType !== 'mouse' || ignored(event)) return;
    rect = stage.getBoundingClientRect();
    const point = local(event);
    toggleZoom(point.x, point.y);
  };

  const onWheel = (event: WheelEvent) => {
    if (ignored(event)) return;
    const pinchLike = event.ctrlKey;
    if (!pinchLike && !options.wheelZooms()) return;
    event.preventDefault();
    rect = stage.getBoundingClientRect();
    const point = local(event);
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= rect.height;
    const factor = Math.exp(-delta * (pinchLike ? 0.01 : 0.002));
    if (factor > 1) options.onEngage?.();
    zp.zoomAt(point.x, point.y, zp.scale * factor);
  };

  // Safari on a Mac sends a trackpad pinch as gesture events, not as a wheel with Ctrl held.
  // On iPhone and iPad the same events come with touches, which the pointer code already handles.
  const onGestureStart = (event: Event) => {
    if (pointers.size > 0) return;
    event.preventDefault();
    gestureStartScale = zp.scale;
  };
  const onGestureChange = (event: Event) => {
    if (pointers.size > 0) return;
    event.preventDefault();
    const gesture = event as SafariGestureEvent;
    rect = stage.getBoundingClientRect();
    const point = local(gesture);
    options.onEngage?.();
    zp.zoomAt(point.x, point.y, gestureStartScale * gesture.scale);
  };

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerEnd);
  stage.addEventListener('pointercancel', onPointerEnd);
  stage.addEventListener('dblclick', onDoubleClick);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('gesturestart', onGestureStart, { passive: false });
  stage.addEventListener('gesturechange', onGestureChange, { passive: false });

  return () => {
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointermove', onPointerMove);
    stage.removeEventListener('pointerup', onPointerEnd);
    stage.removeEventListener('pointercancel', onPointerEnd);
    stage.removeEventListener('dblclick', onDoubleClick);
    stage.removeEventListener('wheel', onWheel);
    stage.removeEventListener('gesturestart', onGestureStart);
    stage.removeEventListener('gesturechange', onGestureChange);
  };
}

/**
 * The zoom keys: plus and minus zoom, 0 resets, and the arrow keys pan while zoomed in.
 * Returns true when the key was used (the caller then prevents its default action).
 */
export function zoomKey(
  event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  zp: ZoomPan,
): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  const stepX = Math.max(40, zp.width * 0.1);
  const stepY = Math.max(40, zp.height * 0.1);
  switch (event.key) {
    case '+':
    case '=':
      zp.zoomBy(1.5);
      return true;
    case '-':
    case '_':
      zp.zoomBy(1 / 1.5);
      return true;
    case '0':
      zp.reset();
      return true;
    case 'ArrowLeft':
      if (!zp.zoomed) return false;
      zp.panBy(stepX, 0);
      return true;
    case 'ArrowRight':
      if (!zp.zoomed) return false;
      zp.panBy(-stepX, 0);
      return true;
    case 'ArrowUp':
      if (!zp.zoomed) return false;
      zp.panBy(0, stepY);
      return true;
    case 'ArrowDown':
      if (!zp.zoomed) return false;
      zp.panBy(0, -stepY);
      return true;
    default:
      return false;
  }
}

/** The smallest of 1, 2, and 4 that covers a scale: picks a sharper file once zoomed in. */
export function sharpnessStep(scale: number): number {
  if (scale > 2.2) return 4;
  if (scale > 1.1) return 2;
  return 1;
}
