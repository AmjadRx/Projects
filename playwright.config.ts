import { defineConfig } from '@playwright/test';

/**
 * The end-to-end suite (tests/e2e; ARCHITECTURE.md 10 and 15): axe, layout, theme, reduced motion,
 * keyboard, contact, GPA, and not-found checks on every public route, run with Playwright in the
 * installed Google Chrome against a production build served by `next start`.
 *
 *   npm run test:e2e
 *
 * The suite starts its own server (tests/e2e/serve.mjs): `npm run build` into its own output folder,
 * then `next start`. Like every npm command here, the build needs MOTION_TOKEN in the environment.
 *
 * Environment:
 * - E2E_PORT: the server's port (3702 by default).
 * - E2E_REUSE_BUILD=1: serve the build already in the suite's output folder instead of building
 *   again (while the suite itself is being worked on).
 * - E2E_BASE_URL: test a server that is already running instead (no server is started).
 * - E2E_WORKERS: how many tests run at once (Playwright's default otherwise: half the cores).
 * - E2E_CHANNEL: the browser channel, `chrome` by default (the installed Google Chrome).
 *
 * Every test opens its own browser context, so tests share nothing and run in parallel. Traces and
 * screenshots are kept only for failed tests, in test-results/ (ignored by git).
 */
const port = Number(process.env.E2E_PORT) || 3702;
const external = process.env.E2E_BASE_URL?.trim();
const baseURL = external || `http://127.0.0.1:${port}`;
const workers = Number(process.env.E2E_WORKERS) || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No retries: a check that passes only sometimes is a finding, not noise to hide.
  retries: 0,
  workers,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    browserName: 'chromium',
    channel: process.env.E2E_CHANNEL?.trim() || 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: external
    ? undefined
    : {
        command: 'node tests/e2e/serve.mjs',
        url: `${baseURL}/`,
        env: { E2E_PORT: String(port) },
        // The build runs first, and it takes a few minutes.
        timeout: 20 * 60_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
