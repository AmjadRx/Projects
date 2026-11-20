import { defineConfig } from '@playwright/test';

/**
 * The end-to-end suite (tests/e2e; ARCHITECTURE.md 10 and 15): axe, layout, theme, reduced motion,
 * keyboard, contact, GPA, not-found, and contrast over the sky checks on every public route, the
 * command palette, printing, and the live sky, run with Playwright in the installed Google Chrome
 * against a production build served by `next start`.
 *
 *   npm run test:e2e
 *
 * The suite starts its own server (tests/e2e/serve.mjs): `npm run build` into its own output folder,
 * then `next start`. Like every npm command here, the build needs MOTION_TOKEN in the environment.
 *
 * Environment:
 * - E2E_PORT: the server's port (3702 by default). When something already answers there, the run
 *   stops with an error rather than test it in this tree's place (it may be another tree's server,
 *   or one left from an earlier run).
 * - E2E_REUSE_SERVER=1: test the server already answering on E2E_PORT after all, instead of
 *   starting one (for a server this tree started and left running on purpose).
 * - E2E_REUSE_BUILD=1: serve the build already in the suite's output folder instead of building
 *   again (while the suite itself is being worked on).
 * - E2E_BASE_URL: test a server that is already running instead (no server is started).
 * - E2E_WORKERS: how many tests run at once (Playwright's default otherwise: half the cores).
 * - E2E_CHANNEL: the browser channel, `chrome` by default (the installed Google Chrome).
 * - E2E_CONTRAST_DIR: a folder where tests/e2e/contrast.spec.ts also writes each page's summary
 *   and, for a page that fails, the screenshots it read (left unset, only the tests' attachments).
 *
 * The live sky's demotion and pause tests (tests/e2e/sky.spec.ts) draw the real scene, which needs
 * a GPU; without one they are skipped and say so.
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
        reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
        // SIGTERM first, so a server stopped during its build puts tsconfig.json back
        // (tests/e2e/serve.mjs). Windows has no such signal; there the next run repairs it.
        gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
