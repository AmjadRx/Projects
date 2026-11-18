/**
 * The sky's three tiers (Phase 5 brief, decision 6; motion sheet 3.4) and when a tier steps down.
 *
 * - Full: a fine pointer and a capable machine. Everything.
 * - Light: a coarse pointer (phones and tablets), or 4 GB of memory or 4 cores or fewer where the
 *   browser reports them. Fewer stars, the 2K Milky Way, no names and no meteor.
 * - Still: reduced motion, Save-Data, no WebGL2, the visitor's pause control, a failed load, or a
 *   step down from Light. The pre-rendered still image, which is also every tier's first paint.
 *
 * A running sky steps down one tier (Full to Light, Light to Still) when its frame rate stays under
 * SKY.demoteBelowFps for SKY.demoteAfter seconds, and never steps back up during a visit. The first
 * second after the sky starts is a probe that can step it down at once (`createFpsGovernor`).
 *
 * `chooseTier`, `lowerTier`, `stepDown` and `createFpsGovernor` are pure; `readDeviceHints`,
 * `saveDataOn` and `webgl2Available` read a browser window. components/sky/host.ts uses them all;
 * tests/sky-tier.test.ts checks them.
 */
import { SKY } from '../motion';

export type SkyTier = 'full' | 'light' | 'still';
/** A tier the live scene draws. */
export type LiveTier = Exclude<SkyTier, 'still'>;

/** What the tier is chosen from. */
export interface TierHints {
  /** prefers-reduced-motion: reduce (or /admin), read live. */
  reducedMotion: boolean;
  /** The Save-Data hint (navigator.connection.saveData), read live. */
  saveData: boolean;
  /** The visitor's pause-motion choice (lib/motionPause.ts). */
  paused: boolean;
  /** The browser has WebGL2, which the scene's three.js needs. */
  webgl2: boolean;
  /** The primary pointer is fine (a mouse, a trackpad or a pen): (pointer: fine). */
  finePointer: boolean;
  /** navigator.deviceMemory in GB, where the browser reports it. */
  memoryGb?: number;
  /** navigator.hardwareConcurrency, where the browser reports it. */
  cores?: number;
}

const RANK: Record<SkyTier, number> = { still: 0, light: 1, full: 2 };

/** The tier the sky starts at, from the hints. */
export function chooseTier(hints: TierHints): SkyTier {
  if (hints.reducedMotion || hints.saveData || hints.paused || !hints.webgl2) return 'still';
  if (!hints.finePointer) return 'light';
  if (hints.memoryGb !== undefined && hints.memoryGb <= SKY.tiers.lightMemoryGb) return 'light';
  if (hints.cores !== undefined && hints.cores <= SKY.tiers.lightCores) return 'light';
  return 'full';
}

/** The lower of two tiers. */
export function lowerTier(a: SkyTier, b: SkyTier): SkyTier {
  return RANK[a] <= RANK[b] ? a : b;
}

/** One tier down: Full to Light, Light (or Still) to Still. */
export function stepDown(tier: SkyTier): SkyTier {
  return tier === 'full' ? 'light' : 'still';
}

/** The device's own hints, which do not change during a visit. */
export function readDeviceHints(win: Window): Pick<TierHints, 'finePointer' | 'memoryGb' | 'cores' | 'webgl2'> {
  const nav = win.navigator as Navigator & { deviceMemory?: unknown };
  const memory = nav.deviceMemory;
  const cores = nav.hardwareConcurrency;
  return {
    finePointer: typeof win.matchMedia === 'function' && win.matchMedia('(pointer: fine)').matches,
    memoryGb: typeof memory === 'number' && memory > 0 ? memory : undefined,
    cores: typeof cores === 'number' && cores > 0 ? cores : undefined,
    webgl2: webgl2Available(win),
  };
}

/**
 * True when the browser offers WebGL2, which three.js needs. This reads the API only: making a
 * context to test it would cost every visitor a context. A browser that offers WebGL2 but cannot
 * make a context (a blocked GPU) fails in the scene, and the host goes to Still.
 */
export function webgl2Available(win: Window): boolean {
  return typeof (win as Window & { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext === 'function';
}

/** The connection the Save-Data hint comes from, where the browser has one. */
export interface SaveDataConnection {
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

/** navigator.connection, where the browser has it (Chromium browsers). */
export function connectionOf(win: Window): SaveDataConnection | undefined {
  return (win.navigator as Navigator & { connection?: SaveDataConnection }).connection;
}

/** True while the browser asks sites to save data. */
export function saveDataOn(win: Window): boolean {
  return connectionOf(win)?.saveData === true;
}

/** Watches the live scene's frame rate and says when the tier must step down. */
export interface FpsGovernor {
  /**
   * One report from the scene's onFps (about every SKY.scene.fpsEvery seconds while it runs) at
   * `nowMs` (performance.now()). True when the tier must step down now.
   */
  report(fps: number, nowMs: number): boolean;
  /**
   * The frame loop stopped or started again, or the tier changed: the run of slow reports starts
   * over, and so does a probe that has not finished.
   */
  reset(nowMs: number): void;
}

/** A frame rate as milliseconds a frame. */
function frameMs(fps: number): number {
  return fps > 0 ? 1000 / fps : Infinity;
}

/**
 * The frame-rate rule, from `startMs`, the moment the scene drew its first frame:
 * - Probe: the reports of the first SKY.tiers.probe seconds are averaged when it ends. Over
 *   SKY.tiers.lightFrameMs a frame, the tier steps down at once, without waiting for the run below.
 *   (The scene reports frames a second, which the screen's refresh caps, 16.7 ms a frame at 60 Hz;
 *   so the sheet's 12 ms line between Full and Light cannot be told from it, and only the 22 ms
 *   line decides here.)
 * - Run: reports under SKY.demoteBelowFps for SKY.demoteAfter seconds in a row step the tier down.
 *   A report covers the time since the one before it, so the run starts where the first slow
 *   report's period began.
 * - Stall: a report that spans more than SKY.tiers.stall seconds covers a stall of the page's main
 *   thread (a heavy route render, a long script), not the sky's own frame rate. It does not start
 *   a run: the run starts at its end instead, so the sky steps down only if the slow reports go on
 *   after it. A run already under way goes on through it, so a sky too slow to report in time
 *   still steps down.
 */
export function createFpsGovernor(startMs: number): FpsGovernor {
  const probeMs = SKY.tiers.probe * 1000;
  const runMs = SKY.demoteAfter * 1000;
  const stallMs = SKY.tiers.stall * 1000;
  let probeFrom: number | null = startMs;
  let probeSum = 0;
  let probeCount = 0;
  let lastAt = startMs;
  let slowSince: number | null = null;

  return {
    report(fps, nowMs) {
      const rate = Number.isFinite(fps) && fps > 0 ? fps : 0;
      const periodStart = lastAt;
      lastAt = nowMs;
      if (probeFrom !== null) {
        probeSum += rate;
        probeCount += 1;
        if (nowMs - probeFrom >= probeMs) {
          probeFrom = null;
          if (frameMs(probeSum / probeCount) > SKY.tiers.lightFrameMs) {
            slowSince = null;
            return true;
          }
        }
      }
      if (rate >= SKY.demoteBelowFps) {
        slowSince = null;
        return false;
      }
      if (slowSince === null) {
        if (nowMs - periodStart > stallMs) {
          slowSince = nowMs;
          return false;
        }
        slowSince = periodStart;
      }
      if (nowMs - slowSince >= runMs) {
        slowSince = null;
        return true;
      }
      return false;
    },
    reset(nowMs) {
      slowSince = null;
      lastAt = nowMs;
      if (probeFrom !== null) {
        probeFrom = nowMs;
        probeSum = 0;
        probeCount = 0;
      }
    },
  };
}
