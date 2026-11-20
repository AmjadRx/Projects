// @vitest-environment jsdom
/**
 * The media hero's slot (components/home/HeroMediaFallback.tsx; the states boards, S.1 and S.5):
 * the photo, or the video behind its poster, as the server drew it; and the plan-view drawing with
 * its caption in its place once that picture does not load, whether it failed before the page came
 * alive or after, never an empty well or the browser's broken-image icon. Nothing shifts: the
 * drawing takes the slot in a box of the height the slot had as the picture failed, until the
 * window changes width. A video that will not play keeps its poster. The drawing here stands in
 * for HeroDrawing (hero-modes.test.ts renders the real hero).
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

/** The height the slot has in the page (jsdom lays nothing out), and the window's size. */
const layout = { slot: 0, width: 390, height: 844 };
const realWindow = { width: Object.getOwnPropertyDescriptor(window, 'innerWidth'), height: Object.getOwnPropertyDescriptor(window, 'innerHeight') };

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
  Object.defineProperty(HTMLDivElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: layout.slot, width: 0, height: layout.slot, toJSON: () => ({}) }),
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => layout.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => layout.height });
});

afterAll(() => {
  for (const name of PROPS) {
    const descriptor = real.get(name);
    if (descriptor) Object.defineProperty(HTMLImageElement.prototype, name, descriptor);
    else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[name];
  }
  delete (HTMLDivElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
  for (const [name, descriptor] of [['innerWidth', realWindow.width], ['innerHeight', realWindow.height]] as const) {
    if (descriptor) Object.defineProperty(window, name, descriptor);
    else delete (window as unknown as Record<string, unknown>)[name];
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
  layout.slot = 658.5;
  layout.width = 390;
  layout.height = 844;
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
const resize = (width: number, height: number) =>
  act(() => {
    layout.width = width;
    layout.height = height;
    window.dispatchEvent(new Event('resize'));
  });
const showsDrawing = () => host.querySelector('.hm-hero__art--drawing') !== null;
/** The box that holds the slot's height for the drawing, or null. */
const held = () => host.querySelector<HTMLElement>(':scope > .hm-hero__held');

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
    expect(held()).toBeNull();
    fail('img');
    expect(showsDrawing()).toBe(true);
    expect(host.querySelector('.hm-hero__media')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('figcaption')?.textContent).toBe(UI.heroCaption);
  });

  it('gives the drawing a box of the height the slot had, in the slot, so nothing shifts', () => {
    mount(photo);
    fail('img');
    const box = held();
    expect(box?.className).toBe('hm-hero__art hm-hero__held');
    expect(box?.style.height).toBe('658.5px');
    expect(box?.querySelector(':scope > .hm-hero__art--drawing')).not.toBeNull();
  });

  it('gives the slot to the drawing at once, in the same box, for a photo that failed before the page came alive', () => {
    picture.complete = true;
    layout.slot = 702;
    mount(photo);
    expect(showsDrawing()).toBe(true);
    expect(held()?.style.height).toBe('702px');
  });

  it("keeps the height while the window changes only in height (a phone's toolbar), and lets the drawing take its own size once it changes width", () => {
    mount(photo);
    fail('img');
    resize(390, 760);
    expect(held()?.style.height).toBe('658.5px');
    resize(844, 390);
    expect(held()).toBeNull();
    expect(host.querySelector(':scope > .hm-hero__art--drawing')).not.toBeNull();
    expect(host.querySelector('figcaption')?.textContent).toBe(UI.heroCaption);
  });

  it('keeps a photo that has loaded', () => {
    picture.complete = true;
    picture.naturalWidth = 1600;
    mount(photo);
    expect(showsDrawing()).toBe(false);
    expect(host.querySelector('.hm-hero__art > .hm-hero__media img')).not.toBeNull();
  });

  it("gives the slot to the drawing, in the video frame's height, when a video's poster does not load", () => {
    layout.slot = 412.25;
    mount(video);
    expect(showsDrawing()).toBe(false);
    fail('.ar-mv__well img');
    expect(showsDrawing()).toBe(true);
    expect(held()?.style.height).toBe('412.25px');
    expect(host.querySelector('video')).toBeNull();
  });

  it('keeps the poster and the Play button of a video that will not play', () => {
    mount(video);
    fail('video');
    expect(showsDrawing()).toBe(false);
    expect(held()).toBeNull();
    expect(host.querySelector('.ar-mv__well img')).not.toBeNull();
    expect(host.querySelector('.ar-mv__bar button')?.textContent).toBe(UI.hero.playVideo);
  });
});
