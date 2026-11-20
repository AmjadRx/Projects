/**
 * The suite's own detectors, each shown a fault it must report, so a passing run means something:
 * axe reports an image with no text alternative; the layout check reports a page wider than the
 * window and text the page frame cuts off; the theme recorder reports a page without its head
 * script and a theme that changes after the body begins; the frame meter and the animation list
 * report a loop and an animation under reduced motion; the text reader leaves out what assistive
 * technology does not read; and the GPA rule reports each wrong form. The faults are added to the
 * page in the browser only; nothing in the site changes.
 */
import { describeViolations, runAxe } from './support/axe';
import { expect, test } from './support/fixtures';
import { gpaProblems } from './support/gpa';
import { overflow } from './support/layout';
import { frameActivity, installFrameMeter, runningAnimations } from './support/motion';
import { open, readableText } from './support/page';
import { DESKTOP, device, PHONE } from './support/site';
import { flashes, recordTheme, themeLog } from './support/theme';

/** A quiet page with no load sequence, for the faults to go into. */
const PAGE = '/contact';

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
  });
});

test('the GPA rule reports every wrong form, and passes the right one', () => {
  const check = (text: string) => gpaProblems({ source: 'sample', text });
  expect(check('University Honors Program. Major GPA 3.65. Honors thesis (in progress).')).toEqual([]);
  expect(check('Major GPA 3.65')).toEqual([]);
  expect(check('GPA 3.65').length).toBeGreaterThan(0);
  expect(check('Major GPA: 3.65').length).toBeGreaterThan(0);
  expect(check('A GPA of 3.65').length).toBeGreaterThan(0);
  expect(check('Grades 3.65').length).toBeGreaterThan(0);
  expect(check('Cumulative Major GPA 3.65').length).toBeGreaterThan(0);
  expect(check('Major GPAs').length).toBeGreaterThan(0);
});
