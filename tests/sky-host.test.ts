/**
 * The sky's host (Phase 5): the server markup of the sky and the footer, the pause-motion store,
 * "empty sky", and components/sky/host.ts at run time against a fake browser and a fake live
 * scene (the real scene needs WebGL). The tier rules themselves are in tests/sky-tier.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LiveController, LiveOptions } from '../components/sky/contract';
import { NOT_EMPTY_SKY, isEmptySky } from '../components/sky/emptySky';
import { bindLive, startSkyHost, type SceneFactory } from '../components/sky/host';
import Sky from '../components/sky/Sky';
import Footer from '../components/site/Footer';
import PauseMotion from '../components/site/PauseMotion';
import { SKY, skyFiles, stored, toMs } from '../lib/motion';
import { PROJECTION, projScale } from '../lib/sky/astro';
import { MOTION_PAUSED_EVENT, motionPaused, setMotionPaused, subscribeMotionPaused } from '../lib/motionPause';
import { STILL_FALLBACK_STEP, stepTimeNear } from '../lib/sky/still-steps';
import type { LiveTier } from '../lib/sky/tier';
import { UI } from '../lib/strings';
import { STILL_CLASSES, blueprintStillUrl, stillVar } from '../lib/theme';

// ---------------------------------------------------------------------------------------------
// A fake browser
// ---------------------------------------------------------------------------------------------

type Listener = (event: any) => void;

/** An event target whose listeners the test can count and call with any event object. */
class FakeTarget {
  private entries = new Map<string, { fn: Listener; once: boolean }[]>();
  addEventListener(type: string, fn: Listener, options?: boolean | AddEventListenerOptions): void {
    const list = this.entries.get(type) ?? [];
    if (list.some((entry) => entry.fn === fn)) return;
    list.push({ fn, once: typeof options === 'object' && options.once === true });
    this.entries.set(type, list);
  }
  removeEventListener(type: string, fn: Listener): void {
    const list = this.entries.get(type);
    const at = list?.findIndex((entry) => entry.fn === fn) ?? -1;
    if (list && at >= 0) list.splice(at, 1);
  }
  dispatchEvent(event: { type: string }): boolean {
    this.fire(event.type, event);
    return true;
  }
  fire(type: string, event: object = {}): void {
    for (const entry of [...(this.entries.get(type) ?? [])]) {
      if (entry.once) this.removeEventListener(type, entry.fn);
      entry.fn({ type, ...event });
    }
  }
  get listenerCount(): number {
    let count = 0;
    for (const list of this.entries.values()) count += list.length;
    return count;
  }
}

class FakeMutationObserver {
  static active = new Set<FakeMutationObserver>();
  constructor(private readonly callback: () => void) {}
  observe(): void {
    FakeMutationObserver.active.add(this);
  }
  disconnect(): void {
    FakeMutationObserver.active.delete(this);
  }
  static trigger(): void {
    for (const observer of FakeMutationObserver.active) observer.callback();
  }
}

class FakeResizeObserver {
  static active = new Set<FakeResizeObserver>();
  constructor(private readonly callback: (entries: { contentRect: { width: number; height: number } }[]) => void) {}
  observe(): void {
    FakeResizeObserver.active.add(this);
  }
  disconnect(): void {
    FakeResizeObserver.active.delete(this);
  }
  static trigger(width: number, height: number): void {
    for (const observer of FakeResizeObserver.active) observer.callback([{ contentRect: { width, height } }]);
  }
}

const REDUCED = '(prefers-reduced-motion: reduce)';
/** One reduced-motion query for the whole file: lib/useMotionOk.ts keeps the first it is given. */
const reduced = Object.assign(new FakeTarget(), { matches: false, media: REDUCED });

/** The browser's idle callback in the fake: a short timer. */
const IDLE = 50;

interface EnvOptions {
  fine?: boolean;
  memoryGb?: number;
  cores?: number;
  saveData?: boolean;
  webgl2?: boolean;
  loaded?: boolean;
  /** The first paint, in ms from now. */
  firstPaintIn?: number;
  /** data-sky-step as the head script wrote it; null for none. */
  step?: string | null;
  storage?: Record<string, string>;
}

function makeEnv(options: EnvOptions = {}) {
  const win = new FakeTarget() as FakeTarget & Record<string, unknown>;
  const doc = new FakeTarget() as FakeTarget & { hidden: boolean; readyState: string; documentElement: unknown };
  const attrs = new Map<string, string>([['data-theme', 'blueprint']]);
  if (options.step !== null) attrs.set('data-sky-step', options.step ?? '7');
  const html = {
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attrs.set(name, String(value)),
    removeAttribute: (name: string) => void attrs.delete(name),
    hasAttribute: (name: string) => attrs.has(name),
    clientWidth: 1280,
    clientHeight: 800,
  };
  const storage = new Map<string, string>(Object.entries(options.storage ?? {}));
  const connection = Object.assign(new FakeTarget(), { saveData: options.saveData ?? false });
  const firstPaint = performance.now() + (options.firstPaintIn ?? -10_000);
  Object.assign(win, {
    matchMedia: (query: string) =>
      query === REDUCED
        ? reduced
        : { matches: query === '(pointer: fine)' ? (options.fine ?? true) : false, addEventListener() {}, removeEventListener() {} },
    navigator: { hardwareConcurrency: options.cores ?? 8, deviceMemory: options.memoryGb ?? 8, connection },
    requestIdleCallback: (run: () => void) => setTimeout(run, IDLE),
    cancelIdleCallback: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    performance: { getEntriesByName: (name: string) => (name === 'first-paint' ? [{ startTime: firstPaint }] : []) },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => void storage.delete(key),
    },
    location: { pathname: '/' },
    ...(options.webgl2 === false ? {} : { WebGL2RenderingContext: function WebGL2RenderingContext() {} }),
  });
  Object.assign(doc, { documentElement: html, readyState: options.loaded === false ? 'loading' : 'complete', hidden: false });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('MutationObserver', FakeMutationObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);

  const classes = new Set<string>();
  const elements = {
    root: { getBoundingClientRect: () => ({ width: 1280, height: 800 }) } as unknown as HTMLElement,
    live: {
      classList: {
        add: (name: string) => void classes.add(name),
        remove: (name: string) => void classes.delete(name),
        contains: (name: string) => classes.has(name),
      },
    } as unknown as HTMLElement,
    labels: { labels: true } as unknown as HTMLElement,
  };
  return { win, doc, html, attrs, storage, connection, elements, classes };
}

type FakeController = { [K in keyof LiveController]: Mock };

/** A live scene that records what the host asks of it. */
function fakeLive({ failImport = false, failData = false } = {}) {
  const scenes: { options: LiveOptions; controller: FakeController }[] = [];
  const factoryTiers: LiveTier[] = [];
  const loadLive = vi.fn(async (): Promise<SceneFactory> => {
    if (failImport) throw new Error('the chunk did not load');
    return async (tier) => {
      factoryTiers.push(tier);
      if (failData) throw new Error('the data did not load');
      return (_container, options) => {
        const controller: FakeController = {
          setSize: vi.fn(),
          setTheme: vi.fn(),
          setTier: vi.fn(),
          setPointer: vi.fn(),
          ripple: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          destroy: vi.fn(),
        };
        scenes.push({ options, controller });
        return controller as unknown as LiveController;
      };
    };
  });
  return { loadLive, scenes, factoryTiers };
}

/** Lets the host's awaits (import, data, scene) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/** An element under the pointer: empty sky, or inside something that is not. */
function target({ inside = false, textBoxes = [] as { left: number; right: number; top: number; bottom: number }[] } = {}) {
  return {
    closest: (selector: string) => (inside && selector === NOT_EMPTY_SKY ? { localName: 'p', closest: () => null } : null),
    childNodes: textBoxes.length ? [{ nodeType: 3, textContent: 'Words' }] : [],
    ownerDocument: { createRange: () => ({ selectNodeContents() {}, getClientRects: () => textBoxes }) },
  };
}

function touches(...list: { identifier: number; clientX: number; clientY: number }[]) {
  return Object.assign([...list], { item: (i: number) => list[i] ?? null });
}

// ---------------------------------------------------------------------------------------------

describe('the pause-motion store', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('answers "not paused" outside a browser', () => {
    expect(motionPaused()).toBe(false);
    expect(subscribeMotionPaused(() => {})).toBeTypeOf('function');
  });

  it('keeps the choice in localStorage, marks <html>, and tells its listeners', () => {
    const env = makeEnv();
    const heard = vi.fn();
    const stop = subscribeMotionPaused(heard);
    expect(motionPaused()).toBe(false);
    setMotionPaused(true);
    expect(motionPaused()).toBe(true);
    expect(env.storage.get(stored.motionPaused)).toBe('1');
    expect(env.attrs.get('data-motion-paused')).toBe('true');
    setMotionPaused(false);
    expect(motionPaused()).toBe(false);
    expect(env.storage.has(stored.motionPaused)).toBe(false);
    expect(env.attrs.has('data-motion-paused')).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    expect(env.win.listenerCount).toBe(0);
  });

  it('hears a change made in another tab', () => {
    const env = makeEnv();
    const heard = vi.fn();
    const stop = subscribeMotionPaused(heard);
    env.storage.set(stored.motionPaused, '1');
    env.win.fire('storage', { key: 'something-else' });
    expect(heard).not.toHaveBeenCalled();
    env.win.fire('storage', { key: stored.motionPaused });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(motionPaused()).toBe(true);
    expect(env.attrs.get('data-motion-paused')).toBe('true');
    stop();
  });

  it('holds the choice for the page when storage is blocked', () => {
    const env = makeEnv();
    const blocked = () => {
      throw new Error('blocked');
    };
    Object.assign(env.win.localStorage as object, { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(motionPaused()).toBe(false);
    setMotionPaused(true);
    expect(motionPaused()).toBe(true);
    setMotionPaused(false);
    expect(motionPaused()).toBe(false);
    // Storage that works again takes over.
    Object.assign(env.win.localStorage as object, {
      getItem: (key: string) => env.storage.get(key) ?? null,
      setItem: (key: string, value: string) => void env.storage.set(key, value),
      removeItem: (key: string) => void env.storage.delete(key),
    });
    setMotionPaused(true);
    expect(env.storage.get(stored.motionPaused)).toBe('1');
    expect(motionPaused()).toBe(true);
    setMotionPaused(false);
  });

  it('fires its event on window', () => {
    makeEnv();
    const heard = vi.fn();
    (window as unknown as FakeTarget).addEventListener(MOTION_PAUSED_EVENT, heard);
    setMotionPaused(true);
    setMotionPaused(false);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('empty sky', () => {
  it('lists every kind of element the contract keeps from the sky', () => {
    const selectors = NOT_EMPTY_SKY.split(', ');
    for (const tag of ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'p', 'li', 'dt', 'dd', 'figure', 'img', 'video', 'canvas', 'table', 'nav', 'header', 'footer']) {
      expect(selectors, tag).toContain(tag);
    }
    for (const heading of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) expect(selectors).toContain(heading);
    expect(selectors).toEqual(expect.arrayContaining(['[role="button"]', '.ar-glass', '.ar-btn']));
    // Focusable widgets count, but not <main tabindex="-1">, which holds every page.
    expect(selectors).toContain('[tabindex]:not([tabindex^="-"])');
  });

  it('is empty sky only off every listed element and off any text under the point', () => {
    expect(isEmptySky(target() as unknown as Element, 5, 5)).toBe(true);
    expect(isEmptySky(target({ inside: true }) as unknown as Element, 5, 5)).toBe(false);
    const words = target({ textBoxes: [{ left: 0, right: 100, top: 0, bottom: 20 }] }) as unknown as Element;
    expect(isEmptySky(words, 50, 10)).toBe(false);
    expect(isEmptySky(words, 50, 40)).toBe(true);
  });

  it("counts the sky's own canvas as sky, and anything that is not an element as not", () => {
    const skyCanvas = { localName: 'canvas', closest: (selector: string) => (selector === '.ar-sky' ? {} : null) };
    const inCanvas = { closest: () => skyCanvas, childNodes: [], ownerDocument: { createRange: () => null } };
    expect(isEmptySky(inCanvas as unknown as Element, 1, 1)).toBe(true);
    const otherCanvas = { closest: () => ({ localName: 'canvas', closest: () => null }), childNodes: [] };
    expect(isEmptySky(otherCanvas as unknown as Element, 1, 1)).toBe(false);
    expect(isEmptySky(null, 1, 1)).toBe(false);
    expect(isEmptySky({} as EventTarget, 1, 1)).toBe(false);
  });
});

describe('the server markup', () => {
  it('draws the sky as four layers, with its numbers from lib/motion.ts and the server still', () => {
    const html = renderToString(createElement(Sky, { background: 'sky' }));
    expect(html).toMatch(/^<div class="ar-sky ar-sky--fixed" data-background="sky" aria-hidden="true" style="[^"]*">/);
    const layers = [...html.matchAll(/<div class="(ar-sky__[a-z]+)"/g)].map((m) => m[1]);
    // The labels layer comes after the dawn, so the drafting lines and names are drawn above it.
    expect(layers).toEqual(['ar-sky__still', 'ar-sky__live', 'ar-sky__dawn', 'ar-sky__labels']);
    expect(html).toContain(`--sky-dawn-min:${SKY.dawnMin}`);
    expect(html).toContain(`--sky-dawn-max:${SKY.dawnMax}`);
    expect(html).toContain(`--sky-fade:${toMs(SKY.liveFade.duration)}ms`);
    for (const widthClass of STILL_CLASSES) {
      expect(html).toContain(`--sky-still-${widthClass}-fallback:url(&quot;${blueprintStillUrl(widthClass, STILL_FALLBACK_STEP)}&quot;)`);
    }
    expect(html).not.toMatch(/<img|<canvas|\ssrc=/);
  });

  it('draws the grid and the plain sheet as one empty layer, with no still and no scene', () => {
    for (const background of ['grid', 'off'] as const) {
      expect(renderToString(createElement(Sky, { background }))).toBe(
        `<div class="ar-sky ar-sky--fixed" data-background="${background}" aria-hidden="true"></div>`,
      );
    }
  });

  it('places each still from its size, in units of the projection scale, for the stylesheet', () => {
    const html = renderToString(createElement(Sky, { background: 'sky' }));
    const style = /^<div [^>]*style="([^"]*)"/.exec(html)?.[1] ?? '';
    const value = (name: string) => Number(new RegExp(`${name}:([^;]+)`).exec(style)?.[1]);
    expect(value('--sky-hz')).toBe(SKY.horizon);
    expect(value('--sky-k-h')).toBeCloseTo(PROJECTION.top * SKY.horizon, 6);
    expect(value('--sky-k-w')).toBeCloseTo(PROJECTION.wide, 6);
    expect(value('--sky-k-c')).toBeCloseTo(PROJECTION.cap * SKY.horizon, 6);
    // The CSS scale, k = min(k-h H, max(k-w W, k-c H)), is the scene's projScale with the horizon at SKY.horizon.
    for (const [W, H] of [[390, 844], [1440, 900], [768, 1024], [3440, 1300]]) {
      const k = Math.min(value('--sky-k-h') * H, Math.max(value('--sky-k-w') * W, value('--sky-k-c') * H));
      expect(k).toBeCloseTo(projScale(W, H * SKY.horizon), 3);
    }
    for (const widthClass of STILL_CLASSES) {
      const { width, height } = skyFiles.stills[widthClass];
      const horizon = Math.round(height * SKY.horizon);
      const k = projScale(width, horizon);
      expect(value(`${stillVar(widthClass)}-w`)).toBeCloseTo(width / k, 6);
      expect(value(`${stillVar(widthClass)}-h`)).toBeCloseTo(height / k, 6);
      expect(value(`${stillVar(widthClass)}-hy`)).toBeCloseTo(horizon / k, 6);
      expect(value(`${stillVar(widthClass)}-ground`)).toBeCloseTo((height - horizon) / height, 6);
    }
  });

  it("picks the still's shape where the view's scale switches, and draws each still in the shape that covers its windows", () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'sheet.css'), 'utf8');
    const section = css.slice(css.indexOf('---------- 23.'), css.indexOf('---------- 24.'));
    const ratios = [...section.matchAll(/@container sky \(min-aspect-ratio: (\d+) \/ (\d+)\)/g)].map((m) => Number(m[1]) / Number(m[2]));
    expect(ratios.length).toBeGreaterThan(0);
    // Wider than this, projScale follows the height (PROJECTION.top); narrower, the width or the cap.
    const wideSwitch = (SKY.horizon * PROJECTION.top) / PROJECTION.wide;
    for (const ratio of ratios) expect(Math.abs(ratio - wideSwitch)).toBeLessThan(0.001);
    // The narrow stills sit at the switch below (cap over wide), so one shape covers every narrow window.
    const narrow = (SKY.horizon * PROJECTION.cap) / PROJECTION.wide;
    for (const widthClass of ['phone', 'tablet'] as const) {
      const { width, height } = skyFiles.stills[widthClass];
      expect(Math.abs(width / height / narrow - 1), widthClass).toBeLessThan(0.001);
    }
    const desktop = skyFiles.stills.desktop;
    expect(desktop.width / desktop.height).toBeGreaterThanOrEqual(2.4);
  });

  it('renders the pause control as a plain button whose words say what it will do', () => {
    // No aria-pressed: a toggle must keep one label, and here the words carry the state.
    expect(renderToString(createElement(PauseMotion, { labels: { pause: UI.sky.pauseMotion, play: UI.sky.playMotion } }))).toBe(
      '<button type="button" class="ar-foot__pause">Pause motion</button>',
    );
    expect([UI.sky.pauseMotion, UI.sky.playMotion]).toEqual(['Pause motion', 'Play motion']);
  });

  function footer(credits: boolean): string {
    return renderToString(
      createElement(Footer, {
        name: 'Owner Name',
        tagline: 'A tagline.',
        email: 'owner@example.com',
        socials: [],
        updated: '2026-11-17',
        year: 2026,
        credits,
      }),
    );
  }

  const textOf = (fragment: string) => fragment.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

  it("prints the sky's credit line word for word, with the licence linked, when the background is the sky", () => {
    const meta = /<div class="ar-foot__meta">([\s\S]*)<\/div><\/div><\/footer>$/.exec(footer(true))?.[1] ?? '';
    const line = /<p class="ar-foot__credits">([\s\S]*?)<\/p>/.exec(meta)?.[1] ?? '';
    expect(textOf(line)).toBe('Stars: Yale Bright Star Catalogue (Hoffleit and Warren). Milky Way: ESO/S. Brunier, CC BY.');
    // As the bundle's Footer: only "CC BY" is a link; the source notes are not linked from the page.
    expect(line.match(/<a /g)).toHaveLength(1);
    expect(line).not.toContain('CREDITS.md');
    expect(line).toContain('<a class="ar-link ar-link--inline" href="https://creativecommons.org/licenses/by/4.0/" rel="license">CC BY</a>');
    expect(line.match(/rel="license"/g)).toHaveLength(1);
    // The bundle's order (the date, the copyright, the credit line), then the pause control.
    expect(meta).toContain('class="ar-foot__pause"');
    expect(meta.indexOf('ar-foot__credits')).toBeLessThan(meta.indexOf('ar-foot__pause'));
  });

  it('leaves the credit line out for the grid and the plain sheet, and keeps the pause control', () => {
    const html = footer(false);
    expect(html).not.toContain('ar-foot__credits');
    expect(html).not.toContain('Hoffleit');
    expect(html).toContain('class="ar-foot__pause"');
  });
});

describe('the host at run time', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    vi.setSystemTime(Date.UTC(2026, 10, 18, 4, 0, 0));
    reduced.matches = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeMutationObserver.active.clear();
    FakeResizeObserver.active.clear();
  });

  async function started(options: EnvOptions = {}, liveOptions: Parameters<typeof fakeLive>[0] = {}) {
    const env = makeEnv(options);
    const live = fakeLive(liveOptions);
    const stop = startSkyHost(env.elements, { getProgress: () => 0.25, loadLive: live.loadLive });
    await vi.advanceTimersByTimeAsync(IDLE);
    await settle();
    return { env, live, stop };
  }

  it('imports the live scene only after the load event and an idle moment, and starts it from the still', async () => {
    const env = makeEnv({ loaded: false });
    const live = fakeLive();
    const stop = startSkyHost(env.elements, { getProgress: () => 0.25, loadLive: live.loadLive });
    expect(env.attrs.get('data-sky-tier')).toBe('full');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(live.loadLive).not.toHaveBeenCalled();

    env.win.fire('load');
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    expect(live.loadLive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(live.loadLive).toHaveBeenCalledTimes(1);
    expect(live.factoryTiers).toEqual(['full']);
    const [{ options, controller }] = live.scenes;
    expect(options).toMatchObject({ theme: 'blueprint', tier: 'full' });
    expect(options.startTimeMs).toBe(stepTimeNear(7, Date.now()));
    expect(Math.abs(options.startTimeMs - Date.now())).toBeLessThan(24 * 60 * 60 * 1000);
    expect(options.getProgress()).toBe(0.25);
    expect(options.overlay).toBe(env.elements.labels);
    expect(controller.setSize).toHaveBeenCalledWith(1280, 800);
    expect(controller.start).toHaveBeenCalledTimes(1);
    stop();
  });

  it("starts from the server's step when the head script left none", async () => {
    const { live, stop } = await started({ step: null });
    expect(live.scenes[0].options.startTimeMs).toBe(stepTimeNear(STILL_FALLBACK_STEP, Date.now()));
    stop();
  });

  it('fades the live layer in after the first frame, never before 400 ms after the first paint', async () => {
    const { env, live, stop } = await started({ firstPaintIn: 100 });
    live.scenes[0].options.onReady();
    const due = 100 + toMs(SKY.liveFade.notBefore) - IDLE;
    await vi.advanceTimersByTimeAsync(due - 1);
    expect(env.classes.has('is-ready')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(env.classes.has('is-ready')).toBe(true);
    stop();
    expect(env.classes.has('is-ready')).toBe(false);
  });

  it('gives a coarse pointer the Light tier, and never imports the scene for the Still tier', async () => {
    const light = await started({ fine: false });
    expect(light.env.attrs.get('data-sky-tier')).toBe('light');
    expect(light.live.factoryTiers).toEqual(['light']);
    expect(light.live.scenes[0].options.tier).toBe('light');
    light.stop();
    vi.unstubAllGlobals();

    for (const options of [{ webgl2: false }, { saveData: true }, { storage: { [stored.motionPaused]: '1' } }] as EnvOptions[]) {
      const still = await started(options);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(still.env.attrs.get('data-sky-tier'), JSON.stringify(options)).toBe('still');
      expect(still.live.loadLive, JSON.stringify(options)).not.toHaveBeenCalled();
      still.stop();
      vi.unstubAllGlobals();
    }

    reduced.matches = true;
    const calm = await started();
    expect(calm.env.attrs.get('data-sky-tier')).toBe('still');
    expect(calm.live.loadLive).not.toHaveBeenCalled();
    calm.stop();
  });

  it('settles to the still at once when the visitor pauses motion, and plays again', async () => {
    const { env, live, stop } = await started();
    const first = live.scenes[0];
    first.options.onReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(env.classes.has('is-ready')).toBe(true);

    setMotionPaused(true);
    expect(first.controller.destroy).toHaveBeenCalledTimes(1);
    expect(env.classes.has('is-ready')).toBe(false);
    expect(env.attrs.get('data-sky-tier')).toBe('still');
    expect(env.attrs.get('data-motion-paused')).toBe('true');

    setMotionPaused(false);
    expect(env.attrs.get('data-sky-tier')).toBe('full');
    await vi.advanceTimersByTimeAsync(IDLE);
    await settle();
    expect(live.scenes).toHaveLength(2);
    expect(live.loadLive).toHaveBeenCalledTimes(1);
    expect(live.scenes[1].controller.start).toHaveBeenCalledTimes(1);
    stop();
  });

  it('goes to the still when reduced motion is turned on during the visit, and back when it is off', async () => {
    const { env, live, stop } = await started();
    reduced.matches = true;
    reduced.fire('change');
    expect(live.scenes[0].controller.destroy).toHaveBeenCalledTimes(1);
    expect(env.attrs.get('data-sky-tier')).toBe('still');
    reduced.matches = false;
    reduced.fire('change');
    await vi.advanceTimersByTimeAsync(IDLE);
    await settle();
    expect(live.scenes).toHaveLength(2);
    stop();
  });

  it('goes to the still when Save-Data is turned on during the visit', async () => {
    const { env, live, stop } = await started();
    env.connection.saveData = true;
    env.connection.fire('change');
    expect(live.scenes[0].controller.destroy).toHaveBeenCalledTimes(1);
    expect(env.attrs.get('data-sky-tier')).toBe('still');
    stop();
  });

  it('steps down Full to Light on a slow probe, then Light to Still after two slow seconds, with a fade', async () => {
    const { env, live, stop } = await started();
    const scene = live.scenes[0];
    scene.options.onReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(env.classes.has('is-ready')).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    scene.options.onFps(30);
    expect(scene.controller.setTier).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    scene.options.onFps(30);
    expect(scene.controller.setTier).toHaveBeenCalledWith('light');
    expect(env.attrs.get('data-sky-tier')).toBe('light');

    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(500);
      scene.options.onFps(30);
    }
    expect(env.attrs.get('data-sky-tier')).toBe('light');
    await vi.advanceTimersByTimeAsync(500);
    scene.options.onFps(30);
    expect(env.attrs.get('data-sky-tier')).toBe('still');
    expect(env.classes.has('is-ready')).toBe(false);
    expect(scene.controller.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(toMs(SKY.liveFade.duration));
    expect(scene.controller.destroy).toHaveBeenCalledTimes(1);

    // Never back up during the visit, whatever the visitor toggles.
    setMotionPaused(true);
    setMotionPaused(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(env.attrs.get('data-sky-tier')).toBe('still');
    expect(live.scenes).toHaveLength(1);
    stop();
  });

  it('keeps a scene that holds its frame rate', async () => {
    const { env, live, stop } = await started();
    const scene = live.scenes[0];
    scene.options.onReady();
    for (let i = 0; i < 20; i += 1) {
      await vi.advanceTimersByTimeAsync(500);
      scene.options.onFps(60);
    }
    expect(scene.controller.setTier).not.toHaveBeenCalled();
    expect(env.attrs.get('data-sky-tier')).toBe('full');
    stop();
  });

  it('leaves the still for the visit when the scene reports an error, or its chunk or data fail', async () => {
    const broken = await started();
    broken.live.scenes[0].options.onError?.('webgl');
    expect(broken.live.scenes[0].controller.destroy).toHaveBeenCalledTimes(1);
    expect(broken.env.attrs.get('data-sky-tier')).toBe('still');
    setMotionPaused(true);
    setMotionPaused(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(broken.live.scenes).toHaveLength(1);
    expect(broken.env.attrs.get('data-sky-tier')).toBe('still');
    broken.stop();
    vi.unstubAllGlobals();

    for (const failure of [{ failImport: true }, { failData: true }]) {
      const failed = await started({}, failure);
      expect(failed.env.attrs.get('data-sky-tier'), JSON.stringify(failure)).toBe('still');
      expect(failed.live.scenes, JSON.stringify(failure)).toHaveLength(0);
      failed.stop();
      vi.unstubAllGlobals();
    }
  });

  it('destroys a scene whose error arrives while it is being made', async () => {
    const env = makeEnv();
    const destroyed = vi.fn();
    const factory: SceneFactory = async () => (_container, options) => {
      options.onError?.('webgl');
      return { setSize: vi.fn(), setTheme: vi.fn(), setTier: vi.fn(), setPointer: vi.fn(), ripple: vi.fn(), start: vi.fn(), stop: vi.fn(), destroy: destroyed };
    };
    const stop = startSkyHost(env.elements, { getProgress: () => 0, loadLive: async () => factory });
    await vi.advanceTimersByTimeAsync(IDLE);
    await settle();
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(env.attrs.get('data-sky-tier')).toBe('still');
    stop();
  });

  it('destroys a scene that throws once it is made, and stays on the still', async () => {
    const env = makeEnv();
    const destroyed = vi.fn();
    const factory: SceneFactory = async () => () => ({
      setSize: vi.fn(),
      setTheme: vi.fn(),
      setTier: vi.fn(),
      setPointer: vi.fn(),
      ripple: vi.fn(),
      start: () => {
        throw new Error('no context');
      },
      stop: vi.fn(),
      destroy: destroyed,
    });
    const stop = startSkyHost(env.elements, { getProgress: () => 0, loadLive: async () => factory });
    await vi.advanceTimersByTimeAsync(IDLE);
    await settle();
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(env.attrs.get('data-sky-tier')).toBe('still');
    stop();
    expect(destroyed).toHaveBeenCalledTimes(1);
  });

  it(`rests after ${SKY.idlePause} s without input, wakes on input, and stops while the tab is hidden`, async () => {
    const { env, live, stop } = await started();
    const { controller } = live.scenes[0];
    expect(controller.start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(toMs(SKY.idlePause) - 1);
    expect(controller.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.stop).toHaveBeenCalledTimes(1);

    env.win.fire('scroll');
    expect(controller.start).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    env.win.fire('pointermove', { pointerType: 'mouse', target: target(), clientX: 1, clientY: 1 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(controller.stop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.stop).toHaveBeenCalledTimes(2);

    env.win.fire('touchstart', { target: target({ inside: true }), touches: touches({ identifier: 1, clientX: 1, clientY: 1 }), changedTouches: touches({ identifier: 1, clientX: 1, clientY: 1 }) });
    expect(controller.start).toHaveBeenCalledTimes(3);
    env.doc.hidden = true;
    env.doc.fire('visibilitychange');
    expect(controller.stop).toHaveBeenCalledTimes(3);
    env.win.fire('scroll');
    expect(controller.start).toHaveBeenCalledTimes(3);
    env.doc.hidden = false;
    env.doc.fire('visibilitychange');
    expect(controller.start).toHaveBeenCalledTimes(4);
    stop();
  });

  it('gives the scene the pointer everywhere, marked off empty sky, a click or tap on empty sky as a ripple, and a touch drag as parallax', async () => {
    const { env, live, stop } = await started();
    const { controller } = live.scenes[0];
    const sky = target();
    const words = target({ inside: true });

    // The parallax follows the pointer over the page too; only its drafting lines need empty sky.
    env.win.fire('pointermove', { pointerType: 'mouse', target: sky, clientX: 10, clientY: 20 });
    expect(controller.setPointer).toHaveBeenLastCalledWith({ x: 10, y: 20, emptySky: true });
    env.win.fire('pointermove', { pointerType: 'mouse', target: words, clientX: 11, clientY: 21 });
    expect(controller.setPointer).toHaveBeenLastCalledWith({ x: 11, y: 21, emptySky: false });
    env.win.fire('pointermove', { pointerType: 'pen', target: sky, clientX: 12, clientY: 22 });
    expect(controller.setPointer).toHaveBeenLastCalledWith({ x: 12, y: 22, emptySky: true });
    // The page scrolling under a resting pointer clears the drafting lines until it moves again.
    env.win.fire('scroll');
    expect(controller.setPointer).toHaveBeenLastCalledWith({ x: 12, y: 22, emptySky: false });
    env.win.fire('pointerout', { pointerType: 'mouse', relatedTarget: null });
    expect(controller.setPointer).toHaveBeenLastCalledWith(null);
    const afterOut = controller.setPointer.mock.calls.length;
    env.win.fire('scroll');
    expect(controller.setPointer.mock.calls.length).toBe(afterOut);

    const press = { pointerType: 'mouse', isPrimary: true, button: 0, pointerId: 1 };
    env.win.fire('pointerdown', { ...press, target: sky, clientX: 30, clientY: 40 });
    expect(controller.ripple).toHaveBeenCalledWith(30, 40);
    env.win.fire('pointerdown', { ...press, target: words, clientX: 31, clientY: 41 });
    env.win.fire('pointerdown', { ...press, button: 2, target: sky, clientX: 32, clientY: 42 });
    env.win.fire('pointerdown', { ...press, target: sky, clientX: 1280, clientY: 42 });
    expect(controller.ripple).toHaveBeenCalledTimes(1);

    const finger = { pointerType: 'touch', isPrimary: true, button: 0, pointerId: 7 };
    env.win.fire('pointerdown', { ...finger, target: sky, clientX: 50, clientY: 60 });
    expect(controller.ripple).toHaveBeenCalledTimes(1);
    env.win.fire('pointerup', { ...finger });
    expect(controller.ripple).toHaveBeenLastCalledWith(50, 60);
    env.win.fire('pointerdown', { ...finger, pointerId: 8, target: sky, clientX: 51, clientY: 61 });
    env.win.fire('pointercancel', { ...finger, pointerId: 8 });
    env.win.fire('pointerup', { ...finger, pointerId: 8 });
    expect(controller.ripple).toHaveBeenCalledTimes(2);

    // A touch pointermove is the touch listeners' business, never a second pointer.
    const calls = controller.setPointer.mock.calls.length;
    env.win.fire('pointermove', { pointerType: 'touch', target: sky, clientX: 70, clientY: 80 });
    expect(controller.setPointer.mock.calls.length).toBe(calls);

    const at = (x: number, y: number) => touches({ identifier: 3, clientX: x, clientY: y });
    env.win.fire('touchstart', { target: sky, touches: at(100, 200), changedTouches: at(100, 200) });
    expect(controller.setPointer).toHaveBeenLastCalledWith({ x: 100, y: 200 });
    env.win.fire('touchmove', { target: sky, touches: at(110, 190), changedTouches: at(110, 190) });
    expect(controller.setPointer).toHaveBeenLastCalledWith({ x: 110, y: 190 });
    env.win.fire('touchend', { target: sky, touches: touches(), changedTouches: at(110, 190) });
    expect(controller.setPointer).toHaveBeenLastCalledWith(null);

    const before = controller.setPointer.mock.calls.length;
    env.win.fire('touchstart', { target: words, touches: at(5, 5), changedTouches: at(5, 5) });
    env.win.fire('touchmove', { target: words, touches: at(6, 6), changedTouches: at(6, 6) });
    expect(controller.setPointer.mock.calls.length).toBe(before);

    // A second finger (a pinch) ends the drag: the parallax goes back to the centre, and stays.
    env.win.fire('touchstart', { target: sky, touches: at(100, 200), changedTouches: at(100, 200) });
    expect(controller.setPointer).toHaveBeenLastCalledWith({ x: 100, y: 200 });
    const pinch = touches({ identifier: 3, clientX: 100, clientY: 200 }, { identifier: 4, clientX: 300, clientY: 300 });
    env.win.fire('touchstart', { target: sky, touches: pinch, changedTouches: touches({ identifier: 4, clientX: 300, clientY: 300 }) });
    expect(controller.setPointer).toHaveBeenLastCalledWith(null);
    env.win.fire('touchmove', { target: sky, touches: at(150, 250), changedTouches: at(150, 250) });
    env.win.fire('touchend', { target: sky, touches: touches(), changedTouches: at(150, 250) });
    expect(controller.setPointer).toHaveBeenLastCalledWith(null);
    stop();
  });

  it('asks the scene whether it can draw before it fetches any data, and fetches for the page theme', async () => {
    const env = makeEnv();
    const order: string[] = [];
    const module = (can: boolean) => ({
      canRender: vi.fn(() => {
        order.push('canRender');
        return can;
      }),
      loadSkyData: vi.fn(async (tier: LiveTier, theme?: string) => {
        order.push(`load ${tier} ${theme}`);
        return { tier };
      }),
      createSky: vi.fn(() => ({}) as LiveController),
    });
    const able = module(true);
    const make = await bindLive(able)('light');
    expect(order).toEqual(['canRender', 'load light blueprint']);
    make({} as HTMLElement, {} as LiveOptions);
    expect(able.createSky).toHaveBeenCalledWith({}, { tier: 'light' }, {});
    // A Whiteprint page asks for no Milky Way (the scene fetches it if the page turns Blueprint).
    env.attrs.set('data-theme', 'whiteprint');
    order.length = 0;
    await bindLive(module(true))('full');
    expect(order).toEqual(['canRender', 'load full whiteprint']);

    order.length = 0;
    const unable = module(false);
    await expect(bindLive(unable)('full')).rejects.toThrow(/webgl/);
    expect(order).toEqual(['canRender']);
    expect(unable.loadSkyData).not.toHaveBeenCalled();
  });

  it('follows the theme and the size of the window', async () => {
    const { env, live, stop } = await started();
    const { controller } = live.scenes[0];
    env.attrs.set('data-theme', 'whiteprint');
    FakeMutationObserver.trigger();
    expect(controller.setTheme).toHaveBeenLastCalledWith('whiteprint');
    FakeResizeObserver.trigger(390, 844);
    expect(controller.setSize).toHaveBeenLastCalledWith(390, 844);
    stop();
  });

  it('leaves nothing running, listening or written when it is torn down', async () => {
    const env = makeEnv();
    const baseline = { win: env.win.listenerCount, doc: env.doc.listenerCount, reduced: reduced.listenerCount, connection: env.connection.listenerCount };
    const live = fakeLive();
    const stop = startSkyHost(env.elements, { getProgress: () => 0, loadLive: live.loadLive });
    expect(env.win.listenerCount).toBeGreaterThan(baseline.win);
    await vi.advanceTimersByTimeAsync(IDLE);
    await settle();
    live.scenes[0].options.onReady();
    stop();
    expect(live.scenes[0].controller.destroy).toHaveBeenCalledTimes(1);
    expect(env.win.listenerCount).toBe(baseline.win);
    expect(env.doc.listenerCount).toBe(baseline.doc);
    expect(reduced.listenerCount).toBe(baseline.reduced);
    expect(env.connection.listenerCount).toBe(baseline.connection);
    expect(FakeMutationObserver.active.size).toBe(0);
    expect(FakeResizeObserver.active.size).toBe(0);
    expect(env.attrs.has('data-sky-tier')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never makes a scene once torn down, even with the import under way', async () => {
    const early = makeEnv();
    const live = fakeLive();
    const stopEarly = startSkyHost(early.elements, { getProgress: () => 0, loadLive: live.loadLive });
    stopEarly();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(live.loadLive).not.toHaveBeenCalled();
    vi.unstubAllGlobals();

    const late = makeEnv();
    let release: (factory: SceneFactory) => void = () => {};
    const made = vi.fn();
    const stopLate = startSkyHost(late.elements, {
      getProgress: () => 0,
      loadLive: () => new Promise<SceneFactory>((resolve) => (release = resolve)),
    });
    await vi.advanceTimersByTimeAsync(IDLE);
    stopLate();
    release(async () => made);
    await settle();
    expect(made).not.toHaveBeenCalled();
  });
});
