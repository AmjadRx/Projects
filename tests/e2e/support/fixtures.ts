/**
 * The suite's `test`: Playwright's, with two more options, set with test.use:
 *
 *   test.use({ theme: 'whiteprint', ...device(390) });
 *
 * - `theme`, the visitor's theme: when it is set, the theme cookie (lib/theme.ts) is in the
 *   browser before the first visit, as it is for a visitor who chose that theme before.
 * - `analyticsStandIn` (on unless a test turns it off): an empty stand-in for Vercel's analytics
 *   script (standInForAnalytics).
 */
import { test as base, expect, type Browser, type BrowserContext } from '@playwright/test';
import { device, THEME_COOKIE, type Theme, type Width } from './site';

/** Vercel's analytics scripts, which @vercel/analytics loads (components/site/SiteAnalytics.tsx). */
export const VERCEL_ANALYTICS = /\/_vercel\/(insights|speed-insights)\//;

/**
 * Vercel's analytics scripts are served only by Vercel, under /_vercel/; `next start` answers 404
 * for them, which the browser reports as a console error on every page. The suite serves an empty
 * script in their place: the page then behaves as on Vercel, and no test visit is counted in the
 * owner's analytics. A routed browser no longer asks for /favicon.ico by itself, though, so the
 * console tests (console.spec.ts) turn the stand-in off and leave the browser as it is.
 */
export async function standInForAnalytics(context: BrowserContext): Promise<void> {
  await context.route(VERCEL_ANALYTICS, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
}

export const test = base.extend<{ theme: Theme | null; analyticsStandIn: boolean }>({
  theme: [null, { option: true }],
  analyticsStandIn: [true, { option: true }],
  // The fixture's second argument is named `provide`, not `use`, so the React hooks lint rule
  // never mistakes it for React's use().
  context: async ({ context, theme, analyticsStandIn, baseURL }, provide) => {
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
  await standInForAnalytics(context);
  if (options.theme) await context.addCookies([{ name: THEME_COOKIE, value: options.theme, url: baseURL }]);
  return context;
}
