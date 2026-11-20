/**
 * Text over the sky passes AA at every breakpoint, in both themes (ARCHITECTURE.md 6A and 15,
 * items 3 and 6a; docs/V3_PLAN.md D-80 and R-06), measured from screenshots: axe leaves
 * color-contrast undecided over the sky and its glass. On every public route, in both themes, at
 * 390, 768, 1024 and 1440 px, at the top of the page and every fifth of a window down to its end,
 * each visible piece of text is checked against the pixels under it (./support/contrast.ts says
 * how: the text read afresh at every position, its own paint made transparent, the 95th or 5th
 * percentile of the background's luminance, 4.5 to 1 or 3 to 1 for large text).
 *
 * The page, at rest: the whole page is brought into view first (visitWholePage), and the readouts'
 * count, which runs once as their row first comes into view, has ended (waitForCounts). What the
 * page swaps as it scrolls (the tools ticker and the phone's featured carousel, which take the place
 * of the server's markup near the view) is read wherever it shows, and text that showed somewhere
 * but was never judged anywhere fails the test.
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
 *   against each of the 24 stills in turn, at every position where it failed, and fails if it fails
 *   over a real one anywhere (the message names the hour). Whiteprint has one still a class, with
 *   no stars and no dawn.
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
  confirmOverHours,
  failuresOf,
  holdDawn,
  judgeLook,
  look,
  ownTextFill,
  pageLength,
  placeAt,
  scanPage,
  shooter,
  showStill,
  stillClassNow,
  TRANSPARENT_TEXT,
  waitForCounts,
  withoutWebGL,
  worstOf,
  type Dawn,
  type Judged,
  type Shoot,
  type Track,
  type Verdict,
} from './support/contrast';
import { expect, test } from './support/fixtures';
import { open, visitWholePage } from './support/page';
import { device, routeTitle, ROUTES, THEMES, WIDTHS, type Theme, type Width } from './support/site';

/** Positions a fifth of a window apart. */
const STEP = 0.2;

/** Where the brightest sky of each width class is served from (by this test's route, not the site). */
const BRIGHTEST = '/__e2e__/sky/brightest-';

/** The brightest sky of each width class, made once in each worker. */
const brightest = new Map<string, Promise<Buffer>>();

/** A piece of text under AA, as the run reports it. */
interface Failure {
  track: Track;
  /** The verdict reported, and the position it was given at. */
  judged: Judged;
  /** The sky it was given over, for the message. */
  where: string;
  /** The hourly still it fails over (Blueprint), shown again for the evidence. */
  hour?: number;
}

/** 95 as "95th", 2.5 as "2.5th", 91 as "91st". */
function ordinal(n: number): string {
  if (!Number.isInteger(n)) return `${n}th`;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/** An hour of the stills, as "07". */
const hh = (step: number) => String(step).padStart(2, '0');

function line(route: string, theme: Theme, width: Width, { track: { item }, judged: { position, verdict }, where }: Failure): string {
  const bg = verdict.background;
  const dawn = position.dawn === null ? '' : `, dawn ${position.dawn.toFixed(3)}`;
  const shown = bg.shown < 0.995 ? `, ${Math.round(bg.shown * 100)} percent of its lines showing` : '';
  return (
    `${route}, ${theme}, ${width} px, scrolled to ${position.y} px${dawn}: ${item.describe}: ` +
    `text ${hex(verdict.text)}${item.opacity < 1 ? ` (opacity ${item.opacity.toFixed(2)})` : ''} ${verdict.large ? 'large' : `${item.fontSize}px`} ` +
    `on ${hex(bg.rgb)} (the ${ordinal(bg.percentile)} percentile of ${bg.pixels} px${shown}, luminance ${bg.luminance.toFixed(4)}): ` +
    `${verdict.ratio.toFixed(2)} to 1, needs ${verdict.required} (${where})`
  );
}

/** A piece of text that showed but got no verdict at any position, for the report. */
function unjudgedLine(route: string, theme: Theme, width: Width, track: Track): string {
  const at = track.shown.map(({ position }) => position.y);
  const why = [...new Set(track.shown.map(({ unjudged }) => unjudged))].join('; ');
  return `${route}, ${theme}, ${width} px: ${track.item.describe} showed at ${at.length} position(s) (${at.slice(0, 6).join(', ')}${at.length > 6 ? ', ...' : ''} px) and was judged at none: ${why}`;
}

/**
 * Checks each piece of text that failed over the brightest sky against the real hourly stills, at
 * every position where it failed there, its worst first, hour by hour, until it fails over one:
 * that hour and that position are what the run reports (support/contrast.ts confirmOverHours). One
 * that passes over all 24 at every such position failed only over their combination, which no
 * visitor sees, and is dropped. One that could not be judged at some hour and position (the page
 * showed it in another form there, or not at all) is kept, as failing over the brightest sky, since
 * nothing cleared it.
 */
async function overTheHours(page: Page, shoot: Shoot, failing: Track[], widthClass: StillClass, dawn: Dawn | null, sky: string): Promise<Failure[]> {
  let placed: number | null = null;
  const { confirmed, unread } = await confirmOverHours(failing, STILL_STEPS, async (position, hour, keys) => {
    if (placed !== position.y) {
      await page.evaluate(placeAt, { y: position.y, next: position.next, dawn });
      placed = position.y;
    }
    await page.evaluate(showStill, { widthClass, url: blueprintStillUrl(widthClass, hour) });
    const found = await look(page, shoot, keys);
    return new Map([...judgeLook(found)].map(([i, verdict]): [string, Verdict] => [found.items[i].key, verdict]));
  });
  const out: Failure[] = [];
  for (const track of failing) {
    const hit = confirmed.get(track.key);
    const missed = unread.get(track.key);
    if (hit) out.push({ track, judged: hit.judged, hour: hit.hour, where: `over the ${widthClass} still of hour ${hh(hit.hour)}, and over ${sky}` });
    else if (missed) {
      const list = `${missed.slice(0, 3).join(', ')}${missed.length > 3 ? `, and ${missed.length - 3} more` : ''}`;
      out.push({ track, judged: failuresOf(track)[0], where: `${sky}; not cleared by the hourly stills, since it could not be judged at ${list}` });
    }
  }
  return out;
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
 * read, when it is set), each over the sky it failed over: the hour's still where an hour was found.
 */
async function evidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
  transparent: { evaluate(fn: (e: Element) => void): Promise<void> },
  failures: Failure[],
  dawn: Dawn | null,
  stillFor: (failure: Failure) => { widthClass: string; url: string } | null,
) {
  const shots: Failure[] = [];
  for (const failure of failures) if (!shots.some((f) => f.judged.position.y === failure.judged.position.y) && shots.length < 3) shots.push(failure);
  const show = async (failure: Failure, next: number) => {
    const still = stillFor(failure);
    if (still) await page.evaluate(showStill, still);
    await page.evaluate(placeAt, { y: failure.judged.position.y, next, dawn });
  };
  if (EVIDENCE_DIR) {
    for (const failure of shots) {
      await show(failure, failure.judged.position.next);
      fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-${failure.judged.position.y}-background.png`), await page.screenshot());
    }
  }
  await transparent.evaluate((e) => e.remove());
  for (const failure of shots) {
    // As a visitor sees it there: the dawn at that position's own strength, nothing carried.
    await show(failure, 0);
    const shot = await page.screenshot();
    await testInfo.attach(`failure at ${failure.judged.position.y} px`, { body: shot, contentType: 'image/png' });
    if (EVIDENCE_DIR) fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-${failure.judged.position.y}.png`), shot);
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
          await waitForCounts(page);
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

          expect(await page.evaluate(ownTextFill), 'text painted in a fill color of its own (the check reads each piece of text by its color)').toEqual([]);
          const transparent = await page.addStyleTag({ content: TRANSPARENT_TEXT });
          const dawn = theme === 'blueprint' ? await page.evaluate(holdDawn) : null;
          if (theme === 'blueprint') expect(dawn, 'the dawn layer (Blueprint)').not.toBeNull();

          const { height } = await pageLength(page);
          const shoot = await shooter(page);
          const { tally, positions } = await scanPage(page, shoot, { step: Math.max(40, Math.round(height * STEP)), dawn });

          const checked = tally.checked();
          const failing = checked.filter((track) => failuresOf(track).length > 0);
          let failures: Failure[] = failing.map((track) => ({ track, judged: failuresOf(track)[0], where: sky }));
          if (theme === 'blueprint' && widthClass && failing.length > 0) failures = await overTheHours(page, shoot, failing, widthClass, dawn, sky);
          const unjudged = tally.unjudged();
          const lowest = checked
            .map((track) => ({ track, worst: worstOf(track)! }))
            .sort((a, b) => a.worst.verdict.ratio - b.worst.verdict.ratio)[0];
          const name = fileName(theme, width, route.path);
          const summary = JSON.stringify(
            {
              route: route.path,
              theme,
              width,
              sky,
              positions: positions.length,
              texts: tally.tracks.size,
              checked: checked.length,
              exempt: [...tally.tracks.values()].filter((track) => track.item.exempt).map((track) => track.item.describe),
              lowest: lowest
                ? { ratio: Number(lowest.worst.verdict.ratio.toFixed(2)), required: lowest.worst.verdict.required, text: lowest.track.item.describe, y: lowest.worst.position.y }
                : null,
              failures: failures.map((failure) => line(route.path, theme, width, failure)),
              unjudged: unjudged.map((track) => unjudgedLine(route.path, theme, width, track)),
              positionsFailed: failures.map((failure) => ({ text: failure.track.item.describe, y: failure.judged.position.y, hour: failure.hour ?? null })),
            },
            null,
            2,
          );
          await testInfo.attach('contrast.json', { contentType: 'application/json', body: summary });
          if (EVIDENCE_DIR) {
            fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
            fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}.json`), summary);
          }
          if (failures.length > 0) {
            const stillFor = (failure: Failure) =>
              theme !== 'blueprint' || !widthClass
                ? null
                : { widthClass, url: failure.hour === undefined ? `${BRIGHTEST}${widthClass}.png` : blueprintStillUrl(widthClass, failure.hour) };
            await evidence(page, testInfo, name, transparent, failures, dawn, stillFor);
          }

          expect(tally.tracks.size, 'pieces of text seen on screen at some position').toBeGreaterThan(0);
          expect
            .soft(unjudged.map((track) => unjudgedLine(route.path, theme, width, track)), `${unjudged.length} piece(s) of text that showed but were never judged`)
            .toEqual([]);
          expect(
            failures.map((failure) => line(route.path, theme, width, failure)),
            `${failures.length} piece(s) of text under AA over the sky (of ${checked.length} checked)`,
          ).toEqual([]);
        });
      }
    });
  }
}
