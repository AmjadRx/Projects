/**
 * Reduced motion removes all animation and loses no content (ARCHITECTURE.md 15, item 7), on every
 * route at the phone's and the desktop's width:
 * - nothing runs at rest: once the page has loaded, and again with each part of the page in view,
 *   no animation is running and no requestAnimationFrame loop goes on (a callback in more than two
 *   frames of a 500 ms span counts as a loop; one-off calls take a frame or two);
 * - the page holds the same text as with motion on, leaving out what is hidden from assistive
 *   technology (the copies a moving strip keeps for its loop, for one).
 */
import type { BrowserContext } from '@playwright/test';
import { expect, newVisitor, test } from './support/fixtures';
import { frameActivity, installFrameMeter, restPositions, runningAnimations } from './support/motion';
import { open, readableText, twoFrames, visitWholePage, waitForReady } from './support/page';
import { DESKTOP, device, PHONE, routeTitle, ROUTES } from './support/site';

/** A span of this many milliseconds with a callback in more than LOOP_FRAMES frames holds a loop. */
const SPAN_MS = 500;
const LOOP_FRAMES = 2;
/** The most places down the page to rest at (the top and the bottom always among them). */
const REST_PLACES = 8;

/** The page's text as assistive technology meets it, once every part of the page has been in view. */
async function textOf(context: BrowserContext, path: string): Promise<{ status: number; text: string }> {
  const page = await context.newPage();
  const status = await open(page, path);
  await visitWholePage(page);
  return { status, text: await readableText(page) };
}

/** Where two texts part: the words only one of them has, and the first place they differ. */
function difference(motion: string, reduced: string): string {
  if (motion === reduced) return 'the same text';
  const count = (text: string) => {
    const words = new Map<string, number>();
    for (const word of text.split(' ')) words.set(word, (words.get(word) ?? 0) + 1);
    return words;
  };
  const a = count(motion);
  const b = count(reduced);
  const only = (x: Map<string, number>, y: Map<string, number>) =>
    [...x].filter(([word, n]) => n > (y.get(word) ?? 0)).map(([word, n]) => `${word} x${n - (y.get(word) ?? 0)}`);
  let at = 0;
  while (at < motion.length && motion[at] === reduced[at]) at += 1;
  return [
    `the texts differ (${motion.length} characters with motion on, ${reduced.length} under reduced motion)`,
    `only with motion on: ${only(a, b).slice(0, 20).join(', ') || 'nothing'}`,
    `only under reduced motion: ${only(b, a).slice(0, 20).join(', ') || 'nothing'}`,
    `first difference, motion on: "${motion.slice(Math.max(0, at - 60), at + 80)}"`,
    `first difference, reduced:   "${reduced.slice(Math.max(0, at - 60), at + 80)}"`,
  ].join('\n');
}

for (const width of [PHONE, DESKTOP]) {
  test.describe(`reduced motion, ${width} px`, () => {
    test.use({ ...device(width), reducedMotion: 'reduce' });

    for (const route of ROUTES) {
      test(`${routeTitle(route)}: no animation and no frame loop at rest`, async ({ page }) => {
        await page.addInitScript(installFrameMeter);
        const response = await page.goto(route.path, { waitUntil: 'load' });
        expect(response?.status(), 'status').toBe(route.status);
        // Ready (fonts, hydration), but not waiting for animations: none may be running.
        await waitForReady(page);
        const findings: string[] = [];
        for (const top of await restPositions(page, REST_PLACES)) {
          await page.evaluate((y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' }), top);
          await twoFrames(page);
          const place = top === 0 ? 'at the top, after load' : `scrolled to ${top} px`;
          const before = await runningAnimations(page);
          const frames = await frameActivity(page, SPAN_MS);
          const after = await runningAnimations(page);
          const running = [...new Set([...before, ...after])];
          if (running.length > 0) findings.push(`${place}: running: ${running.join('; ')}`);
          if (frames.frames > LOOP_FRAMES) {
            findings.push(
              `${place}: requestAnimationFrame callbacks in ${frames.frames} frames of ${SPAN_MS} ms (${frames.calls} calls), from ${frames.callers.join(' | ') || 'callbacks requested before the span'}`,
            );
          }
        }
        expect(findings).toEqual([]);
      });

      test(`${routeTitle(route)}: the same text as with motion on`, async ({ browser, baseURL }) => {
        const contexts = [
          await newVisitor(browser, baseURL ?? '', width, { reducedMotion: 'no-preference' }),
          await newVisitor(browser, baseURL ?? '', width, { reducedMotion: 'reduce' }),
        ];
        try {
          const motion = await textOf(contexts[0], route.path);
          const reduced = await textOf(contexts[1], route.path);
          expect([motion.status, reduced.status], 'status').toEqual([route.status, route.status]);
          expect(reduced.text, difference(motion.text, reduced.text)).toBe(motion.text);
        } finally {
          for (const context of contexts) await context.close();
        }
      });
    }
  });
}
