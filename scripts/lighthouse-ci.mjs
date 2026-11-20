#!/usr/bin/env node
/**
 * Lighthouse CI for the budgets of ARCHITECTURE.md 9 (`npm run lighthouse`), on a production build:
 * run `npm run build` first. Lighthouse CI comes through npx, pinned (LHCI_PACKAGE below, which pins
 * Lighthouse 13.6.0), and needs Google Chrome.
 *
 * Usage: node scripts/lighthouse-ci.mjs [--form-factor mobile|desktop|all] [--theme blueprint|whiteprint|all]
 * (both default to all; LHCI_PORT, LHCI_RUNS, and NEXT_DIST_DIR pass through to lighthouserc.cjs).
 *
 * For each form factor and theme it:
 * 1. runs Lighthouse CI's health check;
 * 2. checks the theme before collect (proveTheme): it serves the build with the server command
 *    Lighthouse CI will use, loads every page in Chrome (through @playwright/test, as the
 *    repository's other browser scripts do), each in a fresh browser context as each Lighthouse run
 *    starts with a fresh profile, and reads <html data-theme> once the page has loaded. This does not
 *    depend on the sky, which the owner can turn off (settings.background `grid` or `off`): then no
 *    run loads a sky still. A page that painted anything but the theme stops the run here;
 * 3. collects (lighthouserc.cjs, built in scripts/lighthouse-config.cjs): `next start` through
 *    scripts/lighthouse-server.mjs, and Lighthouse on every public page in a fresh browser each run; a
 *    page whose runs did not all finish is collected again, each such page on its own, up to
 *    RECOLLECT_ATTEMPTS times;
 * 4. asserts the budgets on the median of the runs, and writes the reports to
 *    .lighthouseci/reports/<form factor>-<theme>/;
 * 5. checks each run's theme a second way, from the sky still it loaded (blueprint-* or
 *    whiteprint-*): a run that loaded the other theme's still fails. A page's theme is proven when
 *    Chrome painted it in step 2 or a run loaded its still, and no run loaded the other's;
 * 6. keeps the median run's HTML report for each page, with manifest.json, assertion-results.json
 *    (every assertion with every run's value), and summary.md (every assertion's result for every
 *    page, and each page's theme), deletes the other reports, and adds the summary to the GitHub
 *    Actions job summary when it runs there.
 * It exits 1 when an assertion or a theme check fails, or when Lighthouse CI could not run.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freePort } from './lighthouse-server.mjs';

const { BUDGETS, FORM_FACTORS, REPORTS_DIR, THEMES, lighthouseConfig, runName } = createRequire(import.meta.url)(
  './lighthouse-config.cjs',
);

/** Lighthouse CI, pinned. Version 0.16.0 pins Lighthouse 13.6.0 and needs Node 22.19 or newer. */
export const LHCI_PACKAGE = '@lhci/cli@0.16.0';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LHCI_DIR = path.join(ROOT, '.lighthouseci');

const THEME_NAMES = { blueprint: 'Blueprint', whiteprint: 'Whiteprint' };
const FORM_FACTOR_NAMES = { mobile: 'phone', desktop: 'desktop' };

const score = (value) => String(Math.round(value * 100));
const ms = (value) => `${Math.round(value).toLocaleString('en-US')} ms`;
const shift = (value) => value.toFixed(3);

/** The table's columns: one per assertion of lighthouse-config.cjs budgetAssertions, in order. */
export const COLUMNS = [
  { key: 'categories:performance', label: 'Performance', budget: `at least ${score(BUDGETS.performance)}`, format: score },
  { key: 'categories:accessibility', label: 'Accessibility', budget: score(BUDGETS.accessibility), format: score },
  { key: 'categories:best-practices', label: 'Best Practices', budget: score(BUDGETS.bestPractices), format: score },
  { key: 'categories:seo', label: 'SEO', budget: score(BUDGETS.seo), format: score },
  { key: 'largest-contentful-paint', label: 'LCP', budget: `at most ${ms(BUDGETS.lcpMs)}`, format: ms, phoneOnly: true },
  { key: 'cumulative-layout-shift', label: 'CLS', budget: `at most ${BUDGETS.cls}`, format: shift },
  { key: 'total-blocking-time', label: 'TBT (for INP)', budget: `at most ${ms(BUDGETS.tbtMs)}`, format: ms },
];

/** The columns that apply to a form factor. */
export function columnsFor(formFactor) {
  return COLUMNS.filter((column) => !column.phoneOnly || formFactor === 'mobile');
}

/** --form-factor and --theme, each a name or `all`. */
export function parseArgs(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? 'all' : argv[i + 1];
  };
  const pick = (flag, all) => {
    const chosen = value(flag);
    if (chosen === 'all') return [...all];
    if (!all.includes(chosen)) throw new Error(`${flag} must be one of: ${[...all, 'all'].join(', ')}.`);
    return [chosen];
  };
  return { formFactors: pick('--form-factor', FORM_FACTORS), themes: pick('--theme', THEMES) };
}

/** The assertion key of a Lighthouse CI result: `categories:<id>` for a category, else the audit id. */
export function resultKey(result) {
  return result.auditId === 'categories' ? `categories:${result.auditProperty}` : result.auditId;
}

/** A URL's path, as the table names pages. */
export function routeOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url);
  }
}

/** The first line of an error's message, as a one-line reason. */
function reasonOf(error) {
  return String(error?.message ?? error).split('\n')[0].trim();
}

/** A theme name as the summary prints it: Blueprint, Whiteprint, another value in quotes, or "no theme". */
function paintedName(painted) {
  if (typeof painted === 'string' && Object.hasOwn(THEME_NAMES, painted)) return THEME_NAMES[painted];
  return painted ? `"${painted}"` : 'no theme';
}

// ------------------------------------------------------------------------------------------------
// The theme check before collect
// ------------------------------------------------------------------------------------------------

/** The screen each form factor's runs emulate (Lighthouse 13.6.0's phone default and desktop preset). */
export const PROOF_SCREENS = Object.freeze({
  mobile: Object.freeze({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true }),
  desktop: Object.freeze({ viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }),
});

/** How long the theme check waits for one page to load. */
const PROOF_PAGE_TIMEOUT_MS = 60_000;

/** The theme check's result when it has not run. */
const NOT_RUN = Object.freeze({ ran: false, reason: 'not run' });

/**
 * Stops a server process and the processes it started. On Windows, taskkill ends the whole tree (a
 * kill of node alone would leave next start running); elsewhere, SIGTERM reaches
 * scripts/lighthouse-server.mjs, which stops next start before it exits.
 */
async function stopProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
  const late = await Promise.race([exited.then(() => false), wait(10_000, true, { ref: false })]);
  if (late) {
    child.kill('SIGKILL');
    await exited;
  }
}

/**
 * Starts a Lighthouse CI server command (`node <script> <args>`, as collect.startServerCommand holds
 * it) as Lighthouse CI does, and resolves to { stop } once its output matches the ready pattern.
 */
export function startServer(command, { env, readyPattern, timeoutMs }) {
  const [program, ...args] = command.trim().split(/\s+/);
  if (program !== 'node') return Promise.reject(new Error(`the server command does not start with node: ${command}`));
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = () => stopProcessTree(child);
  const ready = new RegExp(readyPattern);
  let output = '';
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (finish) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    // Settled before the server is stopped, so the stop does not read as the server failing.
    const timer = setTimeout(() => {
      settle(() => stop().then(() => reject(new Error(`no "${readyPattern}" within ${timeoutMs / 1000} s`))));
    }, timeoutMs);
    const read = (chunk) => {
      output = `${output}${chunk}`.slice(-4000);
      if (ready.test(output)) settle(() => resolve({ stop }));
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (error) => settle(() => reject(error)));
    // `close`, not `exit`: it comes once the server's output is all read, so its last line is here.
    child.on('close', (code) => {
      const last = output.trim().split('\n').at(-1) ?? '';
      settle(() => reject(new Error(`it stopped (exit ${code}) before it was ready${last ? `: ${last}` : ''}`)));
    });
  });
}

/** Google Chrome through @playwright/test, as the repository's other browser scripts start it. */
async function launchChrome() {
  const { chromium } = await import('@playwright/test');
  return chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
}

/**
 * The theme check before collect. It serves the build with Lighthouse CI's own server command (on a
 * port of its own, so the server Lighthouse CI starts next begins clean), loads every page Lighthouse
 * CI will measure in Chrome, each in a fresh browser context at the run's screen size, and reads
 * <html data-theme> once the page has loaded: the attribute the head script of lib/theme.ts sets
 * from the theme cookie before the first paint, and every theme rule of the style sheets keys on.
 * Returns { ran: true, pages: [{ route, status, painted }] } (a page that could not load also has
 * `error`), or { ran: false, reason } when the server or Chrome could not start. The tests pass
 * stand-ins for `start` and `launch`.
 */
export async function proveTheme({ formFactor, theme, env = process.env, start = startServer, launch = launchChrome }) {
  let collect;
  try {
    const port = await freePort();
    collect = lighthouseConfig({ ...env, LHCI_FORM_FACTOR: formFactor, LHCI_THEME: theme, LHCI_PORT: String(port) }, ROOT).ci.collect;
  } catch (error) {
    return { ran: false, reason: `no configuration for it (${reasonOf(error)})` };
  }
  let server;
  try {
    server = await start(collect.startServerCommand, {
      env,
      readyPattern: collect.startServerReadyPattern,
      timeoutMs: collect.startServerReadyTimeout,
    });
  } catch (error) {
    return { ran: false, reason: `the server did not start: ${reasonOf(error)}` };
  }
  let browser = null;
  try {
    try {
      browser = await launch();
    } catch (error) {
      return { ran: false, reason: `Chrome did not start: ${reasonOf(error)}` };
    }
    const pages = [];
    for (const url of collect.url) {
      const route = routeOf(url);
      let context = null;
      try {
        context = await browser.newContext({ ...PROOF_SCREENS[formFactor] });
        const page = await context.newPage();
        const response = await page.goto(url, { waitUntil: 'load', timeout: PROOF_PAGE_TIMEOUT_MS });
        const painted = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        pages.push({ route, status: response ? response.status() : 0, painted });
      } catch (error) {
        pages.push({ route, status: 0, painted: null, error: reasonOf(error) });
      } finally {
        if (context) await context.close().catch(() => {});
      }
    }
    return { ran: true, pages };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await server.stop();
  }
}

/**
 * One page's verdict from the theme check: `proven` when Chrome painted the theme, `wrong` when the
 * page loaded and painted anything else (the other theme, or none), and `unproven` when the check did
 * not run or could not load the page.
 */
export function proofVerdict(page, expected) {
  if (!page || page.error) return 'unproven';
  return page.painted === expected ? 'proven' : 'wrong';
}

/** True when the theme check ran and a page painted anything but the theme: Lighthouse does not run then. */
export function proofFailed(proof, expected) {
  return proof.ran && proof.pages.some((page) => proofVerdict(page, expected) === 'wrong');
}

/** The theme check's paragraph in the summary. */
export function proofLine(proof, expected) {
  if (!proof.ran) {
    return `Theme check before collect: did not run (${proof.reason}). Each page's theme rests on the sky still its runs loaded.`;
  }
  const wrong = proof.pages.filter((page) => proofVerdict(page, expected) === 'wrong');
  if (wrong.length) {
    const found = wrong.map((page) => `${page.route} painted ${paintedName(page.painted)}`).join('; ');
    return `Theme check before collect: FAIL, so Lighthouse did not run. Expected ${THEME_NAMES[expected]}: ${found}.`;
  }
  const unproven = proof.pages.filter((page) => proofVerdict(page, expected) === 'unproven');
  const proven = proof.pages.length - unproven.length;
  const text = [
    `Theme check before collect: ${proven} of ${proof.pages.length} pages painted ${THEME_NAMES[expected]} in Chrome (\`<html data-theme="${expected}">\`), each in a fresh browser context, through the server Lighthouse measures.`,
  ];
  if (unproven.length) text.push(`Chrome could not load ${unproven.map((page) => `${page.route} (${page.error})`).join(', ')}.`);
  return text.join(' ');
}

// ------------------------------------------------------------------------------------------------
// The theme each run measured
// ------------------------------------------------------------------------------------------------

/**
 * The theme a run painted, from the sky still image it loaded: `blueprint` or `whiteprint`, `both`
 * when it loaded one of each (wrong in any run), or null when it loaded none (the sky is off).
 */
export function themeOfRun(lhr) {
  const items = lhr?.audits?.['network-requests']?.details?.items ?? [];
  const urls = items.map((item) => String(item.url ?? ''));
  const blueprint = urls.some((url) => /\/sky\/still\/blueprint-/.test(url));
  const whiteprint = urls.some((url) => /\/sky\/still\/whiteprint-/.test(url));
  if (blueprint && whiteprint) return 'both';
  if (blueprint) return 'blueprint';
  if (whiteprint) return 'whiteprint';
  return null;
}

/** Per page: how many runs showed the expected theme, how many another, how many could not tell. */
export function themeChecks(lhrs, expected) {
  const byRoute = new Map();
  for (const lhr of lhrs) {
    const route = routeOf(lhr.requestedUrl);
    const entry = byRoute.get(route) ?? { route, runs: 0, matched: 0, wrong: 0, unknown: 0 };
    const seen = themeOfRun(lhr);
    entry.runs += 1;
    if (seen === expected) entry.matched += 1;
    else if (seen === null) entry.unknown += 1;
    else entry.wrong += 1;
    byRoute.set(route, entry);
  }
  return byRoute;
}

/**
 * Each page's theme from both checks, as route -> { ok, text }: the theme check before collect
 * (`proof`) and the sky still each run loaded (`checks`). A page passes when Chrome painted its
 * theme or a run loaded its theme's still, and no run loaded the other theme's still. A page whose
 * runs loaded no still passes only on the theme check, so turning the sky off cannot hide a wrong
 * theme.
 */
export function themeVerdicts(routes, checks, proof, expected) {
  const name = THEME_NAMES[expected];
  const runs = (count) => `${count} run${count === 1 ? '' : 's'}`;
  const proofPages = new Map(proof.ran ? proof.pages.map((page) => [page.route, page]) : []);
  const verdicts = new Map();
  for (const route of routes) {
    const page = proofPages.get(route);
    const verdict = proofVerdict(page, expected);
    const check = checks.get(route);
    let result;
    if (verdict === 'wrong') {
      result = { ok: false, text: `FAIL: Chrome painted ${paintedName(page.painted)}` };
    } else if (!check) {
      result = { ok: false, text: 'no runs' };
    } else if (check.wrong > 0) {
      result = { ok: false, text: `FAIL: ${check.wrong} of ${runs(check.runs)} loaded another theme's sky still` };
    } else {
      const still = check.matched === 0 ? `no sky still in ${runs(check.runs)}` : `sky still in ${check.matched} of ${runs(check.runs)}`;
      if (verdict === 'proven') result = { ok: true, text: `${name}: Chrome, ${still}` };
      else if (check.matched > 0) result = { ok: true, text: `${name}: ${still}` };
      else result = { ok: false, text: `FAIL: not proven (${proof.ran ? 'Chrome could not load it' : 'no Chrome check'}, ${still})` };
    }
    verdicts.set(route, result);
  }
  return verdicts;
}

// ------------------------------------------------------------------------------------------------
// The summary
// ------------------------------------------------------------------------------------------------

/**
 * One row per page, in the order of `routes`: each column's result (median value, budget, passed)
 * or null when Lighthouse CI reported nothing for it.
 */
export function assertionRows(results, routes, formFactor) {
  const columns = columnsFor(formFactor);
  return routes.map((route) => {
    const cells = {};
    for (const column of columns) {
      const result = results.find((r) => routeOf(r.url) === route && resultKey(r) === column.key);
      cells[column.key] = result ? { actual: result.actual, values: result.values, passed: Boolean(result.passed) } : null;
    }
    return { route, cells };
  });
}

function cellText(column, cell) {
  if (!cell) return 'no result';
  return `${column.format(cell.actual)} ${cell.passed ? 'pass' : 'FAIL'}`;
}

/** The Markdown summary of one form factor and theme, with whether every page's theme passed. */
export function summaryMarkdown({ formFactor, theme, rows, checks, proof = NOT_RUN, environment, lhciStatus, notes = [] }) {
  const columns = columnsFor(formFactor);
  const verdicts = themeVerdicts(
    rows.map((row) => row.route),
    checks,
    proof,
    theme,
  );
  const lines = [];
  lines.push(`### Lighthouse: ${FORM_FACTOR_NAMES[formFactor]}, ${THEME_NAMES[theme]}`, '');
  if (environment) lines.push(environment, '');
  lines.push(proofLine(proof, theme), '');
  const header = ['page', ...columns.map((c) => `${c.label} (${c.budget})`), 'theme'];
  lines.push(`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`);
  let passed = 0;
  let total = 0;
  const failures = [];
  for (const row of rows) {
    const cells = columns.map((column) => {
      const cell = row.cells[column.key];
      total += 1;
      if (cell?.passed) passed += 1;
      else failures.push(`${row.route} ${column.label}`);
      return cellText(column, cell);
    });
    lines.push(`| ${[row.route, ...cells, verdicts.get(row.route).text].join(' | ')} |`);
  }
  lines.push('');
  lines.push(`${passed} of ${total} assertions pass on the median of the runs.`);
  const themeFailures = rows.filter((row) => !verdicts.get(row.route).ok).map((row) => row.route);
  if (themeFailures.length) lines.push(`Pages whose theme is wrong or not proven: ${themeFailures.join(', ')}.`);
  for (const note of notes) lines.push(note);
  if (lhciStatus !== 0 && failures.length === 0 && themeFailures.length === 0) {
    lines.push(`Lighthouse CI exited with status ${lhciStatus}; its log above says why.`);
  }
  lines.push('');
  return { markdown: lines.join('\n'), passed, total, themeOk: themeFailures.length === 0 };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The test environment, from the runs: the Lighthouse and Chrome versions, and the lowest and highest
 * benchmark index of any run (Lighthouse's measure of the machine's speed: a busy machine scores
 * lower, and its timings run long).
 */
export function environmentLine(lhrs, runs) {
  const first = lhrs[0];
  const chrome = /(?:Headless)?Chrome\/([\d.]+)/.exec(first?.environment?.hostUserAgent ?? '')?.[1];
  const parts = [`Lighthouse ${first?.lighthouseVersion ?? 'unknown'}`];
  if (chrome) parts.push(`Chrome ${chrome}`);
  const indexes = lhrs
    .map((lhr) => lhr?.environment?.benchmarkIndex)
    .filter((index) => typeof index === 'number' && index > 0)
    .map(Math.round);
  if (indexes.length) {
    const [low, high] = [Math.min(...indexes), Math.max(...indexes)];
    parts.push(low === high ? `benchmark index ${low}` : `benchmark index ${low} to ${high}`);
  }
  parts.push(`${runs} run${runs === 1 ? '' : 's'} per page, medians`);
  return `${parts.join(', ')}. Budgets: ARCHITECTURE.md 9.`;
}

/**
 * Keeps the median run's HTML report for each page (it holds the whole result as JSON too) and
 * deletes every other report, and rewrites manifest.json to list what is kept, by file name. Returns
 * every run's result, read before deleting.
 */
export function readAndPruneReports(dir) {
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return [];
  const entries = readJson(manifestFile).map((entry) => ({
    ...entry,
    jsonPath: path.basename(entry.jsonPath),
    htmlPath: path.basename(entry.htmlPath),
  }));
  const lhrs = [];
  for (const name of new Set(entries.map((entry) => entry.jsonPath))) {
    if (fs.existsSync(path.join(dir, name))) lhrs.push(readJson(path.join(dir, name)));
  }
  const kept = entries.filter((entry) => entry.isRepresentativeRun).map(({ jsonPath, ...entry }) => entry);
  // Lighthouse CI names reports by page and second, and writes the median run last, so a name two
  // runs share holds the median run: never delete a file a kept entry names.
  const keep = new Set(kept.map((entry) => entry.htmlPath));
  for (const entry of entries) {
    for (const name of [entry.jsonPath, entry.htmlPath]) if (!keep.has(name)) fs.rmSync(path.join(dir, name), { force: true });
  }
  fs.writeFileSync(manifestFile, `${JSON.stringify(kept, null, 2)}\n`);
  return lhrs;
}

/**
 * The pages, of `urls`, that Lighthouse CI's saved results (.lighthouseci/lhr-*.json) hold fewer
 * than `runs` runs of. The saved runs of each such page are deleted, so collecting it again gives
 * exactly `runs` runs and no median is taken over a part of them. A saved result that cannot be read
 * counts as no run and is deleted too, since Lighthouse CI's assert would stop on it.
 */
export function incompletePages(urls, runs, dir = LHCI_DIR) {
  const saved = new Map();
  const remove = (name) => {
    fs.rmSync(path.join(dir, name), { force: true });
    fs.rmSync(path.join(dir, name.replace(/\.json$/, '.html')), { force: true });
  };
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!/^lhr-\d+(-\d+)?\.json$/.test(name)) continue;
      let url;
      try {
        url = readJson(path.join(dir, name)).requestedUrl;
      } catch {
        remove(name);
        continue;
      }
      saved.set(url, [...(saved.get(url) ?? []), name]);
    }
  }
  const incomplete = urls.filter((url) => (saved.get(url)?.length ?? 0) < runs);
  for (const url of incomplete) for (const name of saved.get(url) ?? []) remove(name);
  return incomplete;
}

/** How many more times a page Lighthouse could not finish every run of is collected. */
export const RECOLLECT_ATTEMPTS = 2;

/**
 * Collects the missing pages again, each in a collect of its own. Lighthouse CI stops a collect at
 * the first page whose run fails and skips the pages after it, so collecting them together would let
 * one page that keeps failing (NO_NAVSTART on a loaded machine) take every page after it down too.
 * `lhci` runs Lighthouse CI with the given arguments.
 */
export function collectAgain(urls, lhci) {
  for (const url of urls) lhci(['collect', '--additive', `--url=${url}`]);
}

/**
 * How to run npx with `args`, as [command, args, shell]. On Windows npx is a .cmd file, which only a
 * shell runs, and Node deprecates handing a shell a list (DEP0190: it joins the list unescaped), so
 * the shell gets one command line, made only of plain words this script wrote (no spaces, quotes, or
 * shell signs); anything else is refused.
 */
export function npxCommand(args, platform = process.platform) {
  if (platform !== 'win32') return ['npx', args, false];
  const unsafe = args.find((arg) => !/^[\w@./:=-]+$/.test(arg));
  if (unsafe !== undefined) throw new Error(`Not a plain word for the Windows shell: ${unsafe}`);
  return [['npx.cmd', ...args].join(' '), [], true];
}

/**
 * Runs one form factor and theme: Lighthouse CI's health check, the theme check, then collect, then
 * collect again, page by page, for any page whose runs did not all finish (Lighthouse CI tries each
 * run three times; on a busy machine Lighthouse can still lose the page load from its trace,
 * NO_NAVSTART), then assert and upload. Returns { ok, markdown }.
 */
async function runOne(formFactor, theme) {
  const env = { ...process.env, LHCI_FORM_FACTOR: formFactor, LHCI_THEME: theme };
  const config = lighthouseConfig(env, ROOT).ci;
  const runs = config.collect.numberOfRuns;
  const name = runName(formFactor, theme);
  const reportDir = path.join(ROOT, REPORTS_DIR, name);
  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.rmSync(path.join(LHCI_DIR, 'assertion-results.json'), { force: true });

  console.log(`\n=== Lighthouse CI: ${FORM_FACTOR_NAMES[formFactor]}, ${THEME_NAMES[theme]} (${config.collect.url.length} pages, ${runs} runs each) ===\n`);
  const lhci = (args) => {
    const [command, list, shell] = npxCommand(['--yes', LHCI_PACKAGE, ...args, '--config=lighthouserc.cjs']);
    return spawnSync(command, list, { cwd: ROOT, env, stdio: 'inherit', shell }).status ?? 1;
  };

  const notes = [];
  let proof = { ran: false, reason: 'the health check failed' };
  let lhciStatus = lhci(['healthcheck', '--fatal']);
  if (lhciStatus === 0) {
    console.log(`\nTheme check before collect: Chrome loads each page through the server Lighthouse CI will start.`);
    proof = await proveTheme({ formFactor, theme, env });
    for (const page of proof.ran ? proof.pages : []) {
      console.log(`  ${page.route}: ${page.error ? `could not load (${page.error})` : `HTTP ${page.status}, data-theme ${page.painted ?? 'missing'}`}`);
    }
    console.log(`${proofLine(proof, theme)}\n`);
  }
  if (lhciStatus === 0 && !proofFailed(proof, theme)) {
    lhci(['collect']);
    for (let attempt = 1; attempt <= RECOLLECT_ATTEMPTS; attempt += 1) {
      const missing = incompletePages(config.collect.url, runs);
      if (missing.length === 0) break;
      notes.push(`Collected again (${attempt} of ${RECOLLECT_ATTEMPTS}), page by page, as Lighthouse could not finish every run: ${missing.map(routeOf).join(', ')}.`);
      console.log(`\nLighthouse CI: ${notes.at(-1)}\n`);
      collectAgain(missing, lhci);
    }
    const unfinished = incompletePages(config.collect.url, runs);
    if (unfinished.length) notes.push(`No complete set of runs, so no result: ${unfinished.map(routeOf).join(', ')}.`);
    lhciStatus = lhci(['assert']);
    if (lhci(['upload']) !== 0) notes.push('Lighthouse CI could not write the reports.');
  }

  const resultsFile = path.join(LHCI_DIR, 'assertion-results.json');
  const results = fs.existsSync(resultsFile) ? readJson(resultsFile) : [];
  fs.mkdirSync(reportDir, { recursive: true });
  if (fs.existsSync(resultsFile)) fs.copyFileSync(resultsFile, path.join(reportDir, 'assertion-results.json'));

  const lhrs = readAndPruneReports(reportDir);
  const routes = config.collect.url.map(routeOf);
  const rows = assertionRows(results, routes, formFactor);
  const checks = themeChecks(lhrs, theme);
  const { markdown, passed, total, themeOk } = summaryMarkdown({
    formFactor,
    theme,
    rows,
    checks,
    proof,
    environment: lhrs.length ? environmentLine(lhrs, runs) : '',
    lhciStatus,
    notes,
  });
  fs.writeFileSync(path.join(reportDir, 'summary.md'), markdown);
  console.log(`\n${markdown}`);

  const ok = lhciStatus === 0 && passed === total && total > 0 && themeOk && !proofFailed(proof, theme);
  return { ok, markdown };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const dist = path.join(ROOT, process.env.NEXT_DIST_DIR || '.next');
  if (!fs.existsSync(path.join(dist, 'BUILD_ID'))) {
    console.error(`No production build in ${path.relative(ROOT, dist)}. Run npm run build first (with the same NEXT_DIST_DIR).`);
    process.exit(1);
  }
  const outcomes = [];
  for (const formFactor of args.formFactors) {
    for (const theme of args.themes) outcomes.push({ formFactor, theme, ...(await runOne(formFactor, theme)) });
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, outcomes.map((outcome) => outcome.markdown).join('\n'));
  }
  const failed = outcomes.filter((outcome) => !outcome.ok);
  console.log(
    failed.length
      ? `\nLighthouse budgets not met: ${failed.map((o) => `${FORM_FACTOR_NAMES[o.formFactor]}, ${THEME_NAMES[o.theme]}`).join('; ')}. Reports: ${REPORTS_DIR}/.`
      : `\nEvery Lighthouse budget is met. Reports: ${REPORTS_DIR}/.`,
  );
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
