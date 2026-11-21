/**
 * The arithmetic and the rules of the tools ticker (motion sheet 7.7; `page.ticker` in
 * lib/motion.ts) and of the phone strip's carousel (sheet 6.4; `page.strip`), apart from React so
 * the tests can check them. Both are Motion+ Tickers (the Carousel is one). An offset is how far
 * the list has slid, in px: it falls as the list slides left. The ticker's offset is never wrapped
 * here; the Motion+ Ticker wraps it into one copy of the list as it draws it.
 */

/** Pixels a second that slide one full copy of the list (`period`, px) past in `loop` seconds. */
export function tickerSpeed(period: number, loop: number): number {
  return period > 0 && loop > 0 ? period / loop : 0;
}

/** The offset after one frame of `deltaMs` at `speed` px a second, sliding left. */
export function tickerAdvance(offset: number, deltaMs: number, speed: number): number {
  return offset - (Math.max(0, deltaMs) / 1000) * speed;
}

/** Half a pixel: an item whose start is this close to the strip's start already starts there. */
const EDGE = 0.5;

/**
 * The offset that brings the next item's start (direction 1) or the previous one's (-1) to the
 * start of the strip, as the arrow keys move it. `starts` are the items' starts within one copy of
 * the list, the first at 0, and `period` the length of that copy; the list repeats, so the step
 * past the last item lands on the first item of the next copy, and back past the first on the last
 * item of the copy before.
 */
export function tickerStep(offset: number, starts: readonly number[], period: number, direction: 1 | -1): number {
  if (!(period > 0) || starts.length === 0) return offset;
  const inset = -offset;
  const copy = Math.floor(inset / period);
  const within = inset - copy * period;
  if (direction > 0) {
    const next = starts.find((start) => start > within + EDGE);
    return -(next !== undefined ? copy * period + next : (copy + 1) * period + starts[0]);
  }
  let previous: number | undefined;
  for (const start of starts) if (start < within - EDGE) previous = start;
  return -(previous !== undefined ? copy * period + previous : (copy - 1) * period + starts[starts.length - 1]);
}

/** What holds the moving ticker still (sheet 7.7: it pauses on hover and on focus). */
export interface TickerHolds {
  /** A mouse or a pen over it; a touch has no hover. */
  hover: boolean;
  /** Keyboard focus inside it: the canvas's home.css pauses it on focus "so a keyboard can stop it too". */
  focus: boolean;
  /** A press or a drag on it, until the pointer is released anywhere. */
  press: boolean;
}

export const NO_HOLDS: TickerHolds = { hover: false, focus: false, press: false };

/** What the moving ticker's listeners report. */
export type TickerInput =
  | { type: 'enter' | 'leave'; pointer: string }
  | { type: 'press' | 'release' }
  | { type: 'focus'; keyboard: boolean }
  | { type: 'key' }
  | { type: 'blur' };

/**
 * The holds after `input`, as the same object when nothing changes (so React skips the render).
 * - A mouse or a pen over the strip holds it; a touch does not.
 * - A press holds it until the release, wherever that happens. A press is pointer use, so it also
 *   ends a hold by focus: the strip takes focus, and focus that a click or a tap gives it must not
 *   leave it still, with no ring to say why, once the pointer has left.
 * - Focus holds it only when it is keyboard focus (as the browser draws the focus ring), and so
 *   does a key pressed while focus is inside (the arrow keys step it); focus leaving it lets go.
 */
export function tickerHolds(holds: TickerHolds, input: TickerInput): TickerHolds {
  let next: Partial<TickerHolds>;
  switch (input.type) {
    case 'enter':
    case 'leave':
      if (input.pointer === 'touch') return holds;
      next = { hover: input.type === 'enter' };
      break;
    case 'press':
      next = { press: true, focus: false };
      break;
    case 'release':
      next = { press: false };
      break;
    case 'focus':
      next = { focus: input.keyboard };
      break;
    case 'key':
      next = { focus: true };
      break;
    case 'blur':
      next = { focus: false };
      break;
  }
  const keys = Object.keys(next) as (keyof TickerHolds)[];
  return keys.every((key) => holds[key] === next[key]) ? holds : { ...holds, ...next };
}

/** Whether the ticker holds still: held, out of view, or in a hidden tab. */
export function tickerHeld(holds: TickerHolds, inView: boolean, visible: boolean): boolean {
  return holds.hover || holds.focus || holds.press || !inView || !visible;
}

/**
 * Whether the focus on `el` is keyboard focus, which the browser marks with :focus-visible. A
 * browser that does not know the selector counts all focus as keyboard focus.
 */
export function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * The carousel offset that turns it to card `index`: the card's start at the strip's start, or, for
 * the last cards, the strip's end at the last card's end (`maxInset`, how far the carousel goes;
 * null if it does not stop). Null when that card is not measured.
 */
export function cardTarget(itemPositions: readonly { start: number }[], maxInset: number | null, index: number): number | null {
  const start = itemPositions[index]?.start;
  if (start === undefined) return null;
  const inset = maxInset === null ? start : Math.min(start, maxInset);
  return inset === 0 ? 0 : -inset;
}

/**
 * The carousel offset of the card nearest to `offset` (where the carousel is drawn now), counting
 * the card it rests on: where it settles when the browser takes a press over for a page scroll.
 * Null when nothing is measured.
 */
export function nearestCardTarget(itemPositions: readonly { start: number }[], maxInset: number | null, offset: number): number | null {
  let nearest: number | null = null;
  for (let index = 0; index < itemPositions.length; index++) {
    const target = cardTarget(itemPositions, maxInset, index);
    if (target !== null && (nearest === null || Math.abs(target - offset) < Math.abs(nearest - offset))) nearest = target;
  }
  return nearest;
}
