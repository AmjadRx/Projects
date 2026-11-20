/**
 * The not-found page (ARCHITECTURE.md 5): an address that is no page, and a project that does not
 * exist (only visible projects get a page), answer 404 with "Sheet not found" and links home and
 * to the projects.
 */
import { expect, test } from './support/fixtures';
import { open } from './support/page';
import { DESKTOP, device, NOT_FOUND_PATH, NOT_FOUND_PROJECT_PATH } from './support/site';

test.describe('not found', () => {
  test.use(device(DESKTOP));

  for (const path of [NOT_FOUND_PATH, NOT_FOUND_PROJECT_PATH]) {
    test(`${path} answers 404 with "Sheet not found" and links home and to the projects`, async ({ page }) => {
      expect(await open(page, path), 'status').toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sheet not found');
      const hrefs = await page.locator('main a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      expect(hrefs, 'a link home').toContain('/');
      expect(hrefs, 'a link to the projects').toContain('/projects');
    });
  }
});
