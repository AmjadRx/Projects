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

  it('keeps the headline markup as it is, whatever the mode', () => {
    for (const heroMode of ['drawing', 'model', 'media'] as const) {
      expect(hero({ heroMode })).toMatch(/<h1 class="hm-hero__title" id="hero-title">[^<]+<\/h1>/);
    }
  });
});
