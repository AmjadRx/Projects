/**
 * The theme persists without a flash (ARCHITECTURE.md 15, item 3). For a visitor whose theme cookie
 * names a theme, <html data-theme> already holds that theme when the parser starts the body, before
 * anything in it exists, stays so in every frame painted while the page loads, and never changes
 * after; and the same on a reload. With the app's script files blocked, the theme is still right:
 * the inline head script sets it, not the app's scripts. Choosing a theme with the toggle keeps it
 * for the next visit, again from the first paint.
 */
import type { Page } from '@playwright/test';
import { UI } from '../../lib/strings';
import { expect, test } from './support/fixtures';
import { open, settle } from './support/page';
import { DESKTOP, device, PHONE, routeTitle, ROUTES, THEME_COOKIE, THEMES, type Theme } from './support/site';
import { flashes, recordTheme, themeLog } from './support/theme';

/** The app's script files (Next's chunks); the inline head script is part of the HTML. */
const APP_SCRIPTS = /\/_next\/static\/.+\.js(\?.*)?$/;

for (const theme of THEMES) {
  test.describe(`theme without a flash, ${theme} cookie`, () => {
    test.use({ theme, ...device(DESKTOP) });

    for (const route of ROUTES) {
      test(`${routeTitle(route)}: from the first paint, and again on reload`, async ({ page }) => {
        await page.addInitScript(recordTheme);
        const response = await page.goto(route.path, { waitUntil: 'load' });
        expect(response?.status(), 'status').toBe(route.status);
        expect(flashes(await themeLog(page), theme), 'first visit').toEqual([]);
        await page.reload({ waitUntil: 'load' });
        expect(flashes(await themeLog(page), theme), 'reload').toEqual([]);
        // Hydration and everything after it leave the theme as it is: no change at all, not even
        // one that is undone (the recorder keeps every change after the body began).
        await settle(page);
        expect(flashes(await themeLog(page), theme), 'after hydration').toEqual([]);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      });

      test(`${routeTitle(route)}: set by the head script, with the app's scripts blocked`, async ({ page }) => {
        await page.route(APP_SCRIPTS, (route) => route.abort());
        await page.addInitScript(recordTheme);
        await page.goto(route.path, { waitUntil: 'load' });
        expect(flashes(await themeLog(page), theme)).toEqual([]);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      });
    }
  });
}

/** Waits until the page shows `theme` and the toggle's cross-fade (components/site/themeFade.ts) has ended. */
async function shows(page: Page, theme: Theme): Promise<void> {
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', theme);
  await expect(html).not.toHaveAttribute('data-theme-fade');
}

/**
 * The next visit after a choice, recorded from the start: `theme` from the first paint, and still
 * no change once hydration and everything after it are done.
 */
async function keeps(page: Page, theme: Theme, visit: () => Promise<unknown>): Promise<void> {
  await page.addInitScript(recordTheme);
  await visit();
  expect(flashes(await themeLog(page), theme), 'the next visit, while it loads').toEqual([]);
  await settle(page);
  expect(flashes(await themeLog(page), theme), 'the next visit, after hydration').toEqual([]);
}

test.describe('theme toggle, 1440 px', () => {
  test.use(device(DESKTOP));

  test('choosing Whiteprint in the nav keeps it for the next visit, from the first paint', async ({ page, context }) => {
    expect(await open(page, '/')).toBe(200);
    await page.getByRole('button', { name: UI.site.whiteprintTheme, exact: true }).click();
    await shows(page, 'whiteprint');
    expect((await context.cookies()).find((cookie) => cookie.name === THEME_COOKIE)?.value).toBe('whiteprint');
    await keeps(page, 'whiteprint', () => page.goto('/projects', { waitUntil: 'load' }));
  });

  test.describe('from Whiteprint', () => {
    test.use({ theme: 'whiteprint' });

    test('choosing Blueprint in the nav keeps it for the next visit, from the first paint', async ({ page, context }) => {
      expect(await open(page, '/')).toBe(200);
      await page.getByRole('button', { name: UI.site.blueprintTheme, exact: true }).click();
      await shows(page, 'blueprint');
      expect((await context.cookies()).find((cookie) => cookie.name === THEME_COOKIE)?.value).toBe('blueprint');
      await keeps(page, 'blueprint', () => page.reload({ waitUntil: 'load' }));
    });
  });
});

test.describe('theme toggle, 390 px', () => {
  test.use(device(PHONE));

  test('choosing Whiteprint in the menu keeps it for the next visit, from the first paint', async ({ page, context }) => {
    expect(await open(page, '/')).toBe(200);
    await page.getByRole('button', { name: UI.site.menu, exact: true }).click();
    const menu = page.getByRole('dialog', { name: UI.site.menu });
    await menu.getByRole('button', { name: UI.site.whiteprint, exact: true }).click();
    await shows(page, 'whiteprint');
    expect((await context.cookies()).find((cookie) => cookie.name === THEME_COOKIE)?.value).toBe('whiteprint');
    await keeps(page, 'whiteprint', () => page.reload({ waitUntil: 'load' }));
  });
});
