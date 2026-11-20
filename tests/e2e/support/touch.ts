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

/** A finger put down at (x, y), moved up 300 px in ten steps, and lifted. */
export async function dragUp(page: Page, x: number, y: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 10; step += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 30 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}
