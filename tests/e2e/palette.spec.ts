/**
 * The command palette on the built site (ARCHITECTURE.md 5, "Also new": "Ctrl or Cmd with K, and a
 * nav button ... Keyboard first, focus trapped, closes on Escape"; 10: focus trapped only in the
 * menu, the lightbox and the palette, each with Escape). tests/palette-*.test.ts prove the filter,
 * the keys, the state and the focus rules on their own, in jsdom; this file proves them on the
 * real page in Chrome, where the key presses, the focus, the router, the loading on demand, the
 * layout at each width and the other layers are real:
 * - Ctrl+K opens it with focus in its field, and so does Cmd+K (Meta+K; the button names both,
 *   for every system), each pressed again closing it;
 * - the nav's search button opens it at 390 and 1440 px;
 * - typing filters the results: a project, a page, a section, and nothing;
 * - Down, Up and Enter open a result, and focus lands where it leads: the section's heading, or the
 *   page's main;
 * - Tab and Shift+Tab stay inside while it is open; Escape closes it and gives focus back to what
 *   opened it;
 * - it does not open over the phone menu or the gallery's lightbox;
 * - axe finds no violation with it open, in both themes, at 390 and 1440 px.
 * The results expected come from /palette.json, the index the palette itself reads.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import type { PaletteIndex } from '../../lib/palette';
import { UI } from '../../lib/strings';
import { describeViolations, runAxe } from './support/axe';
import { expect, test } from './support/fixtures';
import { FIRST_ITEM, galleryName } from './support/gallery';
import { focusedElement, focusInside, open } from './support/page';
import { DESKTOP, device, GALLERY_PAGES, PHONE, routeTitle, THEMES } from './support/site';

const dialog = (page: Page) => page.getByRole('dialog', { name: UI.palette.label });
const field = (page: Page) => dialog(page).getByRole('combobox', { name: UI.palette.label });
const searchButton = (page: Page) => page.getByRole('button', { name: UI.palette.open, exact: true });
const options = (page: Page) => dialog(page).getByRole('option');

/** The palette's own index, as the site serves it. */
async function paletteIndex(request: APIRequestContext): Promise<PaletteIndex> {
  const response = await request.get('/palette.json');
  expect(response.status(), '/palette.json').toBe(200);
  return (await response.json()) as PaletteIndex;
}

/** Every result whose label holds `word`, in the index's order (a one-word query). */
function matching(index: PaletteIndex, word: string) {
  return index.groups.flatMap((group) => group.items.filter((item) => item.label.toLowerCase().includes(word.toLowerCase())));
}

/** Waits until the palette is open, with focus in its field. */
async function isOpen(page: Page): Promise<void> {
  await expect(dialog(page)).toBeVisible();
  await expect(field(page), `focus in the field (focus is on ${await focusedElement(page)})`).toBeFocused();
}

async function isClosed(page: Page): Promise<void> {
  await expect(page.locator('.ar-cmdk')).toHaveCount(0);
}

/** The names of the results shown now, in order. */
async function shown(page: Page): Promise<string[]> {
  return (await options(page).evaluateAll((items) => items.map((item) => item.querySelector('.ar-cmdk__label')?.textContent ?? ''))).map((label) =>
    label.replace(/\s+/g, ' ').trim(),
  );
}

/**
 * The result the palette has active, once the field names it (aria-activedescendant) and it is the
 * one result marked aria-selected; '' until then.
 */
async function activeNow(page: Page): Promise<string> {
  return field(page).evaluate((input) => {
    const id = input.getAttribute('aria-activedescendant');
    const option = id ? document.getElementById(id) : null;
    const selected = Array.from(document.querySelectorAll('.ar-cmdk [role="option"][aria-selected="true"]'));
    if (!option || selected.length !== 1 || selected[0] !== option) return '';
    return (option.querySelector('.ar-cmdk__label')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

/** Waits until the active result is `label`. */
async function expectActive(page: Page, label: string, message?: string): Promise<void> {
  await expect.poll(() => activeNow(page), { message: message ?? `the active result is "${label}"` }).toBe(label);
}

/** Presses Tab and Shift+Tab more times than the dialog has stops; returns where focus got out. */
async function escapes(page: Page, layer: Locator): Promise<string[]> {
  const out: string[] = [];
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let press = 1; press <= 4; press += 1) {
      await page.keyboard.press(key);
      if (!(await focusInside(layer))) out.push(`${key} ${press}: focus went to ${await focusedElement(page)}`);
    }
  }
  return out;
}

test.describe('command palette, 1440 px', () => {
  test.use(device(DESKTOP));

  test('Ctrl+K opens it with focus in its field; Escape closes it and gives focus back to what had it', async ({ page }) => {
    expect(await open(page, '/'), 'status').toBe(200);
    const link = page.locator('.ar-nav').getByRole('link', { name: 'Projects', exact: true });
    await link.focus();
    await page.keyboard.press('Control+K');
    await isOpen(page);
    await expect(searchButton(page)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await isClosed(page);
    await expect(link, `focus back on the link (focus is on ${await focusedElement(page)})`).toBeFocused();
    await expect(searchButton(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('Cmd+K (Meta+K) opens it too, and the shortcut pressed again closes it', async ({ page }) => {
    expect(await open(page, '/about'), 'status').toBe(200);
    const link = page.locator('.ar-nav').getByRole('link', { name: 'Contact', exact: true });
    await link.focus();
    await page.keyboard.press('Meta+K');
    await isOpen(page);
    await page.keyboard.press('Meta+K');
    await isClosed(page);
    await expect(link).toBeFocused();
    await page.keyboard.press('Control+K');
    await isOpen(page);
    await page.keyboard.press('Control+K');
    await isClosed(page);
    await expect(link).toBeFocused();
  });

  test('the nav button opens it; Escape gives focus back to the button', async ({ page }) => {
    expect(await open(page, '/projects'), 'status').toBe(200);
    await searchButton(page).click();
    await isOpen(page);
    // On a desktop the field is the only stop; there is no Close button.
    await expect(dialog(page).getByRole('button', { name: UI.palette.close })).toBeHidden();
    await page.keyboard.press('Escape');
    await isClosed(page);
    await expect(searchButton(page)).toBeFocused();
  });

  test('typing filters the results: a project, a page, a section, and nothing', async ({ page, request }) => {
    const index = await paletteIndex(request);
    expect(await open(page, '/'), 'status').toBe(200);
    await searchButton(page).click();
    await isOpen(page);
    // Before anything is typed: everything, in the index's order.
    await expect.poll(() => shown(page)).toEqual(index.groups.flatMap((group) => group.items.map((item) => item.label)));

    const project = index.groups.find((group) => group.label === UI.palette.groups.projects)?.items.find((item) => item.label === 'Raven');
    const page_ = index.groups.find((group) => group.label === UI.palette.groups.pages)?.items.find((item) => item.label === 'Build log');
    const section = index.groups.find((group) => group.label === UI.palette.groups.sections)?.items.find((item) => item.label.endsWith(': Roadmap'));
    expect([project?.href, page_?.href, section?.href], 'the seed has Raven, the build log, and a Roadmap section').toEqual([
      expect.stringMatching(/^\/projects\/raven$/),
      '/log',
      expect.stringMatching(/^\/projects\/raven#/),
    ]);

    for (const query of ['Raven', 'log', 'roadmap']) {
      await field(page).fill(query);
      await expect.poll(() => shown(page), { message: query }).toEqual(matching(index, query).map((item) => item.label));
      await expectActive(page, matching(index, query)[0].label, `${query}: the first result is active`);
      // The typed text is marked in each result.
      await expect(dialog(page).locator('.ar-cmdk__hit').first()).toHaveText(new RegExp(`^${query}$`, 'i'));
    }
    // The groups each result sits in: the project under Projects, the page under Pages, the section under Sections.
    await field(page).fill('roadmap');
    await expect(dialog(page).getByRole('group', { name: UI.palette.groups.sections })).toBeVisible();
    await field(page).fill('Build log');
    await expect(dialog(page).getByRole('group', { name: UI.palette.groups.pages })).toBeVisible();

    await field(page).fill('zqxjv');
    await expect(options(page)).toHaveCount(0);
    await expect(dialog(page).getByRole('listbox')).toBeHidden();
    // The message the dialog shows. Its status line reads the same words out a moment later, once
    // typing pauses, which tests/palette-dom.test.ts proves.
    const empty = dialog(page).locator('.ar-cmdk__empty');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText(UI.palette.noMatch('zqxjv', index.pages));
    await expect(field(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(field(page)).not.toHaveAttribute('aria-activedescendant', /./);
  });

  test("Down, Up and Enter open a section, and focus lands on the section's heading", async ({ page, request }) => {
    const index = await paletteIndex(request);
    const results = matching(index, 'rav');
    const target = results.findIndex((item) => item.label.endsWith(': Roadmap'));
    expect(target, 'a Roadmap section among the results for "rav"').toBeGreaterThan(1);
    expect(await open(page, '/about'), 'status').toBe(200);
    await page.keyboard.press('Control+K');
    await isOpen(page);
    await field(page).fill('rav');
    await expectActive(page, results[0].label);
    // Down to the section, one past it, and Up back: the active result follows, focus stays in the field.
    for (let n = 0; n < target + 1; n += 1) await page.keyboard.press('ArrowDown');
    await expectActive(page, results[(target + 1) % results.length].label);
    await page.keyboard.press('ArrowUp');
    await expectActive(page, results[target].label);
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Enter');
    const href = results[target].href;
    const [path, id] = href.split('#');
    await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}#${id}$`));
    await isClosed(page);
    const heading = page.locator(`[id="${decodeURIComponent(id)}"]`);
    await expect(heading, `focus on the section's heading (focus is on ${await focusedElement(page)})`).toBeFocused();
    await expect(heading).toBeInViewport();
  });

  test("Enter on a page opens it, and focus lands on that page's main", async ({ page, request }) => {
    const contact = matching(await paletteIndex(request), 'contact')[0];
    expect(contact.href).toBe('/contact');
    expect(await open(page, '/'), 'status').toBe(200);
    await searchButton(page).click();
    await isOpen(page);
    await field(page).fill('contact');
    await expectActive(page, contact.label);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/contact$/);
    await isClosed(page);
    await expect(page.locator('main'), `focus on main (focus is on ${await focusedElement(page)})`).toBeFocused();
  });

  test('Tab and Shift+Tab stay inside while it is open, whatever is typed', async ({ page }) => {
    expect(await open(page, '/experience'), 'status').toBe(200);
    await page.keyboard.press('Control+K');
    await isOpen(page);
    expect(await escapes(page, dialog(page)), 'Tab and Shift+Tab with every result listed').toEqual([]);
    await field(page).fill('zqxjv');
    expect(await escapes(page, dialog(page)), 'Tab and Shift+Tab with nothing listed').toEqual([]);
    await expect(field(page)).toBeFocused();
  });

  test('the seed has a project page with a gallery', () => {
    expect(GALLERY_PAGES.length).toBeGreaterThan(0);
  });

  test('it does not open over the gallery lightbox', async ({ page }) => {
    const route = GALLERY_PAGES[0];
    expect(await open(page, route.path), `${routeTitle(route)} status`).toBe(200);
    // The gallery is named by its heading ("Build photos" on Raven), its first item by its kind
    // ("Open photo 1 of 3"), as tests/e2e/keyboard.spec.ts finds them.
    const gallery = page.getByRole('region', { name: galleryName(route.path), exact: true }).first();
    await gallery.scrollIntoViewIfNeeded();
    const item = gallery.getByRole('button', { name: FIRST_ITEM }).first();
    await item.focus();
    await page.keyboard.press('Enter');
    const lightbox = page.getByRole('dialog', { name: UI.viewers.gallery.label });
    await expect(lightbox).toBeVisible();
    await expect(page.locator('[role="dialog"][aria-busy="true"]')).toHaveCount(0);
    await expect.poll(() => focusInside(lightbox)).toBe(true);
    for (const shortcut of ['Control+K', 'Meta+K']) {
      await page.keyboard.press(shortcut);
      // Give a palette that would load on demand the time to arrive.
      await page.waitForLoadState('networkidle');
      await isClosed(page);
      await expect(lightbox, `the lightbox stays open after ${shortcut}`).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    await isClosed(page);
  });
});

test.describe('command palette, 390 px', () => {
  test.use(device(PHONE));

  test('the nav button opens it over the whole screen, with Close; Tab stays between the field and Close', async ({ page }) => {
    expect(await open(page, '/'), 'status').toBe(200);
    await expect(searchButton(page)).toBeVisible();
    await searchButton(page).click();
    await isOpen(page);
    const close = dialog(page).getByRole('button', { name: UI.palette.close, exact: true });
    await expect(close).toBeVisible();
    const box = await dialog(page).boundingBox();
    expect(box && Math.round(box.width), 'the panel is as wide as the screen').toBe(390);
    expect(await escapes(page, dialog(page))).toEqual([]);
    await page.keyboard.press('Escape');
    await isClosed(page);
    await expect(searchButton(page)).toBeFocused();
    // Close does the same.
    await searchButton(page).click();
    await isOpen(page);
    await close.click();
    await isClosed(page);
    await expect(searchButton(page)).toBeFocused();
  });

  test('it does not open over the phone menu', async ({ page }) => {
    expect(await open(page, '/projects'), 'status').toBe(200);
    const menuButton = page.getByRole('button', { name: UI.site.menu, exact: true });
    await menuButton.click();
    const menu = page.getByRole('dialog', { name: UI.site.menu });
    await expect(menu).toBeVisible();
    await expect.poll(() => focusInside(menu)).toBe(true);
    for (const shortcut of ['Control+K', 'Meta+K']) {
      await page.keyboard.press(shortcut);
      await page.waitForLoadState('networkidle');
      await isClosed(page);
      await expect(menu, `the menu stays open after ${shortcut}`).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(menuButton).toBeFocused();
  });
});

for (const theme of THEMES) {
  for (const width of [PHONE, DESKTOP]) {
    test.describe(`axe with the palette open, ${theme}, ${width} px`, () => {
      test.use({ theme, ...device(width) });

      test('every result listed, one active after the arrows, and nothing found', async ({ page }) => {
        expect(await open(page, '/'), 'status').toBe(200);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await searchButton(page).click();
        await isOpen(page);
        const states: [string, () => Promise<void>][] = [
          ['every result', async () => {}],
          [
            'one active after the arrows',
            async () => {
              await field(page).fill('rav');
              await page.keyboard.press('ArrowDown');
            },
          ],
          ['nothing found', async () => field(page).fill('zqxjv')],
        ];
        for (const [name, reach] of states) {
          await reach();
          const report = await runAxe(page);
          expect(report.violations, `${name}: ${describeViolations(report.violations)}`).toEqual([]);
        }
      });
    });
  }
}
