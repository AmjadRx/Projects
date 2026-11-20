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
 * And one check on every test: its pages ask the image optimizer only for pictures the warm-up made
 * (imagesWarmed).
 */
import { test as base, expect, type Browser, type BrowserContext } from '@playwright/test';
import { notWarmed, OPTIMIZER, readWarmed, requestAccept } from './images';
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

/** A request for a picture the warm-up did not make, and why it counts as one. */
export interface NotWarmed {
  address: string;
  why: string;
}

/**
 * The image optimizer's pictures that the test running now asked for and the warm-up
 * (../global-setup.ts) did not make. Such a picture can hang: when the first request for it is
 * dropped before the server has read its source (a test closes its page while it loads), every
 * later request for it waits until the server restarts, and none of those requests ever gets an
 * answer (../global-setup.ts says why). So each request a page sends to the suite's own optimizer
 * is judged when it is sent, answered or not, against the warm-up's list (./images.ts: the source,
 * the width, the quality, and the format its Accept header chooses). The test fails and names it:
 * the one that first asks, even when it drops that request, and every later one that waits on it.
 * A second net: an answer the server made for the test (X-Nextjs-Cache: MISS), a picture the list
 * counts as warmed that the server had not kept, is named too.
 *
 * The Accept header: in a context with no routing (the console tests) Playwright does not show it
 * when the request is sent, and the check takes the one Chrome sends for that kind of request
 * (./images.ts requestAccept: a picture's, or fetch()'s); for any other kind the format is left to
 * the second net.
 *
 * Not seen: requests a test sends from Node rather than from a page (none of the suite's goes to
 * the optimizer), and pictures the browser takes from its own cache (they reach no server).
 * Against a deployment (E2E_BASE_URL) Vercel's image service answers, and nothing is checked.
 */
const notWarmedForTheTest: NotWarmed[] = [];

/** Notes each request of the context's pages for a picture the warm-up did not make (notWarmedForTheTest). */
function watchImageOptimizer(context: BrowserContext, baseURL: string | undefined): void {
  if (!ownServer) return;
  const warmed = readWarmed();
  const origin = baseURL ? new URL(baseURL).origin : null;
  /** The address when it is the suite's own optimizer, as a URL; otherwise null. */
  const optimizer = (address: string): URL | null => {
    // Most requests are not; they are left before any parsing.
    if (!address.includes(OPTIMIZER)) return null;
    const url = URL.canParse(address) ? new URL(address) : null;
    return url && url.pathname === OPTIMIZER && (origin === null || url.origin === origin) ? url : null;
  };
  context.on('request', (request) => {
    const url = optimizer(request.url());
    if (!url) return;
    const why = warmed
      ? notWarmed(url, requestAccept(request.headers(), request.resourceType()), warmed)
      : 'no list of warmed pictures reached this worker (tests/e2e/global-setup.ts did not run or did not finish)';
    if (why) notWarmedForTheTest.push({ address: `${url.pathname}${url.search}`, why });
  });
  context.on('response', (response) => {
    const url = optimizer(response.url());
    if (url && response.headers()['x-nextjs-cache'] === 'MISS') {
      notWarmedForTheTest.push({ address: `${url.pathname}${url.search}`, why: 'the server made it for this test (X-Nextjs-Cache: MISS)' });
    }
  });
}

/** The requests for pictures the warm-up did not make, so far in this test (the harness shows the check faults). */
export function imagesNotWarmed(): NotWarmed[] {
  return notWarmedForTheTest.map((entry) => ({ ...entry }));
}

/** Forgets them (the harness tests, once they have read the faults they made). */
export function forgetImagesNotWarmed(): void {
  notWarmedForTheTest.length = 0;
}

export const test = base.extend<{ theme: Theme | null; analyticsStandIn: boolean; imagesWarmed: void }>({
  theme: [null, { option: true }],
  analyticsStandIn: [true, { option: true }],
  // Every test, whether its pages come from `page`, `context` or newVisitor (notWarmedForTheTest).
  imagesWarmed: [
    async ({}, provide) => {
      notWarmedForTheTest.length = 0;
      await provide();
      const named = [...new Set(notWarmedForTheTest.map(({ address, why }) => `${address}: ${why}`))];
      expect(
        named,
        'pictures this test asked the image optimizer for that tests/e2e/global-setup.ts did not warm (each can leave every later request for it hanging; see that file)',
      ).toEqual([]);
    },
    { auto: true },
  ],
  // The fixture's second argument is named `provide`, not `use`, so the React hooks lint rule
  // never mistakes it for React's use().
  context: async ({ context, theme, analyticsStandIn, baseURL }, provide) => {
    watchImageOptimizer(context, baseURL);
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
  watchImageOptimizer(context, baseURL);
  await standInForAnalytics(context);
  if (options.theme) await context.addCookies([{ name: THEME_COOKIE, value: options.theme, url: baseURL }]);
  return context;
}
