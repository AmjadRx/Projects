/**
 * No horizontal scroll at 390, 768, 1024 and 1440 px on every route in both themes (ARCHITECTURE.md
 * 15, item 4). The page is scrolled through once first, so everything that arrives as it comes into
 * view is in place; then the three signs of ./support/layout.ts are checked: the document no wider
 * than the window, the window not moving sideways, and no text or control cut off at the edge.
 */
import { expect, test } from './support/fixtures';
import { overflow } from './support/layout';
import { open, visitWholePage } from './support/page';
import { device, routeTitle, ROUTES, THEMES, WIDTHS } from './support/site';

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test.describe(`no horizontal scroll, ${theme}, ${width} px`, () => {
      test.use({ theme, ...device(width) });

      for (const route of ROUTES) {
        test(routeTitle(route), async ({ page }) => {
          expect(await open(page, route.path), 'status').toBe(route.status);
          await visitWholePage(page);
          const found = await overflow(page);
          expect.soft(found.scrollWidth, `the document is ${found.scrollWidth} px wide in a ${found.clientWidth} px window`).toBeLessThanOrEqual(found.clientWidth);
          expect.soft(found.scrolledBy, `the window moved ${found.scrolledBy} px sideways`).toBe(0);
          expect.soft(found.cut, 'text or controls cut off at the window edge by the page frame').toEqual([]);
        });
      }
    });
  }
}
