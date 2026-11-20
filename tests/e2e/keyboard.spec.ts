/**
 * Keyboard paths and page structure (ARCHITECTURE.md 10: all functions by keyboard; focus trapped
 * only in the menu, the lightbox and the command palette, each with Escape; one h1 per page and
 * ordered headings):
 * - the skip link is the first Tab stop on every route and moves focus to the main content;
 * - the phone menu traps focus and closes on Escape, with focus back on its Menu button;
 * - the gallery's lightbox, on each project page with a gallery, traps focus and closes on Escape,
 *   with focus back on the item that opened it;
 * - every route has exactly one h1, and its headings never skip a level on the way down.
 */
import type { Locator, Page } from '@playwright/test';
import { UI } from '../../lib/strings';
import { expect, test } from './support/fixtures';
import { focusedElement, focusInside, open } from './support/page';
import { DESKTOP, device, GALLERY_PAGES, PHONE, projects, routeTitle, ROUTES, type Width } from './support/site';

/**
 * The name of the first gallery on a project page: the heading it sits under, as
 * components/blocks/BlockRenderer.tsx gives it (Project.dc.html names each gallery by its heading),
 * or "Gallery" with no heading before it.
 */
function galleryName(path: string): string {
  const project = projects.find((p) => `/projects/${p.slug}` === path);
  let heading = '';
  for (const block of (project?.blocks ?? []) as { type?: unknown; text?: unknown; items?: unknown }[]) {
    if (block.type === 'heading' && typeof block.text === 'string' && block.text.trim() !== '') heading = block.text;
    const shown = (item: { src?: unknown } | null) => typeof item?.src === 'string' && item.src.trim() !== '';
    if (block.type === 'gallery' && Array.isArray(block.items) && block.items.some(shown)) return heading || UI.viewers.gallery.label;
  }
  return UI.viewers.gallery.label;
}

/** Where focus is now, seen from `main`: inside it, after it, before it, or nowhere. */
function focusFromMain(page: Page): Promise<string> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const active = document.activeElement;
    if (!main || !active || active === document.body) return 'nowhere';
    if (main.contains(active)) return 'inside';
    return main.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
  });
}

/**
 * Presses Tab, then Shift+Tab, more times than `dialog` has stops, and checks after each press that
 * focus is still inside it. Returns the places where it got out.
 */
async function escapesFrom(page: Page, dialog: Locator): Promise<string[]> {
  const stops = await dialog.evaluate(
    (element) => element.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').length,
  );
  const escapes: string[] = [];
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let press = 1; press <= stops + 2; press += 1) {
      await page.keyboard.press(key);
      if (!(await focusInside(dialog))) escapes.push(`${key} ${press}: focus went to ${await focusedElement(page)}`);
    }
  }
  return escapes;
}

test.describe('skip link, 1440 px', () => {
  test.use(device(DESKTOP));

  for (const route of ROUTES) {
    test(`${routeTitle(route)}: the skip link moves focus to the main content`, async ({ page }) => {
      expect(await open(page, route.path), 'status').toBe(route.status);
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: UI.site.skipToContent, exact: true });
      await expect(skip, `the first Tab stop is the skip link (focus is on ${await focusedElement(page)})`).toBeFocused();
      await expect(skip, 'the skip link shows when it has focus').toBeInViewport();
      await page.keyboard.press('Enter');
      await expect(page.locator('main'), `Enter on the skip link focuses main (focus is on ${await focusedElement(page)})`).toBeFocused();
      await page.keyboard.press('Tab');
      expect(['inside', 'after'], `the next Tab goes on from main, to ${await focusedElement(page)}`).toContain(await focusFromMain(page));
    });
  }
});

const MENU_VISITS: { width: Width; path: string }[] = [
  { width: PHONE, path: '/' },
  { width: 768, path: '/projects' },
];

for (const visit of MENU_VISITS) {
  test.describe(`phone menu, ${visit.width} px`, () => {
    test.use(device(visit.width));

    test(`${visit.path}: the menu traps focus and closes on Escape with focus back on its button`, async ({ page }) => {
      expect(await open(page, visit.path), 'status').toBe(200);
      const button = page.getByRole('button', { name: UI.site.menu, exact: true });
      await expect(button).toBeVisible();
      await button.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: UI.site.menu });
      await expect(dialog).toBeVisible();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(() => focusInside(dialog), { message: 'focus moves into the open menu' }).toBe(true);
      expect(await escapesFrom(page, dialog), 'Tab and Shift+Tab stay inside the menu').toEqual([]);
      await page.keyboard.press('Escape');
      await expect(button, `Escape gives focus back to the Menu button (focus is on ${await focusedElement(page)})`).toBeFocused();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(dialog, 'the menu closes').toHaveCount(0);
      await expect(button).toBeFocused();
    });
  });
}

test.describe('gallery lightbox, 1440 px', () => {
  test.use(device(DESKTOP));

  test('the seed has a project page with a gallery', () => {
    expect(GALLERY_PAGES.length).toBeGreaterThan(0);
  });

  for (const route of GALLERY_PAGES) {
    test(`${routeTitle(route)}: the lightbox traps focus and closes on Escape with focus back on the item`, async ({ page }) => {
      expect(await open(page, route.path), 'status').toBe(route.status);
      const gallery = page.getByRole('region', { name: galleryName(route.path), exact: true }).first();
      await gallery.scrollIntoViewIfNeeded();
      // The first item, named by its kind as the bundle's Gallery names it ("Open photo 1 of 3").
      const item = gallery.getByRole('button', { name: /Open (photo|video|3D model)( 1 of \d+)?$/ }).first();
      await item.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: UI.viewers.gallery.label });
      await expect(dialog).toBeVisible();
      // The loading cover (useLightbox.tsx) gives way to the lightbox once its code has come.
      await expect(page.locator('[role="dialog"][aria-busy="true"]')).toHaveCount(0);
      await expect.poll(() => focusInside(dialog), { message: 'focus moves into the open lightbox' }).toBe(true);
      expect(await escapesFrom(page, dialog), 'Tab and Shift+Tab stay inside the lightbox').toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog, 'the lightbox closes').toHaveCount(0);
      await expect(item, `focus goes back to the item that opened it (focus is on ${await focusedElement(page)})`).toBeFocused();
    });
  }
});

interface Heading {
  level: number;
  text: string;
}

/** The headings assistive technology finds, in document order, with their levels. */
function headingsOf(page: Page): Promise<Heading[]> {
  return page.getByRole('heading').evaluateAll((elements) =>
    elements.map((element) => ({
      level: Number(element.getAttribute('aria-level')) || Number(element.tagName.slice(1)) || 2,
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
    })),
  );
}

const outline = (headings: Heading[]) => headings.map((h) => `h${h.level} "${h.text}"`).join(', ') || 'no headings';

for (const width of [PHONE, DESKTOP]) {
  test.describe(`headings, ${width} px`, () => {
    test.use(device(width));

    for (const route of ROUTES) {
      test(`${routeTitle(route)}: one h1`, async ({ page }) => {
        expect(await open(page, route.path), 'status').toBe(route.status);
        const headings = await headingsOf(page);
        expect(headings.filter((h) => h.level === 1).length, outline(headings)).toBe(1);
      });

      test(`${routeTitle(route)}: ordered headings`, async ({ page }) => {
        expect(await open(page, route.path), 'status').toBe(route.status);
        const headings = await headingsOf(page);
        const problems: string[] = [];
        if (headings[0] && headings[0].level !== 1) problems.push(`the first heading is h${headings[0].level} "${headings[0].text}", not the h1`);
        headings.forEach((heading, index) => {
          const before = headings[index - 1];
          if (before && heading.level > before.level + 1) {
            problems.push(`h${heading.level} "${heading.text}" follows h${before.level} "${before.text}"`);
          }
        });
        expect(problems, outline(headings)).toEqual([]);
      });
    }
  });
}
