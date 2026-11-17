/**
 * The hiding rules, checked on real build output (ARCHITECTURE.md 4 and 15, item 2;
 * docs/V3_PLAN.md D-06, D-07, D-08, D-14): a field left empty, an empty cover, and
 * `visible: false` leave no trace in the HTML, the RSC payloads, the JSON-LD, the sitemap, or the
 * metadata.
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

/** Prerendered pages and route bodies: HTML, RSC payloads, the sitemap and robots bodies, and headers. */
function servedFiles(): string[] {
  return walk(appOut).filter((f) => /\.(html|rsc|body|meta)$/.test(f));
}

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
    expect(sitemap).not.toContain('/dev/');
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

  it('gives an empty cover the placeholder and no image in the metadata or JSON-LD', () => {
    const emptyCovers = fs
      .readdirSync(path.join(root, 'content', 'projects'))
      .map((name) => readJson(path.join(root, 'content', 'projects', name)))
      .filter((p) => p.visible && p.cover.src.trim() === '')
      .map((p) => p.slug as string);
    expect(emptyCovers.length).toBeGreaterThan(0);
    for (const slug of emptyCovers) {
      const page = html(`/projects/${slug}`);
      expect(page, slug).toContain('Photo to come');
      expect(page, slug).not.toMatch(/<meta property="og:image"/);
      expect(page, slug).not.toMatch(/<meta name="twitter:image"/);
      for (const block of jsonLdBlocks(page)) expect(block.image, slug).toBeUndefined();
    }
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
