/**
 * No errors in the console on any route (Lighthouse Best Practices 100 allows none, a missing
 * /favicon.ico included; and a hydration mismatch shows here as an error), at the phone's width
 * under reduced motion and at the desktop's width with motion on, with every part of the page
 * brought into view once and the network quiet after it, so late requests have answered.
 *
 * The browser is left as it is here, with no request routing (a routed browser no longer asks for
 * /favicon.ico by itself), so the analytics stand-in of ./support/fixtures.ts is off. Two things are
 * not counted: the not-found page's own 404 answer, which is its purpose, and, on the suite's own
 * `next start`, the errors from Vercel's analytics script, which only Vercel serves. Against a
 * deployment (E2E_BASE_URL) nothing is left out.
 */
import type { ConsoleMessage } from '@playwright/test';
import { expect, test, VERCEL_ANALYTICS } from './support/fixtures';
import { open, visitWholePage } from './support/page';
import { DESKTOP, device, PHONE, routeTitle, ROUTES } from './support/site';

const VISITS = [
  { width: PHONE, reducedMotion: 'reduce' as const, name: 'reduced motion' },
  { width: DESKTOP, reducedMotion: 'no-preference' as const, name: 'motion on' },
];

/** The suite started its own server (`next start`), which does not serve Vercel's own paths. */
const offVercel = !process.env.E2E_BASE_URL?.trim();

function where(message: ConsoleMessage): string {
  const { url, lineNumber } = message.location();
  return url ? ` (${url.replace(/^https?:\/\/[^/]+/, '')}${lineNumber ? `:${lineNumber}` : ''})` : '';
}

for (const visit of VISITS) {
  test.describe(`no console errors, ${visit.width} px, ${visit.name}`, () => {
    test.use({ ...device(visit.width), reducedMotion: visit.reducedMotion, analyticsStandIn: false });

    for (const route of ROUTES) {
      test(routeTitle(route), async ({ page, baseURL }) => {
        const errors: string[] = [];
        const own = new URL(route.path, baseURL).href;
        page.on('console', (message) => {
          if (message.type() !== 'error') return;
          // The not-found page answers 404 by design; the browser reports that as an error.
          if (route.status === 404 && message.location().url === own && /status of 404/.test(message.text())) return;
          if (offVercel && VERCEL_ANALYTICS.test(`${message.location().url} ${message.text()}`)) return;
          errors.push(`${message.text()}${where(message)}`);
        });
        page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
        expect(await open(page, route.path), 'status').toBe(route.status);
        await visitWholePage(page);
        await page.waitForLoadState('networkidle');
        expect(errors).toEqual([]);
      });
    }
  });
}
