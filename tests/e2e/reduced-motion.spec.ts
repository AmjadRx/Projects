/**
 * Reduced motion removes all animation and loses no content (ARCHITECTURE.md 15, item 7), on every
 * route at the phone's and the desktop's width:
 * - nothing runs at rest: once the page has loaded, and again at every place down the page a
 *   quarter window apart (./support/motion.ts restScan), no animation is running and no
 *   requestAnimationFrame loop goes on (a callback in more than two frames of a 250 ms span counts
 *   as a loop, which shows 15 frames or more even at 60 Hz; one-off calls take a frame or two);
 * - the page holds the same text as with motion on, leaving out what is hidden from assistive
 *   technology (the copies a moving strip keeps for its loop, for one).
 */
import type { BrowserContext } from '@playwright/test';
import { expect, newVisitor, test } from './support/fixtures';
import { installFrameMeter, LOOP_FRAMES, LOOP_SPAN_MS as SPAN_MS, restScan, type RestReading } from './support/motion';
import { open, readableText, visitWholePage, waitForReady } from './support/page';
import { DESKTOP, device, PHONE, routeTitle, ROUTES } from './support/site';

/**
 * What is wrong at each place of a scan, with the places next to each other that share a problem
 * named once, as a stretch of the page ("scrolled from 2321 to 4431 px, 11 places: ...").
 */
function restFindings(readings: RestReading[]): string[] {
  const problems = (reading: RestReading) => {
    const found: { key: string; text: string }[] = [];
    if (reading.running.length > 0) {
      const text = `running: ${reading.running.join('; ')}`;
      found.push({ key: text, text });
    }
    const { frames, calls, callers } = reading.activity;
    if (frames > LOOP_FRAMES) {
      found.push({
        key: 'loop',
        text: `requestAnimationFrame callbacks in ${frames} frames of ${SPAN_MS} ms (${calls} calls), from ${callers.join(' | ') || 'callbacks requested before the span'}`,
      });
    }
    return found;
  };
  const stretches: { from: number; to: number; places: number; texts: string[] }[] = [];
  /** The stretches that reach the place before this one, by problem. */
  const going = new Map<string, (typeof stretches)[number]>();
  for (const reading of readings) {
    const now = problems(reading);
    for (const key of [...going.keys()]) if (!now.some((problem) => problem.key === key)) going.delete(key);
    for (const problem of now) {
      const stretch = going.get(problem.key);
      if (stretch) {
        stretch.to = reading.top;
        stretch.places += 1;
        stretch.texts.push(problem.text);
      } else {
        const started = { from: reading.top, to: reading.top, places: 1, texts: [problem.text] };
        stretches.push(started);
        going.set(problem.key, started);
      }
    }
  }
  return stretches.map(({ from, to, places, texts }) => {
    const where = from === 0 && to === 0 ? 'at the top, after load' : from === to ? `scrolled to ${from} px` : `scrolled from ${from} to ${to} px, ${places} places`;
    const counts = texts.map((text) => /in (\d+) frames/.exec(text)?.[1]).filter(Boolean);
    const span = counts.length > 1 ? ` (frames per span: ${counts.join(', ')})` : '';
    return `${where}: ${texts[0]}${span}`;
  });
}

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
        expect(restFindings(await restScan(page, SPAN_MS))).toEqual([]);
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
