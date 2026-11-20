/**
 * Getting a page to rest before a check, and reading it. Every wait here waits for a condition (the
 * load event, the fonts, the end of the load sequence, hydration, the end of every animation that
 * ends) or for animation frames, never for a fixed time. The polling waits check every 100 ms,
 * never through requestAnimationFrame, which the frame meter (./motion.ts) counts; the frame waits
 * run outside the meter's spans.
 */
import { expect, type Locator, type Page } from '@playwright/test';

const POLL = 100;

/** Opens a path, waits for the load event, then for the page to come to rest. Returns the status. */
export async function open(page: Page, path: string): Promise<number> {
  const response = await page.goto(path, { waitUntil: 'load' });
  await settle(page);
  return response?.status() ?? 0;
}

/**
 * Waits until the page is at rest: ready (below), and every animation that ends has ended (an
 * endless one, such as the tools strip, may run on).
 */
export async function settle(page: Page): Promise<void> {
  await waitForReady(page);
  await waitForAnimations(page);
}

/**
 * Waits until the page is ready, without waiting for its animations:
 * - the fonts have loaded;
 * - the load sequence has ended: lib/intro.ts takes data-intro off the hero section at its end
 *   (it plays once a visit, on the home page, and never under reduced motion);
 * - React has hydrated the page's client parts: the nav's Menu button and the footer's pause
 *   control, near the start and the end of the page, carry React's fiber.
 */
export async function waitForReady(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() => !document.querySelector('[data-intro]'), undefined, { polling: POLL, timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const marks = [document.querySelector('.ar-menubtn'), document.querySelector('.ar-foot__pause')].filter(
        (element): element is Element => element !== null,
      );
      if (marks.length === 0) marks.push(document.querySelector('main') ?? document.body);
      return marks.every((element) => Object.keys(element).some((key) => key.startsWith('__reactFiber$')));
    },
    undefined,
    { polling: POLL, timeout: 20_000 },
  );
}

/** Waits for two animation frames: whatever a change starts has started, and a 0.01 ms transition has ended. */
export async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Waits until no animation that ends is still running. Endless and scroll-driven ones are left to run. */
export async function waitForAnimations(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    () =>
      document.getAnimations().every((animation) => {
        if (animation.playState !== 'running') return true;
        const end = Number(animation.effect?.getComputedTiming().endTime ?? Infinity);
        return !Number.isFinite(end);
      }),
    undefined,
    { polling: POLL, timeout },
  );
}

/**
 * Scrolls the whole page into view, a little over half a window at a time, then back to the top,
 * so everything that waits for the view has come: lazy pictures, the gallery's strip, and the
 * panels that rise as they come into view (components/site/risePanels.ts marks them data-ar-rise
 * until they have risen). Then waits for every animation that ends.
 *
 * A panel that is drawn (it has a box) and still waits, unseen, once the whole page has been in view
 * fails the test: it stays at opacity 0 (app/motion-chrome.css), so its content is never shown, and
 * axe would take it for hidden and skip it. (Under reduced motion a waiting panel shows in full, so
 * only an unseen one counts.)
 */
export async function visitWholePage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const twoFrames = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const scroller = document.scrollingElement ?? document.documentElement;
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    for (let top = 0; top < scroller.scrollHeight - window.innerHeight; top += step) {
      window.scrollTo({ top, left: 0, behavior: 'instant' });
      await twoFrames();
    }
    window.scrollTo({ top: scroller.scrollHeight, left: 0, behavior: 'instant' });
    await twoFrames();
  });
  const risen = await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[data-ar-rise]')).every(
          (panel) => panel.getClientRects().length === 0 || getComputedStyle(panel).opacity !== '0',
        ),
      undefined,
      { polling: POLL, timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!risen) {
    const waiting = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-ar-rise]'))
        .filter((panel) => panel.getClientRects().length > 0 && getComputedStyle(panel).opacity === '0')
        .map((panel) => {
          const classes = typeof panel.className === 'string' ? panel.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
          const text = (panel.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
          const top = Math.round(panel.getBoundingClientRect().top + window.scrollY);
          return `${panel.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join('')} at ${top} px${text ? ` "${text}"` : ''}`;
        }),
    );
    expect(waiting, 'panels still waiting to rise (invisible) after the whole page was in view').toEqual([]);
  }
  await waitForAnimations(page);
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await waitForAnimations(page);
}

/**
 * The page's text as assistive technology meets it: the rendered text of the body (innerText, so
 * nothing in display: none or visibility: hidden), leaving out every part marked aria-hidden or
 * inert, with white space collapsed.
 */
export async function readableText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '[aria-hidden="true"], [inert] { display: none !important; }';
    document.head.append(style);
    try {
      return document.body.innerText.replace(/\s+/g, ' ').trim();
    } finally {
      style.remove();
    }
  });
}

/** True while `locator` holds the focused element. */
export function focusInside(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element.contains(document.activeElement));
}

/** A short description of the focused element, for messages. */
export function focusedElement(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return 'the page itself';
    const name = (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const classes = typeof element.className === 'string' ? element.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return `${element.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join('')}${name ? ` "${name}"` : ''}`;
  });
}
