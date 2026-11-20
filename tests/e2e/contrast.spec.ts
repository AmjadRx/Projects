/**
 * Text over the sky passes AA at every breakpoint, in both themes (ARCHITECTURE.md 6A and 15,
 * items 3 and 6a; docs/V3_PLAN.md D-80 and R-06), measured from screenshots: axe leaves
 * color-contrast undecided over the sky and its glass. On every public route, in both themes, at
 * 390, 768, 1024 and 1440 px, at the top of the page and every fifth of a window down to its end,
 * each visible piece of text is checked against the pixels under it (./support/contrast.ts says
 * how: the text painted transparent, the 95th or 5th percentile of the background's luminance,
 * 4.5 to 1 or 3 to 1 for large text).
 *
 * The sky, held still and at its worst (the sky moves; these choices make the check repeatable):
 * - The tier. The live sky's tier depends on the machine (a GPU gives Full or Light, a software
 *   renderer Still), so the test takes WebGL2 away and the page keeps the Still tier: the
 *   pre-rendered still of the same scene that every tier paints first, with the dawn following
 *   scroll. The Full tier draws that same scene over it (the desktop stills are drawn on the Full
 *   tier, the phone and tablet stills on the Light tier, lib/motion.ts skyFiles), adding only the
 *   turning of the sky, which the next point covers, the twinkle of the stars brighter than
 *   magnitude 2 (8 percent either way, on single star cores, which the check reads past as it
 *   reads past hairlines), and the short-lived meteor, ripple and drafting lines, as thin. The
 *   Light tier draws the same scene with fewer stars, and makes every glass panel the plain panel
 *   color, so its panels hold the tokens' own contrast on --sheet-2 (tests/token-contrast.test.ts);
 *   its text on the open sky is the text checked here. Under reduced motion the sky is the Still
 *   tier with the dawn held at its weakest, which this check's dawn always meets or exceeds.
 * - The time of day. The still the head script picks is the hour of the sky over Santa Clara now,
 *   one of 24, and the live sky turns through every hour. Blueprint is checked over the brightest
 *   sky of the day: for each width class, every pixel the brightest it is in any of the 24 hourly
 *   stills. That is never darker than any hour; a piece of text that fails over it is then checked
 *   against each of the 24 stills in turn, and fails only if it fails over a real one (the message
 *   names the hour). Whiteprint has one still a class, with no stars and no dawn.
 * - The dawn, which strengthens with scroll (place 7 of the ramp). At each position it is set to
 *   the strength it reaches at the next one, and text that will cross the horizon before then is
 *   checked against the dawn's brightest row, carried down over the ground (support/contrast.ts
 *   placeAt), so nothing between two positions is brighter than what was checked.
 *
 * The run reports every failure: the route, the theme, the width, the scroll position, the
 * element and its words, the text color, the background statistic, and the ratio.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { STILL_STEPS } from '../../lib/sky/still-steps';
import { blueprintStillUrl, type StillClass } from '../../lib/theme';
import { hex } from './support/color';
import {
  brightestOf,
  collectText,
  holdDawn,
  judge,
  measureText,
  pageLength,
  placeAt,
  prepareShot,
  scrollPositions,
  showStill,
  stillClassNow,
  TRANSPARENT_TEXT,
  withoutWebGL,
  type TextItem,
  type Verdict,
} from './support/contrast';
import { expect, test } from './support/fixtures';
import { open, visitWholePage } from './support/page';
import { decodePng, type Raster } from './support/png';
import { device, routeTitle, ROUTES, THEMES, WIDTHS, type Theme, type Width } from './support/site';

/** Positions a fifth of a window apart. */
const STEP = 0.2;

/** Where the brightest sky of each width class is served from (by this test's route, not the site). */
const BRIGHTEST = '/__e2e__/sky/brightest-';

/** The brightest sky of each width class, made once in each worker. */
const brightest = new Map<string, Promise<Buffer>>();

interface Worst {
  item: TextItem;
  verdict: Verdict;
  /** Where it was worst: the scroll position, the distance to the next position, and the dawn's strength. */
  y: number;
  next: number;
  dawn: number | null;
  /** The first of the 24 hourly stills it also fails over, when checked against them, and its verdict there. */
  hour?: { step: number; verdict: Verdict };
}

const fails = (verdict: Verdict) => verdict.ratio < verdict.required;

/** 95 as "95th", 2.5 as "2.5th", 91 as "91st". */
function ordinal(n: number): string {
  if (!Number.isInteger(n)) return `${n}th`;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

function line(route: string, theme: Theme, width: Width, worst: Worst, sky: string): string {
  const { item, verdict } = worst.hour?.verdict ? { item: worst.item, verdict: worst.hour.verdict } : worst;
  const bg = verdict.background;
  const dawn = worst.dawn === null ? '' : `, dawn ${worst.dawn.toFixed(3)}`;
  const where = worst.hour ? `${sky}, and over the still of hour ${String(worst.hour.step).padStart(2, '0')} too` : sky;
  const shown = bg.shown < 0.995 ? `, ${Math.round(bg.shown * 100)} percent of its lines showing` : '';
  return (
    `${route}, ${theme}, ${width} px, scrolled to ${worst.y} px${dawn}: ${item.describe}: ` +
    `text ${hex(verdict.text)}${item.opacity < 1 ? ` (opacity ${item.opacity.toFixed(2)})` : ''} ${verdict.large ? 'large' : `${item.fontSize}px`} ` +
    `on ${hex(bg.rgb)} (the ${ordinal(bg.percentile)} percentile of ${bg.pixels} px${shown}, luminance ${bg.luminance.toFixed(4)}): ` +
    `${verdict.ratio.toFixed(2)} to 1, needs ${verdict.required} (${where})`
  );
}

/** Takes a screenshot of the window. */
type Shoot = () => Promise<Raster>;

/**
 * The DevTools protocol's own screenshot, PNG encoded for speed, decoded: the window as it is, with
 * none of the waits page.screenshot() adds, for the many screenshots of one page.
 */
async function shooter(page: Page): Promise<Shoot> {
  const cdp = await page.context().newCDPSession(page);
  return async () => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    return decodePng(Buffer.from(data, 'base64'));
  };
}

/** Photographs the window with the text transparent and checks the pieces placed in it. */
async function check(page: Page, shoot: Shoot, items: TextItem[], only: number[] | null): Promise<Map<number, Verdict>> {
  const placements = await page.evaluate(measureText, only);
  const shot = prepareShot(await shoot());
  const out = new Map<number, Verdict>();
  for (const placement of placements) {
    const verdict = judge(items[placement.i], shot, placement.segments, placement.whole);
    if (verdict) out.set(placement.i, verdict);
  }
  return out;
}

/**
 * Checks each piece that failed over the brightest sky against the real hourly stills, hour by hour,
 * at the position where it was worst, until it fails over one (that hour is kept with it). Returns
 * the pieces that fail over a real hour; one that passes over all 24 failed only over their
 * combination, which no visitor sees.
 */
async function overTheHours(page: Page, shoot: Shoot, items: TextItem[], failing: Worst[], widthClass: StillClass, dawn: { min: number; max: number } | null): Promise<Worst[]> {
  const byPosition = new Map<number, Worst[]>();
  for (const worst of failing) byPosition.set(worst.y, [...(byPosition.get(worst.y) ?? []), worst]);
  for (const [y, group] of byPosition) {
    await page.evaluate(placeAt, { y, next: group[0].next, dawn });
    let open = group;
    for (let step = 0; step < STILL_STEPS && open.length > 0; step += 1) {
      await page.evaluate(showStill, { widthClass, url: blueprintStillUrl(widthClass, step) });
      const verdicts = await check(page, shoot, items, open.map((w) => w.item.i));
      for (const worst of open) {
        const verdict = verdicts.get(worst.item.i);
        if (verdict && fails(verdict)) worst.hour = { step, verdict };
      }
      open = open.filter((worst) => !worst.hour);
    }
  }
  return failing.filter((worst) => worst.hour);
}

/**
 * Where each run also writes its summary and, for a failure, the screenshots of the positions where
 * it failed, with and without the text: E2E_CONTRAST_DIR, a folder (left unset, nothing is written
 * but the test's own attachments).
 */
const EVIDENCE_DIR = process.env.E2E_CONTRAST_DIR?.trim() || null;

/** A name for a test's files: "blueprint-1440-projects-raven". */
const fileName = (theme: Theme, width: Width, route: string) => `${theme}-${width}-${route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'home'}`;

/**
 * Screenshots of the page as it shows at the first three positions where text failed, with its
 * text, attached to the test (and written to E2E_CONTRAST_DIR with the text-free ones the check
 * read, when it is set).
 */
async function evidence(page: Page, testInfo: TestInfo, name: string, transparent: { evaluate(fn: (e: Element) => void): Promise<void> }, failures: Worst[], dawn: { min: number; max: number } | null) {
  const positions = [...new Set(failures.map((f) => f.y))].slice(0, 3).map((y) => ({ y, next: failures.find((f) => f.y === y)?.next ?? 0 }));
  if (EVIDENCE_DIR) {
    for (const { y, next } of positions) {
      await page.evaluate(placeAt, { y, next, dawn });
      fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-${y}-background.png`), await page.screenshot());
    }
  }
  await transparent.evaluate((e) => e.remove());
  for (const { y } of positions) {
    // As a visitor sees it there: the dawn at that position's own strength, nothing carried.
    await page.evaluate(placeAt, { y, next: 0, dawn });
    const shot = await page.screenshot();
    await testInfo.attach(`failure at ${y} px`, { body: shot, contentType: 'image/png' });
    if (EVIDENCE_DIR) fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-${y}.png`), shot);
  }
}

// No trace or failure screenshot: the hundreds of steps of a test would make them slow and large;
// a failure attaches its own screenshots (evidence).
test.use({ trace: 'off', screenshot: 'off' });

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test.describe(`contrast over the sky, ${theme}, ${width} px`, () => {
      test.use({ theme, ...device(width) });

      for (const route of ROUTES) {
        test(routeTitle(route), async ({ page }, testInfo) => {
          test.setTimeout(300_000);
          await page.addInitScript(withoutWebGL);
          await page.route(`**${BRIGHTEST}*.png`, async (served) => {
            const widthClass = /brightest-(\w+)\.png/.exec(served.request().url())?.[1] ?? '';
            const body = await brightest.get(widthClass);
            await (body ? served.fulfill({ status: 200, contentType: 'image/png', body }) : served.fulfill({ status: 404 }));
          });
          expect(await open(page, route.path), 'status').toBe(route.status);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await visitWholePage(page);
          // The Still tier, and no live scene over it.
          await expect(page.locator('html')).toHaveAttribute('data-sky-tier', 'still');
          await expect(page.locator('.ar-sky__live.is-ready')).toHaveCount(0);

          const widthClass = (await page.evaluate(stillClassNow)) as StillClass | null;
          expect(widthClass, 'the still in use').not.toBeNull();
          let sky = `the ${theme} still (${widthClass})`;
          if (theme === 'blueprint' && widthClass) {
            if (!brightest.has(widthClass)) {
              const urls = Array.from({ length: STILL_STEPS }, (_, step) => blueprintStillUrl(widthClass, step));
              brightest.set(widthClass, page.evaluate(brightestOf, urls).then((base64) => Buffer.from(base64, 'base64')));
            }
            await brightest.get(widthClass);
            const shown = await page.evaluate(showStill, { widthClass, url: `${BRIGHTEST}${widthClass}.png` });
            expect(shown, 'the brightest sky of the day is the still shown').toContain(BRIGHTEST);
            sky = `the brightest of the 24 hourly ${widthClass} stills`;
          }

          const items = await page.evaluate(collectText);
          expect(items.length, 'text found on the page').toBeGreaterThan(0);
          const transparent = await page.addStyleTag({ content: TRANSPARENT_TEXT });
          const dawn = theme === 'blueprint' ? await page.evaluate(holdDawn) : null;
          if (theme === 'blueprint') expect(dawn, 'the dawn layer (Blueprint)').not.toBeNull();

          const { scrollable, height } = await pageLength(page);
          const shoot = await shooter(page);
          const positions = scrollPositions(scrollable, Math.max(40, Math.round(height * STEP)));
          const worst = new Map<number, Worst>();
          const seen = new Set<number>();
          for (const [k, wanted] of positions.entries()) {
            const next = k + 1 < positions.length ? positions[k + 1] - wanted : 0;
            const placed = await page.evaluate(placeAt, { y: wanted, next, dawn });
            for (const [i, verdict] of await check(page, shoot, items, null)) {
              seen.add(i);
              const before = worst.get(i);
              if (!before || verdict.ratio < before.verdict.ratio) worst.set(i, { item: items[i], verdict, y: placed.y, next, dawn: placed.dawn });
            }
          }

          const checked = [...worst.values()].filter((w) => !w.item.exempt);
          let failures = checked.filter((w) => fails(w.verdict));
          if (theme === 'blueprint' && widthClass && failures.length > 0) failures = await overTheHours(page, shoot, items, failures, widthClass, dawn);
          const lowest = [...checked].sort((a, b) => a.verdict.ratio - b.verdict.ratio)[0];
          const name = fileName(theme, width, route.path);
          const summary = JSON.stringify(
              {
                route: route.path,
                theme,
                width,
                sky,
                positions: positions.length,
                texts: items.length,
                checked: checked.length,
                exempt: [...worst.values()].filter((w) => w.item.exempt).map((w) => w.item.describe),
                lowest: lowest ? { ratio: Number(lowest.verdict.ratio.toFixed(2)), required: lowest.verdict.required, text: lowest.item.describe, y: lowest.y } : null,
                failures: failures.map((f) => line(route.path, theme, width, f, sky)),
                segments: failures.map((f) => ({ text: f.item.describe, y: f.y })),
              },
              null,
              2,
            );
          await testInfo.attach('contrast.json', { contentType: 'application/json', body: summary });
          if (EVIDENCE_DIR) {
            fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
            fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}.json`), summary);
          }
          if (failures.length > 0) await evidence(page, testInfo, name, transparent, failures, dawn);

          expect(seen.size, 'pieces of text seen on screen at some position').toBeGreaterThan(0);
          expect(
            failures.map((f) => line(route.path, theme, width, f, sky)),
            `${failures.length} piece(s) of text under AA over the sky (of ${checked.length} checked)`,
          ).toEqual([]);
        });
      }
    });
  }
}
