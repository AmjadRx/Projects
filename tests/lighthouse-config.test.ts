/**
 * Lighthouse CI's configuration (scripts/lighthouse-config.cjs, exported by lighthouserc.cjs): it
 * measures every public page the site publishes and no other, asserts exactly the budgets of
 * ARCHITECTURE.md 9, uses Lighthouse's own phone settings and desktop preset, and gives each theme
 * the way a visitor gets it.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sitemap from '../app/sitemap';
import { loadPublicProjects } from '../lib/content';
import { THEME_COOKIE, themeFromSetting } from '../lib/theme';

type Env = Record<string, string | undefined>;
type Assertion = [string, Record<string, number | string>];

interface LhciConfig {
  ci: {
    collect: {
      url: string[];
      startServerCommand: string;
      startServerReadyPattern: string;
      numberOfRuns: number;
      settings: Record<string, unknown>;
    };
    assert: { includePassedAssertions: boolean; assertions: Record<string, Assertion> };
    upload: { target: string; outputDir: string };
  };
}

interface ConfigModule {
  BLOCKED_URL_PATTERNS: readonly string[];
  REPORTS_DIR: string;
  STATIC_ROUTES: string[];
  THEME_COOKIE: string;
  lighthouseConfig(env: Env, root?: string): LhciConfig;
  lighthouseTheme(env: Env, root?: string): { theme: string; cookie: string | null };
  publicRoutes(dir?: string): string[];
  siteDefaultTheme(dir?: string): string;
}

const require = createRequire(import.meta.url);
const config = require('../scripts/lighthouse-config.cjs') as ConfigModule;
const root = path.resolve(__dirname, '..');

const median = (options: Record<string, number>): Assertion => ['error', { ...options, aggregationMethod: 'median' }];

/** ARCHITECTURE.md 9, written out here on its own so a change to the configuration shows. */
const PHONE_BUDGETS = {
  'categories:performance': median({ minScore: 0.95 }),
  'categories:accessibility': median({ minScore: 1 }),
  'categories:best-practices': median({ minScore: 1 }),
  'categories:seo': median({ minScore: 1 }),
  'largest-contentful-paint': median({ maxNumericValue: 2000 }),
  'cumulative-layout-shift': median({ maxNumericValue: 0.02 }),
  'total-blocking-time': median({ maxNumericValue: 150 }),
};

let tmp = '';

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

/** A copy of content/ to change, as an owner would in the admin. */
function contentCopy(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-content-'));
  const dir = path.join(tmp, 'content');
  fs.cpSync(path.join(root, 'content'), dir, { recursive: true });
  return dir;
}

function editJson(file: string, edit: (data: any) => void): void {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

describe('the pages Lighthouse CI measures', () => {
  it('are the static pages, then every visible project in the site\'s own order', () => {
    const { url } = config.lighthouseConfig({ LHCI_PORT: '3123' }, root).ci.collect;
    const projects = loadPublicProjects().map((project) => `/projects/${project.slug}`);
    expect(projects.length).toBeGreaterThan(0);
    expect(url).toEqual(['/', '/projects', '/about', '/experience', '/log', '/contact', ...projects].map((r) => `http://localhost:3123${r}`));
  });

  it('are exactly the pages the sitemap publishes', () => {
    const published = sitemap().map((entry) => new URL(entry.url).pathname.replace(/^$/, '/'));
    expect([...config.publicRoutes()].sort()).toEqual([...new Set(published)].sort());
  });

  it('leave out a project the owner hides, from the content folder the build reads', () => {
    const dir = contentCopy();
    editJson(path.join(dir, 'projects', 'raven.json'), (project) => {
      project.visible = false;
    });
    const routes = config.publicRoutes(dir);
    expect(routes).not.toContain('/projects/raven');
    expect(routes).toContain('/projects/moonlamp');
    const { url } = config.lighthouseConfig({ SITE_CONTENT_DIR: dir }, root).ci.collect;
    expect(url).not.toContain('http://localhost:3000/projects/raven');
    expect(url).toHaveLength(routes.length);
  });

  it('follow a project\'s order when the owner reorders', () => {
    const dir = contentCopy();
    const last = config.publicRoutes(dir).at(-1)!.replace('/projects/', '');
    editJson(path.join(dir, 'projects', `${last}.json`), (project) => {
      project.order = -1;
    });
    expect(config.publicRoutes(dir)[config.STATIC_ROUTES.length]).toBe(`/projects/${last}`);
  });
});

describe('the budgets Lighthouse CI asserts', () => {
  it('are exactly ARCHITECTURE.md 9 on the phone, every one an error on the median of the runs', () => {
    const { assert } = config.lighthouseConfig({ LHCI_FORM_FACTOR: 'mobile' }, root).ci;
    expect(assert.assertions).toEqual(PHONE_BUDGETS);
    expect(assert.includePassedAssertions).toBe(true);
  });

  it('are the same on desktop but Largest Contentful Paint, which the budget states for the phone', () => {
    const { assertions } = config.lighthouseConfig({ LHCI_FORM_FACTOR: 'desktop' }, root).ci.assert;
    const { 'largest-contentful-paint': lcp, ...rest } = PHONE_BUDGETS;
    expect(lcp).toBeDefined();
    expect(assertions).toEqual(rest);
  });

  it('do not depend on the theme', () => {
    for (const formFactor of ['mobile', 'desktop']) {
      const blueprint = config.lighthouseConfig({ LHCI_FORM_FACTOR: formFactor, LHCI_THEME: 'blueprint' }, root).ci.assert;
      const whiteprint = config.lighthouseConfig({ LHCI_FORM_FACTOR: formFactor, LHCI_THEME: 'whiteprint' }, root).ci.assert;
      expect(whiteprint).toEqual(blueprint);
    }
  });
});

describe('how Lighthouse runs', () => {
  it('keeps Lighthouse\'s own phone settings and uses its desktop preset on desktop', () => {
    const phone = config.lighthouseConfig({ LHCI_FORM_FACTOR: 'mobile' }, root).ci.collect.settings;
    const desktop = config.lighthouseConfig({ LHCI_FORM_FACTOR: 'desktop' }, root).ci.collect.settings;
    expect(phone).toEqual({ blockedUrlPatterns: ['*/_vercel/*'] });
    expect(desktop).toEqual({ preset: 'desktop', blockedUrlPatterns: ['*/_vercel/*'] });
  });

  it('blocks only the path Vercel serves for itself, never a page or a file of the site', () => {
    expect(config.BLOCKED_URL_PATTERNS).toEqual(['*/_vercel/*']);
    for (const route of config.publicRoutes()) expect(route.startsWith('/_vercel/')).toBe(false);
    expect(fs.existsSync(path.join(root, 'public', '_vercel'))).toBe(false);
  });

  it('serves the build on the chosen port, the theme cookie only for the other theme, three runs a page', () => {
    const { collect } = config.lighthouseConfig({ LHCI_PORT: '3701' }, root).ci;
    expect(collect.startServerCommand).toBe('node scripts/lighthouse-server.mjs --port 3701');
    const whiteprint = config.lighthouseConfig({ LHCI_PORT: '3701', LHCI_THEME: 'whiteprint' }, root).ci.collect;
    expect(whiteprint.startServerCommand).toBe('node scripts/lighthouse-server.mjs --port 3701 --cookie whiteprint');
    expect(fs.existsSync(path.join(root, 'scripts', 'lighthouse-server.mjs'))).toBe(true);
    expect(collect.startServerReadyPattern).toBe('Ready in');
    expect(collect.numberOfRuns).toBe(3);
    expect(config.lighthouseConfig({ LHCI_RUNS: '5' }, root).ci.collect.numberOfRuns).toBe(5);
  });

  it('starts every run in a fresh browser: no puppeteer script, which would share one browser', () => {
    const { collect } = config.lighthouseConfig({ LHCI_THEME: 'whiteprint' }, root).ci;
    expect(Object.keys(collect).sort()).toEqual(
      ['numberOfRuns', 'settings', 'startServerCommand', 'startServerReadyPattern', 'startServerReadyTimeout', 'url'].sort(),
    );
  });

  it('defaults to the phone, Blueprint, port 3000, and refuses values it does not know', () => {
    const { collect, upload } = config.lighthouseConfig({}, root).ci;
    expect(collect.url[0]).toBe('http://localhost:3000/');
    expect(upload.outputDir).toBe('.lighthouseci/reports/mobile-blueprint');
    expect(() => config.lighthouseConfig({ LHCI_FORM_FACTOR: 'tablet' }, root)).toThrow(/LHCI_FORM_FACTOR/);
    expect(() => config.lighthouseConfig({ LHCI_THEME: 'dark' }, root)).toThrow(/LHCI_THEME/);
    expect(() => config.lighthouseConfig({ LHCI_PORT: '80' }, root)).toThrow(/LHCI_PORT/);
    expect(() => config.lighthouseConfig({ LHCI_RUNS: '0' }, root)).toThrow(/LHCI_RUNS/);
    expect(() => config.lighthouseConfig({ LHCI_RUNS: '2.5' }, root)).toThrow(/LHCI_RUNS/);
  });

  it('writes each form factor and theme to its own report folder, which git ignores', () => {
    const folders = new Set<string>();
    for (const formFactor of ['mobile', 'desktop']) {
      for (const theme of ['blueprint', 'whiteprint']) {
        const { upload } = config.lighthouseConfig({ LHCI_FORM_FACTOR: formFactor, LHCI_THEME: theme }, root).ci;
        expect(upload.target).toBe('filesystem');
        folders.add(upload.outputDir);
      }
    }
    expect(folders.size).toBe(4);
    expect(config.REPORTS_DIR.startsWith('.lighthouseci/')).toBe(true);
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/)).toContain('/.lighthouseci/');
  });

  it('is what lighthouserc.cjs exports', () => {
    const rc = require('../lighthouserc.cjs') as LhciConfig;
    expect(rc).toEqual(config.lighthouseConfig(process.env, root));
  });
});

describe('the theme of each run', () => {
  it('uses the cookie lib/theme.ts keeps the theme in, and reads the default theme as the site does', () => {
    expect(config.THEME_COOKIE).toBe(THEME_COOKIE);
    const dir = contentCopy();
    for (const setting of ['dark', 'light']) {
      editJson(path.join(dir, 'site.json'), (site) => {
        site.settings.themeDefault = setting;
      });
      expect(config.siteDefaultTheme(dir)).toBe(themeFromSetting(setting));
    }
  });

  it('measures the default theme as a first visit, with no cookie, and the other through the cookie', () => {
    const site = JSON.parse(fs.readFileSync(path.join(root, 'content', 'site.json'), 'utf8'));
    expect(themeFromSetting(site.settings.themeDefault)).toBe('blueprint');
    expect(config.lighthouseTheme({ LHCI_THEME: 'blueprint' }, root)).toEqual({ theme: 'blueprint', cookie: null });
    expect(config.lighthouseTheme({ LHCI_THEME: 'whiteprint' }, root)).toEqual({ theme: 'whiteprint', cookie: 'whiteprint' });
  });

  it('sets the cookie for Blueprint instead, if the owner makes Whiteprint the default', () => {
    const dir = contentCopy();
    editJson(path.join(dir, 'site.json'), (site) => {
      site.settings.themeDefault = 'light';
    });
    const env = { SITE_CONTENT_DIR: dir };
    expect(config.lighthouseTheme({ ...env, LHCI_THEME: 'blueprint' }, root)).toEqual({ theme: 'blueprint', cookie: 'blueprint' });
    expect(config.lighthouseTheme({ ...env, LHCI_THEME: 'whiteprint' }, root)).toEqual({ theme: 'whiteprint', cookie: null });
  });
});
