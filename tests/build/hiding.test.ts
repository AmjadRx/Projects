/**
 * The hiding rules, checked on real build output (ARCHITECTURE.md 4 and 15, item 2;
 * docs/V3_PLAN.md D-06, D-07, D-08, D-14): a field left empty, an empty cover, and
 * `visible: false` leave no trace in the HTML, the RSC payloads, the JSON-LD, the sitemap, the
 * metadata, or the Open Graph images (a hidden project has no image route at all; every visible
 * page names an image the build drew). The icon, /favicon.ico, the manifest, and robots.txt are
 * checked on the same build.
 *
 * The test copies content/ into a temporary folder, changes it the way an owner would in the
 * admin, builds the site from it with `next build` into its own output folder, and searches every
 * prerendered file and client chunk. Run it with `npm run test:build` (a few minutes).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadValidContent } from '../../lib/content';

const root = path.resolve(__dirname, '..', '..');
const distName = '.next-hiding-test';
const dist = path.join(root, distName);
const appOut = path.join(dist, 'server', 'app');

// A hidden project with markers that appear nowhere else, and a cover file the seed never uses.
const HIDDEN_SLUG = 'hidden-fixture-zq7';
const HIDDEN_TITLE = 'Quillon Fixture Zq7';
const HIDDEN_PITCH = 'Unseen pitch marker vexillum.';
const HIDDEN_LOG_TITLE = 'Unseen log marker ocarina';
const HIDDEN_COVER = '/media/site/img-7657.jpeg';
const PHONE_DIGITS = '407-6321';
const SITE = 'https://amjadrehawi.com';

let tmp = '';

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Empties the GPA and the phone the way the owner would in the admin, but leaves their copies in
 * place: the education line, the about fact, and the contact phone link. The content check and
 * the build both refuse this (D-14, Q-23).
 */
function emptyGpaAndPhone(site: any): void {
  site.personal.phone = '';
  site.personal.gpa = '';
}

/** Removes the copies, as the refusal makes the owner do before the save goes through. */
function removeCopies(site: any): void {
  site.education = site.education.map((entry: { details: string }) => ({
    ...entry,
    details: entry.details
      .split('. ')
      .filter((sentence: string) => !sentence.includes('GPA'))
      .join('. '),
  }));
  site.about.facts = site.about.facts.map((fact: { label: string; value: string }) =>
    fact.label.includes('GPA') ? { ...fact, value: '' } : fact,
  );
  site.socialLinks = site.socialLinks.filter((link: { url: string }) => !link.url.startsWith('tel:'));
}

/**
 * The content an owner could save: the seed plus a hidden project, links to it from every kind
 * of link field, emptied fields, and empty blocks. Two edits are content the check refuses (the
 * proofs that point at the hidden project); they stay in as defence in depth, because the
 * renderer must hide such links whatever the check says.
 */
function makeFixture(dir: string): void {
  fs.cpSync(path.join(root, 'content'), dir, { recursive: true });
  const siteFile = path.join(dir, 'site.json');
  const site = readJson(siteFile);

  // Emptied fields, with the copies removed as the refusal requires.
  emptyGpaAndPhone(site);
  removeCopies(site);
  site.personal.photo = { kind: 'image', src: '', alt: '' };
  site.seo.description = '';
  site.experience[0].company = '';
  site.experience[1].dates = '';
  site.honors[0].year = '';
  site.education[1].school = '';
  site.thesis.headline = '';
  site.about.heading = '';
  site.contact.heading = '';

  // Links that point at the hidden project, in every link field and in both address forms.
  site.nav.push({ label: 'Fixture nav item', href: `/projects/${HIDDEN_SLUG}` });
  site.now.push({ label: 'Fixture now item', href: `/projects/${HIDDEN_SLUG}` });
  site.now.push({ label: 'Fixture absolute item', href: `${SITE}/projects/${HIDDEN_SLUG}` });
  site.stats[0].proof = `/projects/${HIDDEN_SLUG}`;
  site.skills.groups[0].items[0].proof = HIDDEN_SLUG;
  writeJson(siteFile, site);

  const raven = readJson(path.join(dir, 'projects', 'raven.json'));
  raven.links.push({ label: 'Fixture project link', url: `${SITE}/projects/${HIDDEN_SLUG}#log` });
  raven.blocks.push({ id: 'fx-link', type: 'text', md: `See [the fixture](/projects/${HIDDEN_SLUG}).` });
  raven.blocks.push({ id: 'fx-row', type: 'linkRow', links: [{ label: 'Fixture link row', url: `/projects/${HIDDEN_SLUG}` }] });
  // Empty blocks leave nothing, not even their wrapper.
  raven.blocks.push({ id: 'fx-empty-heading', type: 'heading', text: '' });
  raven.blocks.push({ id: 'fx-empty-callout', type: 'callout', tone: 'note', md: '' });
  raven.blocks.push({ id: 'fx-empty-quote', type: 'quote', text: '' });
  raven.blocks.push({ id: 'fx-empty-image', type: 'image', media: { kind: 'image', src: '', alt: '' } });
  writeJson(path.join(dir, 'projects', 'raven.json'), raven);

  writeJson(path.join(dir, 'projects', `${HIDDEN_SLUG}.json`), {
    slug: HIDDEN_SLUG,
    visible: false,
    title: HIDDEN_TITLE,
    subtitle: 'Fixture subtitle',
    role: 'Fixture role',
    timeframe: '2026',
    status: 'active',
    statusLabel: 'Fixture status',
    maturity: { step: 2, label: 'Fixture maturity' },
    featured: true,
    order: 0,
    domain: 'Fixturedomain',
    tags: ['Fixturetag'],
    cover: { kind: 'image', src: HIDDEN_COVER, alt: '' },
    links: [],
    callouts: [{ label: 'Fixture callout', value: '9 units' }],
    pitch: HIDDEN_PITCH,
    highlights: ['Fixture highlight'],
    blocks: [
      { id: 'fx-log', type: 'log', entries: [{ date: '2099-01-01', title: HIDDEN_LOG_TITLE, md: 'Fixture entry.' }] },
    ],
  });
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** True for a route body that is an image (the Open Graph images, the icons, /favicon.ico). */
function isImageBody(file: string): boolean {
  if (!file.endsWith('.body')) return false;
  const head = fs.readFileSync(file).subarray(0, 8);
  return head.equals(PNG_SIGNATURE) || head.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]));
}

/**
 * Prerendered pages and route bodies: HTML, RSC payloads, the sitemap, robots, and manifest
 * bodies, and headers. Image bodies are left out of these text searches (their words are drawn
 * as outlines, so no marker could be found in their bytes, and random bytes could match a short
 * one); the tests below check the image routes themselves.
 */
function servedFiles(): string[] {
  return walk(appOut).filter((f) => /\.(html|rsc|body|meta)$/.test(f) && !isImageBody(f));
}

/** The PNG's width and height. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file);
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), file).toBe(true);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** A meta tag's content in a page, by its property or name. */
function metaContent(page: string, key: string): string | undefined {
  const match = new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(page);
  return match?.[1].replace(/&amp;/g, '&');
}

/** The build output file of an address on the site (a route's body). */
function outputOf(url: string): string {
  const pathname = new URL(url, SITE).pathname.replace(/^\//, '');
  return path.join(appOut, `${pathname}.body`);
}

const VISIBLE_ROUTES = ['/', '/projects', '/about', '/experience', '/log', '/contact'];

/** Everything a visitor can receive, client chunks included (searched only for unique markers). */
function outputFiles(): string[] {
  const chunks = walk(path.join(dist, 'static')).filter((f) => /\.(js|css)$/.test(f));
  return [...servedFiles(), ...chunks];
}

function html(route: string): string {
  const file = path.join(appOut, route === '/' ? 'index.html' : `${route.replace(/^\//, '')}.html`);
  return fs.readFileSync(file, 'utf8');
}

function jsonLdBlocks(page: string): any[] {
  return [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

describe('hiding rules on build output', () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hiding-'));
    const content = path.join(tmp, 'content');
    makeFixture(content);
    fs.rmSync(dist, { recursive: true, force: true });
    execFileSync(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
      cwd: root,
      env: {
        ...process.env,
        SITE_CONTENT_DIR: content,
        NEXT_DIST_DIR: distName,
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_SITE_URL: SITE,
      },
      stdio: 'pipe',
      maxBuffer: 64 * 1024 * 1024,
    });
  });

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it('builds the visible pages', () => {
    for (const route of ['/', '/projects', '/about', '/experience', '/log', '/contact', '/projects/raven']) {
      expect(fs.existsSync(path.join(appOut, route === '/' ? 'index.html' : `${route.slice(1)}.html`)), route).toBe(true);
    }
  });

  it('gives a hidden project no page and no trace in any output file', () => {
    expect(fs.existsSync(path.join(appOut, 'projects', `${HIDDEN_SLUG}.html`))).toBe(false);
    // No Open Graph image either: no output under its slug at all.
    expect(fs.existsSync(path.join(appOut, 'projects', HIDDEN_SLUG))).toBe(false);
    expect([...walk(appOut), ...walk(path.join(dist, 'static'))].filter((f) => f.includes(HIDDEN_SLUG))).toEqual([]);
    const markers = [HIDDEN_SLUG, HIDDEN_TITLE, HIDDEN_PITCH, HIDDEN_LOG_TITLE, 'Fixturedomain', 'Fixture callout'];
    const coverForms = [HIDDEN_COVER, encodeURIComponent(HIDDEN_COVER)];
    const leaks: string[] = [];
    for (const file of outputFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const marker of [...markers, ...coverForms]) {
        if (text.includes(marker)) leaks.push(`${path.relative(dist, file)}: ${marker}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('keeps the hidden project out of the sitemap, which lists the visible pages and /log', () => {
    const sitemap = fs.readFileSync(path.join(appOut, 'sitemap.xml.body'), 'utf8');
    expect(sitemap).not.toContain(HIDDEN_SLUG);
    expect(sitemap).toContain('/projects/raven</loc>');
    expect(sitemap).toContain('/log</loc>');
    expect(sitemap).not.toMatch(/\/dev\/|\/dev-|\/admin|\/api/);
  });

  it('refuses an emptied GPA or phone while a copy remains, in the check and in the build (D-14)', () => {
    const dir = path.join(tmp, 'with-copies');
    fs.cpSync(path.join(root, 'content'), dir, { recursive: true });
    const site = readJson(path.join(dir, 'site.json'));
    emptyGpaAndPhone(site);
    writeJson(path.join(dir, 'site.json'), site);
    expect(() => loadValidContent(dir)).toThrow(/personal\.gpa is empty/);
    expect(() => loadValidContent(dir)).toThrow(/personal\.phone is empty/);
  });

  it('prints links to the hidden project as plain text, and drops a nav item that leads to it', () => {
    expect(html('/')).toContain('Fixture now item');
    expect(html('/')).toContain('Fixture absolute item');
    expect(html('/projects/raven')).toContain('the fixture');
    expect(html('/projects/raven')).toContain('Fixture link row');
    for (const route of ['/', '/about', '/projects/raven']) expect(html(route), route).not.toContain('Fixture nav item');
  });

  it('leaves no trace of an empty phone', () => {
    for (const file of servedFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text.includes(PHONE_DIGITS), path.relative(dist, file)).toBe(false);
      expect(/href="tel:/.test(text), path.relative(dist, file)).toBe(false);
    }
  });

  it('leaves no trace of an empty GPA: no value, and no label without its value', () => {
    for (const file of servedFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text.includes('3.65'), path.relative(dist, file)).toBe(false);
      expect(text.includes('Major GPA'), path.relative(dist, file)).toBe(false);
    }
  });

  it('leaves no description in the metadata when seo.description is empty', () => {
    for (const route of ['/', '/projects', '/about', '/experience', '/log', '/contact']) {
      const page = html(route);
      expect(page, route).not.toMatch(/<meta name="description"/);
      expect(page, route).not.toMatch(/<meta property="og:description"/);
      expect(page, route).not.toMatch(/<meta name="twitter:description"/);
    }
  });

  it('gives an empty cover the placeholder, and no cover image in the metadata or JSON-LD', () => {
    const emptyCovers = fs
      .readdirSync(path.join(root, 'content', 'projects'))
      .map((name) => readJson(path.join(root, 'content', 'projects', name)))
      .filter((p) => p.visible && p.cover.src.trim() === '')
      .map((p) => p.slug as string);
    expect(emptyCovers.length).toBeGreaterThan(0);
    for (const slug of emptyCovers) {
      const page = html(`/projects/${slug}`);
      expect(page, slug).toContain('Photo to come');
      // The share image is the project's generated sheet, never a media file.
      for (const key of ['og:image', 'twitter:image']) {
        expect(metaContent(page, key), `${slug} ${key}`).toMatch(new RegExp(`^${SITE}/projects/${slug}/opengraph-image-[a-z0-9]+\\?v=[0-9a-f]{10}$`));
      }
      expect(page, slug).not.toContain(`${SITE}/media/`);
      for (const block of jsonLdBlocks(page)) expect(block.image, slug).toBeUndefined();
    }
  });

  it('draws an Open Graph image for the home page and each visible project, and every page names one the build drew', () => {
    const visible = fs
      .readdirSync(path.join(root, 'content', 'projects'))
      .map((name) => readJson(path.join(root, 'content', 'projects', name)))
      .filter((p) => p.visible)
      .map((p) => p.slug as string);
    for (const route of [...VISIBLE_ROUTES, ...visible.map((slug) => `/projects/${slug}`)]) {
      const page = html(route);
      const image = metaContent(page, 'og:image');
      expect(image, route).toBeDefined();
      expect(metaContent(page, 'twitter:image'), route).toBe(image);
      expect(metaContent(page, 'twitter:card'), route).toBe('summary_large_image');
      expect(metaContent(page, 'og:image:width'), route).toBe('1200');
      expect(metaContent(page, 'og:image:height'), route).toBe('630');
      const alt = metaContent(page, 'og:image:alt') ?? '';
      expect(alt, route).not.toBe('');
      expect(metaContent(page, 'twitter:image:alt'), route).toBe(alt);
      // The image is a file of this build, 1200 by 630 (the query only versions the address).
      expect(pngSize(outputOf(image!)), route).toEqual({ width: 1200, height: 630 });
      expect(fs.readFileSync(outputOf(image!).replace(/\.body$/, '.meta'), 'utf8'), route).toContain('image/png');
    }
    // The site's pages share the home image.
    for (const route of VISIBLE_ROUTES) expect(metaContent(html(route), 'og:image'), route).toBe(metaContent(html('/'), 'og:image'));
  });

  it('serves the icon, the Apple icon, /favicon.ico, and the manifest from the build, and links them from every page', () => {
    expect(pngSize(path.join(appOut, 'icon.body'))).toEqual({ width: 32, height: 32 });
    expect(pngSize(path.join(appOut, 'apple-icon.body'))).toEqual({ width: 180, height: 180 });
    const ico = fs.readFileSync(path.join(appOut, 'favicon.ico.body'));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
    expect(fs.readFileSync(path.join(appOut, 'favicon.ico.meta'), 'utf8')).toContain('image/x-icon');
    const manifest = JSON.parse(fs.readFileSync(path.join(appOut, 'manifest.webmanifest.body'), 'utf8'));
    expect(manifest).toMatchObject({ start_url: '/', display: 'browser', icons: [{ src: '/icon' }, { src: '/apple-icon' }] });
    for (const route of [...VISIBLE_ROUTES, '/projects/raven']) {
      const page = html(route);
      expect(page, route).toMatch(/<link rel="icon" href="\/icon\?[0-9a-f]+" type="image\/png" sizes="32x32"\/>/);
      expect(page, route).toMatch(/<link rel="apple-touch-icon" href="\/apple-icon\?[0-9a-f]+" type="image\/png" sizes="180x180"\/>/);
      expect(page, route).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    }
  });

  it('keeps the image and font code on the server: no browser chunk carries it', () => {
    // Strings from lib/og/: the WOFF2 decoder, the font roles, the instancer, and the renderer's loader.
    const serverOnly = ['WOFF2: not a WOFF2 file', 'Archivo Headline', 'gvar: a tuple names', 'next/dist/compiled/@vercel/og'];
    const chunks = walk(path.join(dist, 'static')).filter((f) => f.endsWith('.js'));
    expect(chunks.length).toBeGreaterThan(0);
    const found = chunks.flatMap((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return serverOnly.filter((s) => text.includes(s)).map((s) => `${path.relative(dist, file)}: ${s}`);
    });
    expect(found).toEqual([]);
  });

  it('names no private path in robots.txt, and points to the sitemap', () => {
    const robots = fs.readFileSync(path.join(appOut, 'robots.txt.body'), 'utf8');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).not.toMatch(/admin|\/api|\/dev|Disallow/);
  });

  it('leaves an empty photo out of the home page and its JSON-LD', () => {
    const page = html('/');
    expect(page).not.toContain('profile-pic-sf');
    const person = jsonLdBlocks(page).find((b) => b['@type'] === 'Person');
    expect(person).toBeDefined();
    expect(person.image).toBeUndefined();
    expect(person.telephone).toBeUndefined();
  });

  it('prints no element for an empty field, no stray separator, and never an empty image source', () => {
    expect(html('/')).not.toContain('class="kicker"');
    expect(html('/')).not.toContain('id="thesis-title"');
    const emptyElement = /<(h[1-6]|p|dt|dd|li|blockquote|figcaption)\b[^>]*>\s*<\/\1>/;
    const leadingComma = /<(p|li|dd|dt|h[1-6])\b[^>]*>(?:\s*<[^>]+>)*\s*,\s/;
    for (const file of walk(appOut).filter((f) => f.endsWith('.html'))) {
      const text = fs.readFileSync(file, 'utf8');
      const name = path.relative(dist, file);
      expect(text, name).not.toMatch(/\ssrc=""/);
      expect(text.match(emptyElement)?.[0] ?? null, name).toBeNull();
      expect(text.match(leadingComma)?.[0] ?? null, name).toBeNull();
      expect(text.includes('fx-empty-'), name).toBe(false);
    }
  });
});
