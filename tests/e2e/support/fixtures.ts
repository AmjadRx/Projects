/**
 * The suite's `test`: Playwright's, with two more options, set with test.use:
 *
 *   test.use({ theme: 'whiteprint', ...device(390) });
 *
 * - `theme`, the visitor's theme: when it is set, the theme cookie (lib/theme.ts) is in the
 *   browser before the first visit, as it is for a visitor who chose that theme before.
 * - `analyticsStandIn` (on unless a test turns it off): an empty stand-in for Vercel's analytics
 *   script (standInForAnalytics).
 *
 * And one check on every test: no picture the image optimizer made for it (imagesWarmed).
 */
import { test as base, expect, type Browser, type BrowserContext } from '@playwright/test';
import { device, THEME_COOKIE, type Theme, type Width } from './site';

/** Vercel's analytics scripts, which @vercel/analytics loads (components/site/SiteAnalytics.tsx). */
export const VERCEL_ANALYTICS = /\/_vercel\/(insights|speed-insights)\//;

/**
 * Vercel's analytics scripts are served only by Vercel, under /_vercel/; `next start` answers 404
 * for them, which the browser reports as a console error on every page. The suite serves an empty
 * script in their place: the page then behaves as on Vercel, and no test visit is counted in the
 * owner's analytics. A browser context with routing on never asks for /favicon.ico, though, so the
 * console tests (console.spec.ts) turn the stand-in off and leave the browser as it is.
 */
export async function standInForAnalytics(context: BrowserContext): Promise<void> {
  await context.route(VERCEL_ANALYTICS, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
}

/** The suite started its own server (`next start`), whose image optimizer ../global-setup.ts warms. */
const ownServer = !process.env.E2E_BASE_URL?.trim();

/**
 * The image optimizer's answers made for the test running now: /_next/image addresses a page asked
 * for that the suite's own server had not made before (X-Nextjs-Cache: MISS), so the warm-up
 * (../global-setup.ts) missed them. Such an address can hang: a test that drops the first request
 * for it, by closing its page while the picture loads, leaves every later request for it waiting
 * until the server restarts (../global-setup.ts says why). Each test fails when one of its pages
 * got such an answer, and names it, so a page that sends a new source or width through the
 * optimizer is caught the first time, not by a test that hangs now and then. Against a deployment
 * (E2E_BASE_URL) Vercel's image service answers, and nothing is checked.
 */
const madeForTheTest: string[] = [];

/** Notes each answer of the image optimizer that was made for the test (madeForTheTest). */
function watchImageOptimizer(context: BrowserContext): void {
  if (!ownServer) return;
  context.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname === '/_next/image' && response.headers()['x-nextjs-cache'] === 'MISS') {
      madeForTheTest.push(`${url.pathname}${url.search}`);
    }
  });
}

/** The image optimizer's answers made for the test so far (the harness shows the check a fault). */
export function imagesMadeForTheTest(): string[] {
  return [...madeForTheTest];
}

/** Forgets them (the harness test, once it has read the fault it made). */
export function forgetImagesMadeForTheTest(): void {
  madeForTheTest.length = 0;
}

export const test = base.extend<{ theme: Theme | null; analyticsStandIn: boolean; imagesWarmed: void }>({
  theme: [null, { option: true }],
  analyticsStandIn: [true, { option: true }],
  // Every test, whether its pages come from `page`, `context` or newVisitor (madeForTheTest).
  imagesWarmed: [
    async ({}, provide) => {
      madeForTheTest.length = 0;
      await provide();
      expect(madeForTheTest, 'pictures the image optimizer made for this test, which tests/e2e/global-setup.ts did not warm').toEqual([]);
    },
    { auto: true },
  ],
  // The fixture's second argument is named `provide`, not `use`, so the React hooks lint rule
  // never mistakes it for React's use().
  context: async ({ context, theme, analyticsStandIn, baseURL }, provide) => {
    watchImageOptimizer(context);
    if (analyticsStandIn) await standInForAnalytics(context);
    if (theme && baseURL) await context.addCookies([{ name: THEME_COOKIE, value: theme, url: baseURL }]);
    await provide(context);
  },
});

export { expect };

/**
 * A second visitor for the tests that compare two (motion on and reduced motion): a context of its
 * own at a width, with the theme cookie when a theme is given. Close it when done.
 */
export async function newVisitor(
  browser: Browser,
  baseURL: string,
  width: Width,
  options: { theme?: Theme; reducedMotion?: 'reduce' | 'no-preference' } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    ...device(width),
    reducedMotion: options.reducedMotion ?? 'no-preference',
  });
  watchImageOptimizer(context);
  await standInForAnalytics(context);
  if (options.theme) await context.addCookies([{ name: THEME_COOKIE, value: options.theme, url: baseURL }]);
  return context;
}
