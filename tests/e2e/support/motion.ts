/**
 * Measuring motion at rest (ARCHITECTURE.md 15, item 7; the BRIEF rule "nothing runs at rest"):
 * the animations still running, and requestAnimationFrame activity over a span of time.
 */
import type { Page } from '@playwright/test';

/**
 * The rule the checks call a requestAnimationFrame loop by: a span of LOOP_SPAN_MS milliseconds
 * with a callback in more than LOOP_FRAMES frames. A loop shows 15 frames or more in such a span at
 * 60 Hz, and still four or five on a machine so busy that it draws 18 frames a second; one-off
 * calls take a frame or two.
 */
export const LOOP_SPAN_MS = 250;
export const LOOP_FRAMES = 2;

interface FrameMeterApi {
  start(): void;
  stop(): FrameActivity;
}

export interface FrameActivity {
  /** requestAnimationFrame calls made during the span. */
  calls: number;
  /** Frames in which at least one requestAnimationFrame callback ran during the span. */
  frames: number;
  /** Where the first calls came from (stack lines), for the report. */
  callers: string[];
}

/**
 * Installed with page.addInitScript, so it is in place before any of the page's scripts run (and
 * before any library keeps its own reference to requestAnimationFrame): it wraps the function to
 * count calls, and the frames their callbacks run in, while the meter is on.
 */
export function installFrameMeter(): void {
  const native = window.requestAnimationFrame.bind(window);
  let on = false;
  let calls = 0;
  let frames = new Set<number>();
  let callers: string[] = [];
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    if (on) {
      calls += 1;
      if (callers.length < 3) {
        // The page's own frames only: the meter's wrappers have no file of their own (<anonymous>).
        const stack = String(new Error().stack ?? '')
          .split('\n')
          .slice(2)
          .map((line) => line.trim())
          .filter((line) => line.startsWith('at ') && !line.includes('<anonymous>'))
          .slice(0, 3)
          .join(' < ');
        if (stack && !callers.includes(stack)) callers.push(stack);
      }
    }
    return native((time) => {
      if (on) frames.add(time);
      callback(time);
    });
  };
  const api: FrameMeterApi = {
    start() {
      on = true;
      calls = 0;
      frames = new Set<number>();
      callers = [];
    },
    stop() {
      on = false;
      return { calls, frames: frames.size, callers };
    },
  };
  (window as unknown as { __e2eFrameMeter: FrameMeterApi }).__e2eFrameMeter = api;
}

/**
 * requestAnimationFrame activity over `ms` milliseconds, measured inside the page (the span is a
 * measurement, so it is a fixed time by nature). A loop shows as a callback in nearly every frame
 * (about 30 frames in 500 ms at 60 Hz, more where headless Chrome draws faster); one-off calls
 * show as a frame or two.
 */
export async function frameActivity(page: Page, ms: number): Promise<FrameActivity> {
  return page.evaluate(async (span) => {
    const meter = (window as unknown as { __e2eFrameMeter?: FrameMeterApi }).__e2eFrameMeter;
    if (!meter) throw new Error('The frame meter is not installed (installFrameMeter)');
    meter.start();
    await new Promise((resolve) => setTimeout(resolve, span));
    return meter.stop();
  }, ms);
}

/** The animations running now (CSS animations and transitions, and Web Animations), described. */
export async function runningAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const describe = (target: Element | null | undefined): string => {
      if (!target) return 'nothing';
      const classes = typeof target.className === 'string' ? target.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
      return `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}${classes.map((c) => `.${c}`).join('')}`;
    };
    return document
      .getAnimations()
      .filter((animation) => animation.playState === 'running')
      .map((animation) => {
        const named = animation as Animation & { animationName?: string; transitionProperty?: string };
        const kind = named.animationName
          ? `CSS animation ${named.animationName}`
          : named.transitionProperty
            ? `CSS transition of ${named.transitionProperty}`
            : `Web Animation${animation.id ? ` ${animation.id}` : ''}`;
        const effect = animation.effect as KeyframeEffect | null;
        const end = Number(effect?.getComputedTiming().endTime ?? Infinity);
        const scrollDriven = Boolean(animation.timeline) && animation.timeline !== document.timeline;
        const span = scrollDriven ? ' (tied to scroll)' : Number.isFinite(end) ? ` (${Math.round(end)} ms)` : ' (endless)';
        return `${kind} on ${describe(effect?.target)}${span}`;
      });
  });
}

/**
 * How far apart a rest scan rests, in window heights: a quarter window, the narrowest band in which
 * the site keeps something running near the view. The phone's featured strip (lib/motion.ts
 * page.strip) mounts its Carousel only while the strip is out of the window but within a quarter
 * window of it, and the tools ticker (page.ticker) works by the same margins. Resting at least this
 * often lands at least once in any band that wide, wherever the page's height puts it.
 */
export const REST_STEP = 0.25;

/**
 * The most places a rest scan takes (50 windows of page at REST_STEP). A longer page fails the scan
 * instead of being sampled more thinly; at about 300 ms a place, 200 places fit the test timeout.
 */
export const MAX_REST_PLACES = 200;

export interface RestReading {
  /** Where the window rested, in px from the top of the page. */
  top: number;
  /** The animations running there, before or after the span. */
  running: string[];
  /** requestAnimationFrame activity over the span. */
  activity: FrameActivity;
}

/**
 * Rests the window at every place from the top of the page to its bottom, REST_STEP apart, for
 * `spanMs` each: scrolls there at once, waits two frames (whatever the scroll starts has started),
 * then notes the animations running and the requestAnimationFrame activity over the span. The
 * bottom is read again at each place, so a page that grows while it is scrolled is covered to its
 * end. Needs installFrameMeter.
 */
export async function restScan(page: Page, spanMs: number): Promise<RestReading[]> {
  const step = await page.evaluate((share) => Math.max(1, Math.floor(window.innerHeight * share)), REST_STEP);
  const readings: RestReading[] = [];
  for (let wanted = 0; ; wanted += step) {
    if (readings.length >= MAX_REST_PLACES) {
      throw new Error(
        `The page is too long to rest at every quarter window (more than ${MAX_REST_PLACES} places); the scan stops instead of resting more thinly. Raise MAX_REST_PLACES and the test's timeout if the page is meant to be this long.`,
      );
    }
    const top = await page.evaluate(async (y) => {
      const scroller = document.scrollingElement ?? document.documentElement;
      window.scrollTo({ top: Math.min(y, Math.max(0, scroller.scrollHeight - window.innerHeight)), left: 0, behavior: 'instant' });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return window.scrollY;
    }, wanted);
    const before = await runningAnimations(page);
    const activity = await frameActivity(page, spanMs);
    const after = await runningAnimations(page);
    readings.push({ top, running: [...new Set([...before, ...after])], activity });
    const bottom = await page.evaluate(() => Math.max(0, (document.scrollingElement ?? document.documentElement).scrollHeight - window.innerHeight));
    if (top >= bottom || wanted >= bottom) break;
  }
  return readings;
}
