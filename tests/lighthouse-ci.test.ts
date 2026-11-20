/**
 * The Lighthouse CI runner (scripts/lighthouse-ci.mjs) and the server it measures
 * (scripts/lighthouse-server.mjs): the theme each run measured is proved from the run itself, the
 * report lists every assertion for every page, and the proxy in front of `next start` changes nothing
 * but the theme cookie, which it writes exactly as the site's theme toggle does.
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
  assertionRows,
  columnsFor,
  RECOLLECT_ATTEMPTS,
  incompletePages,
  parseArgs,
  readAndPruneReports,
  resultKey,
  summaryMarkdown,
  themeChecks,
  themeOfRun,
  type AssertionResult,
  type Lhr,
} from '../scripts/lighthouse-ci.mjs';
import { createThemeProxy, parseServerArgs, themeCookieHeader } from '../scripts/lighthouse-server.mjs';

interface ConfigModule {
  budgetAssertions(formFactor: string): Record<string, unknown>;
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

  it('counts a missing result as a failure and prints every value with its unit', () => {
    const checks = themeChecks([run(`${BASE}/`, ['/sky/still/blueprint-phone-05.webp']), run(`${BASE}/about`, [])], 'blueprint');
    const rows = assertionRows(results, routes, 'mobile');
    const { markdown, passed, total } = summaryMarkdown({ formFactor: 'mobile', theme: 'blueprint', rows, checks, environment: 'Lighthouse 13.6.0.', lhciStatus: 1 });
    expect(total).toBe(14);
    expect(passed).toBe(4);
    expect(markdown).toContain('### Lighthouse: phone, Blueprint');
    expect(markdown).toContain('| / | 73 FAIL | 100 pass | 96 FAIL | 100 pass | 4,381 ms FAIL | 0.013 pass | 462 ms FAIL | Blueprint, 1 of 1 runs |');
    expect(markdown).toContain('| /about | 97 pass | no result |');
    expect(markdown).toContain('Blueprint in 0 of 1 runs, 1 without a sky still');
    expect(markdown).toContain('4 of 14 assertions pass on the median of the runs.');
    expect(markdown).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
  });

  it('names the pages whose runs measured the wrong theme', () => {
    const checks = themeChecks([run(`${BASE}/`, ['/sky/still/blueprint-desktop-05.webp'])], 'whiteprint');
    const rows = assertionRows([], ['/'], 'desktop');
    const { markdown } = summaryMarkdown({ formFactor: 'desktop', theme: 'whiteprint', rows, checks, environment: '', lhciStatus: 1 });
    expect(markdown).toContain('FAIL: 1 of 1 runs showed another theme');
    expect(markdown).toContain('Runs that measured the wrong theme: /.');
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

  it('are tried at most twice more, and the summary says which they were', () => {
    expect(RECOLLECT_ATTEMPTS).toBe(2);
    const note = 'Collected again (1 of 2), as Lighthouse could not finish every run: /about.';
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
