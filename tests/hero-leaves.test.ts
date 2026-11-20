// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hero } from '../lib/motion';

const state = vi.hoisted(() => ({ motionOk: true, paused: false }));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('../lib/useMotionOk', () => ({ useMotionOk: () => state.motionOk }));
vi.mock('../lib/motionPause', () => ({ useMotionPaused: () => state.paused }));

const { default: DrawingStage } = await import('../components/home/hero/DrawingStage');
const { default: RavenDrawing } = await import('../components/home/hero/RavenDrawing');
const { default: RotorTilt } = await import('../components/home/hero/RotorTilt');
const { createLens, lensTransform } = await import('../components/home/hero/lens');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REST = lensTransform(hero.lens.rest);
const TILTED = ['rotor', 'disc', 'pod-front', 'pod-sides', 'cable-left', 'cable-right'];
const FADED = ['blade', 'tail', 'tail-heat'];

/** The drawing's box with the drawing in it, as the server sends it, inside a hero section. */
function drawingBox(): HTMLDivElement {
  const section = document.createElement('section');
  section.className = 'hm-hero';
  const box = document.createElement('div');
  box.className = 'hm-art';
  box.innerHTML = renderToStaticMarkup(createElement(RavenDrawing, { label: 'Raven' }));
  section.append(box);
  document.body.append(section);
  return box;
}

const lensElements = (root: Element) => Array.from(root.querySelectorAll('[data-hd="lens"]'));
const faded = (root: Element) => Array.from(root.querySelectorAll<SVGElement>('.hd-th, .hd-ring'));

/** How many attributes the tilt has written into the drawing (none at rest). */
const posed = (root: Element) =>
  [...TILTED.map((name) => `[data-hd="${name}"][transform]`), ...FADED.map((name) => `[data-hd="${name}"][opacity]`)].reduce(
    (n, selector) => n + root.querySelectorAll(selector).length,
    0,
  );

describe('createLens: the lens outside React', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('moves the thermal clip and the ring together, in drawing units', () => {
    const box = drawingBox();
    const lens = createLens(box);
    expect(lensElements(box)).toHaveLength(2);
    lens.jumpTo({ x: 120, y: 410 });
    for (const el of lensElements(box)) expect(el.getAttribute('transform')).toBe('translate(120 410)');
    lens.destroy();
  });

  it('springs to a point and settles there', async () => {
    const box = drawingBox();
    const lens = createLens(box);
    lens.springTo({ x: 150, y: 128 }, hero.lens.follow);
    await vi.waitFor(() => {
      for (const el of lensElements(box)) expect(el.getAttribute('transform')).toBe('translate(150 128)');
    }, { timeout: 4000, interval: 50 });
    lens.destroy();
  });

  it('fades the lens and its thermal view by inline opacity, for touch', () => {
    const box = drawingBox();
    const lens = createLens(box);
    lens.fade(0, hero.touch.fadeOut);
    for (const el of faded(box)) {
      expect(el.style.opacity).toBe('0');
      expect(el.style.transition).toContain('opacity');
    }
    lens.destroy();
  });

  it('destroy() puts the drawing back as the server sent it: the lens at rest, no inline styles', () => {
    const box = drawingBox();
    const before = box.innerHTML;
    const lens = createLens(box);
    lens.jumpTo({ x: 60, y: 500 });
    lens.fade(1, hero.touch.fadeIn);
    lens.destroy();
    for (const el of lensElements(box)) expect(el.getAttribute('transform')).toBe(REST);
    for (const el of faded(box)) expect(el.getAttribute('style') ?? '').toBe('');
    expect(box.innerHTML.replace(/ style=""/g, '')).toBe(before);
  });
});

describe('RotorTilt', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('poses both layers and the mask while mounted, and clears every pose when it unmounts', () => {
    const box = drawingBox();
    const before = box.innerHTML;
    const host = document.createElement('div');
    document.body.append(host);
    const r = createRoot(host);
    act(() => r.render(createElement(RotorTilt, { art: { current: box } })));
    // Every tilted part in the line layer, the thermal layer and the stroke-in mask is written.
    expect(box.querySelectorAll('[data-hd="disc"][transform]')).toHaveLength(6);
    expect(box.querySelectorAll('[data-hd="rotor"][transform]')).toHaveLength(4);
    expect(posed(box)).toBeGreaterThan(0);
    act(() => r.unmount());
    expect(posed(box)).toBe(0);
    expect(box.innerHTML).toBe(before);
  });
});

describe('the rotor tilt puts the rotors back at hover when motion stops', () => {
  let root: Root | null = null;
  let section: HTMLElement;

  function render() {
    const r = root!;
    act(() => r.render(createElement(DrawingStage, null, createElement(RavenDrawing, { label: 'Raven' }))));
  }

  beforeEach(() => {
    state.motionOk = true;
    state.paused = false;
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-intro-seen');
    window.matchMedia = ((query: string) => ({
      matches: query !== '(prefers-reduced-motion: reduce)' && query.includes('pointer'),
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    section = document.createElement('section');
    section.className = 'hm-hero';
    document.body.append(section);
    root = createRoot(section);
  });

  afterEach(() => {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it('finds the box on the first mount (no StrictMode rerun to hide a missing ref), poses the rotors, and clears every pose when reduced motion turns on', () => {
    render();
    expect(posed(section)).toBeGreaterThan(0);
    state.motionOk = false;
    render();
    expect(posed(section)).toBe(0);
    for (const el of lensElements(section)) expect(el.getAttribute('transform')).toBe(REST);
  });

  it('clears every pose when the visitor pauses motion, and poses again on Play', () => {
    render();
    expect(posed(section)).toBeGreaterThan(0);
    state.paused = true;
    render();
    expect(posed(section)).toBe(0);
    state.paused = false;
    render();
    expect(posed(section)).toBeGreaterThan(0);
  });
});
