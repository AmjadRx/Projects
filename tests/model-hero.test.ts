/**
 * The hero model's shell (ARCHITECTURE.md 6 and 9; motion sheets 4.1, 4.5 and 6.3): when its engine
 * loads (useHeroActivation.ts, with the viewers' shared prefersTapToLoad), when its lens shows
 * (useHeroLens.ts lensEnabled), the markup the server sends (HeroModelViewer.tsx), the server
 * component's fallback (components/home/hero/HeroModel.tsx), and the split that keeps the shell out
 * of the home page's first load (HeroModelLazy.tsx). tests/model-hero-hydrate.test.ts hydrates
 * that markup in a browser-like document.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HeroModel from '@/components/home/hero/HeroModel';
import HeroModelViewer from '@/components/viewers/model/HeroModelViewer';
import { HINT_FADE_VARS } from '@/components/viewers/model/orbit';
import {
  HERO_INACTIVE,
  heroActivation,
  heroLoadPlan,
  type HeroActivationEvent,
} from '@/components/viewers/model/useHeroActivation';
import { lensEnabled } from '@/components/viewers/model/useHeroLens';
import { prefersTapToLoad } from '@/components/viewers/shared/useViewerActivation';
import { hero, media as mediaMotion, toMs } from '@/lib/motion';
import { UI } from '@/lib/strings';
import { HERO_MEDIA } from './fixtures/hero-media';

// Hoisted above the imports by Vitest: useMotionOk reads the path.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');

/** React's escaping of text and attribute values in server HTML. */
const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

describe('heroLoadPlan: when the engine loads (ARCHITECTURE.md 6; sheets 4.5 and 6.3)', () => {
  it('waits for a tap of the poster button on phones, tablets, and slow or metered connections', () => {
    for (const readyState of ['loading', 'interactive', 'complete'] as const) {
      expect(heroLoadPlan({ tapPreferred: true, readyState, hasIdleCallback: true })).toEqual({ wait: 'tap' });
    }
  });

  it('on a desktop waits for the load event, then an idle period, then the stage within 200 px of the view', () => {
    const { idleTimeout, noIdleDelay } = hero.model.afterInteractive;
    expect(heroLoadPlan({ tapPreferred: false, readyState: 'loading', hasIdleCallback: true })).toEqual({
      wait: 'interactive',
      afterLoadEvent: true,
      idle: { kind: 'callback', timeout: toMs(idleTimeout) },
      rootMargin: '200px 0px',
    });
    expect(mediaMotion.model.loadMargin).toBe(200);
    // Still loading its images: the load event is still to come.
    expect(heroLoadPlan({ tapPreferred: false, readyState: 'interactive', hasIdleCallback: true })).toMatchObject({ afterLoadEvent: true });
    // Already loaded (the shell's chunk came late): straight to the idle wait.
    expect(heroLoadPlan({ tapPreferred: false, readyState: 'complete', hasIdleCallback: true })).toMatchObject({ afterLoadEvent: false });
    // Safari has no requestIdleCallback: a short delay instead.
    expect(heroLoadPlan({ tapPreferred: false, readyState: 'complete', hasIdleCallback: false })).toMatchObject({
      idle: { kind: 'delay', ms: toMs(noIdleDelay) },
    });
  });
});

describe('prefersTapToLoad: who waits for a tap (components/viewers/shared/useViewerActivation.ts)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function device({ fine, connection }: { fine: boolean; connection?: { saveData?: boolean; effectiveType?: string } }) {
    vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: fine && query === '(hover: hover) and (pointer: fine)' }) });
    vi.stubGlobal('navigator', { connection });
  }

  it('loads near the view with a mouse on a fast connection, and waits for a tap on touch or a slow connection', () => {
    device({ fine: true });
    expect(prefersTapToLoad('view-or-tap')).toBe(false);
    device({ fine: true, connection: { effectiveType: '4g' } });
    expect(prefersTapToLoad('view-or-tap')).toBe(false);
    device({ fine: false });
    expect(prefersTapToLoad('view-or-tap')).toBe(true);
    device({ fine: true, connection: { saveData: true } });
    expect(prefersTapToLoad('view-or-tap')).toBe(true);
    for (const effectiveType of ['slow-2g', '2g', '3g']) {
      device({ fine: true, connection: { effectiveType } });
      expect(prefersTapToLoad('view-or-tap')).toBe(true);
    }
  });
});

describe('heroActivation: the activation state machine', () => {
  const run = (...events: HeroActivationEvent[]) => events.reduce(heroActivation, HERO_INACTIVE);

  it('starts inactive, so the poster paints first (on the server too)', () => {
    expect(run()).toEqual({ active: false, requiresTap: false, byTap: false });
  });

  it('on a phone shows the button, and a tap loads the engine and says so (the slow turn of sheet 4.5)', () => {
    expect(run('tap-needed')).toEqual({ active: false, requiresTap: true, byTap: false });
    expect(run('tap-needed', 'activate')).toEqual({ active: true, requiresTap: false, byTap: true });
  });

  it('on a desktop loads near the view, or on a view button pressed before that, never as a tap', () => {
    expect(run('near')).toEqual({ active: true, requiresTap: false, byTap: false });
    expect(run('activate')).toEqual({ active: true, requiresTap: false, byTap: false });
  });

  it('stays as it is once the engine is on, and keeps the same state when nothing changes', () => {
    expect(run('tap-needed', 'activate', 'near', 'tap-needed', 'activate')).toEqual({ active: true, requiresTap: false, byTap: true });
    expect(run('near', 'tap-needed', 'activate')).toEqual({ active: true, requiresTap: false, byTap: false });
    const waiting = run('tap-needed');
    expect(heroActivation(waiting, 'tap-needed')).toBe(waiting);
    const on = run('near');
    expect(heroActivation(on, 'activate')).toBe(on);
  });
});

describe('lensEnabled: when the lens shows (DESIGN_DIRECTION.md 6.1; sheets 4.1, 4.5 and 8)', () => {
  const on = { motion: true, finePointer: true, engineReady: true, view: 'realistic' as const };

  it('shows in the Realistic view, with a mouse or pen, with motion, once the engine draws', () => {
    expect(lensEnabled(on)).toBe(true);
  });

  it('is off under reduced motion or the pause control, on touch, before the engine, and in the other views', () => {
    expect(lensEnabled({ ...on, motion: false })).toBe(false);
    expect(lensEnabled({ ...on, finePointer: false })).toBe(false);
    expect(lensEnabled({ ...on, engineReady: false })).toBe(false);
    expect(lensEnabled({ ...on, view: 'blueprint' })).toBe(false);
    expect(lensEnabled({ ...on, view: 'thermal' })).toBe(false);
  });
});

describe('HeroModelViewer on the server: the markup the first client render matches', () => {
  const html = renderToString(createElement(HeroModelViewer, { media: HERO_MEDIA, caption: UI.heroCaption }));

  it('paints the poster, with no engine and no button yet', () => {
    expect(html.startsWith('<figure class="hm-model">')).toBe(true);
    expect(html).toMatch(/<div class="hm-model__poster" style="--hm-poster-out:150ms;--hm-poster-ease:[^"]+"><img alt=""/);
    expect(html).toContain(encodeURIComponent('/media/site/hero-poster.webp'));
    expect(html).not.toContain('role="application"');
    expect(html).not.toContain('<canvas');
    expect(html).not.toContain('ar-mv__play');
    // The lens ring is there from the start, hidden until a mouse comes over the stage.
    expect(html).toContain('<span class="hm-model__ring" aria-hidden="true"></span>');
  });

  it('shows the three views with Realistic pressed, and the hint with its 150 ms fade', () => {
    const views = [...html.matchAll(/<button type="button" class="ar-mv__btn ar-mv__btn--text" aria-pressed="(true|false)">([^<]+)<\/button>/g)];
    expect(views.map((match) => [match[2], match[1]])).toEqual([
      [escapeHtml(UI.viewers.model.realistic), 'true'],
      [escapeHtml(UI.viewers.model.blueprint), 'false'],
      [escapeHtml(UI.viewers.model.thermal), 'false'],
    ]);
    const fade = Object.entries(HINT_FADE_VARS)
      .map(([name, value]) => `${name}:${value}`)
      .join(';');
    const hint = /<span class="hm-model__hint[^"]*" style="([^"]*)">/.exec(html);
    expect(hint?.[1]).toBe(fade);
    expect(html).toContain(escapeHtml(UI.viewers.model.hint));
  });

  it('ends with the caption, the figure last child, after the model description', () => {
    expect(html.endsWith(`<figcaption class="hm-art__cap">${escapeHtml(UI.heroCaption)}</figcaption></figure>`)).toBe(true);
    const description = html.indexOf(`class="ar-sr">${escapeHtml(HERO_MEDIA.alt)}</p>`);
    expect(description).toBeGreaterThan(html.indexOf('hm-model__stage'));
    expect(description).toBeLessThan(html.indexOf('hm-model__bar'));
  });

  it('leaves the description out when the model has no alt text', () => {
    const bare = renderToString(createElement(HeroModelViewer, { media: { ...HERO_MEDIA, alt: '' }, caption: UI.heroCaption }));
    expect(bare).not.toContain('class="ar-sr"');
    expect(bare.endsWith('</figcaption></figure>')).toBe(true);
  });
});

describe('HeroModel: the hero visual in mode "model" (components/home/hero/HeroModel.tsx)', () => {
  const fallback = createElement('p', { className: 'fallback' }, 'the drawing');

  it('renders the fallback and nothing of its own when heroModel has no model file', () => {
    const settings: Parameters<typeof HeroModel>[0]['model'][] = [
      undefined,
      { kind: 'model', src: '', alt: '' },
      { kind: 'image', src: '/media/site/img-7414.webp', alt: '' },
    ];
    for (const model of settings) {
      expect(renderToString(createElement(HeroModel, { model, fallback }))).toBe('<p class="fallback">the drawing</p>');
    }
  });

  it('keeps the viewer out of the home page first load: its dynamic import sits in a client file', () => {
    // A server component's client imports, a dynamic import() included, go into the route's first
    // load; only a client file's import() makes a chunk of its own. The build's check:sky --build
    // measures the result; this keeps the arrangement from coming undone.
    const server = read('components/home/hero/HeroModel.tsx');
    expect(server).not.toMatch(/^\s*['"]use client['"]/);
    expect(server).not.toMatch(/from 'next\/dynamic'|\bimport\s*\(/);
    expect(server).not.toMatch(/HeroModelViewer['"]/);
    expect(server).toContain("from '@/components/viewers/model/HeroModelLazy'");
    const lazy = read('components/viewers/model/HeroModelLazy.tsx');
    expect(lazy).toMatch(/^'use client';/);
    expect(lazy).toContain("dynamic(() => import('./HeroModelViewer')");
  });
});
