/**
 * The sky's tiers (lib/sky/tier.ts; Phase 5 brief, decision 6; motion sheet 3.4): the tier chosen
 * from the device and the visitor's settings, and the frame-rate rule that steps it down.
 */
import { describe, expect, it } from 'vitest';
import { SKY } from '../lib/motion';
import {
  chooseTier,
  createFpsGovernor,
  lowerTier,
  readDeviceHints,
  saveDataOn,
  stepDown,
  webgl2Available,
  type TierHints,
} from '../lib/sky/tier';

const desktop: TierHints = {
  reducedMotion: false,
  saveData: false,
  paused: false,
  webgl2: true,
  finePointer: true,
  memoryGb: 8,
  cores: 8,
};

describe('chooseTier', () => {
  it('gives a desktop with a fine pointer the Full tier, with or without memory and core hints', () => {
    expect(chooseTier(desktop)).toBe('full');
    expect(chooseTier({ ...desktop, memoryGb: undefined, cores: undefined })).toBe('full');
    expect(chooseTier({ ...desktop, memoryGb: 4.5, cores: 6 })).toBe('full');
  });

  it('gives a coarse pointer, or 4 GB or 4 cores or fewer, the Light tier', () => {
    expect(chooseTier({ ...desktop, finePointer: false })).toBe('light');
    expect(chooseTier({ ...desktop, memoryGb: SKY.tiers.lightMemoryGb })).toBe('light');
    expect(chooseTier({ ...desktop, memoryGb: 2 })).toBe('light');
    expect(chooseTier({ ...desktop, cores: SKY.tiers.lightCores })).toBe('light');
    expect(chooseTier({ ...desktop, cores: 2 })).toBe('light');
  });

  it('gives reduced motion, Save-Data, the pause control and no WebGL2 the Still tier, on any device', () => {
    for (const device of [desktop, { ...desktop, finePointer: false }]) {
      expect(chooseTier({ ...device, reducedMotion: true })).toBe('still');
      expect(chooseTier({ ...device, saveData: true })).toBe('still');
      expect(chooseTier({ ...device, paused: true })).toBe('still');
      expect(chooseTier({ ...device, webgl2: false })).toBe('still');
    }
  });

  it('steps down one tier at a time and never up', () => {
    expect(stepDown('full')).toBe('light');
    expect(stepDown('light')).toBe('still');
    expect(stepDown('still')).toBe('still');
    expect(lowerTier('full', 'light')).toBe('light');
    expect(lowerTier('light', 'full')).toBe('light');
    expect(lowerTier('still', 'full')).toBe('still');
    expect(lowerTier('full', 'full')).toBe('full');
  });
});

describe('the device hints', () => {
  function fakeWindow({ fine = true, memory, cores, webgl2 = true, saveData }: { fine?: boolean; memory?: unknown; cores?: unknown; webgl2?: boolean; saveData?: boolean }) {
    return {
      matchMedia: (query: string) => ({ matches: query === '(pointer: fine)' ? fine : false }),
      navigator: { deviceMemory: memory, hardwareConcurrency: cores, ...(saveData === undefined ? {} : { connection: { saveData } }) },
      ...(webgl2 ? { WebGL2RenderingContext: function WebGL2RenderingContext() {} } : {}),
    } as unknown as Window;
  }

  it('reads the pointer, memory, cores and WebGL2, leaving out what the browser does not report', () => {
    expect(readDeviceHints(fakeWindow({ memory: 8, cores: 12 }))).toEqual({ finePointer: true, memoryGb: 8, cores: 12, webgl2: true });
    expect(readDeviceHints(fakeWindow({ fine: false, webgl2: false }))).toEqual({
      finePointer: false,
      memoryGb: undefined,
      cores: undefined,
      webgl2: false,
    });
    expect(readDeviceHints(fakeWindow({ memory: 'lots', cores: 0 }))).toMatchObject({ memoryGb: undefined, cores: undefined });
    expect(webgl2Available(fakeWindow({}))).toBe(true);
  });

  it('reads Save-Data only where the browser has a connection to ask', () => {
    expect(saveDataOn(fakeWindow({ saveData: true }))).toBe(true);
    expect(saveDataOn(fakeWindow({ saveData: false }))).toBe(false);
    expect(saveDataOn(fakeWindow({}))).toBe(false);
  });
});

describe('the frame-rate rule', () => {
  const every = SKY.scene.fpsEvery * 1000;
  const probe = SKY.tiers.probe * 1000;
  const run = SKY.demoteAfter * 1000;

  /** Feeds reports every SKY.scene.fpsEvery from `from`; returns the time of the first step down, or null. */
  function feed(governor: ReturnType<typeof createFpsGovernor>, from: number, rates: number[]): number | null {
    let at = from;
    for (const fps of rates) {
      at += every;
      if (governor.report(fps, at)) return at;
    }
    return null;
  }

  it('keeps a sky that holds its frame rate', () => {
    expect(feed(createFpsGovernor(0), 0, Array(40).fill(60))).toBeNull();
    // After the probe, the run rule keeps a sky at the line itself.
    expect(feed(createFpsGovernor(0), 0, [60, 60, ...Array(40).fill(SKY.demoteBelowFps)])).toBeNull();
  });

  it('holds the probe to its own line: 22 ms a frame is a little over 45 frames a second', () => {
    expect(feed(createFpsGovernor(0), 0, Array(4).fill(1000 / SKY.tiers.lightFrameMs))).toBeNull();
    expect(feed(createFpsGovernor(0), 0, Array(4).fill(SKY.demoteBelowFps))).toBe(probe);
  });

  it('steps down at the end of the first-second probe when its frames take over 22 ms', () => {
    const slow = 1000 / (SKY.tiers.lightFrameMs + 3);
    expect(feed(createFpsGovernor(0), 0, Array(10).fill(slow))).toBe(probe);
    // A probe that averages under the line keeps the tier, though one report was slow.
    expect(feed(createFpsGovernor(0), 0, [40, 60, 60, 60, 60, 60])).toBeNull();
  });

  it(`steps down when the frame rate stays under ${SKY.demoteBelowFps} for ${SKY.demoteAfter} s after the probe`, () => {
    const governor = createFpsGovernor(0);
    expect(feed(governor, 0, [60, 60, 60, 60])).toBeNull();
    // Slow from 2,000 ms: the first slow report (at 2,500) covers the time since 2,000.
    expect(feed(governor, 2 * every * 2, Array(10).fill(30))).toBe(2 * every * 2 + run);
  });

  it('starts the run over when a report is good again', () => {
    const governor = createFpsGovernor(0);
    feed(governor, 0, [60, 60]);
    expect(feed(governor, probe, [30, 30, 30, 60, 30, 30, 30])).toBeNull();
    expect(feed(governor, probe + 7 * every, [30])).toBe(probe + 8 * every);
  });

  it('forgets a run on reset (the loop stopped), and restarts a probe that had not finished', () => {
    const governor = createFpsGovernor(0);
    feed(governor, 0, [60, 60, 30, 30, 30]);
    governor.reset(60_000);
    // Without the reset these two would close a two-second run.
    expect(feed(governor, 60_000, [30, 30])).toBeNull();

    const early = createFpsGovernor(0);
    expect(early.report(20, every)).toBe(false);
    early.reset(10_000);
    expect(early.report(60, 10_000 + every)).toBe(false);
    expect(early.report(60, 10_000 + probe)).toBe(false);
  });

  it("does not step down for one stall of the page's main thread", () => {
    const stall = SKY.tiers.stall * 1000;
    expect(stall).toBe(2 * every);
    for (const blocked of [2100, 3000, 6000]) {
      const governor = createFpsGovernor(0);
      expect(feed(governor, 0, [60, 60, 60, 60])).toBeNull();
      // One report spanning the stall (a frame or two in it), then the sky's own rate again.
      expect(governor.report(1, 2 * probe + blocked), String(blocked)).toBe(false);
      expect(feed(governor, 2 * probe + blocked, [60, 60, 60, 60, 60, 60, 60, 60]), String(blocked)).toBeNull();
    }
  });

  it('steps down when the slow reports go on after a stall, counted from its end', () => {
    const governor = createFpsGovernor(0);
    feed(governor, 0, [60, 60, 60, 60]);
    const end = 2 * probe + 2500;
    expect(governor.report(2, end)).toBe(false);
    expect(feed(governor, end, Array(10).fill(30))).toBe(end + run);
  });

  it('still steps down a sky too slow to report within the stall line', () => {
    const governor = createFpsGovernor(0);
    feed(governor, 0, [60, 60, 60, 60]);
    // One frame every two seconds: every report spans more than the stall line.
    const reports = [2 * probe + 2000, 2 * probe + 4000, 2 * probe + 6000].map((at) => governor.report(0.5, at));
    expect(reports).toEqual([false, true, false]);
  });

  it('treats a missing or broken report as no frames', () => {
    const governor = createFpsGovernor(0);
    expect(governor.report(Number.NaN, every)).toBe(false);
    expect(governor.report(-5, probe)).toBe(true);
  });
});
