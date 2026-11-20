/**
 * Reduced motion removes all animation and loses no content (ARCHITECTURE.md 15, item 7), on every
 * route at the phone's and the desktop's width:
 * - nothing runs at rest: once the page has loaded, and again at every place down the page a
 *   quarter window apart (./support/motion.ts restScan), no animation is running and no
 *   requestAnimationFrame loop goes on (a callback in more than two frames of a 250 ms span counts
 *   as a loop, which shows 15 frames or more even at 60 Hz; one-off calls take a frame or two);
 * - the page holds the same text as with motion on, leaving out what is hidden from assistive
 *   technology (the copies a moving strip keeps for its loop, for one).
 *
 * And the footer's pause control, turned on and off with the page open and the strip in view (the
 * gallery on each page that has one, at both widths; the home page's featured strip on a phone):
 * the strip that moves by Motion+ Carousel gives way to the still strip, which runs no frame loop,
 * and back, with every frame where it was, the same counter or marks, and no layout shift; paused,
 * the still strip still moves.
 */
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { UI } from '../../lib/strings';
import { expect, newVisitor, test } from './support/fixtures';
import { frameActivity, installFrameMeter, restScan, type RestReading } from './support/motion';
import { open, readableText, twoFrames, visitWholePage, waitForReady } from './support/page';
import { DESKTOP, device, GALLERY_PAGES, PHONE, routeTitle, ROUTES } from './support/site';

/** A span of this many milliseconds with a callback in more than LOOP_FRAMES frames holds a loop. */
const SPAN_MS = 250;
const LOOP_FRAMES = 2;

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

interface ShiftMeter {
  total: number;
  /** Adds the shifts recorded but not yet reported. */
  flush(): void;
}

/**
 * Installed with page.addInitScript: adds up the layout shifts the page makes (the Layout
 * Instability API), from a moment the test sets, so a swap can be checked to shift nothing.
 */
function installShiftMeter(): void {
  const meter: ShiftMeter = { total: 0, flush() {} };
  (window as unknown as { __e2eShift: ShiftMeter }).__e2eShift = meter;
  const add = (entries: PerformanceEntryList) => {
    for (const entry of entries as (PerformanceEntry & { value: number })[]) meter.total += entry.value;
  };
  try {
    const observer = new PerformanceObserver((list) => add(list.getEntries()));
    observer.observe({ type: 'layout-shift', buffered: true });
    meter.flush = () => add(observer.takeRecords());
  } catch {
    // No Layout Instability API: nothing can be counted, and the check says so.
    meter.total = Number.NaN;
  }
}

/** Starts counting layout shifts from now. */
async function startShifts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const meter = (window as unknown as { __e2eShift: ShiftMeter }).__e2eShift;
    meter.flush();
    meter.total = 0;
  });
}

/** The layout shifts since startShifts, once the frames drawn so far have been recorded. */
async function shiftsSince(page: Page): Promise<number> {
  await twoFrames(page);
  return page.evaluate(() => {
    const meter = (window as unknown as { __e2eShift: ShiftMeter }).__e2eShift;
    meter.flush();
    return meter.total;
  });
}

/** Presses the footer's pause control where it is, as a visitor's click does, without scrolling to it. */
async function pressPause(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.ar-foot__pause')?.click());
}

/** Where each of `items` is drawn in the window, to the half px. */
function places(items: Locator): Promise<string[]> {
  return items.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      const half = (n: number) => Math.round(n * 2) / 2;
      return `${half(box.left)},${half(box.top)} ${half(box.width)}x${half(box.height)}`;
    }),
  );
}

/**
 * Waits until `items` hold their places over a 150 ms span measured in the page (a spring has
 * settled), then gives the places.
 */
async function settled(items: Locator): Promise<string[]> {
  await expect
    .poll(
      () =>
        items.evaluateAll(async (elements) => {
          const read = () => elements.map((element) => element.getBoundingClientRect().left.toFixed(1)).join(',');
          const before = read();
          await new Promise((resolve) => setTimeout(resolve, 150));
          return read() === before;
        }),
      { message: 'the strip comes to rest', timeout: 10_000 },
    )
    .toBe(true);
  return places(items);
}

/** How many frames the sampler notes (startSampling): a swap and the frames after it. */
const SAMPLES = 12;

/**
 * Notes, once each of the next SAMPLES frames has been drawn, where the elements `selector` finds
 * were drawn in it (their left edges): a swap that drew a frame anywhere else, for one frame, shows.
 */
async function startSampling(page: Page, selector: string): Promise<void> {
  await page.evaluate(
    ({ selector: find, count }) => {
      const samples: string[] = [];
      (window as unknown as { __e2eSamples: string[] }).__e2eSamples = samples;
      const read = () => Array.from(document.querySelectorAll(find), (element) => element.getBoundingClientRect().left.toFixed(1)).join(',');
      // After a frame's callbacks, once it has been drawn: where it was drawn.
      const next = () =>
        requestAnimationFrame(() =>
          setTimeout(() => {
            samples.push(read());
            if (samples.length < count) next();
          }, 0),
        );
      next();
    },
    { selector, count: SAMPLES },
  );
}

/** The places the sampler noted, once it has noted all of them. */
async function sampled(page: Page): Promise<string[]> {
  await page.waitForFunction((count) => ((window as unknown as { __e2eSamples?: string[] }).__e2eSamples?.length ?? 0) >= count, SAMPLES, {
    polling: 100,
  });
  return page.evaluate(() => (window as unknown as { __e2eSamples: string[] }).__e2eSamples);
}

/** The number of frames in a 250 ms span with a requestAnimationFrame callback: more than LOOP_FRAMES is a loop. */
async function loopFrames(page: Page): Promise<number> {
  return (await frameActivity(page, SPAN_MS)).frames;
}

test.describe('the pause control, with the page open', () => {
  for (const width of [PHONE, DESKTOP]) {
    test.describe(`${width} px`, () => {
      test.use({ ...device(width), reducedMotion: 'no-preference' });

      for (const route of GALLERY_PAGES) {
        test(`${routeTitle(route)}: the gallery trades Carousel for the still strip and back, in place`, async ({ page }) => {
          await page.addInitScript(installFrameMeter);
          await page.addInitScript(installShiftMeter);
          expect(await open(page, route.path), 'status').toBe(route.status);
          const gallery = page.locator('section.ar-gal').first();
          const frames = gallery.locator('.ar-gal__frame');
          const count = gallery.locator('.ar-gal__count');
          // Carousel's items carry aria-hidden="false"; the still strip's carry none.
          const carouselItems = gallery.locator('.mm-gal > ul > li[aria-hidden="false"]');
          // The server's still strip gives way to Carousel as it nears the view, drawn where it was.
          await startSampling(page, 'section.ar-gal .ar-gal__frame');
          await gallery.scrollIntoViewIfNeeded();
          await expect(carouselItems.first(), 'Carousel moves the strip with motion on').toBeAttached();
          expect(new Set(await sampled(page)).size, 'every frame drawn in one place as Carousel takes over').toBe(1);

          await gallery.getByRole('button', { name: UI.viewers.next, exact: true }).click();
          await expect(count).toHaveText(/^2 of \d+$/);
          const moving = await settled(frames);
          const counter = await count.textContent();

          await startShifts(page);
          await startSampling(page, 'section.ar-gal .ar-gal__frame');
          await pressPause(page);
          await expect(carouselItems, 'paused: the still strip, with no Carousel').toHaveCount(0);
          expect(new Set(await sampled(page)).size, 'every frame of the swap drawn in one place').toBe(1);
          expect(await places(frames), 'every frame where it was').toEqual(moving);
          await expect(count).toHaveText(counter ?? '');
          expect(await shiftsSince(page), 'layout shift as the still strip takes over').toBe(0);
          expect(await loopFrames(page), 'no frame loop with the still strip in view').toBeLessThanOrEqual(LOOP_FRAMES);

          // Paused, it still moves, one frame at once: back to the first, which starts at the strip's
          // edge, and on to the second, where Carousel drew it.
          await gallery.getByRole('button', { name: UI.viewers.previous, exact: true }).click();
          await expect(count).toHaveText(/^1 of \d+$/);
          const edge = await gallery.locator('.mm-gal').evaluate((box) => {
            const strip = box.getBoundingClientRect();
            const first = box.querySelector('.ar-gal__frame')!.getBoundingClientRect();
            return first.left - strip.left - Number.parseFloat(getComputedStyle(box).paddingLeft);
          });
          expect(Math.abs(edge), "Previous brings the first frame to the strip's edge").toBeLessThanOrEqual(1);
          await gallery.getByRole('button', { name: UI.viewers.next, exact: true }).click();
          await expect(count).toHaveText(counter ?? '');
          expect(await places(frames), 'the second frame where Carousel had it').toEqual(moving);
          expect(await loopFrames(page), 'still no frame loop').toBeLessThanOrEqual(LOOP_FRAMES);

          await startShifts(page);
          await startSampling(page, 'section.ar-gal .ar-gal__frame');
          await pressPause(page);
          await expect(carouselItems.first(), 'played again: Carousel is back').toBeAttached();
          expect(new Set(await sampled(page)).size, 'every frame of the swap drawn in one place').toBe(1);
          expect(await places(frames), 'every frame where the still strip had it').toEqual(moving);
          await expect(count).toHaveText(counter ?? '');
          expect(await shiftsSince(page), 'layout shift as Carousel takes over').toBe(0);
        });
      }
    });
  }

  test.describe(`${PHONE} px`, () => {
    test.use({ ...device(PHONE), reducedMotion: 'no-preference' });

    test('home (/): the featured strip trades its Carousel for the scrolling strip in place, and stays still in the window on Play', async ({ page }) => {
      await page.addInitScript(installFrameMeter);
      await page.addInitScript(installShiftMeter);
      expect(await open(page, '/'), 'status').toBe(200);
      const box = page.locator('.hm-feat-box');
      const cards = box.locator('.hm-feat__item');
      // Just below the window, within a quarter window of it: the Carousel takes the strip's place.
      await box.evaluate((element) => {
        const top = element.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: Math.max(0, top - window.innerHeight - 40), behavior: 'instant' });
      });
      await expect(page.locator('.hm-feat--carousel'), 'the Carousel near the view, with motion on').toBeAttached({ timeout: 15_000 });
      await box.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.getByRole('button', { name: UI.home.featuredStrip.next, exact: true }).click();
      const moving = await settled(cards);
      const marks = await page.locator('.hm-swipe__dots').innerHTML();

      await startShifts(page);
      await startSampling(page, '.hm-feat-box .hm-feat__item');
      await pressPause(page);
      await expect(page.locator('.hm-feat--carousel'), 'paused: the scrolling strip').toHaveCount(0);
      expect(new Set(await sampled(page)).size, 'every frame of the swap drawn in one place').toBe(1);
      expect(await places(cards), 'every card where it was').toEqual(moving);
      expect(await page.locator('.hm-swipe__dots').innerHTML(), 'the marks on the same card').toBe(marks);
      expect(await shiftsSince(page), 'layout shift as the strip takes over').toBe(0);
      expect(await loopFrames(page), 'no frame loop with the strip in view').toBeLessThanOrEqual(LOOP_FRAMES);

      // Played again in the window: the strip stays there; once it has left the window the Carousel comes back.
      await startSampling(page, '.hm-feat-box .hm-feat__item');
      await pressPause(page);
      expect(new Set(await sampled(page)).size, 'the strip stays where it is in the window').toBe(1);
      await expect(page.locator('.hm-feat--carousel')).toHaveCount(0);
      expect(await places(cards)).toEqual(moving);
      await box.evaluate((element) => {
        const top = element.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: Math.max(0, top - window.innerHeight - 40), behavior: 'instant' });
      });
      await expect(page.locator('.hm-feat--carousel'), 'out of the window, the Carousel is back').toBeAttached({ timeout: 15_000 });
    });
  });
});

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
