import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Hero from '../components/home/Hero';
import { loadPublicProjects, loadSite } from '../lib/content';
import { introGoScript, introScript } from '../lib/intro';
import { UI } from '../lib/strings';
import type { Site } from '../lib/types';

// useMotionOk reads the path; the hero renders on the home page.
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ prefetch: () => {} }) }));

// The model hero's viewer as the server renders it in a build. In a build, HeroModelLazy's
// next/dynamic renders the viewer on the server, its chunk awaited by the prerender; renderToString
// cannot wait and sends the dynamic's loading slot instead, so the viewer stands in for it here,
// rendered as tests/model-hero.test.ts renders it. That the dynamic keeps rendering on the server
// is checked from its source below.
vi.mock('@/components/viewers/model/HeroModelLazy', async () => ({
  default: (await vi.importActual<typeof import('../components/viewers/model/HeroModelViewer')>('../components/viewers/model/HeroModelViewer')).default,
}));

/** React's escaping of text and attribute values in server HTML. */
const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

/** The home page's hero as the server sends it, with the seed's content and these settings. */
function hero(settings: Partial<Site['settings']>): string {
  const site = loadSite();
  return renderToString(createElement(Hero, { site: { ...site, settings: { ...site.settings, ...settings } }, projects: loadPublicProjects() }));
}

const scripts = (html: string) => html.match(/<script\b/g)?.length ?? 0;
const ARM = `<script>${introScript()}</script>`;
const GO = `<script>${introGoScript()}</script>`;

describe('the hero visual follows settings.heroMode (ARCHITECTURE.md 6)', () => {
  it('drawing: Raven in plan view with the lens, its caption, and the load sequence go after the svg', () => {
    const html = hero({ heroMode: 'drawing' });
    expect(html).toContain('<figure class="hm-hero__art hm-hero__art--drawing"');
    expect(html).toMatch(/<svg class="hd-svg"[^>]*role="img"/);
    expect(html).toContain('class="hd-ring"');
    expect(html).toContain(UI.heroCaption);
    expect(html).not.toContain('hm-hero__media');
    // The section's first script marks it, the drawing's starts the strokes once the svg is parsed.
    expect(scripts(html)).toBe(2);
    expect(html).toMatch(new RegExp(`^<section [^>]*>${ARM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(html.indexOf(GO)).toBeGreaterThan(html.lastIndexOf('</svg>'));
  });

  it('model: the drawing, until the owner model hero joins (components/home/hero/HeroModel.tsx)', () => {
    const html = hero({ heroMode: 'model' });
    expect(html).toContain('hm-hero__art--drawing');
    expect(html).toContain('class="hd-svg"');
  });

  it("media: the owner's picture, with no drawing and no lens", () => {
    const html = hero({ heroMode: 'media' });
    expect(html).toContain('hm-hero__media');
    expect(html).toMatch(/<img\b/);
    for (const part of ['hm-hero__art--drawing', 'hd-svg', 'hd-ring', 'hd-th', GO]) expect(html, part.slice(0, 40)).not.toContain(part);
    // The section's own script stays: the headline's start state and give-up key off its mark.
    expect(scripts(html)).toBe(1);
    expect(html).toContain(ARM);
  });

  it('media with nothing uploaded: the placeholder at the drawing box, still no drawing', () => {
    const html = hero({ heroMode: 'media', heroMedia: undefined });
    expect(html).toContain(UI.placeholder.photoToCome);
    expect(html).not.toContain('hd-svg');
  });

  // The seed's hero has no model file and an image for media; the two cases below give the other
  // files the admin allows, the development samples (as tests/fixtures/states.ts does).
  it("model with the owner's model file: the model hero in the drawing's place, with its poster, its description and the caption, and no drawing", () => {
    const alt = 'A sample model';
    const html = hero({
      heroMode: 'model',
      heroModel: { kind: 'model', src: '/dev/samples/model.glb', poster: '/dev/samples/model-poster.webp', alt },
    });
    // In the drawing's place: the viewer's figure, its poster painted first, the model described
    // for screen readers, and the caption the drawing has.
    expect(html).toContain('<div class="hm-hero__art"><figure class="hm-model">');
    expect(html).toMatch(/<div class="hm-model__poster"[^>]*><img alt=""[^>]*>/);
    expect(html).toContain(encodeURIComponent('/dev/samples/model-poster.webp'));
    expect(html).toContain(`class="ar-sr">${escapeHtml(alt)}</p>`);
    expect(html).toContain(`<figcaption class="hm-art__cap">${escapeHtml(UI.heroCaption)}</figcaption></figure></div>`);
    for (const part of ['hm-hero__art--drawing', 'hd-svg', 'hd-ring', 'hm-hero__media', '<canvas', GO]) expect(html, part.slice(0, 40)).not.toContain(part);
    expect(scripts(html)).toBe(1);
  });

  it('keeps the model hero rendering on the server: its dynamic import is not client-only', () => {
    // With ssr: false the server would send only the empty slot, and the poster, the description and
    // the caption would wait for the chunk.
    const lazy = fs.readFileSync(path.resolve('components/viewers/model/HeroModelLazy.tsx'), 'utf8');
    expect(lazy).toContain("dynamic(() => import('./HeroModelViewer')");
    expect(lazy).not.toMatch(/\bssr\s*:\s*false\b/);
  });

  it('media with a video: its poster in the well, with no drawing and no lens', () => {
    const html = hero({
      heroMode: 'media',
      heroMedia: { kind: 'video', src: '/dev/samples/clip.mp4', poster: '/dev/samples/clip-poster.webp', alt: 'A sample clip' },
    });
    expect(html).toContain('hm-hero__media');
    expect(html).toMatch(/<img\b[^>]*clip-poster\.webp/);
    for (const part of ['hm-hero__art--drawing', 'hd-svg', 'hd-ring', 'hd-th', GO]) expect(html, part.slice(0, 40)).not.toContain(part);
  });

  it('keeps the headline markup as it is, whatever the mode', () => {
    for (const heroMode of ['drawing', 'model', 'media'] as const) {
      expect(hero({ heroMode })).toMatch(/<h1 class="hm-hero__title" id="hero-title">[^<]+<\/h1>/);
    }
  });
});
