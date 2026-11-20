/**
 * The command palette's index (lib/palette.ts) and the file that serves it (app/palette.json):
 * built from the seed through the site's loaders, it lists every page, every visible project with
 * its sheet, and every heading of a project page with its anchor, as the Palette boards group them;
 * and, built from a fixture with a hidden project (content is never edited for a test), it names
 * nothing of that project, nor a nav item that leads to it, nor an empty heading.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildPaletteIndex, headingsOf, paletteIndex, type PaletteIndex } from '../lib/palette';
import { siteData } from '../lib/site';
import type { Block } from '../lib/types';

const root = path.resolve(__dirname, '..');

const groupOf = (index: PaletteIndex, label: string) => index.groups.find((g) => g.label === label)?.items ?? [];

describe('the index of the seed', () => {
  const index = paletteIndex();

  it('has the three groups in the bundle order', () => {
    expect(index.groups.map((g) => g.label)).toEqual(['Pages', 'Projects', 'Sections']);
  });

  it('lists home and the nav pages, and offers the nav names when nothing matches', () => {
    const { site } = siteData();
    expect(groupOf(index, 'Pages')).toEqual([
      { label: 'Home', meta: 'Page', href: '/' },
      ...site.nav.map((item) => ({ label: item.label, meta: 'Page', href: item.href })),
    ]);
    expect(index.pages).toEqual(site.nav.map((item) => item.label));
    expect(index.pages).toEqual(['Projects', 'About', 'Experience', 'Build log', 'Contact']);
  });

  it('lists every visible project in order with its sheet, as the 1440 board shows Raven', () => {
    const { projects } = siteData();
    const items = groupOf(index, 'Projects');
    expect(items.map((p) => p.href)).toEqual(projects.map((p) => `/projects/${p.slug}`));
    expect(items.find((p) => p.label === 'Raven')).toEqual({ label: 'Raven', meta: 'Sheet 2 of 12', href: '/projects/raven' });
    expect(items[0]).toEqual({ label: 'SCU Pegasus: Design-Build-Vertical Flight', meta: 'Sheet 1 of 12', href: '/projects/dbvf-senior-design' });
  });

  it("lists each project page's headings as sections, named and anchored as the boards have them", () => {
    const sections = groupOf(index, 'Sections');
    expect(sections.filter((s) => s.href.startsWith('/projects/raven#'))).toEqual([
      { label: 'Raven: Structure and analysis', meta: 'Section', href: '/projects/raven#rv-c' },
      { label: 'Raven: Roadmap', meta: 'Section', href: '/projects/raven#rv-e' },
      { label: 'Raven: Build photos', meta: 'Section', href: '/projects/raven#rv-h' },
    ]);
    expect(sections[0]).toEqual({
      label: 'SCU Pegasus: Design-Build-Vertical Flight: My part: the electrical system',
      meta: 'Section',
      href: '/projects/dbvf-senior-design#db-b',
    });
  });

  it('is what /palette.json serves, as JSON, built statically', async () => {
    const route = await import('../app/palette.json/route');
    expect(route.dynamic).toBe('force-static');
    const response = route.GET();
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    expect(await response.json()).toEqual(index);
  });

  it('carries no GPA and no dash, like every other page', () => {
    const text = JSON.stringify(index);
    expect(text).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`));
    expect(text).not.toMatch(/GPA/);
  });
});

describe('the sections of a project page', () => {
  it('follows the page: headings with text, in order, both columns of a twoCol, nothing the page skips', () => {
    const blocks = [
      { id: 'a', type: 'heading', text: 'First' },
      { id: 'b', type: 'text', md: 'Prose.' },
      { id: 'c', type: 'heading', text: '   ' },
      { id: 'd', type: 'mystery', text: 'Unknown block' },
      {
        id: 'e',
        type: 'twoCol',
        left: [{ id: 'f', type: 'heading', text: 'Left' }],
        right: [
          { id: 'g', type: 'heading', text: ' Right ' },
          { id: 'h', type: 'bullets', heading: 'A list heading is no section', items: ['x'] },
        ],
      },
      { id: 'i', type: 'heading', text: 'Last' },
    ] as Block[];
    expect(headingsOf(blocks)).toEqual([
      { id: 'a', text: 'First' },
      { id: 'f', text: 'Left' },
      { id: 'g', text: 'Right' },
      { id: 'i', text: 'Last' },
    ]);
  });

  it('anchors an odd block id safely', () => {
    const { site, projects, resolveLink } = siteData();
    const raven = projects.find((p) => p.slug === 'raven')!;
    const index = buildPaletteIndex({
      site,
      resolveLink,
      projects: [{ ...raven, blocks: [{ id: 'a b#c', type: 'heading', text: 'Odd' }] }],
    });
    expect(groupOf(index, 'Sections')).toEqual([{ label: 'Raven: Odd', meta: 'Section', href: '/projects/raven#a%20b%23c' }]);
  });
});

/**
 * A fixture built the way the owner could save it in the admin: the seed, plus a hidden project
 * with a heading of its own, a nav item and links that point at it, and an empty heading on a
 * visible page. It is read through the real loaders (SITE_CONTENT_DIR, as the hiding build test
 * does), so the index meets exactly what every page meets.
 */
describe('the index of a site with a hidden project', () => {
  const SLUG = 'hidden-palette-zq9';
  const TITLE = 'Quillon Palette Zq9';
  const HEADING = 'Unseen heading marker sextant';
  /** A heading added to a visible project: proof that the index was built from the fixture. */
  const SEEN = 'Seen heading marker heliograph';
  let dir = '';
  let index: PaletteIndex;
  let served: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palette-'));
    fs.cpSync(path.join(root, 'content'), dir, { recursive: true });
    const siteFile = path.join(dir, 'site.json');
    const site = JSON.parse(fs.readFileSync(siteFile, 'utf8'));
    site.nav.push({ label: 'Fixture nav item', href: `/projects/${SLUG}` });
    fs.writeFileSync(siteFile, JSON.stringify(site, null, 2));
    const ravenFile = path.join(dir, 'projects', 'raven.json');
    const raven = JSON.parse(fs.readFileSync(ravenFile, 'utf8'));
    raven.blocks.push({ id: 'fx-empty-heading', type: 'heading', text: '' });
    raven.blocks.push({ id: 'fx-seen', type: 'heading', text: SEEN });
    raven.blocks.push({ id: 'fx-link', type: 'text', md: `See [the fixture](/projects/${SLUG}).` });
    fs.writeFileSync(ravenFile, JSON.stringify(raven, null, 2));
    fs.writeFileSync(
      path.join(dir, 'projects', `${SLUG}.json`),
      JSON.stringify({
        slug: SLUG,
        visible: false,
        title: TITLE,
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
        cover: { kind: 'image', src: '', alt: '' },
        links: [],
        callouts: [],
        pitch: 'Fixture pitch.',
        highlights: [],
        blocks: [{ id: 'fx-h', type: 'heading', text: HEADING }],
      }),
    );

    vi.resetModules();
    vi.stubEnv('SITE_CONTENT_DIR', dir);
    const palette = await import('../lib/palette');
    const route = await import('../app/palette.json/route');
    index = palette.paletteIndex();
    served = await route.GET().text();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the fixture, not the seed', () => {
    expect(groupOf(index, 'Sections')).toContainEqual({ label: `Raven: ${SEEN}`, meta: 'Section', href: '/projects/raven#fx-seen' });
    expect(served).toContain(SEEN);
    expect(groupOf(index, 'Projects')).toHaveLength(12);
  });

  it('names nothing of the hidden project: not its slug, its title, or its heading', () => {
    for (const marker of [SLUG, TITLE, HEADING, 'Fixture']) {
      expect(JSON.stringify(index), marker).not.toContain(marker);
      expect(served, marker).not.toContain(marker);
    }
  });

  it('drops the nav item that leads to it, and keeps the empty heading out', () => {
    expect(groupOf(index, 'Pages').map((p) => p.label)).toEqual(['Home', 'Projects', 'About', 'Experience', 'Build log', 'Contact']);
    expect(index.pages).not.toContain('Fixture nav item');
    expect(served).not.toContain('fx-empty-heading');
  });

  it('still lists every visible project and section', () => {
    expect(groupOf(index, 'Projects').map((p) => p.label)).toContain('Raven');
    expect(groupOf(index, 'Sections').map((s) => s.href)).toContain('/projects/raven#rv-e');
  });
});
