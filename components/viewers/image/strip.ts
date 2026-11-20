/**
 * The gallery strip's arithmetic (components/viewers/image/Gallery.tsx; motion sheet 6.4), pure for
 * tests. Motion+ Carousel measures the frames (useTicker's `itemPositions`: where each frame starts
 * and ends along the strip's list, in px) and how far the strip can travel (`maxInset`: null until
 * it has measured, 0 when every frame fits). An inset is how far the strip has moved to the left,
 * so at inset 0 the first frame starts at the column's edge; Carousel's own offset is the inset
 * negated on a left-to-right page.
 */
import type { Transition } from 'motion/react';
import { media } from '@/lib/motion';

/** A frame along the strip, in px, as Carousel measures it (offsetLeft and offsetWidth). */
export interface FramePosition {
  readonly start: number;
  readonly end: number;
}

/** Measured positions are whole px: anything nearer than this is the same place. */
export const SAME_PLACE = 0.5;

/** Where frame `index` starts, counted from the first frame's start. */
function startOf(positions: readonly FramePosition[], index: number): number {
  const first = positions[0];
  const frame = positions[index];
  return first && frame ? frame.start - first.start : 0;
}

/** An inset held to the strip's travel: 0 to `maxInset` (no upper end until measured). */
export function clampInset(inset: number, maxInset: number | null): number {
  return Math.max(0, maxInset === null ? inset : Math.min(inset, maxInset));
}

/** The inset that starts frame `index` at the strip's left edge, or as near as the end allows. */
export function frameInset(positions: readonly FramePosition[], index: number, maxInset: number | null): number {
  return clampInset(startOf(positions, index), maxInset);
}

/** The first frame whose `place` is nearest `inset`. */
function nearestBy(count: number, inset: number, place: (index: number) => number): number {
  let best = 0;
  let distance = Infinity;
  for (let index = 0; index < count; index += 1) {
    const gap = Math.abs(place(index) - inset);
    if (gap < distance) {
      distance = gap;
      best = index;
    }
  }
  return best;
}

/** The frame that starts nearest an inset: what the counter says once the strip has settled. */
export function nearestFrame(positions: readonly FramePosition[], inset: number): number {
  return nearestBy(positions.length, inset, (index) => startOf(positions, index));
}

/**
 * The frame whose resting place is nearest an inset: where a strip let go without motion settles
 * (sheet 8.1), moving the least. Frames that share the end's place give the first of them.
 */
export function nearestRest(positions: readonly FramePosition[], inset: number, maxInset: number | null): number {
  return nearestBy(positions.length, inset, (index) => frameInset(positions, index, maxInset));
}

/**
 * Whether frame `index` lies wholly inside the strip while it rests at `inset`. Carousel's
 * `maxInset` is the frames' whole length less the strip's width, which gives the width. True while
 * nothing is measured, and when every frame fits.
 */
export function frameInView(
  positions: readonly FramePosition[],
  index: number,
  inset: number,
  maxInset: number | null,
): boolean {
  const first = positions[0];
  const last = positions[positions.length - 1];
  const frame = positions[index];
  if (!first || !last || !frame || maxInset === null || maxInset <= 0) return true;
  const width = last.end - first.start - maxInset;
  const start = frame.start - first.start;
  const end = frame.end - first.start;
  return start >= inset - SAME_PLACE && end <= inset + width + SAME_PLACE;
}

/**
 * How far a wheel moves the strip along itself, read as Carousel reads a wheel (motion-plus
 * `wheel`): the sideways delta, or the vertical one with Shift held; 0 when the wheel runs mostly
 * across the strip, which is the page's own scroll. Positive moves toward the last frame.
 */
export function wheelAlong(event: { deltaX: number; deltaY: number; shiftKey: boolean }): number {
  const along = event.shiftKey ? event.deltaY : event.deltaX;
  const across = event.shiftKey ? event.deltaX : event.deltaY;
  return Math.abs(along) < Math.abs(across) ? 0 : along;
}

/**
 * Whether a move toward the last frame (`toward` above 0) or the first (below 0) would push a strip
 * resting at `inset` past the end it already rests at. When every frame fits, both ways are past
 * an end. Never before the strip is measured.
 */
export function headsPastEnd(inset: number, maxInset: number | null, toward: number): boolean {
  if (maxInset === null || toward === 0) return false;
  return toward > 0 ? inset >= maxInset - SAME_PLACE : inset <= SAME_PLACE;
}

/**
 * How the strip moves (sheet 6.4): the snap spring for every move, and the stretch at the ends.
 * Without motion (sheet 8.1) every move takes no time and the strip stops at the ends.
 */
export function stripMotion(motionOk: boolean): { transition: Transition; elastic: number } {
  return motionOk
    ? { transition: media.gallery.snap, elastic: media.gallery.overdrag }
    : { transition: media.gallery.atOnce, elastic: 0 };
}

/**
 * Carousel keeps the transition object it gets on its first render for its own paging (a wheel
 * swipe), so the strip hands it one object for its whole life and swaps what that object says
 * when motion becomes allowed or not (the first render always allows it: useMotionOk() answers as
 * the server did until the page has hydrated).
 */
export function swapTransition(target: Record<string, unknown>, source: Transition): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}
