/**
 * Printing (ARCHITECTURE.md 5, "Also new": "a project page prints as a clean drawing sheet with the
 * title block, on white, without nav or motion"; app/print.css). tests/print.test.ts keeps the
 * stylesheet's rules from drifting; this file prints the built pages in Chrome:
 * - every project page: page.pdf() gives one page, US Letter landscape, holding the title block (its
 *   labels and values), the project's title and the page's address;
 * - every project page under print media: the nav, the sky, the palette (even left open), every
 *   button and all motion are gone, the paper is white, and the thermal ramp shows only in the
 *   maturity scale (DESIGN_DIRECTION.md 2.4, place 2);
 * - every other route: printed on white with no nav and no sky, its heading in the PDF, and every
 *   piece of text legible on the paper (AA contrast against what it is printed on).
 */
import type { Page } from '@playwright/test';
import { UI } from '../../lib/strings';
import { contrast, over, parseColor, requiredRatio, type Rgb } from './support/color';
import { expect, test } from './support/fixtures';
import { open, visitWholePage } from './support/page';
import { letters, readPdf } from './support/pdf';
import { DESKTOP, device, projects, routeTitle, ROUTES } from './support/site';

/** US Letter landscape, in points. */
const LETTER_LANDSCAPE: [number, number] = [792, 612];
/** US Letter, portrait, which the other pages print on. */
const LETTER: [number, number] = [612, 792];

const isProject = (path: string) => path.startsWith('/projects/') && projects.some((p) => `/projects/${p.slug}` === path);

/** What the page shows in print: run under print media. */
interface PrintView {
  /** Rendered elements that print.css keeps off the paper, described. */
  nav: string[];
  /** The drawing sheet's frame, which a project page prints (and no other page). */
  frame: string[];
  sky: string[];
  palette: string[];
  buttons: string[];
  /** Animations and transitions still running. */
  motion: string[];
  /** The backgrounds of the root, the body and the page frame. */
  paper: string[];
  /** Rendered elements drawn in the thermal ramp (at least two of its stops in a gradient), described. */
  ramp: string[];
  /** The title block's labels and values as the page prints them, and the address and the title. */
  titleBlock: string[];
  address: string | null;
  title: string | null;
  h1: string | null;
}

function printView(): PrintView {
  const describe = (el: Element) => {
    const classes = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
    const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
    return `${el.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join('')}${words ? ` "${words}"` : ''}`;
  };
  const rendered = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const shown = (selector: string) => Array.from(document.querySelectorAll(selector)).filter(rendered).map(describe);
  // The ramp's stops as this page computes them.
  const probe = document.createElement('span');
  document.body.append(probe);
  const stops = [0, 1, 2, 3, 4, 5, 6].map((n) => {
    probe.style.color = `var(--t${n})`;
    return getComputedStyle(probe).color.replace(/\s+/g, '');
  });
  probe.remove();
  const ramp = Array.from(document.querySelectorAll('*')).filter((el) => {
    if (!rendered(el)) return false;
    const image = getComputedStyle(el).backgroundImage.replace(/\s+/g, '');
    return image.includes('gradient') && stops.filter((stop) => image.includes(stop)).length >= 2;
  });
  const article = document.querySelector('.pj-sheet');
  return {
    nav: shown('.ar-nav, .ar-mmenu, .ar-skip'),
    frame: shown('.ar-sheetframe'),
    sky: shown('.ar-sky, .ar-sky *'),
    palette: shown('.ar-cmdk, .ar-cmdk *'),
    buttons: shown('button, [role="button"], .ar-btn, .ar-iconbtn'),
    motion: document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => `${(a as Animation & { animationName?: string }).animationName ?? 'animation'} on ${describe((a.effect as KeyframeEffect | null)?.target ?? document.body)}`),
    paper: [document.documentElement, document.body, document.querySelector('.ar-frame')].map((el) => (el ? getComputedStyle(el).backgroundColor : 'none')),
    ramp: ramp.map(describe),
    // The words each field shows on paper: its rendered text, less what is there for screen readers only.
    titleBlock: Array.from(document.querySelectorAll('.pj-sheet .ar-tb dt, .pj-sheet .ar-tb dd'))
      .filter(rendered)
      .map((el) => {
        const words: string[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (parent && !parent.closest('.ar-sr') && rendered(parent)) words.push(node.nodeValue ?? '');
        }
        return words.join(' ').replace(/\s+/g, ' ').trim();
      })
      .filter(Boolean),
    address: article?.getAttribute('data-print-address') ?? null,
    title: document.querySelector('.pj-sheet .pj-title')?.textContent?.trim() ?? null,
    h1: document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  };
}

/** Each visible piece of text with its color and the color of what it is printed on (backgrounds composited from the paper up). */
function printedText(): { describe: string; color: string; backgrounds: string[]; fontSize: number; fontWeight: number }[] {
  const out: { describe: string; color: string; backgrounds: string[]; fontSize: number; fontWeight: number }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || seen.has(el) || !(node.nodeValue ?? '').trim()) continue;
    if (el.closest('script, style, noscript, template, [aria-hidden="true"]')) continue;
    if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    seen.add(el);
    const backgrounds: string[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) backgrounds.unshift(getComputedStyle(e).backgroundColor);
    const style = getComputedStyle(el);
    const classes = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
    out.push({
      describe: `${el.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join('')} "${(node.nodeValue ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`,
      color: style.webkitTextFillColor || style.color,
      backgrounds,
      fontSize: Number.parseFloat(style.fontSize) || 16,
      fontWeight: Number(style.fontWeight) || 400,
    });
  }
  return out;
}

/** The pieces of text printed under AA on what they are printed on. */
async function illegible(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const text of await page.evaluate(printedText)) {
    let ground: Rgb = [255, 255, 255];
    for (const background of text.backgrounds) {
      const color = parseColor(background);
      if (color && color.alpha > 0) ground = over(color.rgb, color.alpha, ground);
    }
    const ink = parseColor(text.color);
    if (!ink || ink.alpha === 0) continue;
    const shown = over(ink.rgb, ink.alpha, ground);
    const ratio = contrast(shown, ground);
    const least = requiredRatio(text.fontSize, text.fontWeight);
    if (ratio < least) out.push(`${text.describe}: ${text.color} on ${ground.map(Math.round).join(',')}, ${ratio.toFixed(2)} to 1, needs ${least}`);
  }
  return out;
}

const WHITE = 'rgb(255, 255, 255)';

test.describe('print, 1440 px', () => {
  test.use(device(DESKTOP));

  for (const route of ROUTES.filter((r) => isProject(r.path))) {
    test(`${routeTitle(route)}: one US Letter landscape sheet with the title block, the title and the address`, async ({ page }) => {
      expect(await open(page, route.path), 'status').toBe(route.status);
      await visitWholePage(page);
      await page.emulateMedia({ media: 'print' });
      const view = await page.evaluate(printView);
      // Back to no emulation: page.pdf() prints with print media unless screen is emulated.
      await page.emulateMedia({ media: null });
      expect(view.title, 'the sheet has its title').toBeTruthy();
      expect(view.address, 'the sheet carries its address').toMatch(new RegExp(`/projects/${route.path.split('/').pop()}$`));
      expect(view.titleBlock.length, 'the title block prints its fields').toBeGreaterThanOrEqual(4);

      const pdf = await readPdf(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
      expect(pdf.pages, 'pages').toBe(1);
      expect(pdf.sizes[0], 'US Letter landscape, in points').toEqual(LETTER_LANDSCAPE);
      const printed = letters(pdf.text[0]);
      expect(printed, 'the title').toContain(letters(view.title ?? ''));
      expect(printed, 'the address').toContain(letters(view.address ?? ''));
      const missing = view.titleBlock.filter((field) => !printed.includes(letters(field)));
      expect(missing, 'title block fields missing from the printed sheet').toEqual([]);
    });

    test(`${routeTitle(route)}: on white, with no nav, sky, palette, button or motion, and the ramp only in the maturity scale`, async ({ page }) => {
      expect(await open(page, route.path), 'status').toBe(route.status);
      await visitWholePage(page);
      // The palette, left open as the page is printed.
      await page.keyboard.press('Control+K');
      await expect(page.getByRole('dialog', { name: UI.palette.label })).toBeVisible();
      await page.emulateMedia({ media: 'print' });
      const view = await page.evaluate(printView);
      expect(view.nav, 'nav').toEqual([]);
      expect(view.frame, 'the drawing frame, the one piece of chrome the sheet prints').toEqual([expect.stringMatching(/^div\.ar-sheetframe/)]);
      expect(view.sky, 'sky').toEqual([]);
      expect(view.palette, 'palette').toEqual([]);
      expect(view.buttons, 'buttons').toEqual([]);
      expect(view.motion, 'motion').toEqual([]);
      expect(view.paper, 'the paper: the root, the body and the page frame').toEqual([WHITE, WHITE, WHITE]);
      expect(view.ramp.filter((el) => !el.startsWith('span.ar-ms__heat')), 'the ramp outside the maturity scale').toEqual([]);
      expect(await illegible(page), 'text printed under AA').toEqual([]);
    });
  }

  for (const route of ROUTES.filter((r) => !isProject(r.path))) {
    test(`${routeTitle(route)}: prints legibly on white, with no nav and no sky`, async ({ page }) => {
      expect(await open(page, route.path), 'status').toBe(route.status);
      await visitWholePage(page);
      await page.emulateMedia({ media: 'print' });
      const view = await page.evaluate(printView);
      expect(view.nav, 'nav').toEqual([]);
      expect(view.sky, 'sky').toEqual([]);
      expect(view.paper, 'the paper: the root, the body and the page frame').toEqual([WHITE, WHITE, WHITE]);
      expect(view.ramp.filter((el) => !el.startsWith('span.ar-ms__heat')), 'the ramp outside the maturity scale').toEqual([]);
      expect(await illegible(page), 'text printed under AA').toEqual([]);
      expect(view.frame, 'no drawing frame off the project sheet').toEqual([]);
      await page.emulateMedia({ media: null });
      const pdf = await readPdf(await page.pdf({ format: 'Letter', preferCSSPageSize: true, printBackground: true }));
      expect(pdf.pages, 'pages').toBeGreaterThanOrEqual(1);
      expect(pdf.sizes.every(([w, h]) => w === LETTER[0] && h === LETTER[1]), `every page US Letter: ${JSON.stringify(pdf.sizes)}`).toBe(true);
      expect(letters(pdf.text.join(' ')), 'the page heading on paper').toContain(letters(view.h1 ?? ''));
    });
  }
});
