/**
 * The Lighthouse CI configuration for the budgets of ARCHITECTURE.md 9 (docs/V3_PLAN.md D-71,
 * D-80), built from the environment. lighthouserc.cjs exports what lighthouseConfig() returns, and
 * scripts/lighthouse-ci.mjs runs it once for each form factor and theme.
 *
 * What it measures: a production build served by `next start` (through scripts/lighthouse-server.mjs),
 * at every public route of ARCHITECTURE.md 5: /, /projects, every visible project page (read from
 * content/ by the site's own rule: `visible` true, in `order`), /about, /experience, /log, /contact.
 * Each run starts in a fresh browser (Lighthouse CI's standard way).
 *
 *   LHCI_FORM_FACTOR  `mobile`: Lighthouse's default settings (a 412 by 823 px phone screen, slow 4G,
 *                     the CPU slowed 4 times); or `desktop`: Lighthouse's desktop preset.
 *   LHCI_THEME        `blueprint` or `whiteprint`. The site's default theme (content/site.json
 *                     settings.themeDefault, read as lib/theme.ts reads it) is measured as a first
 *                     visit, with no theme cookie; the other theme with the `theme` cookie a visitor's
 *                     choice sets, which scripts/lighthouse-server.mjs adds to every page it serves.
 *   LHCI_PORT         the port Lighthouse loads the site on (default 3000).
 *   LHCI_RUNS         Lighthouse runs per page (default 3). Every assertion reads their median.
 *   NEXT_DIST_DIR     the build folder, as next.config.mjs reads it (default .next).
 *   SITE_CONTENT_DIR  the content folder, as lib/content.ts reads it (default content/).
 *
 * The assertions, all at level error, on the median of the runs (ARCHITECTURE.md 9):
 * - Performance at least 0.95, Accessibility 1, Best Practices 1, SEO 1, on phone and desktop;
 * - Largest Contentful Paint at most 2,000 ms, on the phone only, where the budget states it;
 * - Cumulative Layout Shift at most 0.02;
 * - Total Blocking Time at most 150 ms, standing in for Interaction to Next Paint, which needs a real
 *   interaction and cannot be measured in a lab run. TBT is the lab metric for the main-thread work
 *   that delays a response to input, and 150 ms is the INP budget's own number: on the phone profile
 *   it sits a quarter under the 200 ms that web.dev and Lighthouse's mobile scoring call good for
 *   TBT, as the 150 ms INP budget sits a quarter under INP's 200 ms good line; on desktop it is
 *   Lighthouse's own good line for TBT.
 *
 * One path is blocked: /_vercel/, where Web Analytics loads its script. Vercel serves that path on
 * every deployment; `next start` cannot, so without the block every page would log a 404 that the
 * live site never shows, and Best Practices could never reach 100 here. Lighthouse leaves requests it
 * blocks out of its console-error audit. The analytics script is a deferred few kilobytes.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const FORM_FACTORS = ['mobile', 'desktop'];
const THEMES = ['blueprint', 'whiteprint'];

/** The cookie lib/theme.ts keeps the visitor's theme in (THEME_COOKIE there). */
const THEME_COOKIE = 'theme';

/** The public routes of ARCHITECTURE.md 5 besides the project pages. */
const STATIC_ROUTES = ['/', '/projects', '/about', '/experience', '/log', '/contact'];

/** ARCHITECTURE.md 9, in the units Lighthouse reports. */
const BUDGETS = Object.freeze({
  performance: 0.95,
  accessibility: 1,
  bestPractices: 1,
  seo: 1,
  /** Largest Contentful Paint on the phone, ms ("under 2.0 s"). */
  lcpMs: 2000,
  /** Cumulative Layout Shift ("under 0.02"). */
  cls: 0.02,
  /** Total Blocking Time, ms: the lab stand-in for the 150 ms Interaction to Next Paint budget. */
  tbtMs: 150,
});

/** Requests Lighthouse blocks: paths only Vercel serves (see above). */
const BLOCKED_URL_PATTERNS = Object.freeze(['*/_vercel/*']);

/** Where `lhci autorun` writes its reports, inside .lighthouseci/ (git ignores it). */
const REPORTS_DIR = '.lighthouseci/reports';

function choose(name, value, allowed, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);
  return value;
}

function wholeNumber(name, value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

/** The content folder, as lib/content.ts finds it. */
function contentDir(env = process.env, root = ROOT) {
  return env.SITE_CONTENT_DIR ? path.resolve(env.SITE_CONTENT_DIR) : path.join(root, 'content');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The public routes, in the site's order: the static pages, then each visible project in `order`
 * (files read in name order, then sorted by `order`, as lib/lint.ts validateContent sorts them).
 */
function publicRoutes(dir = contentDir()) {
  const projectsDir = path.join(dir, 'projects');
  const projects = fs
    .readdirSync(projectsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson(path.join(projectsDir, name)))
    .filter((project) => project && project.visible === true && typeof project.slug === 'string' && project.slug !== '')
    .sort((a, b) => a.order - b.order);
  return [...STATIC_ROUTES, ...projects.map((project) => `/projects/${project.slug}`)];
}

/** The theme a first visit sees: content/site.json settings.themeDefault, as lib/theme.ts reads it. */
function siteDefaultTheme(dir = contentDir()) {
  const site = readJson(path.join(dir, 'site.json'));
  return site && site.settings && site.settings.themeDefault === 'light' ? 'whiteprint' : 'blueprint';
}

/**
 * The theme of this run, and the cookie the browser needs for it: none for the site's default theme
 * (a first visit), else the theme's name, as the theme toggle stores it.
 */
function lighthouseTheme(env = process.env, root = ROOT) {
  const theme = choose('LHCI_THEME', env.LHCI_THEME, THEMES, 'blueprint');
  const cookie = theme === siteDefaultTheme(contentDir(env, root)) ? null : theme;
  return { theme, cookie };
}

/** The assertions of ARCHITECTURE.md 9 for one form factor, each on the median of the runs. */
function budgetAssertions(formFactor) {
  const median = (options) => ['error', { ...options, aggregationMethod: 'median' }];
  return {
    'categories:performance': median({ minScore: BUDGETS.performance }),
    'categories:accessibility': median({ minScore: BUDGETS.accessibility }),
    'categories:best-practices': median({ minScore: BUDGETS.bestPractices }),
    'categories:seo': median({ minScore: BUDGETS.seo }),
    ...(formFactor === 'mobile' ? { 'largest-contentful-paint': median({ maxNumericValue: BUDGETS.lcpMs }) } : {}),
    'cumulative-layout-shift': median({ maxNumericValue: BUDGETS.cls }),
    'total-blocking-time': median({ maxNumericValue: BUDGETS.tbtMs }),
  };
}

/** The name of one form factor and theme, as the report folders and CI artifacts use it. */
function runName(formFactor, theme) {
  return `${formFactor}-${theme}`;
}

/** The whole Lighthouse CI configuration for the form factor and theme the environment names. */
function lighthouseConfig(env = process.env, root = ROOT) {
  const formFactor = choose('LHCI_FORM_FACTOR', env.LHCI_FORM_FACTOR, FORM_FACTORS, 'mobile');
  const { theme, cookie } = lighthouseTheme(env, root);
  const port = wholeNumber('LHCI_PORT', env.LHCI_PORT, 3000, 1024, 65535);
  const runs = wholeNumber('LHCI_RUNS', env.LHCI_RUNS, 3, 1, 9);
  const base = `http://localhost:${port}`;
  return {
    ci: {
      collect: {
        url: publicRoutes(contentDir(env, root)).map((route) => `${base}${route}`),
        // node itself, not npm: Lighthouse CI stops the server by killing the process tree.
        startServerCommand: `node scripts/lighthouse-server.mjs --port ${port}${cookie ? ` --cookie ${cookie}` : ''}`,
        startServerReadyPattern: 'Ready in',
        startServerReadyTimeout: 60000,
        numberOfRuns: runs,
        settings: {
          ...(formFactor === 'desktop' ? { preset: 'desktop' } : {}),
          blockedUrlPatterns: [...BLOCKED_URL_PATTERNS],
        },
      },
      assert: {
        includePassedAssertions: true,
        assertions: budgetAssertions(formFactor),
      },
      upload: {
        target: 'filesystem',
        outputDir: `${REPORTS_DIR}/${runName(formFactor, theme)}`,
      },
    },
  };
}

module.exports = {
  BLOCKED_URL_PATTERNS,
  BUDGETS,
  FORM_FACTORS,
  REPORTS_DIR,
  STATIC_ROUTES,
  THEMES,
  THEME_COOKIE,
  budgetAssertions,
  contentDir,
  lighthouseConfig,
  lighthouseTheme,
  publicRoutes,
  runName,
  siteDefaultTheme,
};
