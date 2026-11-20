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
 * - the text reader leaves out what assistive technology does not read;
 * - the GPA rule reports each wrong form, and the resume rule each name a resume can be stored as.
 * The faults are added to the page in the browser only; nothing in the site changes.
 */
import type { Page } from '@playwright/test';
import { describeViolations, runAxe } from './support/axe';
import { expect, test } from './support/fixtures';
import { gpaProblems } from './support/gpa';
import { overflow } from './support/layout';
import { frameActivity, installFrameMeter, REST_STEP, restScan, runningAnimations } from './support/motion';
import { open, readableText, settle, visitWholePage } from './support/page';
import { namedLikeResume } from './support/resume';
import { DESKTOP, device, PHONE } from './support/site';
import { flashes, recordTheme, themeLog } from './support/theme';

/** A quiet page with no load sequence, for the faults to go into. */
const PAGE = '/contact';

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
      expect((await frameActivity(page, 500)).frames).toBeGreaterThan(10);
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
