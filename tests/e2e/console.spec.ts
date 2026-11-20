/**
 * No errors in the console on any route (Lighthouse Best Practices 100 allows none, a missing
 * /favicon.ico included; and a hydration mismatch shows here as an error), in both themes (each
 * loads pictures of its own, and ARCHITECTURE.md 9 asks for Best Practices 100 in both), at the
 * phone's width under reduced motion and at the desktop's width with motion on, with every part of
 * the page brought into view once and the network quiet after it, so late requests have answered.
 *
 * The browser is left as it is here, with no request routing, because a routed browser context never
 * asks for /favicon.ico; so the analytics stand-in of ./support/fixtures.ts is off. Two things are
 * not counted: the not-found page's own 404 answer, which is its purpose, and, on the suite's own
 * `next start`, the errors from Vercel's analytics script, which only Vercel serves. Against a
 * deployment (E2E_BASE_URL) nothing is left out.
 *
 * Chrome also asks for a missing icon only once per browser: it remembers that the icon is missing,
 * and a later visit in the same browser hears nothing. Which of these tests hears a missing icon
 * depends on the order they run in, so the tab icon tests below check the icon on every route
 * without a browser.
 */
import type { ConsoleMessage } from '@playwright/test';
import { expect, test, VERCEL_ANALYTICS } from './support/fixtures';
import { open, visitWholePage } from './support/page';
import { DESKTOP, device, PHONE, routeTitle, ROUTES, THEMES } from './support/site';

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

for (const theme of THEMES) {
  for (const visit of VISITS) {
    test.describe(`no console errors, ${theme}, ${visit.width} px, ${visit.name}`, () => {
      test.use({ theme, ...device(visit.width), reducedMotion: visit.reducedMotion, analyticsStandIn: false });

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
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await visitWholePage(page);
          await page.waitForLoadState('networkidle');
          expect(errors).toEqual([]);
        });
      }
    });
  }
}

/** The value of an attribute in a tag's markup, or null. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '').replace(/&amp;/g, '&') : null;
}

/**
 * The tab icon: the icons a page names (<link rel="icon">, "shortcut icon" included) each answer
 * with a picture, and a page that names none has /favicon.ico, which a browser asks for then.
 */
test.describe('the tab icon answers', () => {
  for (const route of ROUTES) {
    test(routeTitle(route), async ({ request }) => {
      const response = await request.get(route.path);
      expect(response.status(), 'status').toBe(route.status);
      const links = [...(await response.text()).matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
      const icons = links
        .filter((tag) => (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('icon'))
        .map((tag) => attribute(tag, 'href') ?? '');
      const wanted = icons.length > 0 ? icons : ['/favicon.ico'];
      const answers: string[] = [];
      for (const href of wanted) {
        const icon = await request.get(href);
        answers.push(`${href}: ${icon.status()} ${icon.headers()['content-type'] ?? 'no type'}`);
      }
      const named = icons.length > 0 ? `the icons the page names` : 'the page names no icon, so a browser asks for /favicon.ico';
      expect(answers.filter((answer) => !/: 200 image\//.test(answer)), named).toEqual([]);
    });
  }
});
