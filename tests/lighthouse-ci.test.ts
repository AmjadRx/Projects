/**
 * The Lighthouse CI runner (scripts/lighthouse-ci.mjs) and the server it measures
 * (scripts/lighthouse-server.mjs): each page's theme is proven twice, in Chrome before collect and
 * from the sky still each run loaded, and turning the sky off cannot hide a wrong theme; the report
 * lists every assertion for every page; and the proxy in front of `next start` changes nothing but
 * the theme cookie, which it writes exactly as the site's theme toggle does.
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_COOKIE, applyTheme } from '../lib/theme';
import {
  COLUMNS,
  LHCI_PACKAGE,
  PROOF_SCREENS,
  assertionRows,
  columnsFor,
  RECOLLECT_ATTEMPTS,
  collectAgain,
  environmentLine,
  incompletePages,
  npxCommand,
  parseArgs,
  proofFailed,
  proofLine,
  proofVerdict,
  proveTheme,
  readAndPruneReports,
  resultKey,
  startServer,
  summaryMarkdown,
  themeChecks,
  themeOfRun,
  themeVerdicts,
  type AssertionResult,
  type Lhr,
  type Proof,
  type ProofBrowser,
  type ServerOptions,
} from '../scripts/lighthouse-ci.mjs';
import { createThemeProxy, parseServerArgs, themeCookieHeader } from '../scripts/lighthouse-server.mjs';

interface ConfigModule {
  budgetAssertions(formFactor: string): Record<string, unknown>;
  publicRoutes(dir?: string): string[];
}

const require = createRequire(import.meta.url);
const config = require('../scripts/lighthouse-config.cjs') as ConfigModule;

const BASE = 'http://localhost:3000';

function run(url: string, requests: string[]): Lhr {
  return { requestedUrl: url, audits: { 'network-requests': { details: { items: requests.map((u) => ({ url: u })) } } } };
}

function result(url: string, auditId: string, actual: number, passed: boolean, auditProperty?: string): AssertionResult {
  return { url, auditId, actual, values: [actual, actual, actual], passed, ...(auditProperty ? { auditProperty } : {}) };
}

/** A theme check that ran, with what Chrome painted on each page. */
function proof(painted: Record<string, string | null>, errors: Record<string, string> = {}): Proof {
  return {
    ran: true,
    pages: [
      ...Object.entries(painted).map(([route, theme]) => ({ route, status: 200, painted: theme })),
      ...Object.entries(errors).map(([route, error]) => ({ route, status: 0, painted: null, error })),
    ],
  };
}

describe('the runner', () => {
  it('pins Lighthouse CI 0.16.0, which pins Lighthouse 13.6.0', () => {
    expect(LHCI_PACKAGE).toBe('@lhci/cli@0.16.0');
  });

  it('runs every form factor and theme unless told one', () => {
    expect(parseArgs([])).toEqual({ formFactors: ['mobile', 'desktop'], themes: ['blueprint', 'whiteprint'] });
    expect(parseArgs(['--form-factor', 'desktop', '--theme', 'whiteprint'])).toEqual({ formFactors: ['desktop'], themes: ['whiteprint'] });
    expect(parseArgs(['--theme', 'all'])).toEqual({ formFactors: ['mobile', 'desktop'], themes: ['blueprint', 'whiteprint'] });
    expect(() => parseArgs(['--form-factor', 'tablet'])).toThrow(/--form-factor/);
    expect(() => parseArgs(['--theme'])).toThrow(/--theme/);
  });

  it('reports one column for each assertion the configuration makes, and only those', () => {
    for (const formFactor of ['mobile', 'desktop'] as const) {
      expect(columnsFor(formFactor).map((c) => c.key)).toEqual(Object.keys(config.budgetAssertions(formFactor)));
    }
    expect(COLUMNS.map((c) => c.budget)).toEqual(['at least 95', '100', '100', '100', 'at most 2,000 ms', 'at most 0.02', 'at most 150 ms']);
  });

  it('names a category assertion by its category and any other by its audit', () => {
    expect(resultKey({ auditId: 'categories', auditProperty: 'best-practices' })).toBe('categories:best-practices');
    expect(resultKey({ auditId: 'total-blocking-time' })).toBe('total-blocking-time');
  });

  it('runs npx without a shell, except on Windows, where the shell gets one line of plain words', () => {
    const args = ['--yes', LHCI_PACKAGE, 'collect', '--additive', '--url=http://localhost:3701/projects/dbvf-senior-design', '--config=lighthouserc.cjs'];
    expect(npxCommand(args, 'linux')).toEqual(['npx', args, false]);
    expect(npxCommand(args, 'win32')).toEqual([`npx.cmd ${args.join(' ')}`, [], true]);
    for (const unsafe of ['--url=http://localhost:3701/a b', '--url=http://x/?a=1&b=2', '"quoted"', 'a|b', '%PATH%', '']) {
      expect(() => npxCommand([unsafe], 'win32'), unsafe).toThrow(/Not a plain word/);
    }
  });
});

describe('the theme each run measured', () => {
  it('is read from the sky still image the run loaded', () => {
    expect(themeOfRun(run(`${BASE}/`, [`${BASE}/sky/still/blueprint-phone-05.webp`, `${BASE}/sky/stars.bin`]))).toBe('blueprint');
    expect(themeOfRun(run(`${BASE}/`, [`${BASE}/sky/still/whiteprint-desktop.webp`]))).toBe('whiteprint');
    expect(themeOfRun(run(`${BASE}/`, [`${BASE}/sky/still/whiteprint-phone.webp`, `${BASE}/sky/still/blueprint-phone-05.webp`]))).toBe('both');
    expect(themeOfRun(run(`${BASE}/`, [`${BASE}/_next/static/chunks/main.js`]))).toBeNull();
    expect(themeOfRun({ requestedUrl: `${BASE}/` })).toBeNull();
  });

  it('is counted for each page: right, wrong (the other theme, or both), or not shown', () => {
    const checks = themeChecks(
      [
        run(`${BASE}/`, ['/sky/still/whiteprint-phone.webp']),
        run(`${BASE}/`, ['/sky/still/whiteprint-phone.webp']),
        run(`${BASE}/about`, ['/sky/still/blueprint-phone-05.webp']),
        run(`${BASE}/about`, ['/sky/still/whiteprint-phone.webp', '/sky/still/blueprint-phone-05.webp']),
        run(`${BASE}/log`, []),
      ],
      'whiteprint',
    );
    expect(checks.get('/')).toEqual({ route: '/', runs: 2, matched: 2, wrong: 0, unknown: 0 });
    expect(checks.get('/about')).toEqual({ route: '/about', runs: 2, matched: 0, wrong: 2, unknown: 0 });
    expect(checks.get('/log')).toEqual({ route: '/log', runs: 1, matched: 0, wrong: 0, unknown: 1 });
  });
});

describe('a page\'s theme, from both checks', () => {
  const still = (route: string, theme: string | null, count = 3) =>
    Array.from({ length: count }, () => run(`${BASE}${route}`, theme ? [`/sky/still/${theme}-phone.webp`] : []));

  it('is proven by Chrome when the page painted the theme, wrong when it painted anything else, unproven when it could not be read', () => {
    expect(proofVerdict({ route: '/', status: 200, painted: 'whiteprint' }, 'whiteprint')).toBe('proven');
    expect(proofVerdict({ route: '/', status: 200, painted: 'blueprint' }, 'whiteprint')).toBe('wrong');
    expect(proofVerdict({ route: '/', status: 200, painted: null }, 'blueprint')).toBe('wrong');
    expect(proofVerdict({ route: '/', status: 404, painted: 'dark' }, 'blueprint')).toBe('wrong');
    expect(proofVerdict({ route: '/', status: 0, painted: null, error: 'Timeout 60000ms exceeded.' }, 'blueprint')).toBe('unproven');
    expect(proofVerdict(undefined, 'blueprint')).toBe('unproven');
  });

  it('stops Lighthouse when Chrome painted another theme on any page, and only then', () => {
    expect(proofFailed(proof({ '/': 'whiteprint', '/about': 'blueprint' }), 'whiteprint')).toBe(true);
    expect(proofFailed(proof({ '/': 'whiteprint' }, { '/about': 'net::ERR_ABORTED' }), 'whiteprint')).toBe(false);
    expect(proofFailed({ ran: false, reason: 'Chrome did not start: no Chrome' }, 'whiteprint')).toBe(false);
  });

  it('passes on Chrome alone when the sky is off and no run loaded a still', () => {
    const verdicts = themeVerdicts(['/', '/about'], themeChecks([...still('/', null), ...still('/about', null)], 'whiteprint'), proof({ '/': 'whiteprint', '/about': 'whiteprint' }), 'whiteprint');
    expect(verdicts.get('/')).toEqual({ ok: true, text: 'Whiteprint: Chrome, no sky still in 3 runs' });
    expect(verdicts.get('/about')?.ok).toBe(true);
  });

  it('fails a page no check proves: the sky off and Chrome not run, or unable to load it', () => {
    const checks = themeChecks([...still('/', null), ...still('/about', null, 1)], 'whiteprint');
    const notRun = themeVerdicts(['/', '/about'], checks, { ran: false, reason: 'Chrome did not start: missing' }, 'whiteprint');
    expect(notRun.get('/')).toEqual({ ok: false, text: 'FAIL: not proven (no Chrome check, no sky still in 3 runs)' });
    expect(notRun.get('/about')).toEqual({ ok: false, text: 'FAIL: not proven (no Chrome check, no sky still in 1 run)' });
    const unread = themeVerdicts(['/'], checks, proof({}, { '/': 'Timeout 60000ms exceeded.' }), 'whiteprint');
    expect(unread.get('/')).toEqual({ ok: false, text: 'FAIL: not proven (Chrome could not load it, no sky still in 3 runs)' });
  });

  it('passes on the sky still alone when Chrome did not run, as long as no run loaded the other theme\'s', () => {
    const checks = themeChecks([...still('/', 'whiteprint'), ...still('/about', 'whiteprint', 2), ...still('/about', null, 1)], 'whiteprint');
    const verdicts = themeVerdicts(['/', '/about'], checks, { ran: false, reason: 'the health check failed' }, 'whiteprint');
    expect(verdicts.get('/')).toEqual({ ok: true, text: 'Whiteprint: sky still in 3 of 3 runs' });
    expect(verdicts.get('/about')).toEqual({ ok: true, text: 'Whiteprint: sky still in 2 of 3 runs' });
  });

  it('fails a page on either check\'s wrong theme, whatever the other says', () => {
    const checks = themeChecks([...still('/', 'whiteprint', 2), ...still('/', 'blueprint', 1), ...still('/about', 'whiteprint')], 'whiteprint');
    const verdicts = themeVerdicts(['/', '/about', '/log'], checks, proof({ '/': 'whiteprint', '/about': 'blueprint', '/log': 'whiteprint' }), 'whiteprint');
    expect(verdicts.get('/')).toEqual({ ok: false, text: 'FAIL: 1 of 3 runs loaded another theme\'s sky still' });
    expect(verdicts.get('/about')).toEqual({ ok: false, text: 'FAIL: Chrome painted Blueprint' });
    // No runs: the page fails on its assertions ("no result"), not on its theme.
    expect(verdicts.get('/log')).toEqual({ ok: true, text: 'no runs' });
  });

  it('describes the theme check in one paragraph, naming what failed', () => {
    expect(proofLine(proof({ '/': 'whiteprint', '/about': 'whiteprint' }), 'whiteprint')).toBe(
      'Theme check before collect: 2 of 2 pages painted Whiteprint in Chrome (`<html data-theme="whiteprint">`), each in a fresh browser context, through the server Lighthouse measures.',
    );
    expect(proofLine(proof({ '/': 'whiteprint' }, { '/about': 'net::ERR_ABORTED' }), 'whiteprint')).toContain('1 of 2 pages painted Whiteprint');
    expect(proofLine(proof({ '/': 'whiteprint' }, { '/about': 'net::ERR_ABORTED' }), 'whiteprint')).toContain('Chrome could not load /about (net::ERR_ABORTED).');
    expect(proofLine(proof({ '/': 'blueprint', '/about': null, '/log': 'whiteprint' }), 'whiteprint')).toBe(
      'Theme check before collect: FAIL, so Lighthouse did not run. Expected Whiteprint: / painted Blueprint; /about painted no theme.',
    );
    expect(proofLine({ ran: false, reason: 'Chrome did not start: no Chrome' }, 'blueprint')).toBe(
      'Theme check before collect: did not run (Chrome did not start: no Chrome). Each page\'s theme rests on the sky still its runs loaded.',
    );
  });
});

describe('the theme check before collect', () => {
  const realDocument = (globalThis as { document?: unknown }).document;

  afterEach(() => {
    (globalThis as { document?: unknown }).document = realDocument;
  });

  interface Recorded {
    commands: string[];
    options: ServerOptions[];
    stops: number;
    contexts: Array<{ options: unknown; urls: string[]; closed: boolean }>;
    browserClosed: boolean;
  }

  /** Stand-ins for the server and Chrome: each page paints `paint(url)`, or throws when that returns an Error. */
  function standIns(paint: (url: string) => string | null | Error, failStart = false, failLaunch = false) {
    const recorded: Recorded = { commands: [], options: [], stops: 0, contexts: [], browserClosed: false };
    const start = async (command: string, options: ServerOptions) => {
      recorded.commands.push(command);
      recorded.options.push(options);
      if (failStart) throw new Error('it stopped (exit 1) before it was ready: Lighthouse server: no build');
      return {
        stop: async () => {
          recorded.stops += 1;
        },
      };
    };
    const browser: ProofBrowser = {
      async newContext(options) {
        const context = { options, urls: [] as string[], closed: false };
        recorded.contexts.push(context);
        return {
          async newPage() {
            let painted: string | null = null;
            return {
              async goto(url: string) {
                context.urls.push(url);
                const outcome = paint(url);
                if (outcome instanceof Error) throw outcome;
                painted = outcome;
                return { status: () => 200 };
              },
              async evaluate<T>(fn: () => T): Promise<T> {
                // The function runs as it would in the page, against that page's <html>.
                (globalThis as { document?: unknown }).document = {
                  documentElement: { getAttribute: (name: string) => (name === 'data-theme' ? painted : null) },
                };
                return fn();
              },
            };
          },
          async close() {
            context.closed = true;
          },
        };
      },
      async close() {
        recorded.browserClosed = true;
      },
    };
    const launch = async () => {
      if (failLaunch) throw new Error('browserType.launch: Chromium distribution \'chrome\' is not found\nRun "npx playwright install chrome"');
      return browser;
    };
    return { recorded, start, launch };
  }

  it('serves the build with Lighthouse CI\'s own server command, on a port of its own, and reads every page in a fresh context', async () => {
    const { recorded, start, launch } = standIns(() => 'whiteprint');
    const result = await proveTheme({ formFactor: 'mobile', theme: 'whiteprint', env: { LHCI_PORT: '3701' }, start, launch });
    const routes = config.publicRoutes();
    expect(result).toEqual({ ran: true, pages: routes.map((route) => ({ route, status: 200, painted: 'whiteprint' })) });
    expect(recorded.commands).toHaveLength(1);
    const port = /--port (\d+)/.exec(recorded.commands[0])?.[1];
    expect(port).toBeDefined();
    expect(port).not.toBe('3701');
    expect(recorded.commands[0]).toBe(`node scripts/lighthouse-server.mjs --port ${port} --cookie whiteprint`);
    expect(recorded.options[0]).toMatchObject({ readyPattern: 'Ready in', timeoutMs: 60000 });
    expect(recorded.contexts.map((c) => c.urls)).toEqual(routes.map((route) => [`http://localhost:${port}${route}`]));
    for (const context of recorded.contexts) {
      expect(context.options).toEqual(PROOF_SCREENS.mobile);
      expect(context.closed).toBe(true);
    }
    expect(recorded.browserClosed).toBe(true);
    expect(recorded.stops).toBe(1);
  });

  it('gives the default theme no cookie, and each form factor Lighthouse\'s own screen', async () => {
    const { recorded, start, launch } = standIns(() => 'blueprint');
    const result = await proveTheme({ formFactor: 'desktop', theme: 'blueprint', env: {}, start, launch });
    expect(result.ran && result.pages.every((page) => page.painted === 'blueprint')).toBe(true);
    expect(recorded.commands[0]).toMatch(/^node scripts\/lighthouse-server\.mjs --port \d+$/);
    expect(recorded.contexts[0].options).toEqual({ viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    expect(PROOF_SCREENS.mobile).toEqual({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true });
  });

  it('records what each page painted, and a page it could not load, without stopping', async () => {
    const { start, launch } = standIns((url) => (url.endsWith('/about') ? new Error('page.goto: Timeout 60000ms exceeded.\nCall log: ...') : url.endsWith('/log') ? 'blueprint' : 'whiteprint'));
    const result = await proveTheme({ formFactor: 'mobile', theme: 'whiteprint', env: {}, start, launch });
    if (!result.ran) throw new Error('the check should have run');
    expect(result.pages.find((page) => page.route === '/about')).toEqual({ route: '/about', status: 0, painted: null, error: 'page.goto: Timeout 60000ms exceeded.' });
    expect(result.pages.find((page) => page.route === '/log')?.painted).toBe('blueprint');
    expect(result.pages).toHaveLength(config.publicRoutes().length);
    expect(proofFailed(result, 'whiteprint')).toBe(true);
  });

  it('does not run, and says why, when the server or Chrome cannot start, and always stops what it started', async () => {
    const noServer = standIns(() => 'whiteprint', true);
    expect(await proveTheme({ formFactor: 'mobile', theme: 'whiteprint', env: {}, start: noServer.start, launch: noServer.launch })).toEqual({
      ran: false,
      reason: 'the server did not start: it stopped (exit 1) before it was ready: Lighthouse server: no build',
    });
    expect(noServer.recorded.contexts).toHaveLength(0);

    const noChrome = standIns(() => 'whiteprint', false, true);
    expect(await proveTheme({ formFactor: 'mobile', theme: 'whiteprint', env: {}, start: noChrome.start, launch: noChrome.launch })).toEqual({
      ran: false,
      reason: 'Chrome did not start: browserType.launch: Chromium distribution \'chrome\' is not found',
    });
    expect(noChrome.recorded.stops).toBe(1);
  });
});

// These start and stop real processes, which a busy machine slows well past the default 5 s.
describe('starting a server as Lighthouse CI does', { timeout: 30_000 }, () => {
  let tmp = '';
  const stops: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(stops.splice(0).map((stop) => stop()));
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  });

  /** A script in a new folder (the command is split on spaces, as the configuration writes it). */
  function script(source: string): string {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-server-'));
    const file = path.join(tmp, 'server.mjs');
    fs.writeFileSync(file, source);
    return file;
  }

  const options = (timeoutMs = 20000): ServerOptions => ({ env: { ...process.env }, readyPattern: 'Ready in', timeoutMs });

  it.skipIf(/\s/.test(os.tmpdir()))('resolves once the server prints the ready pattern, and stop() ends it', async () => {
    const file = script(
      "import http from 'node:http';\n" +
        "const server = http.createServer((req, res) => res.end('ok')).listen(0, '127.0.0.1', () => {\n" +
        "  console.log(`Lighthouse server: Ready in 5 ms on ${server.address().port}`);\n" +
        '});\n',
    );
    const handle = await startServer(`node ${file}`, options());
    stops.push(() => handle.stop());
    await handle.stop();
    await handle.stop();
  });

  it.skipIf(/\s/.test(os.tmpdir()))('rejects with the server\'s last line when it stops before it is ready', async () => {
    const file = script("console.error('Lighthouse server: the check page answered 500');\nprocess.exit(1);\n");
    await expect(startServer(`node ${file}`, options())).rejects.toThrow(
      'it stopped (exit 1) before it was ready: Lighthouse server: the check page answered 500',
    );
  });

  it.skipIf(/\s/.test(os.tmpdir()))('gives up, and stops the server, when it never becomes ready', async () => {
    const file = script("setInterval(() => {}, 1000);\nconsole.log('starting');\n");
    await expect(startServer(`node ${file}`, options(1500))).rejects.toThrow('no "Ready in" within 1.5 s');
  });

  it('runs only node commands', async () => {
    await expect(startServer('npm start', options())).rejects.toThrow('does not start with node');
  });
});

describe('the summary', () => {
  const routes = ['/', '/about'];
  const results: AssertionResult[] = [
    result(`${BASE}/`, 'categories', 0.73, false, 'performance'),
    result(`${BASE}/`, 'categories', 1, true, 'accessibility'),
    result(`${BASE}/`, 'categories', 0.96, false, 'best-practices'),
    result(`${BASE}/`, 'categories', 1, true, 'seo'),
    result(`${BASE}/`, 'largest-contentful-paint', 4381.2, false),
    result(`${BASE}/`, 'cumulative-layout-shift', 0.013, true),
    result(`${BASE}/`, 'total-blocking-time', 462, false),
    result(`${BASE}/about`, 'categories', 0.97, true, 'performance'),
  ];

  it('gives every page a cell for every assertion, the median and whether it passed', () => {
    const rows = assertionRows(results, routes, 'mobile');
    expect(rows.map((r) => r.route)).toEqual(routes);
    expect(rows[0].cells['largest-contentful-paint']).toEqual({ actual: 4381.2, values: [4381.2, 4381.2, 4381.2], passed: false });
    expect(rows[1].cells['categories:performance']?.passed).toBe(true);
    expect(rows[1].cells['total-blocking-time']).toBeNull();
    expect(Object.keys(assertionRows(results, routes, 'desktop')[0].cells)).not.toContain('largest-contentful-paint');
  });

  it('counts a missing result as a failure, prints every value with its unit, and each page\'s theme', () => {
    const checks = themeChecks([run(`${BASE}/`, ['/sky/still/blueprint-phone-05.webp']), run(`${BASE}/about`, [])], 'blueprint');
    const rows = assertionRows(results, routes, 'mobile');
    const { markdown, passed, total, themeOk } = summaryMarkdown({
      formFactor: 'mobile',
      theme: 'blueprint',
      rows,
      checks,
      proof: proof({ '/': 'blueprint', '/about': 'blueprint' }),
      environment: 'Lighthouse 13.6.0.',
      lhciStatus: 1,
    });
    expect(total).toBe(14);
    expect(passed).toBe(4);
    expect(themeOk).toBe(true);
    expect(markdown).toContain('### Lighthouse: phone, Blueprint');
    expect(markdown).toContain('Theme check before collect: 2 of 2 pages painted Blueprint in Chrome');
    expect(markdown).toContain('| / | 73 FAIL | 100 pass | 96 FAIL | 100 pass | 4,381 ms FAIL | 0.013 pass | 462 ms FAIL | Blueprint: Chrome, sky still in 1 of 1 run |');
    expect(markdown).toContain('| /about | 97 pass | no result |');
    expect(markdown).toContain('| Blueprint: Chrome, no sky still in 1 run |');
    expect(markdown).toContain('4 of 14 assertions pass on the median of the runs.');
    expect(markdown).not.toContain('Pages whose theme');
    expect(markdown).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
  });

  it('fails a page with no sky still when the theme check did not run', () => {
    const checks = themeChecks([run(`${BASE}/`, ['/sky/still/blueprint-phone-05.webp']), run(`${BASE}/about`, [])], 'blueprint');
    const { markdown, themeOk } = summaryMarkdown({ formFactor: 'mobile', theme: 'blueprint', rows: assertionRows(results, routes, 'mobile'), checks, environment: '', lhciStatus: 1 });
    expect(themeOk).toBe(false);
    expect(markdown).toContain('Theme check before collect: did not run (not run).');
    expect(markdown).toContain('| Blueprint: sky still in 1 of 1 run |');
    expect(markdown).toContain('| FAIL: not proven (no Chrome check, no sky still in 1 run) |');
    expect(markdown).toContain('Pages whose theme is wrong or not proven: /about.');
  });

  it('names the versions, and the machine\'s slowest and fastest benchmark over every run', () => {
    const lhr = (benchmarkIndex?: number): Lhr => ({
      requestedUrl: `${BASE}/`,
      lighthouseVersion: '13.6.0',
      environment: { hostUserAgent: 'Mozilla/5.0 HeadlessChrome/157.0.0.0 Safari/537.36', ...(benchmarkIndex ? { benchmarkIndex } : {}) },
    });
    expect(environmentLine([lhr(2184.2), lhr(1133.4), lhr()], 3)).toBe(
      'Lighthouse 13.6.0, Chrome 157.0.0.0, benchmark index 1133 to 2184, 3 runs per page, medians. Budgets: ARCHITECTURE.md 9.',
    );
    expect(environmentLine([lhr(2184)], 1)).toBe('Lighthouse 13.6.0, Chrome 157.0.0.0, benchmark index 2184, 1 run per page, medians. Budgets: ARCHITECTURE.md 9.');
  });

  it('names the pages whose runs measured the wrong theme', () => {
    const checks = themeChecks([run(`${BASE}/`, ['/sky/still/blueprint-desktop-05.webp'])], 'whiteprint');
    const rows = assertionRows([], ['/'], 'desktop');
    const { markdown, themeOk } = summaryMarkdown({ formFactor: 'desktop', theme: 'whiteprint', rows, checks, proof: proof({ '/': 'whiteprint' }), environment: '', lhciStatus: 1 });
    expect(themeOk).toBe(false);
    expect(markdown).toContain('FAIL: 1 of 1 run loaded another theme\'s sky still');
    expect(markdown).toContain('Pages whose theme is wrong or not proven: /.');
  });

  it('fails a page with no runs on its assertions, and leaves it out of the theme failures', () => {
    const passing = ['performance', 'accessibility', 'best-practices', 'seo'].map((id) => result(`${BASE}/`, 'categories', 1, true, id));
    passing.push(result(`${BASE}/`, 'cumulative-layout-shift', 0, true), result(`${BASE}/`, 'total-blocking-time', 0, true));
    const { markdown, passed, total, themeOk } = summaryMarkdown({
      formFactor: 'desktop',
      theme: 'whiteprint',
      rows: assertionRows(passing, ['/', '/about'], 'desktop'),
      checks: themeChecks([run(`${BASE}/`, ['/sky/still/whiteprint-desktop.webp'])], 'whiteprint'),
      proof: proof({ '/': 'whiteprint', '/about': 'whiteprint' }),
      environment: '',
      lhciStatus: 0,
      notes: ['No complete set of runs, so no result: /about.'],
    });
    expect([passed, total]).toEqual([6, 12]);
    expect(themeOk).toBe(true);
    expect(markdown).toContain('| /about | no result | no result | no result | no result | no result | no result | no runs |');
    expect(markdown).not.toContain('Pages whose theme');
  });

  it('says Lighthouse did not run when Chrome painted the wrong theme before collect', () => {
    const { markdown, passed, themeOk } = summaryMarkdown({
      formFactor: 'desktop',
      theme: 'whiteprint',
      rows: assertionRows([], ['/', '/about'], 'desktop'),
      checks: new Map(),
      proof: proof({ '/': 'blueprint', '/about': 'whiteprint' }),
      environment: '',
      lhciStatus: 0,
    });
    expect(passed).toBe(0);
    expect(themeOk).toBe(false);
    expect(markdown).toContain('Theme check before collect: FAIL, so Lighthouse did not run. Expected Whiteprint: / painted Blueprint.');
    expect(markdown).toContain('| FAIL: Chrome painted Blueprint |');
    expect(markdown).toContain('| no runs |');
  });
});

describe('pages collected again', () => {
  let dir = '';

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  function save(name: string, url: string): void {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ requestedUrl: url }));
    fs.writeFileSync(path.join(dir, `${name}.html`), '<!doctype html>');
  }

  it('are the pages with fewer saved runs than asked for, whose partial runs are deleted', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-saved-'));
    for (const name of ['lhr-1', 'lhr-2', 'lhr-3']) save(name, `${BASE}/`);
    save('lhr-4-5', `${BASE}/about`);
    fs.writeFileSync(path.join(dir, 'lhr-6.json'), '');
    fs.writeFileSync(path.join(dir, 'assertion-results.json'), '[]');
    const urls = [`${BASE}/`, `${BASE}/about`, `${BASE}/log`];
    expect(incompletePages(urls, 3, dir)).toEqual([`${BASE}/about`, `${BASE}/log`]);
    expect(fs.readdirSync(dir).sort()).toEqual([
      'assertion-results.json',
      'lhr-1.html',
      'lhr-1.json',
      'lhr-2.html',
      'lhr-2.json',
      'lhr-3.html',
      'lhr-3.json',
    ]);
    expect(incompletePages([`${BASE}/`], 3, dir)).toEqual([]);
  });

  it('are each collected on their own, so a page that keeps failing cannot cost the pages after it their runs', () => {
    const calls: string[][] = [];
    collectAgain([`${BASE}/projects/dbvf-senior-design`, `${BASE}/projects/raven`], (args) => {
      calls.push(args);
      return calls.length === 1 ? 1 : 0;
    });
    expect(calls).toEqual([
      ['collect', '--additive', `--url=${BASE}/projects/dbvf-senior-design`],
      ['collect', '--additive', `--url=${BASE}/projects/raven`],
    ]);
  });

  it('are tried at most twice more, and the summary says which they were', () => {
    expect(RECOLLECT_ATTEMPTS).toBe(2);
    const note = 'Collected again (1 of 2), page by page, as Lighthouse could not finish every run: /about.';
    const { markdown } = summaryMarkdown({
      formFactor: 'desktop',
      theme: 'whiteprint',
      rows: assertionRows([], ['/about'], 'desktop'),
      checks: new Map(),
      environment: '',
      lhciStatus: 0,
      notes: [note],
    });
    expect(markdown).toContain(note);
  });
});

describe('the reports kept', () => {
  let dir = '';

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  /** A Lighthouse CI filesystem upload: three runs of two pages, the middle one the median run. */
  function upload(sharedName = false): string[] {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-reports-'));
    const manifest = [];
    for (const page of ['home', 'about']) {
      for (const runIndex of [1, 2, 3]) {
        const name = sharedName && runIndex === 3 ? `${page}-2` : `${page}-${runIndex}`;
        fs.writeFileSync(path.join(dir, `${name}.report.json`), JSON.stringify(run(`${BASE}/${page}`, [])));
        fs.writeFileSync(path.join(dir, `${name}.report.html`), '<!doctype html>');
        manifest.push({
          url: `${BASE}/${page}`,
          isRepresentativeRun: runIndex === 2,
          // Absolute paths, as Lighthouse CI writes them.
          jsonPath: path.join(dir, `${name}.report.json`),
          htmlPath: path.join(dir, `${name}.report.html`),
          summary: { performance: 0.9 },
        });
      }
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    return fs.readdirSync(dir);
  }

  it('keeps only the median run\'s HTML report for each page, after reading every run', () => {
    upload();
    const lhrs = readAndPruneReports(dir);
    expect(lhrs).toHaveLength(6);
    expect(fs.readdirSync(dir).sort()).toEqual(['about-2.report.html', 'home-2.report.html', 'manifest.json']);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(manifest).toEqual([
      { url: `${BASE}/home`, isRepresentativeRun: true, htmlPath: 'home-2.report.html', summary: { performance: 0.9 } },
      { url: `${BASE}/about`, isRepresentativeRun: true, htmlPath: 'about-2.report.html', summary: { performance: 0.9 } },
    ]);
  });

  it('never deletes the median run\'s report when another run wrote the same name', () => {
    upload(true);
    readAndPruneReports(dir);
    expect(fs.readdirSync(dir).sort()).toEqual(['about-2.report.html', 'home-2.report.html', 'manifest.json']);
  });

  it('reads nothing when Lighthouse CI wrote no reports', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-reports-'));
    expect(readAndPruneReports(dir)).toEqual([]);
  });
});

describe('the server Lighthouse measures (scripts/lighthouse-server.mjs)', () => {
  const realDocument = (globalThis as { document?: unknown }).document;
  const open: http.Server[] = [];

  afterEach(async () => {
    (globalThis as { document?: unknown }).document = realDocument;
    await Promise.all(open.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  function listen(server: http.Server): Promise<number> {
    open.push(server);
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
  }

  /** A stand-in for next start: a page that sets a cookie of its own, a script, a redirect, and not found. */
  function upstream(): Promise<number> {
    return listen(
      http.createServer((req, res) => {
        if (req.url === '/') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'other=1; Path=/' });
          res.end('<!doctype html><title>home</title>');
        } else if (req.url === '/app.js') {
          res.writeHead(200, { 'content-type': 'application/javascript' });
          res.end('console.log(1)');
        } else if (req.url === '/old') {
          res.writeHead(308, { location: '/' });
          res.end();
        } else {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><title>not found</title>');
        }
      }),
    );
  }

  it('takes its port and the theme cookie to set, and refuses anything else', () => {
    expect(parseServerArgs(['--port', '3701'])).toEqual({ port: 3701, cookie: null });
    expect(parseServerArgs(['--port', '3000', '--cookie', 'whiteprint'])).toEqual({ port: 3000, cookie: 'whiteprint' });
    expect(() => parseServerArgs([])).toThrow(/--port/);
    expect(() => parseServerArgs(['--port', '80'])).toThrow(/--port/);
    expect(() => parseServerArgs(['--port', '3000', '--cookie', 'dark'])).toThrow(/--cookie/);
  });

  it('writes the cookie exactly as the site\'s theme toggle does', () => {
    const written: string[] = [];
    (globalThis as { document?: unknown }).document = {
      documentElement: { setAttribute() {} },
      set cookie(text: string) {
        written.push(text);
      },
    };
    applyTheme('whiteprint');
    expect(themeCookieHeader('whiteprint')).toBe(written[0]);
    expect(themeCookieHeader('blueprint').startsWith(`${THEME_COOKIE}=blueprint; `)).toBe(true);
  });

  it('adds the theme cookie to every HTML page and passes everything else through as it is', async () => {
    const base = `http://127.0.0.1:${await listen(createThemeProxy({ upstreamPort: await upstream(), cookie: 'whiteprint' }))}`;
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toBe('<!doctype html><title>home</title>');
    expect(home.headers.getSetCookie()).toEqual(['other=1; Path=/', themeCookieHeader('whiteprint')]);

    const script = await fetch(`${base}/app.js`);
    expect(await script.text()).toBe('console.log(1)');
    expect(script.headers.get('content-type')).toBe('application/javascript');
    expect(script.headers.getSetCookie()).toEqual([]);

    const moved = await fetch(`${base}/old`, { redirect: 'manual' });
    expect(moved.status).toBe(308);
    expect(moved.headers.get('location')).toBe('/');
    expect(moved.headers.getSetCookie()).toEqual([]);

    const missing = await fetch(`${base}/lighthouse-server-check`);
    expect(missing.status).toBe(404);
    expect(missing.headers.getSetCookie()).toEqual([themeCookieHeader('whiteprint')]);
  });

  it('changes nothing for the default theme', async () => {
    const base = `http://127.0.0.1:${await listen(createThemeProxy({ upstreamPort: await upstream(), cookie: null }))}`;
    const home = await fetch(`${base}/`);
    expect(await home.text()).toBe('<!doctype html><title>home</title>');
    expect(home.headers.getSetCookie()).toEqual(['other=1; Path=/']);
  });

  it('answers 502 with the reason when next start is not there', async () => {
    const gone = http.createServer();
    const port = await listen(gone);
    open.splice(open.indexOf(gone), 1);
    await new Promise((resolve) => gone.close(resolve));
    const base = `http://127.0.0.1:${await listen(createThemeProxy({ upstreamPort: port, cookie: null }))}`;
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('Lighthouse server: the request to next start failed (ECONNREFUSED).');
  });
});
