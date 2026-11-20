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
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { blockHasContent } from '../lib/blocks';
import { loadValidContent } from '../lib/content';
import { mergedLog } from '../lib/log';
import { isKnownBlock } from '../lib/schema';
import { UI } from '../lib/strings';
import { LONG_TITLE, NO_PHOTO_CALLOUTS, writeStatesContent, type StatesVariant } from './fixtures/states';

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
  for (const variant of ['states', 'logphoto', 'nolog', 'heromedia'] as const) {
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
