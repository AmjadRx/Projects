// @vitest-environment jsdom
/**
 * The media hero's slot (components/home/HeroMediaFallback.tsx; the states boards, S.1 and S.5):
 * the photo, or the video behind its poster, as the server drew it; and the plan-view drawing with
 * its caption in its place once that picture does not load, whether it failed before the page came
 * alive or after, never an empty well or the browser's broken-image icon. A video that will not
 * play keeps its poster. The drawing here stands in for HeroDrawing (hero-modes.test.ts renders the
 * real hero).
 */
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import HeroMediaFallback from '../components/home/HeroMediaFallback';
import { UI } from '../lib/strings';

/** What the browser says of every picture: still on its way, loaded, or finished with no pixels (failed). */
const picture = { complete: false, naturalWidth: 0 };
const PROPS = ['complete', 'naturalWidth', 'currentSrc'] as const;
const real = new Map(PROPS.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, name)]));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => picture.complete });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => picture.naturalWidth });
  Object.defineProperty(HTMLImageElement.prototype, 'currentSrc', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.getAttribute('src') ?? '';
    },
  });
});

afterAll(() => {
  for (const name of PROPS) {
    const descriptor = real.get(name);
    if (descriptor) Object.defineProperty(HTMLImageElement.prototype, name, descriptor);
    else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

const drawing = h(
  'figure',
  { className: 'hm-hero__art hm-hero__art--drawing' },
  h('svg', { className: 'hd-svg', role: 'img', 'aria-label': UI.hero.drawing }),
  h('figcaption', { className: 'hm-art__cap' }, UI.heroCaption),
);
const photo = h('div', { className: 'ar-well hm-hero__media' }, h('img', { src: '/media/site/hero.webp', alt: '' }));
const video = h(
  'div',
  { className: 'ar-mv hm-hero__media' },
  h('div', { className: 'ar-mv__well' }, h('img', { src: '/media/site/hero-poster.webp', alt: '' }), h('video', { src: '/media/site/hero.mp4', muted: true })),
  h('div', { className: 'ar-mv__bar' }, h('button', { type: 'button' }, UI.hero.playVideo)),
);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  picture.complete = false;
  picture.naturalWidth = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = (media: ReturnType<typeof h>) => act(() => root.render(h(HeroMediaFallback, { fallback: drawing, children: media })));
const fail = (selector: string) => act(() => void host.querySelector(selector)!.dispatchEvent(new Event('error')));
const showsDrawing = () => host.querySelector('.hm-hero__art--drawing') !== null;

describe('the media hero, as the server draws it', () => {
  it('is the picture in the hero art slot, with no drawing', () => {
    const html = renderToString(h(HeroMediaFallback, { fallback: drawing, children: photo }));
    expect(html).toBe('<div class="hm-hero__art"><div class="ar-well hm-hero__media"><img src="/media/site/hero.webp" alt=""/></div></div>');
  });
});

describe('the media hero in the browser', () => {
  it('keeps a photo on its way, and gives the slot to the drawing, with its caption, when it does not load', () => {
    mount(photo);
    expect(host.querySelector('img')).not.toBeNull();
    expect(showsDrawing()).toBe(false);
    fail('img');
    expect(showsDrawing()).toBe(true);
    expect(host.querySelector('.hm-hero__media')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('figcaption')?.textContent).toBe(UI.heroCaption);
  });

  it('gives the slot to the drawing at once for a photo that failed before the page came alive', () => {
    picture.complete = true;
    mount(photo);
    expect(showsDrawing()).toBe(true);
  });

  it('keeps a photo that has loaded', () => {
    picture.complete = true;
    picture.naturalWidth = 1600;
    mount(photo);
    expect(showsDrawing()).toBe(false);
    expect(host.querySelector('.hm-hero__art > .hm-hero__media img')).not.toBeNull();
  });

  it("gives the slot to the drawing when a video's poster does not load", () => {
    mount(video);
    expect(showsDrawing()).toBe(false);
    fail('.ar-mv__well img');
    expect(showsDrawing()).toBe(true);
    expect(host.querySelector('video')).toBeNull();
  });

  it('keeps the poster and the Play button of a video that will not play', () => {
    mount(video);
    fail('video');
    expect(showsDrawing()).toBe(false);
    expect(host.querySelector('.ar-mv__well img')).not.toBeNull();
    expect(host.querySelector('.ar-mv__bar button')?.textContent).toBe(UI.hero.playVideo);
  });
});
