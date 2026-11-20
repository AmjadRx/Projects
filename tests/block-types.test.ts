/**
 * Every block type renders, and an unknown block type renders nothing (ARCHITECTURE.md 4 and 15,
 * item 8). Each of the 21 known types goes through the project page's own BlockRenderer, as the
 * server renders it, and shows its content in its wrapper; a block of a type the site does not
 * know leaves no trace, alone, between two known blocks, or inside a two-column block.
 * tests/blocks.test.ts checks the schema side (the unknown type is kept and skipped); the seed uses
 * only some of the types, so they are given here one by one.
 *
 * The media are files the site already serves: the owner's photos under public/media, and, for the
 * kinds the seed has no file of yet (video, 3D model, document, audio, a download), the
 * development samples under public/dev/samples, as tests/fixtures/states.ts uses them; they move
 * with those samples.
 *
 * Two blocks render through async server components, which React 18's renderer in this test cannot
 * wait for: the code block (highlighted while the page is prerendered) and the repository card
 * (read from GitHub at build time; here, as in CI without CONTENT_BLOCKLIST, the plain link, so no
 * network is used). Each is rendered first by its own real component, awaited, and the renderer
 * is handed the result.
 */
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import BlockRenderer from '../components/blocks/BlockRenderer';
import type { BlockContext } from '../components/blocks/context';
import { makeLinkResolver } from '../lib/links';
import { BlockSchema, KNOWN_BLOCK_TYPES } from '../lib/schema';
import { UI } from '../lib/strings';
import type { Block } from '../lib/types';

// The viewers' client parts read the route and the router.
vi.mock('next/navigation', async (load) => ({
  ...(await load<typeof import('next/navigation')>()),
  usePathname: () => '/projects/raven',
  useRouter: () => ({ push: () => undefined, back: () => undefined, prefetch: () => undefined }),
}));

/** What the two async server components rendered, by their props, filled before the tests run. */
const awaited = vi.hoisted(() => new Map<string, ReactNode>());
vi.mock('@/components/viewers/code/CodeBlock', () => ({
  default: (props: object) => awaited.get(`code ${JSON.stringify(props)}`) ?? null,
}));
vi.mock('@/components/viewers/repo/RepoCard', () => ({
  default: (props: object) => awaited.get(`repo ${JSON.stringify(props)}`) ?? null,
}));

const S = '/dev/samples';
const PHOTO = '/media/raven/build-01.webp';
const PHOTO_2 = '/media/raven/img-7666.webp';
const REPO = 'https://github.com/AmjadRx/MoonLight';
const CODE = { language: 'ts', code: 'export const marker = "Codemarkerzq";\n' };

/** One block of each known type, each with words or a file of its own to find in the markup. */
const RAW: Record<string, Record<string, unknown>> = {
  heading: { type: 'heading', text: 'Headingmarkerzq' },
  text: { type: 'text', md: 'Textmarkerzq with **bold** words.' },
  image: { type: 'image', media: { kind: 'image', src: PHOTO, alt: '', caption: 'Imagemarkerzq' } },
  gallery: {
    type: 'gallery',
    items: [
      { kind: 'image', src: PHOTO, alt: '', caption: 'Gallerymarkerzq one' },
      { kind: 'image', src: PHOTO_2, alt: '', caption: 'Gallerymarkerzq two' },
    ],
  },
  video: { type: 'video', media: { kind: 'video', src: `${S}/clip.mp4`, poster: `${S}/clip-poster.webp`, alt: '', caption: 'Videomarkerzq' } },
  specTable: { type: 'specTable', rows: [{ label: 'Speclabelzq', value: 'Specvaluezq' }] },
  bullets: { type: 'bullets', heading: 'Bulletsheadzq', items: ['Bulletmarkerzq'] },
  twoCol: {
    type: 'twoCol',
    left: [{ id: 'left-text', type: 'text', md: 'Leftmarkerzq' }],
    right: [{ id: 'right-text', type: 'text', md: 'Rightmarkerzq' }],
  },
  quote: { type: 'quote', text: 'Quotemarkerzq', attribution: 'Quotebyzq' },
  linkRow: { type: 'linkRow', links: [{ label: 'Linkmarkerzq', url: '/projects/raven' }] },
  roadmap: { type: 'roadmap', stages: [{ n: 1, title: 'Stagemarkerzq', desc: 'Stage words.', status: 'in-progress' }] },
  log: { type: 'log', entries: [{ date: '2026-05-20', title: 'Logmarkerzq', md: 'Entry words.' }] },
  file: { type: 'file', label: 'Filemarkerzq', src: `${S}/data.csv`, note: 'Filenotezq' },
  callout: { type: 'callout', tone: 'note', md: 'Calloutmarkerzq' },
  model3d: { type: 'model3d', media: { kind: 'model', src: `${S}/model.glb`, poster: `${S}/model-poster.webp`, alt: 'Modelmarkerzq' } },
  document: { type: 'document', title: 'Documentmarkerzq', media: { kind: 'document', src: `${S}/document.pdf`, poster: `${S}/document-poster.webp`, alt: '' } },
  audio: { type: 'audio', title: 'Audiomarkerzq', media: { kind: 'audio', src: `${S}/tone.mp3`, alt: '' } },
  code: { type: 'code', ...CODE },
  compare: { type: 'compare', before: { kind: 'image', src: PHOTO, alt: '' }, after: { kind: 'image', src: PHOTO_2, alt: '' } },
  panzoom: { type: 'panzoom', media: { kind: 'image', src: `${S}/drawing.svg`, alt: '', caption: 'Panzoommarkerzq' } },
  repo: { type: 'repo', url: REPO },
};

/** What each type's markup must hold besides its wrapper. */
const SHOWS: Record<string, (string | RegExp)[]> = {
  heading: [/<h2 id="b-heading" class="pj-h2">Headingmarkerzq<\/h2>/],
  text: ['Textmarkerzq', '<strong>bold</strong>'],
  image: ['Imagemarkerzq', /<img\b/],
  // The strip shows the photos; their captions show in the lightbox.
  gallery: [`aria-label="${UI.viewers.gallery.label}"`, /build-01\.webp/, /img-7666\.webp/],
  video: ['Videomarkerzq', 'clip-poster.webp'],
  specTable: [/<table\b/, 'Speclabelzq', 'Specvaluezq'],
  bullets: ['Bulletsheadzq', /<li\b[^>]*>(?:(?!<\/li>)[\s\S])*Bulletmarkerzq/],
  twoCol: ['class="pj-two"', 'data-block="text"', 'Leftmarkerzq', 'Rightmarkerzq'],
  quote: [/<blockquote\b/, 'Quotemarkerzq', 'Quotebyzq'],
  linkRow: [/<a\b[^>]*href="\/projects\/raven"[^>]*>(?:(?!<\/a>)[\s\S])*Linkmarkerzq/],
  roadmap: ['Stagemarkerzq', UI.roadmapStatus['in-progress']],
  log: ['Logmarkerzq', '2026-05-20'],
  file: ['Filemarkerzq', 'Filenotezq', `href="${S}/data.csv"`],
  callout: ['Calloutmarkerzq'],
  model3d: ['Modelmarkerzq', 'model-poster.webp'],
  document: ['Documentmarkerzq', 'document-poster.webp'],
  audio: ['Audiomarkerzq'],
  code: ['Codemarkerzq', /<pre\b/],
  compare: [/build-01\.webp/, /img-7666\.webp/],
  panzoom: ['Panzoommarkerzq', 'drawing.svg'],
  repo: [/<a\b[^>]*href="https:\/\/github\.com\/AmjadRx\/MoonLight"/],
};

const block = (type: string): Block => BlockSchema.parse({ id: `b-${type}`, ...RAW[type] }) as Block;

const ctx: BlockContext = {
  resolveLink: makeLinkResolver(new Set(['raven']), { siteHosts: ['amjadrehawi.com'], phoneShown: true }),
  level: 2,
  idPrefix: '',
  label: 'Fixture project',
};

const render = (blocks: unknown[]) => renderToStaticMarkup(h(BlockRenderer, { blocks: blocks as Block[], ctx }));

/** Where a block's wrapper, `<div id="b-type" [class=...] data-block="type">`, starts in the markup, or -1. */
function wrapperAt(html: string, type: string): number {
  return html.search(new RegExp(`<div id="b-${type}"(?: class="[^"]*")? data-block="${type}">`));
}

beforeAll(async () => {
  // As in CI: no CONTENT_BLOCKLIST, so the repository card is the plain link and reads no network.
  vi.stubEnv('CI', '1');
  vi.stubEnv('CONTENT_BLOCKLIST', '');
  const { default: CodeBlock } = await vi.importActual<typeof import('../components/viewers/code/CodeBlock')>('../components/viewers/code/CodeBlock');
  const { default: RepoCard } = await vi.importActual<typeof import('../components/viewers/repo/RepoCard')>('../components/viewers/repo/RepoCard');
  awaited.set(`code ${JSON.stringify({ language: CODE.language, code: CODE.code })}`, await CodeBlock({ language: CODE.language, code: CODE.code }));
  awaited.set(`repo ${JSON.stringify({ url: REPO, title: ctx.label })}`, await RepoCard({ url: REPO, title: ctx.label }));
}, 60_000);

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('every block type renders (ARCHITECTURE.md 15, item 8)', () => {
  it('has a fixture for each of the 21 known types', () => {
    expect(Object.keys(RAW).sort()).toEqual([...KNOWN_BLOCK_TYPES].sort());
    for (const type of KNOWN_BLOCK_TYPES) expect(BlockSchema.safeParse({ id: `b-${type}`, ...RAW[type] }).success, type).toBe(true);
  });

  for (const type of KNOWN_BLOCK_TYPES) {
    it(`${type}: renders its content`, () => {
      const html = render([block(type)]);
      expect(html, `${type} renders nothing`).not.toBe('');
      expect(html.startsWith('<div class="pj-blocks">'), 'in the body column').toBe(true);
      if (type !== 'heading') {
        const at = wrapperAt(html, type);
        expect(at, `the ${type} wrapper`).toBeGreaterThanOrEqual(0);
        expect(html.slice(at), `the ${type} wrapper holds something`).not.toMatch(/^<div[^>]*><\/div>/);
      }
      for (const wanted of SHOWS[type]) {
        if (typeof wanted === 'string') expect(html, `${type}: ${wanted}`).toContain(wanted);
        else expect(html, `${type}: ${wanted}`).toMatch(wanted);
      }
    });
  }

  it('renders all 21 together, each in its place, in the order given', () => {
    const html = render(KNOWN_BLOCK_TYPES.map(block));
    const at = KNOWN_BLOCK_TYPES.map((type) => (type === 'heading' ? html.indexOf('<h2 id="b-heading"') : wrapperAt(html, type)));
    expect(KNOWN_BLOCK_TYPES.filter((_, i) => at[i] < 0), 'blocks missing').toEqual([]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe('an unknown block type renders nothing (ARCHITECTURE.md 15, item 8)', () => {
  const unknown = { id: 'zz-unknownzq', type: 'hologram', depth: 3, words: 'Unrenderedmarkerzq', media: { kind: 'image', src: PHOTO_2, alt: '' } };

  it('alone: no column, no wrapper, nothing at all', () => {
    expect(render([unknown])).toBe('');
  });

  it('between two known blocks: the same markup as without it, and no trace of it', () => {
    const known = [block('text'), block('quote')];
    const html = render([known[0], unknown, known[1]]);
    expect(html).toBe(render(known));
    for (const trace of ['zz-unknownzq', 'hologram', 'Unrenderedmarkerzq', 'img-7666']) expect(html, trace).not.toContain(trace);
  });

  it('inside a two-column block: the column renders without it', () => {
    const twoCol = { id: 'b-two', type: 'twoCol', left: [unknown, { id: 'l1', type: 'text', md: 'Leftonlyzq' }], right: [unknown] };
    const html = render([twoCol]);
    expect(html).toContain('Leftonlyzq');
    for (const trace of ['zz-unknownzq', 'hologram', 'Unrenderedmarkerzq']) expect(html, trace).not.toContain(trace);
  });
});
