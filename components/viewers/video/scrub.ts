/**
 * The numbers of a scroll-scrubbed video (motion sheet 6.2; the video block's `scrub` option): the
 * block sticks under the nav while the page scrolls through a run, and the video's time follows
 * the scroll through the scrub spring. Pure functions, for the player (components/viewers/video/
 * VideoPlayer.tsx), its engine, and the tests.
 */
import { media } from '@/lib/motion';

/**
 * The run's length in px for a video of `duration` seconds in a window `screen` px tall: 100 px of
 * scroll for each second of video, at least one screen height and at most three. 0 while the
 * duration is not known.
 */
export function scrubRunPx(duration: number, screen: number): number {
  if (!(duration > 0) || !(screen > 0)) return 0;
  const { pxPerSecond, minScreens, maxScreens } = media.scrub;
  return Math.round(Math.min(maxScreens * screen, Math.max(minScreens * screen, pxPerSecond * duration)));
}

/**
 * True when changing the run's length by `change` px cannot be seen. A longer or shorter run moves
 * only what follows it, which starts where the run ends: `end` px from the window's top now, and
 * `end + change` after. The change is hidden while both stay at or below the window's foot.
 */
export function runChangeHidden(end: number, change: number, screen: number): boolean {
  return Math.min(end, end + change) >= screen;
}

/**
 * The scroll offsets of the run, for Motion's useScroll with the run as its target: progress 0 when
 * the run's top reaches `top` (the pinned stage's place under the nav), 1 when it has risen `run`
 * px further, where the pin ends.
 */
export function scrubOffset(top: number, run: number): [`${number}px ${number}px`, `${number}px ${number}px`] {
  return [`0px ${top}px`, `${run}px ${top}px`];
}

/** The playhead for a progress through the run: progress times the duration, less the end guard. */
export function scrubTime(progress: number, duration: number): number {
  const span = Math.max(0, duration - media.scrub.endGuard);
  return Math.min(1, Math.max(0, progress || 0)) * span;
}
