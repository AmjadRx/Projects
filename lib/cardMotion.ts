/**
 * The arithmetic of a project card's motion (motion sheets 5 and 7), kept apart from React and the
 * DOM so the tests can check it: the tilt toward the pointer, the callouts' timeline and its exact
 * reverse, the model cover's swing, which cover runs on a phone, the filter's cards, and the name
 * a cover carries through the card-to-page transition. Every number comes from lib/motion.ts.
 */
import type { Bezier } from './motion';

/** A box in CSS px, as getBoundingClientRect gives it. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A card's pose for a pointer over it. */
export interface Tilt {
  /** Degrees about the horizontal axis: positive when the pointer is in the top half. */
  rotateX: number;
  /** Degrees about the vertical axis: positive when the pointer is in the right half. */
  rotateY: number;
  /** Where the pointer is across and down the card, 0 to 1 (the highlight's centre). */
  fx: number;
  fy: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Sheet 5.2, Tilt: the card turns toward the pointer about its centre, rotateX from the pointer's
 * height on the card and rotateY from its width, up to `max` degrees at an edge (the bundle's
 * ProjectCard: (0.5 - y) * 2 * max and (x - 0.5) * 2 * max). A pointer outside the box counts as on
 * its edge, so a fast move never tips a card past `max`.
 */
export function tiltToward(clientX: number, clientY: number, box: Box, max: number): Tilt {
  const fx = box.width > 0 ? clamp((clientX - box.left) / box.width, 0, 1) : 0.5;
  const fy = box.height > 0 ? clamp((clientY - box.top) / box.height, 0, 1) : 0.5;
  return { rotateX: (0.5 - fy) * 2 * max, rotateY: (fx - 0.5) * 2 * max, fx, fy };
}

/** Rounds a time or a control point to the microsecond, so subtraction leaves no float dust. */
const tidy = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * The same curve played backwards: the point at time t of the original is the point at time 1 - t
 * of this one. Undrawing on a mirrored curve retraces the draw exactly.
 */
export function mirrorEase(curve: Bezier): Bezier {
  const [x1, y1, x2, y2] = curve;
  return [tidy(1 - x2), tidy(1 - y2), tidy(1 - x1), tidy(1 - y1)];
}

/** One part of a timeline, as lib/motion.ts writes it: when it starts, how long, on which curve. */
export interface TimedPart {
  start: number;
  duration: number;
  ease: Bezier;
}

/** A part's Motion transition: its delay, duration and curve, in seconds. */
export interface PartTransition {
  delay: number;
  duration: number;
  ease: Bezier;
}

export interface CalloutParts<T> {
  lines: T;
  arrowheads: T;
  plates: T;
}

/**
 * Sheet 5.3: the callouts draw in three parts (the lines, then the plates and the arrowheads) and
 * on leave undraw in reverse: the whole timeline played backwards, so the part that finished last
 * leaves first, each on its mirrored curve, and the lines are gone exactly `total` after the leave.
 */
export function calloutTimeline(parts: CalloutParts<TimedPart>): {
  total: number;
  draw: CalloutParts<PartTransition>;
  undraw: CalloutParts<PartTransition>;
} {
  const all = [parts.lines, parts.arrowheads, parts.plates];
  const total = tidy(Math.max(...all.map((p) => p.start + p.duration)));
  const forward = (p: TimedPart): PartTransition => ({ delay: p.start, duration: p.duration, ease: p.ease });
  const backward = (p: TimedPart): PartTransition => ({
    delay: tidy(total - p.start - p.duration),
    duration: p.duration,
    ease: mirrorEase(p.ease),
  });
  return {
    total,
    draw: { lines: forward(parts.lines), arrowheads: forward(parts.arrowheads), plates: forward(parts.plates) },
    undraw: { lines: backward(parts.lines), arrowheads: backward(parts.arrowheads), plates: backward(parts.plates) },
  };
}

/**
 * Sheet 5.2, Model cover: the angle `seconds` into a swing of `swing` degrees either way on a sine
 * of `cycle` seconds. It starts at 0 and rises first.
 */
export function swingAngle(seconds: number, swing: number, cycle: number): number {
  return swing * Math.sin((2 * Math.PI * seconds) / cycle);
}

/**
 * The time in the cycle where the swing passes `angle` on its way up, so a cover that is still
 * springing back carries on from where it is instead of jumping to the start.
 */
export function swingTimeAt(angle: number, swing: number, cycle: number): number {
  if (!(swing > 0)) return 0;
  return (Math.asin(clamp(angle / swing, -1, 1)) / (2 * Math.PI)) * cycle;
}

/**
 * The thresholds an IntersectionObserver reports a card's share in view at: 0 (gone), then
 * `steps` even steps from `from` to 1.
 */
export function inViewThresholds(from: number, steps: number): number[] {
  const n = Math.max(1, Math.floor(steps));
  const out = [0];
  for (let i = 0; i <= n; i += 1) out.push(tidy(from + ((1 - from) * i) / n));
  return [...new Set(out)];
}

/**
 * Sheet 5.2, Phones: the cover that runs is the one most in view, if at least `threshold` of its
 * card is; a tie keeps the cover already running, so two cards in view never take turns. Null
 * when no card is far enough in view.
 */
export function pickRunner(shares: ReadonlyMap<string, number>, threshold: number, current: string | null): string | null {
  let best: string | null = null;
  let bestShare = -1;
  for (const [id, share] of shares) {
    if (share < threshold) continue;
    if (share > bestShare || (share === bestShare && id === current)) {
      best = id;
      bestShare = share;
    }
  }
  return best;
}

/** Sheet 7.4: the cards a domain filter shows, in their order; an empty key is All. */
export function cardsForDomain<T extends { domains: readonly string[] }>(items: readonly T[], key: string): T[] {
  return key === '' ? [...items] : items.filter((item) => item.domains.includes(key));
}

/**
 * Sheet 7.3: the shared element's name for a project's cover, `cover-<slug>`. Slugs are lowercase
 * letters, digits and hyphens (lib/schema.ts); anything else becomes a hyphen, and the prefix keeps
 * the name a valid CSS identifier even for a slug that starts with a digit.
 */
export function coverTransitionName(slug: string): string {
  return `cover-${slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

/**
 * Sheet 7.3, Back: whether a card's cover counts as on screen, so the cover may travel back into
 * it: at least half of it across and half of it down lies inside the window.
 */
export function mostlyOnScreen(box: Box, viewWidth: number, viewHeight: number): boolean {
  if (!(box.width > 0) || !(box.height > 0)) return false;
  const across = Math.min(box.left + box.width, viewWidth) - Math.max(box.left, 0);
  const down = Math.min(box.top + box.height, viewHeight) - Math.max(box.top, 0);
  return across >= box.width / 2 && down >= box.height / 2;
}

/** The parts of a click that decide whether the page may take it over. */
export interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/**
 * A plain primary click (or Enter on a link): no modifier, the main button, not already handled.
 * Anything else (a new tab, a new window, a download) is left to the browser.
 */
export function isPlainClick(event: ClickLike): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
