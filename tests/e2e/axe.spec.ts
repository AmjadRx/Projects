/**
 * axe on every public route in both themes, at the phone's and the desktop's width (ARCHITECTURE.md
 * 10 and 15, item 13: "axe reports no violations on any route in either theme"). Each page is
 * checked as a visitor sees it once it has come to rest: after the load sequence, with every part
 * of the page scrolled into view once, so the panels that rise into view and the gallery's strip
 * are there too.
 */
import { describeViolations, runAxe, WCAG_TAGS } from './support/axe';
import { expect, test } from './support/fixtures';
import { open, visitWholePage } from './support/page';
import { DESKTOP, device, PHONE, routeTitle, ROUTES, THEMES } from './support/site';

for (const theme of THEMES) {
  for (const width of [PHONE, DESKTOP]) {
    test.describe(`axe, ${theme}, ${width} px`, () => {
      test.use({ theme, ...device(width) });

      for (const route of ROUTES) {
        test(routeTitle(route), async ({ page }) => {
          expect(await open(page, route.path), 'status').toBe(route.status);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await visitWholePage(page);
          const report = await runAxe(page);
          expect(report.tags, `axe ${report.version} tags`).toEqual(expect.arrayContaining(WCAG_TAGS));
          expect(report.violations, describeViolations(report.violations)).toEqual([]);
        });
      }
    });
  }
}
