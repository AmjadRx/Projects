/**
 * The GPA (ARCHITECTURE.md 15, item 2): on every route, any text with "GPA" in it reads exactly
 * "Major GPA 3.65", label and value together, in the text a visitor sees and in the metadata (the
 * title, every meta tag, and the JSON-LD); the value never appears without its label, and the word
 * "cumulative" never sits beside it (./support/gpa.ts).
 */
import { expect, test } from './support/fixtures';
import { GPA, gpaProblems, gpaSources } from './support/gpa';
import { open } from './support/page';
import { DESKTOP, device, routeTitle, ROUTES } from './support/site';

test.describe('GPA', () => {
  test.use(device(DESKTOP));

  for (const route of ROUTES) {
    test(`${routeTitle(route)}: every GPA reads "${GPA}", in the text and the metadata`, async ({ page }) => {
      expect(await open(page, route.path), 'status').toBe(route.status);
      expect((await gpaSources(page)).flatMap(gpaProblems)).toEqual([]);
    });
  }
});
