/**
 * The arithmetic of the chrome's motion (motion sheet 7, "Page motion"), free of React and the DOM
 * so the tests run it as it is: the page progress that the heat rule and the lit zone follow, the
 * zone it lights, the heat rule's two translations, the delays of a group of rising panels, and
 * the delays of the phone menu's links. Every number comes from `page` in lib/motion.ts.
 */
import { page, toMs } from '@/lib/motion';

/**
 * The page progress of sheet 7.1: the distance scrolled over the page height less the window
 * height, from 0 to 1. A page that does not scroll has no progress (0): Motion's own
 * scrollYProgress reads 1 there, which would draw the whole heat rule and light zone F on a page
 * that has nothing to read further.
 */
export function pageProgress(scrollY: number, scrollLength: number): number {
  if (!(scrollLength > 0) || !Number.isFinite(scrollY)) return 0;
  return Math.min(1, Math.max(0, scrollY / scrollLength));
}

/**
 * The zone of the sheet border lit at a page progress: the page is split into as many equal parts
 * as there are zone marks (A to F), and the last part includes the very end. 0 is the first zone.
 */
export function zoneAt(progress: number, zones: number): number {
  if (!(zones > 1)) return 0;
  const p = Number.isFinite(progress) ? progress : 0;
  return Math.min(zones - 1, Math.max(0, Math.floor(p * zones)));
}

/** A percentage for a CSS translation, to four decimals, with no negative zero. */
function percent(value: number): string {
  const rounded = Number(value.toFixed(4));
  return `${rounded === 0 ? 0 : rounded}%`;
}

/**
 * The heat rule at a page progress: its window (`bar`) slides in from the left by the progress
 * while the ramp inside it (`fill`) slides back by as much, so the ramp stays on the page width
 * and the line's right end sits at `progress` of it. Two translations that are linear in the
 * progress, so CSS can tie the same keyframes to scroll (app/motion-chrome.css) and the line has
 * no singular start, as a ramp counter-scaled by 1 / progress would at the top of the page.
 */
export function heatTransforms(progress: number): { bar: string; fill: string } {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return { bar: `translateX(${percent((p - 1) * 100)})`, fill: `translateX(${percent((1 - p) * 100)})` };
}

/**
 * The delay of the panel at `index` in a group that comes into view together, in ms: 60 ms apart,
 * at most three to a group, so a fourth and any later one start with the third (sheet 7.2).
 */
export function riseDelay(index: number): number {
  const { step, groupMax } = page.panels;
  return toMs(Math.min(Math.max(0, index), groupMax - 1) * step);
}

/** The delay of the phone menu's link at `index`, in ms: 40 ms apart from 80 ms (sheet 7.5). */
export function menuLinkDelay(index: number): number {
  const { start, step } = page.menu.links;
  return toMs(start + Math.max(0, index) * step);
}
