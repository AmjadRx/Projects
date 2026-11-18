/**
 * The 24 hourly sidereal steps of the still sky (docs/V3_PLAN.md 5.7, "Still and live sky").
 *
 * The Blueprint still is rendered at 24 local sidereal times at Santa Clara, 0h to 23h, for each
 * width class. Before the first paint, the inline head script picks the step nearest the current
 * local sidereal time there. The live sky starts from that step's sidereal time, within half an
 * hour of the real sky, so its fade over the still shows no jump, then turns at SKY.speed times the
 * real rate. The scene depends on the clock only through the local sidereal time (J2000 positions,
 * no Sun or Moon), so a step is fully described by its sidereal time.
 *
 * The live sky should read back the step the head script chose rather than call `stillStepAt`
 * again when it starts: near a half-hour boundary a later call can land on the next step.
 */
import { SKY } from '../motion';
import { DAY_MS, GMST_J2000_DEG, J2000_MS, SIDEREAL_DEG_PER_DAY, lstDeg, wrap180 } from './astro';

/** The number of still steps: one for each hour of sidereal time. */
export const STILL_STEPS = 24;

/** Degrees of sidereal time from one step to the next: one hour. */
export const STILL_STEP_DEG = 360 / STILL_STEPS;

/** The local sidereal time of a step, in degrees: step 7 is 105 degrees (7h). */
export function stepSiderealDeg(step: number): number {
  return step * STILL_STEP_DEG;
}

/** The step, 0 to 23, nearest the local sidereal time at Santa Clara at a moment in Unix milliseconds. */
export function stillStepAt(ms: number): number {
  return Math.round(lstDeg(ms, SKY.site.lon) / STILL_STEP_DEG) % STILL_STEPS;
}

/**
 * The moment nearest `ms` at which the local sidereal time at Santa Clara is the step's, in Unix
 * milliseconds. The live sky starts its clock here, so its first frame is the still's sky; for the
 * step `stillStepAt(ms)` picks, it is less than half a sidereal hour from `ms`.
 */
export function stepTimeNear(step: number, ms: number): number {
  return ms + (wrap180(stepSiderealDeg(step) - lstDeg(ms, SKY.site.lon)) / SIDEREAL_DEG_PER_DAY) * DAY_MS;
}

/**
 * `stillStepAt` for the inline head script: a dependency-free JavaScript function expression of a
 * Unix time in milliseconds, so `(${STILL_STEP_SCRIPT})(Date.now())` is the step. It does the same
 * arithmetic in the same order as `stillStepAt` (gmstDeg and lstDeg in ./astro), so the two always
 * agree (tests/sky-astro.test.ts). It holds no doubled braces, which the content check reads as
 * template placeholders.
 */
export const STILL_STEP_SCRIPT =
  `function(t){var g=${GMST_J2000_DEG}+${SIDEREAL_DEG_PER_DAY}*((t-${J2000_MS})/${DAY_MS});` +
  `g=((g%360)+360)%360+(${SKY.site.lon});g=((g%360)+360)%360;` +
  `return Math.round(g/${STILL_STEP_DEG})%${STILL_STEPS}}`;

/**
 * The moment the design bundle's previews show: 21:00 Pacific time on 16 November 2026, which is
 * 05:00 UTC on 17 November.
 */
export const PREVIEW_MS = Date.UTC(2026, 10, 17, 5, 0, 0);

/**
 * A fixed step for the server HTML, which cannot know the visitor's clock: the bundle's preview
 * moment. The head script replaces it before the first paint whenever scripts run.
 */
export const STILL_FALLBACK_STEP = stillStepAt(PREVIEW_MS);
