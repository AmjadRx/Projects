#!/usr/bin/env node
/**
 * Lighthouse CI for the budgets of ARCHITECTURE.md 9 (`npm run lighthouse`), on a production build:
 * run `npm run build` first. Lighthouse CI comes through npx, pinned (LHCI_PACKAGE below, which pins
 * Lighthouse 13.6.0), and needs Google Chrome.
 *
 * Usage: node scripts/lighthouse-ci.mjs [--form-factor mobile|desktop|all] [--theme blueprint|whiteprint|all]
 * (both default to all; LHCI_PORT, LHCI_RUNS, and NEXT_DIST_DIR pass through to lighthouserc.cjs).
 *
 * For each form factor and theme it runs Lighthouse CI's steps (healthcheck, collect, assert, upload;
 * lighthouserc.cjs, built in scripts/lighthouse-config.cjs): collect serves the build (`next start`
 * through scripts/lighthouse-server.mjs) and runs Lighthouse on every public page in a fresh browser
 * each time; a page whose runs did not all finish is collected again, up to RECOLLECT_ATTEMPTS times;
 * assert checks the budgets on the median of the runs; upload writes the reports to
 * .lighthouseci/reports/<form factor>-<theme>/. Then it:
 * - checks that every run measured its theme, from the sky still image the run loaded (blueprint-*
 *   or whiteprint-*); a run that loaded the other theme's still fails;
 * - keeps the median run's HTML report for each page, with manifest.json, assertion-results.json
 *   (every assertion with every run's value), and summary.md (every assertion's result for every
 *   page), and deletes the other reports;
 * - adds the summary to the GitHub Actions job summary when it runs there.
 * It exits 1 when an assertion or a theme check fails, or when Lighthouse CI could not run.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

function themeText(check, expected) {
  if (!check) return 'no runs';
  const name = THEME_NAMES[expected];
  if (check.wrong > 0) return `FAIL: ${check.wrong} of ${check.runs} runs showed another theme`;
  if (check.unknown > 0) return `${name} in ${check.matched} of ${check.runs} runs, ${check.unknown} without a sky still`;
  return `${name}, ${check.matched} of ${check.runs} runs`;
}

/** The Markdown summary of one form factor and theme. */
export function summaryMarkdown({ formFactor, theme, rows, checks, environment, lhciStatus, notes = [] }) {
  const columns = columnsFor(formFactor);
  const lines = [];
  lines.push(`### Lighthouse: ${FORM_FACTOR_NAMES[formFactor]}, ${THEME_NAMES[theme]}`, '');
  if (environment) lines.push(environment, '');
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
    lines.push(`| ${[row.route, ...cells, themeText(checks.get(row.route), theme)].join(' | ')} |`);
  }
  lines.push('');
  lines.push(`${passed} of ${total} assertions pass on the median of the runs.`);
  const wrongTheme = [...checks.values()].filter((check) => check.wrong > 0).map((check) => check.route);
  if (wrongTheme.length) lines.push(`Runs that measured the wrong theme: ${wrongTheme.join(', ')}.`);
  for (const note of notes) lines.push(note);
  if (lhciStatus !== 0 && failures.length === 0 && !wrongTheme.length) {
    lines.push(`Lighthouse CI exited with status ${lhciStatus}; its log above says why.`);
  }
  lines.push('');
  return { markdown: lines.join('\n'), passed, total };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The test environment, from one report: Lighthouse and Chrome versions and the machine's speed. */
function environmentLine(lhr, runs) {
  const chrome = /(?:Headless)?Chrome\/([\d.]+)/.exec(lhr?.environment?.hostUserAgent ?? '')?.[1];
  const parts = [`Lighthouse ${lhr?.lighthouseVersion ?? 'unknown'}`];
  if (chrome) parts.push(`Chrome ${chrome}`);
  if (lhr?.environment?.benchmarkIndex) parts.push(`benchmark index ${Math.round(lhr.environment.benchmarkIndex)}`);
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
 * Runs one form factor and theme: Lighthouse CI's health check, then collect, then collect again
 * for any page whose runs did not all finish (Lighthouse CI tries each run three times; under heavy
 * load Lighthouse can still lose the page load from its trace, NO_NAVSTART), then assert and upload.
 * Returns { ok, markdown }.
 */
function runOne(formFactor, theme) {
  const env = { ...process.env, LHCI_FORM_FACTOR: formFactor, LHCI_THEME: theme };
  const config = lighthouseConfig(env, ROOT).ci;
  const runs = config.collect.numberOfRuns;
  const name = runName(formFactor, theme);
  const reportDir = path.join(ROOT, REPORTS_DIR, name);
  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.rmSync(path.join(LHCI_DIR, 'assertion-results.json'), { force: true });

  console.log(`\n=== Lighthouse CI: ${FORM_FACTOR_NAMES[formFactor]}, ${THEME_NAMES[theme]} (${config.collect.url.length} pages, ${runs} runs each) ===\n`);
  const windows = process.platform === 'win32';
  const lhci = (args) =>
    spawnSync(windows ? 'npx.cmd' : 'npx', ['--yes', LHCI_PACKAGE, ...args, '--config=lighthouserc.cjs'], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
      shell: windows,
    }).status ?? 1;

  const notes = [];
  let lhciStatus = lhci(['healthcheck', '--fatal']);
  if (lhciStatus === 0) {
    lhci(['collect']);
    for (let attempt = 1; attempt <= RECOLLECT_ATTEMPTS; attempt += 1) {
      const missing = incompletePages(config.collect.url, runs);
      if (missing.length === 0) break;
      notes.push(`Collected again (${attempt} of ${RECOLLECT_ATTEMPTS}), as Lighthouse could not finish every run: ${missing.map(routeOf).join(', ')}.`);
      console.log(`\nLighthouse CI: ${notes.at(-1)}\n`);
      lhci(['collect', '--additive', ...missing.map((url) => `--url=${url}`)]);
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
  const { markdown, passed, total } = summaryMarkdown({
    formFactor,
    theme,
    rows,
    checks,
    environment: lhrs.length ? environmentLine(lhrs[0], runs) : '',
    lhciStatus,
    notes,
  });
  fs.writeFileSync(path.join(reportDir, 'summary.md'), markdown);
  console.log(`\n${markdown}`);

  const wrongTheme = [...checks.values()].some((check) => check.wrong > 0);
  const missing = routes.some((route) => !checks.has(route));
  const ok = lhciStatus === 0 && passed === total && total > 0 && !wrongTheme && !missing;
  return { ok, markdown };
}

function main() {
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
    for (const theme of args.themes) outcomes.push({ formFactor, theme, ...runOne(formFactor, theme) });
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
