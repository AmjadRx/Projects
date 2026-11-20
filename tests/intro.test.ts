// @vitest-environment jsdom
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load, toMs } from '../lib/motion';

const END = toMs(load.end);
const ATTR = 'data-intro';
const GO = 'data-intro-go';
const SEEN = 'data-intro-seen';
const REDUCED = '(prefers-reduced-motion: reduce)';

/** A fresh copy of lib/intro.ts. */
async function intro() {
  vi.resetModules();
  return import('../lib/intro');
}

/** Lets promise callbacks run (an animation's `finished`, then the code waiting on it). */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** A stand-in for a CSS animation: its `finished` settles when the test says so. */
type FakeAnimation = { finished: Promise<unknown>; finish: () => void; cancel: () => void };
function fakeAnimation(): FakeAnimation {
  let finish!: () => void;
  let cancel!: () => void;
  const finished = new Promise((resolve, reject) => {
    finish = () => resolve(undefined);
    cancel = () => reject(new Error('AbortError'));
  });
  finished.catch(() => {});
  return { finished, finish, cancel };
}

function stubReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({ matches: matches && query === REDUCED })) as unknown as typeof window.matchMedia;
}

function stubSaveData(on: boolean) {
  Object.defineProperty(window.navigator, 'connection', { configurable: true, value: on ? { saveData: true } : undefined });
}

function blockStorage() {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
}

describe('introWanted: once a visit, never under reduced motion, with motion paused, or with Save-Data', () => {
  it('plays only when nothing says not to', async () => {
    const { introWanted } = await intro();
    const none = { seen: false, reducedMotion: false, paused: false, saveData: false };
    expect(introWanted(none)).toBe(true);
    expect(introWanted({ ...none, seen: true })).toBe(false);
    expect(introWanted({ ...none, reducedMotion: true })).toBe(false);
    expect(introWanted({ ...none, paused: true })).toBe(false);
    expect(introWanted({ ...none, saveData: true })).toBe(false);
  });
});

describe('beginIntro, after a client-side navigation', () => {
  /** A hero section; with a drawing whose animations are `animations` (or that cannot list them). */
  function hero(drawing?: FakeAnimation[] | 'unsupported') {
    const section = document.createElement('section');
    section.className = 'hm-hero';
    if (drawing) {
      section.innerHTML = '<div class="hm-art"><svg class="hd-svg"></svg></div>';
      const svg = section.querySelector('svg')! as unknown as { getAnimations?: () => FakeAnimation[] };
      if (drawing !== 'unsupported') svg.getAnimations = () => drawing;
    }
    document.body.append(section);
    return section;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-motion-paused');
    document.documentElement.removeAttribute(SEEN);
    stubReducedMotion(false);
    stubSaveData(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('marks the section, the visit and the page; without a drawing (media mode) the mark goes at load.end', async () => {
    const { beginIntro, introAge, introPlaying, introSeen } = await intro();
    const section = hero();
    expect(beginIntro(section)).toBe(true);
    expect(Number.isFinite(Number(section.getAttribute(ATTR)))).toBe(true);
    expect(section.hasAttribute(GO)).toBe(false);
    expect(sessionStorage.getItem(load.onceKey)).toBe('1');
    expect(document.documentElement.hasAttribute(SEEN)).toBe(true);
    expect(introSeen()).toBe(true);
    expect(introAge(section)).toBe(0);
    await vi.advanceTimersByTimeAsync(END - 1);
    expect(introPlaying(section)).toBe(true);
    expect(introAge(section)).toBe(END - 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(introPlaying(section)).toBe(false);
    expect(introAge(section)).toBeNull();
  });

  it("starts the drawing's steps at once, and ends when they have ended, not before load.end", async () => {
    const { beginIntro } = await intro();
    const draw = fakeAnimation();
    const band = fakeAnimation();
    const section = hero([draw, band]);
    expect(beginIntro(section)).toBe(true);
    expect(section.hasAttribute(ATTR) && section.hasAttribute(GO)).toBe(true);
    await vi.advanceTimersByTimeAsync(1100);
    draw.finish();
    await vi.advanceTimersByTimeAsync(460);
    band.finish();
    await flush();
    await vi.advanceTimersByTimeAsync(39);
    expect(section.hasAttribute(ATTR) && section.hasAttribute(GO)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(section.hasAttribute(ATTR) || section.hasAttribute(GO)).toBe(false);
  });

  it('never cuts a late scan band short: the marks stay until it has crossed', async () => {
    const { beginIntro } = await intro();
    const band = fakeAnimation();
    const section = hero([band]);
    beginIntro(section);
    // A busy main thread started the band 540 ms late: it ends at 2,100 ms, after load.end.
    await vi.advanceTimersByTimeAsync(2099);
    expect(section.hasAttribute(ATTR)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    band.finish();
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(section.hasAttribute(ATTR) || section.hasAttribute(GO)).toBe(false);
  });

  it('ends at once when motion is turned off during the sequence (its steps stop)', async () => {
    const { beginIntro } = await intro();
    const draw = fakeAnimation();
    const band = fakeAnimation();
    const section = hero([draw, band]);
    beginIntro(section);
    await vi.advanceTimersByTimeAsync(300);
    draw.cancel();
    band.cancel();
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(section.hasAttribute(ATTR) || section.hasAttribute(GO)).toBe(false);
  });

  it('where the browser cannot list animations, ends load.end after the go', async () => {
    const { beginIntro } = await intro();
    const section = hero('unsupported');
    beginIntro(section);
    expect(section.hasAttribute(GO)).toBe(true);
    await vi.advanceTimersByTimeAsync(END - 1);
    expect(section.hasAttribute(ATTR)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(section.hasAttribute(ATTR) || section.hasAttribute(GO)).toBe(false);
  });

  it('plays once a visit: back on the home page everything is final', async () => {
    const { beginIntro } = await intro();
    expect(beginIntro(hero())).toBe(true);
    const again = hero([fakeAnimation()]);
    expect(beginIntro(again)).toBe(false);
    expect(again.hasAttribute(ATTR) || again.hasAttribute(GO)).toBe(false);
  });

  it('does not play under reduced motion, with motion paused, or with Save-Data', async () => {
    stubReducedMotion(true);
    let api = await intro();
    expect(api.beginIntro(hero())).toBe(false);

    stubReducedMotion(false);
    document.documentElement.setAttribute('data-motion-paused', 'true');
    api = await intro();
    expect(api.beginIntro(hero())).toBe(false);

    document.documentElement.removeAttribute('data-motion-paused');
    stubSaveData(true);
    api = await intro();
    const section = hero([fakeAnimation()]);
    expect(api.beginIntro(section)).toBe(false);
    expect(section.hasAttribute(ATTR) || section.hasAttribute(GO)).toBe(false);
    expect(sessionStorage.getItem(load.onceKey)).toBeNull();
    expect(document.documentElement.hasAttribute(SEEN)).toBe(false);
  });

  it('keeps a sequence the inline scripts started, and remembers the visit even without storage', async () => {
    const { beginIntro, introSeen } = await intro();
    const section = hero();
    section.setAttribute(ATTR, '120');
    blockStorage();
    expect(beginIntro(section)).toBe(true);
    expect(introSeen()).toBe(true);
    expect(beginIntro(hero())).toBe(false);
  });

  it('never plays twice in one page when storage is blocked and hydration comes after the end', async () => {
    const { beginIntro, introGoScript, introScript, introSeen } = await intro();
    blockStorage();
    // The page as the browser parses it: the hero's first script, the drawing, then its go.
    const section = document.createElement('section');
    section.className = 'hm-hero';
    document.body.append(section);
    const arm = document.createElement('script');
    arm.textContent = introScript();
    section.append(arm);
    expect(section.hasAttribute(ATTR)).toBe(true);
    const art = document.createElement('div');
    art.className = 'hm-art';
    art.innerHTML = '<svg class="hd-svg"></svg>';
    (art.firstElementChild as unknown as { getAnimations: () => FakeAnimation[] }).getAnimations = () => [];
    section.append(art);
    const go = document.createElement('script');
    go.textContent = introGoScript();
    art.append(go);
    expect(section.hasAttribute(GO)).toBe(true);
    // The sequence ends; React hydrates later still, and DrawingStage calls beginIntro.
    await flush();
    await vi.advanceTimersByTimeAsync(END + 1000);
    expect(section.hasAttribute(ATTR) || section.hasAttribute(GO)).toBe(false);
    expect(introSeen()).toBe(true);
    expect(beginIntro(section)).toBe(false);
    expect(section.hasAttribute(ATTR)).toBe(false);
  });
});

describe('afterIntro: work the visitor cannot see yet waits for the end of the sequence', () => {
  /** A hero section, playing the sequence since `since` ms ago when given. */
  function hero(since?: number) {
    const section = document.createElement('section');
    section.className = 'hm-hero';
    if (since !== undefined) section.setAttribute(ATTR, String(Math.round(performance.now() - since)));
    document.body.append(section);
    return section;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.advanceTimersByTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('runs at once on a page with no hero, or a hero whose sequence is not playing', async () => {
    const { afterIntro } = await intro();
    const run = vi.fn();
    afterIntro(run);
    expect(run).toHaveBeenCalledTimes(1);
    hero();
    afterIntro(run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs once, when the mark goes, and not before', async () => {
    const { afterIntro } = await intro();
    const section = hero(300);
    const run = vi.fn();
    afterIntro(run);
    await flush();
    await vi.advanceTimersByTimeAsync(END);
    expect(run).not.toHaveBeenCalled();
    section.setAttribute(GO, '');
    await flush();
    expect(run).not.toHaveBeenCalled();
    section.removeAttribute(ATTR);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(END * 3);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting twice load.end after the mark was set, for a hero that left the page mid-sequence', async () => {
    const { afterIntro } = await intro();
    const section = hero(500);
    const run = vi.fn();
    afterIntro(run);
    // A client-side navigation away: the hero leaves with its mark, and no end ever comes.
    section.remove();
    await vi.advanceTimersByTimeAsync(END * 2 - 500 - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled: nothing runs afterwards', async () => {
    const { afterIntro } = await intro();
    const section = hero(0);
    const run = vi.fn();
    const cancel = afterIntro(run);
    cancel();
    section.removeAttribute(ATTR);
    await flush();
    await vi.advanceTimersByTimeAsync(END * 3);
    expect(run).not.toHaveBeenCalled();
    cancel();
  });
});

describe('the inline scripts: introScript at the top of the hero section, introGoScript after the svg', () => {
  type PageOptions = {
    seen?: boolean;
    reduced?: boolean;
    paused?: boolean;
    saveData?: boolean;
    storageBlocked?: boolean;
    /** The drawing and its go script, with these animations (or none it can list); false: media mode. */
    drawing?: FakeAnimation[] | 'unsupported' | false;
  };

  /** A page as the server sends it, parsed with its scripts, on a clock the test moves. */
  async function page({ seen = false, reduced = false, paused = false, saveData = false, storageBlocked = false, drawing = [] }: PageOptions = {}) {
    const { introGoScript, introScript } = await intro();
    const clock = { now: 250, timers: [] as { at: number; order: number; run: () => void }[] };
    const art = drawing === false ? '' : `<div class="hm-art"><svg class="hd-svg"></svg><script>${introGoScript()}</script></div>`;
    const dom = new JSDOM(
      `<!doctype html><html${paused ? ' data-motion-paused="true"' : ''}><body><main><section class="hm-hero">` +
        `<script>${introScript()}</script><h1>Headline</h1>${art}</section></main></body></html>`,
      {
        url: 'https://example.test/',
        runScripts: 'dangerously',
        beforeParse(window) {
          if (seen) window.sessionStorage.setItem(load.onceKey, '1');
          if (storageBlocked) {
            window.Storage.prototype.getItem = () => {
              throw new Error('blocked');
            };
            window.Storage.prototype.setItem = () => {
              throw new Error('blocked');
            };
          }
          window.matchMedia = ((query: string) => ({ matches: reduced && query === REDUCED })) as unknown as typeof window.matchMedia;
          if (saveData) Object.defineProperty(window.navigator, 'connection', { configurable: true, value: { saveData: true } });
          window.performance.now = () => clock.now;
          window.setTimeout = ((run: () => void, ms?: number) => {
            clock.timers.push({ at: clock.now + (Number(ms) || 0), order: clock.timers.length, run });
            return clock.timers.length;
          }) as unknown as typeof window.setTimeout;
          if (Array.isArray(drawing)) {
            (window.Element.prototype as unknown as { getAnimations: () => FakeAnimation[] }).getAnimations = () => drawing;
          }
        },
      },
    );
    const section = dom.window.document.querySelector('section')!;
    /** Moves the clock on by `ms`, running each timer that falls due, with promises settled between. */
    const advance = async (ms: number) => {
      const until = clock.now + ms;
      for (;;) {
        await flush();
        clock.timers.sort((a, b) => a.at - b.at || a.order - b.order);
        const next = clock.timers[0];
        if (!next || next.at > until) break;
        clock.timers.shift();
        clock.now = next.at;
        next.run();
      }
      clock.now = until;
      await flush();
    };
    const marks = () => ({ intro: section.hasAttribute(ATTR), go: section.hasAttribute(GO) });
    return { dom, section, advance, marks };
  }

  it('are plain: no doubled braces (the content check reads them as placeholders) and no dashes', async () => {
    const { introGoScript, introScript } = await intro();
    for (const script of [introScript(), introGoScript()]) {
      expect(script).not.toMatch(/\{\{|\}\}/);
      expect(script).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
      expect(script).toContain(String(END));
    }
    expect(introScript()).toContain(JSON.stringify(load.onceKey));
  });

  it('mark the section, the visit and the page, and start the drawing once it is all there', async () => {
    const { dom, section, marks } = await page();
    expect(marks()).toEqual({ intro: true, go: true });
    expect(Number(section.getAttribute(ATTR))).toBe(250);
    expect(dom.window.sessionStorage.getItem(load.onceKey)).toBe('1');
    expect(dom.window.document.documentElement.hasAttribute(SEEN)).toBe(true);
    dom.window.close();
  });

  it('leave the page final when the visit has seen it, under reduced motion, with motion paused, or with Save-Data', async () => {
    for (const options of [{ seen: true }, { reduced: true }, { paused: true }, { saveData: true }]) {
      const { dom, marks } = await page(options);
      expect(marks(), JSON.stringify(options)).toEqual({ intro: false, go: false });
      expect(dom.window.document.documentElement.hasAttribute(SEEN), JSON.stringify(options)).toBe(false);
      dom.window.close();
    }
  });

  it('without a drawing (media mode), end at load.end', async () => {
    const { dom, advance, marks } = await page({ drawing: false });
    expect(marks()).toEqual({ intro: true, go: false });
    await advance(END - 1);
    expect(marks().intro).toBe(true);
    await advance(1);
    expect(marks().intro).toBe(false);
    dom.window.close();
  });

  it("with a drawing, end when the drawing's steps have ended, not before load.end", async () => {
    const draw = fakeAnimation();
    const band = fakeAnimation();
    const { dom, advance, marks } = await page({ drawing: [draw, band] });
    await advance(1100);
    draw.finish();
    await advance(460);
    band.finish();
    await advance(39);
    expect(marks()).toEqual({ intro: true, go: true });
    await advance(1);
    expect(marks()).toEqual({ intro: false, go: false });
    dom.window.close();
  });

  it('never cut a late scan band short: the first script leaves the end to the drawing', async () => {
    const band = fakeAnimation();
    const { dom, advance, marks } = await page({ drawing: [band] });
    // The first script's load.end passes while the band, started late, is still crossing.
    await advance(END);
    expect(marks()).toEqual({ intro: true, go: true });
    await advance(500);
    band.finish();
    await advance(0);
    expect(marks()).toEqual({ intro: false, go: false });
    dom.window.close();
  });

  it('end at once when the steps stop (motion paused or reduced during the sequence)', async () => {
    const draw = fakeAnimation();
    const band = fakeAnimation();
    const { dom, advance, marks } = await page({ drawing: [draw, band] });
    await advance(300);
    draw.cancel();
    band.cancel();
    await advance(0);
    expect(marks()).toEqual({ intro: false, go: false });
    dom.window.close();
  });

  it('where the browser cannot list animations, end load.end after the go', async () => {
    const { dom, advance, marks } = await page({ drawing: 'unsupported' });
    expect(marks()).toEqual({ intro: true, go: true });
    await advance(END - 1);
    expect(marks().intro).toBe(true);
    await advance(1);
    expect(marks()).toEqual({ intro: false, go: false });
    dom.window.close();
  });

  it('play with storage blocked, and leave the mark on <html> that keeps the visit from playing it again', async () => {
    const { dom, marks } = await page({ storageBlocked: true });
    expect(marks()).toEqual({ intro: true, go: true });
    expect(dom.window.document.documentElement.hasAttribute(SEEN)).toBe(true);
    dom.window.close();
  });
});
