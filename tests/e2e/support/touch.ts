/**
 * A finger on the screen, for the check that nothing blocks scrolling on touch (ARCHITECTURE.md
 * 6A: the sky "never blocks scrolling on touch"): the drag goes through the browser's own touch
 * input, so a listener that cancels a touch, or a `touch-action` that forbids the pan, stops the
 * scroll as it would on a phone; and every touch or wheel event a script cancels is recorded.
 */
import type { Page } from '@playwright/test';

/** In the page, before its scripts: records the type of every touch or wheel event something cancels. */
export function recordCancels(): void {
  const w = window as unknown as { __e2eCancelled: string[] };
  w.__e2eCancelled = [];
  const native = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function (this: Event) {
    if (/^(touch|wheel)/.test(this.type)) w.__e2eCancelled.push(this.type);
    native.call(this);
  };
}

/** The touch and wheel events cancelled so far (recordCancels). */
export const cancelled = (page: Page) => page.evaluate(() => (window as unknown as { __e2eCancelled?: string[] }).__e2eCancelled ?? []);

/** How long the finger rests at the end of a drag before it lifts. */
const REST_MS = 150;

/**
 * A finger put down at (x, y), moved up 300 px in ten steps, held still for a moment, and lifted.
 * Held still, it lifts with no speed, so no fling carries the page on after it: the page scrolls by
 * the drag alone, and is at rest once the finger is up.
 */
export async function dragUp(page: Page, x: number, y: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 10; step += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 30 }] });
    await page.waitForTimeout(REST_MS);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 300 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

/**
 * Waits until the page's scroll holds still: two reads of its position 150 ms apart that agree (a
 * scroll still gliding moves in that time). Returns the position.
 */
export async function scrollRest(page: Page, timeout = 10_000): Promise<number> {
  const read = () => page.evaluate(() => window.scrollY);
  const until = Date.now() + timeout;
  let last = await read();
  for (;;) {
    await page.waitForTimeout(150);
    const now = await read();
    if (now === last) return now;
    if (Date.now() > until) throw new Error(`the page was still scrolling after ${timeout} ms, at ${now} px`);
    last = now;
  }
}
