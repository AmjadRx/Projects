/**
 * The suite's own detectors, each shown a fault it must report, so a passing run means something:
 * - axe reports an image with no text alternative;
 * - the layout check reports a page wider than the window, and content cut off at the window's edge
 *   (bare text, and text, a video and a picture inside a wide box), but not a strip's own overflow
 *   or a drawing hidden from assistive technology;
 * - the theme recorder reports a page without its head script, a theme that changes after the body
 *   begins, and one that changes and changes back after load;
 * - the frame meter and the animation list report a loop and an animation under reduced motion,
 *   and the rest scan finds a loop that runs only near the view;
 * - the scroll through fails on a panel that never rises into view;
 * - the image check (./support/fixtures.ts) names a request for a picture the warm-up did not make
 *   (a source not warmed, or an Accept header that chooses another format), even one dropped
 *   before any answer, and not a warmed one, also in a context with no routing, where Playwright
 *   shows no Accept header; and an answer the server made for the test at a warmed address, but
 *   not one it had kept;
 * - the text reader leaves out what assistive technology does not read;
 * - the GPA rule reports each wrong form, and the resume rule each name a resume can be stored as;
 * - the contrast check (./support/contrast.ts) reports dim text and passes bright text,
 *   reads a glow under a word but not a hairline, and leaves out text under the sticky nav, and its
 *   statistic takes a twentieth of a whole line where only part of it shows; its transparent style
 *   paints none of the text's own paint and leaves each color to read, and text painted in a fill
 *   color of its own is reported; its page scan judges words the page swaps in as it scrolls, and
 *   names words that showed but were never judged; its check against the hourly stills looks at
 *   every position where a piece of text failed, its worst first; the touch check reports a
 *   listener that cancels a finger's drag, and the scroll it stops; the PNG reader gives a
 *   screenshot's pixels back; the PDF reader counts a printout's pages and reads them.
 * The faults are added to the page in the browser only; nothing in the site changes.
 */
import type { Page, Route } from '@playwright/test';
import { describeViolations, runAxe } from './support/axe';
import { luminance } from './support/color';
import {
  confirmOverHours,
  judge,
  ownTextFill,
  prepareShot,
  readText,
  sampleBackground,
  scanPage,
  shooter,
  TRANSPARENT_TEXT,
  withoutWebGL,
  type Position,
  type Segment,
  type Track,
  type Verdict,
} from './support/contrast';
import { expect, forgetImagesNotWarmed, imagesNotWarmed, test } from './support/fixtures';
import { gpaProblems } from './support/gpa';
import { OPTIMIZER, readWarmed, warmedAddress } from './support/images';
import { overflow } from './support/layout';
import { frameActivity, installFrameMeter, LOOP_FRAMES, LOOP_SPAN_MS, REST_STEP, restScan, runningAnimations } from './support/motion';
import { open, readableText, settle, visitWholePage } from './support/page';
import { letters, readPdf } from './support/pdf';
import { decodePng } from './support/png';
import { namedLikeResume } from './support/resume';
import { DESKTOP, device, PHONE } from './support/site';
import { flashes, recordTheme, themeLog } from './support/theme';
import { cancelled, dragUp, recordCancels, scrollRest } from './support/touch';

/** A quiet page with no load sequence, for the faults to go into. */
const PAGE = '/contact';

/** A 1 px GIF, the body of the image optimizer's stand-in answers. */
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Puts `html` at the end of main, in place of what the last call put there. */
async function put(page: Page, html: string): Promise<void> {
  await page.evaluate((markup) => {
    document.querySelector('[data-e2e-fault]')?.remove();
    const holder = document.createElement('div');
    holder.setAttribute('data-e2e-fault', '');
    holder.innerHTML = markup;
    document.querySelector('main')?.append(holder);
  }, html);
}

test.describe('harness, 1440 px', () => {
  test.use(device(DESKTOP));

  test('axe reports an image with no text alternative', async ({ page }) => {
    expect(await open(page, PAGE)).toBe(200);
    await page.evaluate(() => {
      const image = document.createElement('img');
      image.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      image.width = 20;
      image.height = 20;
      document.querySelector('main')?.append(image);
    });
    const report = await runAxe(page);
    expect(report.violations.map((violation) => violation.rule), describeViolations(report.violations)).toContain('image-alt');
  });

  test('the text reader leaves out what is hidden from assistive technology', async ({ page }) => {
    expect(await open(page, PAGE)).toBe(200);
    await page.evaluate(() => {
      const main = document.querySelector('main');
      for (const [text, attribute] of [['Shownmarkzq', ''], ['Hiddenmarkzq', 'aria-hidden'], ['Inertmarkzq', 'inert']]) {
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        if (attribute === 'aria-hidden') paragraph.setAttribute('aria-hidden', 'true');
        if (attribute === 'inert') paragraph.setAttribute('inert', '');
        main?.append(paragraph);
      }
    });
    const text = await readableText(page);
    expect(text).toContain('Shownmarkzq');
    expect(text).not.toContain('Hiddenmarkzq');
    expect(text).not.toContain('Inertmarkzq');
  });

  test('the scroll through fails on a panel that never rises into view', async ({ page }) => {
    expect(await open(page, PAGE)).toBe(200);
    // Waiting to rise, as components/site/risePanels.ts marks a panel, but nothing will ever raise it.
    await put(page, '<div class="ar-glass" data-ar-rise>A panel that never rises</div>');
    await expect(visitWholePage(page)).rejects.toThrow(/A panel that never rises/);
  });

  test.describe('the image check', () => {
    test.skip(Boolean(process.env.E2E_BASE_URL?.trim()), "the check is off against a deployment, whose image service is Vercel's");

    /** The address as an attribute writes it. */
    const attribute = (address: string) => address.replace(/&/g, '&amp;');
    /** The address of a request, as the check names it. */
    const asked = (url: URL) => `${url.pathname}${url.search}`;

    test('names a request for a picture the warm-up did not make, even one its page drops before any answer, and not a warmed one', async ({ context }) => {
      const warmed = readWarmed();
      expect(warmed, "the warm-up's list reached this worker").not.toBeNull();
      // A warmed picture, asked for by the page and answered by the suite's server.
      const kept = warmedAddress(warmed!);
      // A warmed picture asked for by fetch(), whose Accept header (*/*) chooses another format;
      // answered in the browser, so the server never sees it.
      const fetched = warmedAddress(warmed!, { width: 1 });
      // A picture never warmed: held in the browser with no answer, then dropped as its page
      // closes, as a test drops the first request for a picture that then hangs (the server never
      // sees this one either).
      const dropped = `${OPTIMIZER}?url=%2Fe2e-fault-dropped.gif&w=${warmed!.widths[0]}&q=${warmed!.qualities[0]}`;
      const page = await context.newPage();
      const held: Route[] = [];
      await page.route((url) => asked(url) === dropped, (route) => void held.push(route));
      await page.route((url) => asked(url) === fetched, (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: GIF }));
      expect(await open(page, PAGE)).toBe(200);
      await put(page, `<img alt="" width="16" height="16" src="${attribute(kept)}">`);
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('[data-e2e-fault] img');
        return Boolean(image?.complete && image.naturalWidth > 0);
      });
      expect(await page.evaluate(async (address) => (await fetch(address)).status, fetched)).toBe(200);
      const sent = page.waitForRequest((request) => asked(new URL(request.url())) === dropped);
      await put(page, `<img alt="" width="16" height="16" src="${attribute(dropped)}">`);
      await sent;
      await page.close();
      expect(held, 'the dropped request was held with no answer').toHaveLength(1);
      const named = imagesNotWarmed();
      expect(named.map((entry) => entry.address).sort(), JSON.stringify(named, null, 1)).toEqual([dropped, fetched].sort());
      expect(named.find((entry) => entry.address === dropped)?.why).toContain('source /e2e-fault-dropped.gif not warmed');
      expect(named.find((entry) => entry.address === fetched)?.why).toContain(`Accept "*/*" asks for the source's own format, and the warm-up made ${warmed!.format}`);
      // Seen; so the check at the end of this test passes.
      forgetImagesNotWarmed();
    });

    test('names an answer the image optimizer made for the test at a warmed address, and not one it had made before', async ({ page }) => {
      const warmed = readWarmed();
      expect(warmed, "the warm-up's list reached this worker").not.toBeNull();
      // Two warmed pictures, answered in the browser (the server never sees these requests): one
      // as the server answers a picture it made for the request (X-Nextjs-Cache: MISS), one as a
      // picture it had kept (HIT).
      const made = warmedAddress(warmed!, { width: 2 });
      const kept = warmedAddress(warmed!, { width: 3 });
      await page.route(
        (url) => [made, kept].includes(asked(url)),
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'image/gif',
            headers: { 'x-nextjs-cache': asked(new URL(route.request().url())) === made ? 'MISS' : 'HIT' },
            body: GIF,
          }),
      );
      expect(await open(page, PAGE)).toBe(200);
      await put(page, [made, kept].map((address) => `<img alt="" width="16" height="16" src="${attribute(address)}">`).join(''));
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll<HTMLImageElement>('[data-e2e-fault] img')).every((image) => image.complete && image.naturalWidth > 0),
      );
      await expect.poll(() => imagesNotWarmed()).toEqual([{ address: made, why: 'the server made it for this test (X-Nextjs-Cache: MISS)' }]);
      forgetImagesNotWarmed();
    });

    test.describe('with no routing in the context, as the console tests run', () => {
      test.use({ analyticsStandIn: false });

      test("judges a picture by the Accept header Chrome sends for it, which Playwright does not show here, and a fetch() by its own", async ({ page }) => {
        const warmed = readWarmed();
        expect(warmed, "the warm-up's list reached this worker").not.toBeNull();
        // A warmed picture, answered by the suite's server.
        const kept = warmedAddress(warmed!);
        // A warmed picture asked for by fetch(), whose Accept header (any type) chooses the
        // source's own format. With no routing nothing can answer in the browser: the server makes
        // it, small, under a key no page asks for.
        const fetched = warmedAddress(warmed!, { width: 4 });
        expect(await open(page, PAGE)).toBe(200);
        await put(page, `<img alt="" width="16" height="16" src="${attribute(kept)}">`);
        await page.waitForFunction(() => {
          const image = document.querySelector<HTMLImageElement>('[data-e2e-fault] img');
          return Boolean(image?.complete && image.naturalWidth > 0);
        });
        expect(imagesNotWarmed(), 'a warmed picture, though this context shows no Accept header for it').toEqual([]);
        const status = await page.evaluate(async (address) => {
          const response = await fetch(address);
          await response.arrayBuffer();
          return response.status;
        }, fetched);
        expect(status).toBe(200);
        await expect
          .poll(() => imagesNotWarmed().filter((entry) => entry.address === fetched).map((entry) => entry.why).join('\n'))
          .toMatch(/Accept "\*\/\*"( \(Chrome's own for this kind of request\))? asks for the source's own format/);
        forgetImagesNotWarmed();
      });
    });
  });

  test.describe('with a Whiteprint cookie', () => {
    test.use({ theme: 'whiteprint' });

    test('the theme recorder reports a page whose head script is missing', async ({ page }) => {
      await page.route(
        (url) => url.pathname === PAGE,
        async (route) => {
          const response = await route.fetch();
          const html = (await response.text()).replace(/<script>(?:(?!<\/script>)[\s\S])*?setAttribute\('data-theme'[\s\S]*?<\/script>/, '');
          await route.fulfill({ status: response.status(), contentType: 'text/html; charset=utf-8', body: html });
        },
      );
      await page.addInitScript(recordTheme);
      await page.goto(PAGE, { waitUntil: 'load' });
      expect(flashes(await themeLog(page), 'whiteprint').length).toBeGreaterThan(0);
    });

    test('the theme recorder reports a theme that changes after the body begins', async ({ page }) => {
      await page.addInitScript(recordTheme);
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => document.documentElement.setAttribute('data-theme', 'blueprint'));
      });
      await page.goto(PAGE, { waitUntil: 'load' });
      const problems = flashes(await themeLog(page), 'whiteprint');
      expect(problems.some((problem) => problem.includes('after the body began')), problems.join('\n')).toBe(true);
    });

    test('the theme recorder reports a theme that changes and changes back after load', async ({ page }) => {
      await page.addInitScript(recordTheme);
      await page.goto(PAGE, { waitUntil: 'load' });
      expect(flashes(await themeLog(page), 'whiteprint'), 'before the fault').toEqual([]);
      await page.evaluate(async () => {
        const html = document.documentElement;
        html.setAttribute('data-theme', 'blueprint');
        await new Promise((resolve) => setTimeout(resolve, 50));
        html.setAttribute('data-theme', 'whiteprint');
      });
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'whiteprint');
      const problems = flashes(await themeLog(page), 'whiteprint');
      expect(problems.some((problem) => problem.includes('from "whiteprint" to "blueprint"')), problems.join('\n')).toBe(true);
    });
  });
});

test.describe('harness, 390 px', () => {
  test.use(device(PHONE));

  test('the layout check reports text cut off by the page frame, and a page wider than the window', async ({ page }) => {
    expect(await open(page, PAGE)).toBe(200);
    await page.evaluate(() => {
      const line = document.createElement('p');
      line.textContent = 'A line far too wide for a phone';
      line.style.width = '1200px';
      line.style.whiteSpace = 'nowrap';
      document.querySelector('main')?.append(line);
    });
    expect((await overflow(page)).cut.join('\n')).toContain('A line far too wide');
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.style.width = '1600px';
      wide.style.height = '10px';
      document.body.append(wide);
    });
    const found = await overflow(page);
    expect(found.scrollWidth).toBeGreaterThan(found.clientWidth);
    expect(found.scrolledBy).toBeGreaterThan(0);
  });

  test("the layout check reports content cut off inside a box wider than the window, and leaves a strip's own overflow alone", async ({ page }) => {
    expect(await open(page, PAGE)).toBe(200);
    expect((await overflow(page)).cut, 'the page as it is').toEqual([]);
    const faults: [string, string, string][] = [
      [
        'a wide panel that clips its own text',
        '<div style="width:1200px;overflow:hidden;border-radius:4px;border:1px solid"><p style="white-space:nowrap">Panel text running off the phone</p></div>',
        'Panel text running off',
      ],
      ['a wide video', '<video aria-label="Wide fault video" style="display:block;width:1200px;max-width:none;height:40px"></video>', 'Wide fault video'],
      [
        'a wide picture',
        '<img alt="Wide fault picture" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="display:block;width:1200px;max-width:none;height:40px">',
        'Wide fault picture',
      ],
    ];
    for (const [name, html, mark] of faults) {
      await put(page, html);
      expect((await overflow(page)).cut.join('\n'), name).toContain(mark);
    }
    const fine: [string, string][] = [
      [
        'a strip that scrolls inside the window',
        '<div style="width:100%;overflow-x:auto"><p style="white-space:nowrap;width:1200px">Strip text that scrolls in its own box</p></div>',
      ],
      ['a drawing hidden from assistive technology', '<svg aria-hidden="true" width="1200" height="40" style="display:block;max-width:none"></svg>'],
    ];
    for (const [name, html] of fine) {
      await put(page, html);
      expect((await overflow(page)).cut, name).toEqual([]);
    }
  });

  test.describe('under reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('the frame meter reports a requestAnimationFrame loop, and the list a running animation', async ({ page }) => {
      await page.addInitScript(installFrameMeter);
      expect(await open(page, PAGE)).toBe(200);
      expect((await frameActivity(page, 500)).frames).toBeLessThanOrEqual(2);
      expect(await runningAnimations(page)).toEqual([]);
      await page.evaluate(() => {
        const loop = () => requestAnimationFrame(loop);
        loop();
        document.querySelector('main')?.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 20_000 });
      });
      // A loop by the rule the checks apply (support/motion.ts), however fast this machine draws.
      expect((await frameActivity(page, LOOP_SPAN_MS)).frames).toBeGreaterThan(LOOP_FRAMES);
      expect((await runningAnimations(page)).join('\n')).toContain('Web Animation on main');
    });

    test('the rest scan finds a loop that runs only while a mark is out of the window, within a quarter window of it', async ({ page }) => {
      await page.addInitScript(installFrameMeter);
      expect(await open(page, PAGE)).toBe(200);
      // Four windows of page, an 8 px mark, four more: the loop runs only in two bands of scroll a
      // quarter window wide (the mark just below the window, and just above it), as the phone's
      // featured strip mounts its Carousel (lib/motion.ts page.strip).
      await page.evaluate(() => {
        const block = (height: number) => {
          const element = document.createElement('div');
          element.style.height = `${height}px`;
          return element;
        };
        const mark = block(8);
        document.querySelector('main')?.append(block(4 * window.innerHeight), mark, block(4 * window.innerHeight));
        let frame = 0;
        const tick = () => {
          frame = requestAnimationFrame(tick);
        };
        const check = () => {
          const box = mark.getBoundingClientRect();
          const view = window.innerHeight;
          const near = (box.top > view && box.top <= view * 1.25) || (box.bottom < 0 && box.bottom >= -view * 0.25);
          if (near && !frame) tick();
          else if (!near && frame) {
            cancelAnimationFrame(frame);
            frame = 0;
          }
        };
        window.addEventListener('scroll', check, { passive: true });
      });
      const readings = await restScan(page, 250);
      const tops = readings.map((reading) => reading.top);
      const gaps = tops.slice(1).map((top, index) => top - tops[index]);
      expect(Math.max(...gaps), `rested at ${tops.join(', ')}`).toBeLessThanOrEqual(Math.floor(device(PHONE).viewport.height * REST_STEP));
      expect(readings[0].activity.frames, 'nothing runs at the top').toBeLessThanOrEqual(2);
      const loops = readings.filter((reading) => reading.activity.frames > 2).map((reading) => reading.top);
      expect(loops.length, `rested at ${tops.join(', ')}; the loop showed at ${loops.join(', ') || 'none'}`).toBeGreaterThan(0);
    });
  });
});

test('the GPA rule reports every wrong form, and passes the right one', () => {
  const check = (text: string) => gpaProblems({ source: 'sample', text });
  for (const right of [
    'University Honors Program. Major GPA 3.65. Honors thesis (in progress).',
    'Major GPA 3.65',
    'Major GPA 3.65, Santa Clara',
    'Major GPA 3.65 Location Santa Clara, CA',
    // A list's fields run together in the visible text: a field ending in "quarter" is not a qualifier.
    'Started Fall quarter Major GPA 3.65',
  ]) {
    expect(check(right), right).toEqual([]);
  }
  for (const wrong of [
    'GPA 3.65',
    'Major GPA: 3.65',
    'A GPA of 3.65',
    'Grades 3.65',
    'Cumulative Major GPA 3.65',
    'Overall Major GPA 3.65',
    'Major GPAs',
    'Major GPA 3.654',
    'Major GPA 3.650',
    'Major GPA 3.65/4.0',
    'Major GPA 3.65 / 4.0',
    'Major GPA 3.65 out of 4',
    'Major GPA 3.65 of 4.00',
  ]) {
    expect(check(wrong).length, wrong).toBeGreaterThan(0);
  }
});

test('the resume rule catches every name a resume can be stored as, and passes the site\'s own kinds of name', () => {
  for (const name of [
    // As lib/storage/rules.ts sanitizeFileName stores uploads: lowercase, accents dropped, words joined.
    'amjadrehawiresume.pdf',
    'amjadresume2026.pdf',
    'mycv.pdf',
    'rehawicv.pdf',
    'amjadcv-final.pdf',
    'amjad-rehawi-cv-2026.pdf',
    'resume-2026.pdf',
    'curriculumvitae.pdf',
    'curriculum-vitae.pdf',
    'amjad-vita.pdf',
    // As a person names a file, or a link names a page.
    'AmjadRehawiResume.pdf',
    'Résumé.pdf',
    'R%C3%A9sum%C3%A9.pdf',
    'https://example.com/files/CV.pdf',
    '/media/site/amjadcv2026.docx',
    '/resume',
    '/cv',
  ]) {
    expect(namedLikeResume(name), name).toBe(true);
  }
  for (const name of [
    '/projects/raven',
    '/media/raven/img-7414.webp',
    '/media/fsae-bronco-racing/24e64973-722d-410e-8d06-175b12151d50.jpeg',
    '/projects/opencv-lane-detection',
    '/media/project/opencv-results.png',
    'https://github.com/someone',
  ]) {
    expect(namedLikeResume(name), name).toBe(false);
  }
});

test.describe('harness, the contrast check and its readers, 1440 px', () => {
  test.use({ ...device(DESKTOP), theme: 'blueprint' });

  /** Every piece of text on the page now, judged against the window as it is, by its words. */
  async function verdicts(page: Page) {
    const style = await page.addStyleTag({ content: TRANSPARENT_TEXT });
    // Read with the style on, as the check reads every page.
    const { items, placements } = await page.evaluate(readText, null);
    const shot = prepareShot(decodePng(await page.screenshot()));
    await style.evaluate((e) => e.parentNode?.removeChild(e));
    const out = new Map<string, number>();
    for (const placement of placements) {
      const verdict = judge(items[placement.i], shot, placement.segments, placement.whole);
      const words = /"([^"]+)"/.exec(items[placement.i].describe)?.[1] ?? '';
      if (verdict) out.set(words, verdict.ratio);
    }
    return out;
  }

  test('the PNG reader gives back the colors of a screenshot', async ({ page }) => {
    expect(await open(page, PAGE)).toBe(200);
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:100px;top:200px;width:50px;height:40px;background:rgb(18,52,86);z-index:999';
      document.body.append(box);
    });
    const raster = decodePng(await page.screenshot());
    expect([raster.width, raster.height]).toEqual([1440, 900]);
    const at = (120 + 220 * raster.width) * 4;
    expect(Array.from(raster.data.slice(at, at + 4))).toEqual([18, 52, 86, 255]);
  });

  test('the contrast check reports dim text, passes bright text, and reads a glow but not a hairline', async ({ page }) => {
    await page.addInitScript(withoutWebGL);
    expect(await open(page, PAGE)).toBe(200);
    // On a ground of the sheet's own color, in the page's flow (a fixed element would count as a
    // layer in front of the page, as the nav does).
    await put(
      page,
      [
        '<div style="position:relative;height:180px;background:#0b1f45">',
        '<p style="position:absolute;left:20px;top:10px;margin:0;font-size:17px;line-height:22px;color:#2b3a55">Dimmarkzq</p>',
        '<p style="position:absolute;left:20px;top:50px;margin:0;font-size:17px;line-height:22px;color:#ffffff">Brightmarkzq</p>',
        // A hairline (1 px) of white across a word: not the ground it is read against.
        '<div style="position:absolute;left:0;top:100px;width:400px;height:1px;background:#ffffff"></div>',
        '<p style="position:absolute;left:20px;top:90px;margin:0;font-size:17px;line-height:22px;color:#a9bedf">Hairlinemarkzq</p>',
        // A glow (a 12 px band of pale light) behind the lower half of a word: the ground it is read against.
        '<div style="position:absolute;left:0;top:141px;width:400px;height:12px;background:#d8e2f2"></div>',
        '<p style="position:absolute;left:20px;top:130px;margin:0;font-size:17px;line-height:22px;color:#a9bedf">Glowmarkzq</p>',
        '</div>',
      ].join(''),
    );
    await page.locator('[data-e2e-fault]').evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const found = await verdicts(page);
    expect(found.get('Dimmarkzq'), 'dim text on the dark ground').toBeLessThan(4.5);
    expect(found.get('Brightmarkzq'), 'white on the dark ground').toBeGreaterThan(10);
    expect(found.get('Hairlinemarkzq'), 'a hairline across a word does not decide it').toBeGreaterThan(4.5);
    expect(found.get('Glowmarkzq'), 'a band of light under a word does').toBeLessThan(2);
  });

  test('the contrast check leaves out text where the sticky nav lies over it', async ({ page }) => {
    await page.addInitScript(withoutWebGL);
    expect(await open(page, PAGE)).toBe(200);
    // Under the nav (64 px tall from the frame's top), dim text that no one can see; beside it, outside.
    await put(page, '<p style="position:fixed;left:900px;top:30px;margin:0;font-size:15px;color:#2b3a55;z-index:0">Undernavmarkzq</p>');
    const found = await verdicts(page);
    expect(found.has('Undernavmarkzq'), 'text under the nav is not judged').toBe(false);
  });

  test('the transparent style paints none of the text, leaves each color to read, and a fill color of its own is reported', async ({ page }) => {
    expect(await open(page, PAGE)).toBe(200);
    // Each way text is painted, on a flat ground in the page's flow.
    const GROUND = [11, 31, 69];
    const marks = ['Plainmarkzq', 'Linkmarkzq', 'Shadowmarkzq', 'Strokemarkzq', 'Listmarkzq', 'Buttonmarkzq', 'Svgmarkzq'];
    await put(
      page,
      [
        `<div style="background:rgb(${GROUND.join(',')});padding:12px 20px;font-size:20px;line-height:30px">`,
        '<p style="margin:0;color:#ffffff">Plainmarkzq</p>',
        '<p style="margin:0"><a href="#e2e" style="color:#ffd27f;text-decoration:underline 2px">Linkmarkzq</a></p>',
        '<p style="margin:0;color:#ffffff;text-shadow:0 0 6px #ffffff, 2px 2px 0 #ff0000">Shadowmarkzq</p>',
        '<p style="margin:0;color:#ffffff;-webkit-text-stroke:2px #ff0000">Strokemarkzq</p>',
        '<ul style="margin:0;padding:0;color:#ffffff;list-style-position:inside"><li>Listmarkzq</li></ul>',
        '<button type="button" style="all:unset;color:#ffffff">Buttonmarkzq</button>',
        '<svg width="240" height="30" style="display:block"><text x="0" y="22" fill="#ffffff" font-size="20">Svgmarkzq</text></svg>',
        '</div>',
      ].join(''),
    );
    await page.locator('[data-e2e-fault]').evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    expect(await page.evaluate(ownTextFill), 'no text here takes a fill color of its own').toEqual([]);
    const before = await page.evaluate(readText, null);
    const style = await page.addStyleTag({ content: TRANSPARENT_TEXT });
    const after = await page.evaluate(readText, null);
    const raster = decodePng(await page.screenshot());
    await style.evaluate((e) => e.parentNode?.removeChild(e));
    for (const mark of marks) {
      const was = before.items.find((item) => item.describe.includes(mark));
      const now = after.items.find((item) => item.describe.includes(mark));
      expect(now?.color, `${mark}: its color, read with the style on`).toBe(was?.color);
      const placement = after.placements.find((p) => p.i === now?.i);
      expect(placement, `${mark} shows`).toBeTruthy();
      // Every pixel of its line boxes is the ground: no fill, stroke, shadow or underline left.
      const painted: string[] = [];
      for (const [x0, y0, x1, y1] of placement!.segments) {
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const at = (y * raster.width + x) * 4;
            const pixel = [raster.data[at], raster.data[at + 1], raster.data[at + 2]];
            if (pixel.some((c, k) => Math.abs(c - GROUND[k]) > 2)) painted.push(`${x},${y}: ${pixel.join(',')}`);
          }
        }
      }
      expect(painted.slice(0, 5), `${mark}: pixels of its line boxes painted with the style on`).toEqual([]);
    }
    // A fill color of the text's own would be painted instead of its color, which the check reads.
    await put(page, '<p style="color:#ffffff;-webkit-text-fill-color:#ff0000">Fillmarkzq</p>');
    expect((await page.evaluate(ownTextFill)).join('\n')).toContain('Fillmarkzq');
  });

  test('the page scan judges words the page swaps in as it scrolls, and names words that showed but were never judged', async ({ page }) => {
    await page.addInitScript(withoutWebGL);
    expect(await open(page, PAGE)).toBe(200);
    // Below a window and a half of page: bright words that the page replaces with dim ones once they
    // come near the view, and puts back once they are far again, as the tools ticker trades places
    // with its moving form; then words painted transparent wherever they show, as a readout that
    // never ended its count would be.
    await put(
      page,
      [
        '<div style="height:1400px"></div>',
        '<div style="background:#0b1f45;padding:20px">',
        '<p id="e2e-swap" style="margin:0;font-size:17px;line-height:24px;color:#ffffff">Servermarkzq</p>',
        '<p style="margin:0;font-size:17px;line-height:24px;color:transparent">Stuckmarkzq</p>',
        '</div>',
      ].join(''),
    );
    await page.evaluate(() => {
      const holder = document.getElementById('e2e-swap');
      if (!holder) return;
      new IntersectionObserver(
        ([entry]) => {
          const swapped = holder.textContent === 'Swappedmarkzq';
          if (entry.isIntersecting && !swapped) {
            holder.style.color = '#2b3a55';
            holder.replaceChildren(document.createTextNode('Swappedmarkzq'));
          } else if (!entry.isIntersecting && swapped) {
            holder.style.color = '#ffffff';
            holder.replaceChildren(document.createTextNode('Servermarkzq'));
          }
        },
        { rootMargin: '100px 0px' },
      ).observe(holder);
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });
    await page.addStyleTag({ content: TRANSPARENT_TEXT });
    const { tally } = await scanPage(page, await shooter(page), { step: 180, dawn: null });
    const track = (mark: string) => [...tally.tracks.values()].find((t) => t.item.describe.includes(mark));
    const swapped = track('Swappedmarkzq');
    expect(swapped?.judged.length, 'the words swapped in near the view are judged').toBeGreaterThan(0);
    expect(Math.min(...swapped!.judged.map((j) => j.verdict.ratio)), 'dim words on the dark ground').toBeLessThan(4.5);
    expect(
      tally.unjudged().map((t) => t.item.describe),
      'words that showed but were never judged',
    ).toEqual([expect.stringContaining('Stuckmarkzq')]);
    expect(track('Stuckmarkzq')?.shown[0].unjudged).toMatch(/transparent/);
  });

  test('the PDF reader counts the pages of a printout and reads their words and size', async ({ page }) => {
    await page.setContent('<p>Firstpagezq</p><p style="break-before:page">Secondpagezq</p>');
    const pdf = await readPdf(await page.pdf({ format: 'Letter' }));
    expect(pdf.pages).toBe(2);
    expect(pdf.sizes).toEqual([
      [612, 792],
      [612, 792],
    ]);
    expect(letters(pdf.text[0])).toContain('firstpagezq');
    expect(letters(pdf.text[1])).toContain('secondpagezq');
  });
});

test('the contrast statistic takes a twentieth of the whole line where only part of it shows', () => {
  const width = 200;
  const height = 40;
  /** A dark sky, white where `light` says. */
  const sky = (light: (x: number, y: number) => boolean) => {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) data.set(light(x, y) ? [255, 255, 255, 255] : [11, 20, 48, 255], (y * width + x) * 4);
    }
    return prepareShot({ width, height, data });
  };
  const text = luminance([169, 190, 223]);
  const whole = 160 * 20;
  const line: Segment = [20, 10, 180, 30];
  // The lower 8 rows of the line, below a layer in front that hides the rest in passing.
  const strip: Segment = [20, 22, 180, 30];
  // A star's glow, 12 px across, under the strip: 3 percent of the line, 7.5 percent of the strip.
  const star = sky((x, y) => x >= 90 && x < 102 && y >= 22 && y < 34);
  expect(sampleBackground(star, [line], text, whole)?.luminance, 'the whole line: the star is under a twentieth').toBeLessThan(0.01);
  expect(sampleBackground(star, [strip], text)?.luminance, 'the strip read on its own: the star decides').toBeGreaterThan(0.9);
  const passing = sampleBackground(star, [strip], text, whole);
  expect(passing?.luminance, 'the strip as part of its line: the star does not decide').toBeLessThan(0.01);
  expect(passing?.shown).toBeCloseTo(0.4, 5);
  expect(passing?.percentile).toBe(87.5);
  // A glow under all of the strip still decides, and nothing is read where under a twentieth shows.
  const glow = sky((_x, y) => y >= 20);
  expect(sampleBackground(glow, [strip], text, whole)?.luminance, 'a glow under all that shows').toBeGreaterThan(0.9);
  expect(sampleBackground(glow, [[20, 28, 30, 30]], text, whole), 'a sliver: 20 of 3,200 px').toBeNull();
});

test('the check against the hourly stills looks at every position where a piece of text failed, its worst first', async () => {
  const at = (y: number): Position => ({ y, next: 100, dawn: 0.1 });
  const verdict = (ratio: number): Verdict => ({
    ratio,
    required: 4.5,
    large: false,
    text: [169, 190, 223],
    background: { pixels: 800, percentile: 95, shown: 1, rgb: [74, 91, 121], luminance: 0.1 },
  });
  /** A piece of text that failed over the brightest sky at these positions, with these ratios. */
  const track = (key: string, failed: [number, number][]): Track => ({
    key,
    item: { i: 0, key, color: 'rgb(169, 190, 223)', opacity: 1, fontSize: 15, fontWeight: 400, describe: key, exempt: null },
    shown: failed.map(([y]) => ({ position: at(y), unjudged: null })),
    judged: failed.map(([y, ratio]) => ({ position: at(y), verdict: verdict(ratio) })),
  });
  // Worst at 100 px, where it passes over every hour; it fails over hour 07 at 500 px.
  const elsewhere = track('a "Elsewheremarkzq" #1', [
    [100, 3.0],
    [500, 4.0],
  ]);
  // Fails only over the hours' combination.
  const combined = track('a "Combinedmarkzq" #1', [[100, 3.5]]);
  // Not there to judge over hour 03 at 100 px, and passes over every other hour.
  const unseen = track('a "Unseenmarkzq" #1', [[100, 4.2]]);
  const calls: string[] = [];
  const { confirmed, unread } = await confirmOverHours([elsewhere, combined, unseen], 24, async (position, hour, keys) => {
    calls.push(`${position.y}:${hour}`);
    const out = new Map<string, Verdict>();
    for (const key of keys) {
      if (key === unseen.key && hour === 3) continue;
      out.set(key, verdict(key === elsewhere.key && position.y === 500 && hour === 7 ? 4.2 : 5));
    }
    return out;
  });
  expect(calls[0], 'each piece first where it was worst').toBe('100:0');
  expect(confirmed.get(elsewhere.key), 'a failure over a real hour away from its worst position').toMatchObject({ hour: 7, judged: { position: { y: 500 } } });
  expect(calls.filter((call) => call.startsWith('500:')), 'hour by hour until one fails').toHaveLength(8);
  expect(confirmed.has(combined.key) || unread.has(combined.key), 'failed only over the combination of the hours').toBe(false);
  expect(confirmed.has(unseen.key)).toBe(false);
  expect(unread.get(unseen.key), 'kept, as nothing cleared it at that hour').toEqual(['hour 03 at 100 px']);
});

test.describe('harness, the touch check, 390 px', () => {
  test.use(device(PHONE));

  test('reports a listener that cancels a touch, and the scroll it stops', async ({ page }) => {
    await page.addInitScript(recordCancels);
    expect(await open(page, PAGE)).toBe(200);
    await dragUp(page, 195, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'a free drag scrolls' }).toBeGreaterThan(150);
    expect(await cancelled(page)).toEqual([]);
    // Back to the top once the first drag's scroll has ended, and at rest there before the next.
    await scrollRest(page);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      window.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
    });
    expect(await scrollRest(page), 'at rest at the top before the cancelled drag').toBe(0);
    await dragUp(page, 195, 600);
    expect(await scrollRest(page), 'a cancelled drag does not scroll').toBe(0);
    expect(await cancelled(page)).toContain('touchmove');
  });
});
