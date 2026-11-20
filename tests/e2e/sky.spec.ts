/**
 * The live sky in the browser (ARCHITECTURE.md 6A and 15, item 6a; docs/V3_PLAN.md D-80:
 * "demotion proved ... by injecting slow frames"): on a desktop window the sky starts on the Full
 * tier, and when every frame is made slow it steps down to Light, then to Still, and stays there;
 * a hidden tab stops its frame loop; and on a phone a finger dragged over the sky scrolls the page,
 * with nothing cancelling a touch or a wheel. tests/sky-tier.test.ts and tests/sky-host.test.ts
 * prove the same rules with a recording fake of the scene; this file runs the real scene in Chrome.
 *
 * The live scene needs WebGL2 on a GPU: a software renderer is refused (components/sky/live,
 * failIfMajorPerformanceCaveat) and the sky keeps its still, as it should. Where the browser has no
 * GPU (most CI runners), the first two tests are skipped and say so; the fakes' tests still run
 * there. The touch test runs on every tier and names the one it ran on.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { installFrameMeter, frameActivity } from './support/motion';
import { waitForReady } from './support/page';
import { DESKTOP, device, PHONE } from './support/site';
import { cancelled, dragUp, recordCancels } from './support/touch';

/** In the page, before its scripts: every animation frame can be made to cost 40 ms (window.__e2eSlow). */
function slowFrames(): void {
  const native = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    native((time) => {
      if ((window as unknown as { __e2eSlow?: boolean }).__e2eSlow) {
        const until = performance.now() + 40;
        while (performance.now() < until) {
          // A frame that takes 40 ms: 25 frames a second, under the 45 that keeps a tier.
        }
      }
      callback(time);
    });
}

/** What the sky did during the visit (recordSky). */
interface SkyRecord {
  /** Every tier it took, in order, with the time it took it (performance.now()). */
  tiers: { tier: string; at: number }[];
  /** Its live layer drew at some point. */
  live: boolean;
}

/**
 * In the page, before its scripts: records every tier the sky takes, and whether its live layer
 * ever drew, so a step taken between two looks is still seen (on a busy machine the sky may step
 * down on its own before the test slows its frames, which proves the same rule).
 */
function recordSky(): void {
  const record: SkyRecord = { tiers: [], live: false };
  (window as unknown as { __e2eSky: SkyRecord }).__e2eSky = record;
  const note = () => {
    const tier = document.documentElement?.getAttribute('data-sky-tier');
    if (tier && record.tiers[record.tiers.length - 1]?.tier !== tier) record.tiers.push({ tier, at: performance.now() });
    if (!record.live && document.querySelector('.ar-sky__live.is-ready')) record.live = true;
  };
  new MutationObserver(note).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-sky-tier', 'class'] });
}

const tier = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-sky-tier'));
const sky = (page: Page) => page.evaluate(() => (window as unknown as { __e2eSky: SkyRecord }).__e2eSky);

/** Opens a page and waits for the live sky to draw; skips the test where it cannot (no GPU). */
async function liveSky(page: Page, path: string): Promise<void> {
  await page.addInitScript(recordSky);
  const response = await page.goto(path, { waitUntil: 'load' });
  expect(response?.status()).toBe(200);
  await waitForReady(page);
  await page.waitForFunction(
    () => (window as unknown as { __e2eSky: SkyRecord }).__e2eSky.live || document.documentElement.getAttribute('data-sky-tier') === 'still',
    undefined,
    { polling: 100, timeout: 20_000 },
  );
  test.skip(
    !(await sky(page)).live,
    'this browser cannot draw the live sky (no WebGL2 on a GPU), so the sky keeps its still; tests/sky-host.test.ts proves the rule with a fake scene',
  );
}

test.describe('the live sky, 1440 px', () => {
  test.use(device(DESKTOP));

  test('starts on the Full tier, then steps down to Light and to Still when its frames are slow, and stays', async ({ page }) => {
    await page.addInitScript(slowFrames);
    await liveSky(page, '/about');
    const slowed = await page.evaluate(() => {
      (window as unknown as { __e2eSlow?: boolean }).__e2eSlow = true;
      return performance.now();
    });
    // The loop rests after 30 s without input: keep it awake while the frames are slow.
    const awake = setInterval(() => void page.mouse.move(200 + Math.random() * 400, 300).catch(() => undefined), 1000);
    try {
      await expect.poll(() => tier(page), { message: 'the sky steps down to its still', timeout: 30_000, intervals: [100] }).toBe('still');
    } finally {
      clearInterval(awake);
    }
    const { tiers } = await sky(page);
    const from = tiers.findIndex((t) => t.tier === 'full');
    expect(
      tiers.slice(Math.max(0, from)).map((t) => t.tier),
      'a desktop window with a fine pointer starts on the Full tier, then steps down to Light, then to Still',
    ).toEqual(['full', 'light', 'still']);
    const after = (name: string) => Math.round((tiers.find((t) => t.tier === name)?.at ?? slowed) - slowed);
    test.info().annotations.push({
      type: 'demotion',
      description: `Light ${after('light')} ms and Still ${after('still')} ms after the frames were made to take 40 ms (a time below zero: the machine's own load stepped it down first)`,
    });
    // The live layer faded out; a step down lasts for the visit.
    await expect(page.locator('.ar-sky__live.is-ready')).toHaveCount(0);
    await page.evaluate(() => {
      (window as unknown as { __e2eSlow?: boolean }).__e2eSlow = false;
    });
    await page.mouse.move(700, 400);
    await page.waitForTimeout(1500);
    expect(await tier(page), 'never steps back up during the visit').toBe('still');
  });

  test('stops drawing while the tab is hidden, and draws again when it is shown', async ({ page }) => {
    await page.addInitScript(installFrameMeter);
    await liveSky(page, '/experience');
    await page.mouse.move(400, 300);
    const shown = (await frameActivity(page, 1000)).frames;
    test.skip(
      (await tier(page)) === 'still',
      "this machine's load stepped the sky down to its still before its frames were counted; tests/sky-host.test.ts proves the rule with a fake scene",
    );
    expect(shown, 'the live sky draws while shown').toBeGreaterThan(10);
    const hide = (hidden: boolean) =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await hide(true);
    await page.waitForTimeout(300);
    expect((await frameActivity(page, 1000)).frames, 'no frame loop while hidden').toBeLessThanOrEqual(2);
    await hide(false);
    expect((await frameActivity(page, 1000)).frames, 'drawing again once shown').toBeGreaterThan(10);
  });
});

test.describe('the sky on a phone, 390 px', () => {
  test.use(device(PHONE));

  test('never blocks scrolling on touch: a finger dragged over the sky scrolls the page, and nothing cancels it', async ({ page }) => {
    // Every touch or wheel event something cancels (the one way a listener can stop a scroll).
    await page.addInitScript(recordCancels);
    const response = await page.goto('/about', { waitUntil: 'load' });
    expect(response?.status()).toBe(200);
    await waitForReady(page);
    // The live sky where this browser can draw it (the Light tier on a phone), else the still.
    await page.waitForFunction(
      () => Boolean(document.querySelector('.ar-sky__live.is-ready')) || document.documentElement.getAttribute('data-sky-tier') === 'still',
      undefined,
      { polling: 100, timeout: 20_000 },
    );
    test.info().annotations.push({ type: 'tier', description: `${await tier(page)}` });
    // A point in the page's left margin where the sky shows: what lies there paints no background.
    const start = await page.evaluate(() => {
      for (let y = Math.round(innerHeight * 0.6); y > 100; y -= 40) {
        for (const x of [4, 8, 12]) {
          const top = document.elementFromPoint(x, y);
          const s = top ? getComputedStyle(top) : null;
          if (!s || (/rgba?\([^)]*[,/]\s*0\)$|^transparent$/.test(s.backgroundColor) && s.backgroundImage === 'none')) {
            return { x, y, under: top ? `${top.tagName.toLowerCase()}.${String(top.className).split(' ')[0]}` : 'nothing' };
          }
        }
      }
      return null;
    });
    expect(start, 'a point where the finger lies on the sky').not.toBeNull();
    test.info().annotations.push({ type: 'finger', description: `at ${start!.x}, ${start!.y}, over ${start!.under}` });
    await dragUp(page, start!.x, start!.y);
    await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'the page scrolled under the finger' }).toBeGreaterThan(200);
    expect(await cancelled(page), 'touch or wheel events cancelled').toEqual([]);
  });
});
