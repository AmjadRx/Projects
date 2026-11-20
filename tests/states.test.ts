/**
 * The States boards' cases (the canvas's States-Rules sheet and its boards), on fixture content
 * for the states the seed does not have (tests/fixtures/states.ts): a no-photo project with
 * callouts and an empty gallery (S.1), a one-photo gallery (S.2), a long title (S.3), a build log
 * with one entry and /log with one or none (S.4). Each page renders from its fixture folder through
 * SITE_CONTENT_DIR, as a build would. Loading and failure states (S.5) are the components' own
 * (CoverImage, the gallery, the lightbox), checked in a browser on these fixtures.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { blockHasContent } from '../lib/blocks';
import { loadValidContent } from '../lib/content';
import { mergedLog } from '../lib/log';
import { isKnownBlock } from '../lib/schema';
import type { MediaRef } from '../lib/types';
import { JSDOM } from 'jsdom';
import { UI } from '../lib/strings';
import {
  LONG_LOG,
  LONG_ROWS,
  LONG_TITLE,
  NO_PHOTO_CALLOUTS,
  SAMPLE_MODEL,
  SAMPLE_VIDEO,
  writeStatesContent,
  type StatesVariant,
} from './fixtures/states';

// The project page's client parts read the route and the router.
vi.mock('next/navigation', async (load) => ({
  ...(await load<typeof import('next/navigation')>()),
  usePathname: () => '/projects/raven',
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
}));

const ROOT = path.resolve(__dirname, '..');
let tmp = '';
const dirs = {} as Record<StatesVariant, string>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'states-'));
  for (const variant of ['states', 'logphoto', 'nolog', 'heromedia', 'longsheet', 'media'] as const) {
    dirs[variant] = writeStatesContent(path.join(ROOT, 'content'), path.join(tmp, variant), variant);
  }
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A page module loaded fresh against one fixture folder (lib/content.ts reads SITE_CONTENT_DIR when it loads). */
async function pageFor<T>(variant: StatesVariant, load: () => Promise<T>): Promise<T> {
  vi.stubEnv('SITE_CONTENT_DIR', dirs[variant]);
  vi.resetModules();
  return load();
}

async function projectHtml(variant: StatesVariant, slug: string): Promise<string> {
  const { default: ProjectPage } = await pageFor(variant, () => import('../app/(site)/projects/[slug]/page'));
  return renderToStaticMarkup(await ProjectPage({ params: Promise.resolve({ slug }) }));
}

async function logHtml(variant: StatesVariant): Promise<string> {
  const { default: LogPage } = await pageFor(variant, () => import('../app/(site)/log/page'));
  return renderToStaticMarkup(LogPage());
}

describe('the fixtures', () => {
  it('are content the site accepts, in every variant', () => {
    for (const variant of Object.keys(dirs) as StatesVariant[]) {
      expect(() => loadValidContent(dirs[variant]), variant).not.toThrow();
    }
  });

  it('hold the states the seed lacks', () => {
    const { projects } = loadValidContent(dirs.states);
    const bySlug = new Map(projects.map((p) => [p.slug, p]));
    const raven = bySlug.get('raven')!;
    const known = raven.blocks.filter(isKnownBlock);
    expect(known.find((b) => b.type === 'gallery')).toMatchObject({ items: [expect.anything()] });
    expect(known.find((b) => b.type === 'log')).toMatchObject({ entries: [expect.objectContaining({ date: '2026-02' })] });
    expect(mergedLog(projects.filter((p) => p.visible))).toHaveLength(1);
    expect(bySlug.get('can-bus-diagnostic-tool')).toMatchObject({ cover: { src: '' }, callouts: NO_PHOTO_CALLOUTS });
    expect(bySlug.get('stm32-embedded-projects')!.title.length).toBeGreaterThan(56);
    const empty = bySlug.get('moonlamp')!.blocks.find((b) => b.id === 'fx-empty-gallery')!;
    expect(isKnownBlock(empty) && blockHasContent(empty)).toBe(false);
    expect(mergedLog(loadValidContent(dirs.nolog).projects)).toHaveLength(0);
  });

  it('hold more than the printed sheet takes, and the covers the seed lacks', () => {
    const long = new Map(loadValidContent(dirs.longsheet).projects.map((p) => [p.slug, p]));
    const ravenLog = long.get('raven')!.blocks.filter(isKnownBlock).find((b) => b.type === 'log');
    expect(ravenLog?.type === 'log' && ravenLog.entries).toHaveLength(LONG_LOG.length + 3);
    const ravenSpec = long.get('raven')!.blocks.filter(isKnownBlock).find((b) => b.type === 'specTable');
    expect(ravenSpec?.type === 'specTable' && ravenSpec.rows.slice(-LONG_ROWS.length)).toEqual(LONG_ROWS);
    expect(long.get('dbvf-senior-design')!.highlights.length).toBeGreaterThan(10);
    const media = new Map(loadValidContent(dirs.media).projects.map((p) => [p.slug, p]));
    expect(media.get('raven')!.cover).toMatchObject(SAMPLE_VIDEO);
    expect(media.get('moonlamp')!.cover).toMatchObject(SAMPLE_MODEL);
    expect(media.get('moonlamp')!.callouts).toEqual(NO_PHOTO_CALLOUTS);
  });
});

/** The project page's DOM, from its server markup. */
async function projectDom(variant: StatesVariant, slug: string): Promise<Document> {
  return new JSDOM(await projectHtml(variant, slug)).window.document;
}

describe('a video or model cover', () => {
  it('keeps its callouts as the row of readouts under the viewer, outside any figure', async () => {
    for (const [slug, count] of [
      ['raven', 3],
      ['moonlamp', NO_PHOTO_CALLOUTS.length],
    ] as const) {
      const doc = await projectDom('media', slug);
      const row = doc.querySelector('.pj-cover > ul.ar-dim__row');
      expect(row, slug).not.toBeNull();
      expect(row?.getAttribute('aria-label')).toBe(UI.projects.callouts);
      expect(row?.querySelectorAll('li')).toHaveLength(count);
      // Not a photo cover: no drawn figure, so app/styles/project.css is what shows the row.
      expect(doc.querySelector('.pj-cover .ar-dim'), slug).toBeNull();
    }
    const css = fs.readFileSync(path.join(ROOT, 'app/styles/project.css'), 'utf8');
    expect(css).toMatch(/\.pj-cover > \.ar-dim__row \{ display: flex; \}/);
  }, 120_000);

  it("paints the model's poster in the wrapper that stays under the model and prints", async () => {
    const { default: ModelViewer } = await import('../components/viewers/model/ModelViewer');
    const { resolveMedia } = await import('../lib/media-server');
    const media = resolveMedia(SAMPLE_MODEL as MediaRef)!;
    const html = renderToStaticMarkup(createElement(ModelViewer, { media, views: ['realistic'], explode: false, callouts: [] }));
    // Before the engine is ready the poster shows; once it is, data-out hides it on screen only
    // (app/motion-media.css), and app/print.css shows it again on paper.
    expect(html).toMatch(/<div class="mm-poster"><img /);
    expect(html).not.toContain('data-out');
    const motion = fs.readFileSync(path.join(ROOT, 'app/motion-media.css'), 'utf8');
    expect(motion).toMatch(/\.mm-poster\[data-out\] \{\s*opacity: 0;/);
  }, 120_000);
});

describe('the printed sheet with more than it holds', () => {
  it("serves every revision newest first, so the sheet's newest five are the first five rows", async () => {
    const doc = await projectDom('longsheet', 'raven');
    const rows = [...doc.querySelectorAll('[data-block="log"] tbody tr.ar-rev__row')];
    expect(rows).toHaveLength(LONG_LOG.length + 3);
    const dates = rows.map((row) => row.querySelector('.ar-rev__date')?.textContent ?? '');
    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates.slice(0, 5)).toEqual(LONG_LOG.map((entry) => entry.date).sort().reverse());
    expect(rows[0].querySelector('.ar-rev__rev')?.textContent).toBe('H');
  }, 120_000);

  it('serves every spec row, the long tables included, for the sheet to keep what fits', async () => {
    const doc = await projectDom('longsheet', 'fsae-bronco-racing');
    const tables = [...doc.querySelectorAll('[data-block="specTable"] table.ar-spec')];
    expect(tables).toHaveLength(2);
    expect(tables[1].querySelectorAll('tbody > tr')).toHaveLength(6 + 3 * LONG_ROWS.length);
    // Each table is headed by its heading block, which the sheet prints as the caption.
    expect(tables.map((t) => t.querySelector('caption')?.textContent)).toEqual(['BR1, the 2026 car', 'BR2, the 2027 car']);
  }, 120_000);
});

describe('S.1 a project with no photos', () => {
  it('shows the placeholder, and the callouts as the row under it at every width', async () => {
    const html = await projectHtml('states', 'can-bus-diagnostic-tool');
    expect(html).toContain('ar-dim--nophoto');
    expect(html).toContain(UI.placeholder.photoToCome);
    const row = /<ul class="ar-dim__row" aria-label="([^"]*)">([\s\S]*?)<\/ul>/.exec(html);
    expect(row?.[1]).toBe(UI.projects.callouts);
    expect([...(row?.[2] ?? '').matchAll(/<li>/g)]).toHaveLength(NO_PHOTO_CALLOUTS.length);
    // Nothing is drawn on a placeholder.
    expect(html).not.toContain('ar-dim__svg');
  }, 120_000);

  it('renders nothing for a gallery block with no items: no heading, no frame, no message', async () => {
    const html = await projectHtml('states', 'moonlamp');
    expect(html).not.toContain('fx-empty-gallery');
    expect(html).not.toContain('data-block="gallery"');
  }, 120_000);
});

describe('S.2 a gallery with one image', () => {
  it('is a single figure: no strip, no buttons, no counter, no gallery role description', async () => {
    const html = await projectHtml('states', 'raven');
    const gallery = /<div id="rv-i" data-block="gallery">([\s\S]*?)<\/section><\/div>/.exec(html)?.[1] ?? '';
    expect(gallery).toContain('ar-gal--single');
    expect(gallery).not.toContain('aria-roledescription');
    expect(gallery).not.toMatch(/ar-gal__(bar|nav|count)/);
  }, 120_000);
});

describe('S.3 a long title', () => {
  it('steps down on phones past 56 characters, and is never cut', async () => {
    const html = await projectHtml('states', 'stm32-embedded-projects');
    expect(html).toContain(`<h1 class="pj-title pj-title--long">${LONG_TITLE}</h1>`);
    const css = fs.readFileSync(path.join(ROOT, 'app/styles/project.css'), 'utf8');
    expect(css).toMatch(/@container frame \(max-width: 767px\) \{ \.pj-title--long \{ font-size: 32px;/);
    expect(css).not.toMatch(/text-overflow|line-clamp/);
  }, 120_000);
});

describe('S.4 the build log with one entry', () => {
  it('is one row, revision A, under the header and the label, on the project page', async () => {
    const html = await projectHtml('states', 'raven');
    const log = /<div id="rv-j" class="pj-log" data-block="log">([\s\S]*?)<\/table>/.exec(html)?.[1] ?? '';
    expect(log).toContain(`>${UI.projects.buildLog}</h2>`);
    expect(log).toMatch(/<th scope="col" class="ar-th-caps">Rev<\/th>/);
    expect([...log.matchAll(/<tr id="rv-j-rev-\d+" class="ar-rev__row">/g)]).toHaveLength(1);
    expect(log).toContain('<td class="ar-rev__rev">A</td><td class="ar-rev__date">2026-02</td>');
  }, 120_000);

  it('is the merged table with one row and its Project column on /log', async () => {
    const html = await logHtml('states');
    expect(html).toContain(UI.log.intro);
    expect(html).toContain(`>${UI.revisions.project}</th>`);
    expect([...html.matchAll(/class="ar-rev__row"/g)]).toHaveLength(1);
    expect(html).toMatch(/<td class="ar-rev__proj ar-rev__cell-proj"><a [^>]*href="\/projects\/raven"/);
  }, 120_000);

  it('says so on /log when no project has an entry, and points to the projects', async () => {
    const html = await logHtml('nolog');
    expect(html).toContain(UI.log.intro);
    expect(html).toContain(`<p>${UI.log.empty}</p>`);
    expect(html).toMatch(new RegExp(`<a [^>]*href="/projects"[^>]*>[\\s\\S]*?${UI.log.seeProjects}`));
    expect(html).not.toContain('<table');
  }, 120_000);

  it('leaves no build log section on a project with no log block', async () => {
    const html = await projectHtml('nolog', 'raven');
    expect(html).not.toContain('data-block="log"');
    expect(html).not.toContain(`>${UI.projects.buildLog}</h2>`);
  }, 120_000);
});
