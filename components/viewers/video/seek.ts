/**
 * Seeking on a custom slider (role="slider"), shared by the video seek bar and the audio
 * waveform. Loaded only with the players' engines.
 *
 * A mouse or pen seeks where it presses and while it drags. A touch waits until it shows its
 * direction: a vertical swipe scrolls the page (the slider has touch-action: pan-y) and never
 * seeks; a sideways drag seeks; a tap seeks where it lands. So a finger that scrolls past a
 * player never moves its playhead.
 */
import { clamp, SEEK_STEP } from './time';

/** Movement, in CSS pixels, that tells a tap from a swipe. */
const TOUCH_SLOP = 8;

export interface SeekGestureOptions {
  /** The box that maps a pointer to a position: 0 at its left edge, 1 at its right edge. */
  area: () => DOMRect | null;
  /** A position from 0 to 1 that the pointer asks for. */
  seek: (ratio: number) => void;
  /** A drag starts (true) or ends (false). */
  drag?: (dragging: boolean) => void;
}

/** Attaches the pointer gestures to the slider. Returns the function that removes them. */
export function attachSeekGestures(element: HTMLElement, options: SeekGestureOptions): () => void {
  let mouse: number | null = null;
  let touch: { id: number; x: number; y: number; dragging: boolean } | null = null;

  const seekAt = (clientX: number) => {
    const rect = options.area();
    if (!rect || rect.width <= 0) return;
    options.seek(clamp((clientX - rect.left) / rect.width, 0, 1));
  };

  const onDown = (event: PointerEvent) => {
    if (element.getAttribute('aria-disabled') === 'true') return;
    if (event.pointerType === 'touch') {
      touch = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
      return;
    }
    if (event.button !== 0) return;
    mouse = event.pointerId;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a convenience: without it the drag ends at the slider's edge.
    }
    options.drag?.(true);
    seekAt(event.clientX);
  };

  const onMove = (event: PointerEvent) => {
    if (mouse === event.pointerId) {
      seekAt(event.clientX);
      return;
    }
    if (!touch || touch.id !== event.pointerId) return;
    if (!touch.dragging) {
      const dx = Math.abs(event.clientX - touch.x);
      const dy = Math.abs(event.clientY - touch.y);
      if (dx < TOUCH_SLOP || dx <= dy) return;
      touch.dragging = true;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // The browser already took the touch for scrolling.
      }
      options.drag?.(true);
    }
    seekAt(event.clientX);
  };

  const onUp = (event: PointerEvent) => {
    if (mouse === event.pointerId) {
      mouse = null;
      options.drag?.(false);
      return;
    }
    if (!touch || touch.id !== event.pointerId) return;
    const { dragging, x, y } = touch;
    touch = null;
    if (dragging) {
      options.drag?.(false);
      return;
    }
    // A tap: it barely moved. Anything longer was a swipe the page scrolled with.
    if (Math.abs(event.clientX - x) <= TOUCH_SLOP && Math.abs(event.clientY - y) <= TOUCH_SLOP) seekAt(event.clientX);
  };

  const onCancel = (event: PointerEvent) => {
    if (mouse === event.pointerId) {
      mouse = null;
      options.drag?.(false);
    }
    if (touch && touch.id === event.pointerId) {
      if (touch.dragging) options.drag?.(false);
      touch = null;
    }
  };

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onCancel);
  return () => {
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onCancel);
  };
}

/**
 * The playhead a key asks for on a seek slider: the arrows move 5 seconds, Page Up and Page
 * Down a tenth of the length, Home and End go to the ends. Null for any other key.
 */
export function seekTargetForKey(key: string, now: number, duration: number): number | null {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return now - SEEK_STEP;
    case 'ArrowRight':
    case 'ArrowUp':
      return now + SEEK_STEP;
    case 'PageDown':
      return now - duration / 10;
    case 'PageUp':
      return now + duration / 10;
    case 'Home':
      return 0;
    case 'End':
      return duration;
    default:
      return null;
  }
}

/**
 * Writes a slider's value for assistive technology, only when it changed. Whole seconds, rounded
 * down like the value text and the clock (time.ts), so the numbers always agree.
 */
export function writeSliderValue(slider: HTMLElement, now: number, text: string): void {
  const value = String(Number.isFinite(now) && now > 0 ? Math.floor(now) : 0);
  if (slider.getAttribute('aria-valuenow') !== value) slider.setAttribute('aria-valuenow', value);
  if (slider.getAttribute('aria-valuetext') !== text) slider.setAttribute('aria-valuetext', text);
}
