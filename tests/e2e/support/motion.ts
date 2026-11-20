/**
 * Measuring motion at rest (ARCHITECTURE.md 15, item 7; the BRIEF rule "nothing runs at rest"):
 * the animations still running, and requestAnimationFrame activity over a span of time.
 */
import type { Page } from '@playwright/test';

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
        const stack = String(new Error().stack ?? '').split('\n').slice(2, 5);
        callers.push(stack.map((line) => line.trim()).join(' < '));
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
 * The scroll positions to rest at: the top, then one window further each time to the bottom, at
 * most `max` places in all (always the top and the bottom).
 */
export async function restPositions(page: Page, max = 10): Promise<number[]> {
  const { height, window: view } = await page.evaluate(() => ({
    height: (document.scrollingElement ?? document.documentElement).scrollHeight,
    window: window.innerHeight,
  }));
  const bottom = Math.max(0, height - view);
  const count = Math.min(max, Math.ceil(bottom / view) + 1);
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => Math.round((bottom * index) / (count - 1)));
}
