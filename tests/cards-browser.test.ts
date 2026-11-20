// @vitest-environment jsdom
// jsdom for the parts of the cards that need a document: the card-to-page transition helper
// (lib/cardTransition.ts), with a stand-in for the browser's View Transitions API and for the App
// Router, and the moving card cover (components/sheet/CardCover.tsx), rendered.
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_COVER_ATTR, FROM_KEY, PAGE_COVER_ATTR, coverLanding, openProject } from '../lib/cardTransition';
import { page, stored, toMs } from '../lib/motion';
import CardCover from '../components/sheet/CardCover';
import CardShell from '../components/sheet/CardShell';

// The client components read the route (useMotionOk) and the router (CardShell).
vi.mock('next/navigation', () => ({ usePathname: () => '/projects', useRouter: () => ({ push: () => undefined }) }));

// ---------------------------------------------------------------------------------------------
// The browser, as far as these tests need it.

interface FakeQuery {
  matches: boolean;
  readonly media: string;
  set(matches: boolean): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  addListener(listener: () => void): void;
  removeListener(listener: () => void): void;
}

const queries = new Map<string, FakeQuery>();

/** One media query per text, as the browser keeps it (lib/useMotionOk.ts holds on to its own). */
function mediaQuery(media: string): FakeQuery {
  const known = queries.get(media);
  if (known) return known;
  const listeners = new Set<() => void>();
  const query: FakeQuery = {
    matches: false,
    media,
    set(matches: boolean) {
      query.matches = matches;
      listeners.forEach((listener) => listener());
    },
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    addListener: (listener) => void listeners.add(listener),
    removeListener: (listener) => void listeners.delete(listener),
  };
  queries.set(media, query);
  return query;
}

window.matchMedia = ((media: string) => mediaQuery(media)) as unknown as typeof window.matchMedia;
const reducedMotion = mediaQuery('(prefers-reduced-motion: reduce)');
const finePointer = mediaQuery('(hover: hover) and (pointer: fine)');

/** The shared names on the page now, as "data-id name". */
function namesNow(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-id]')]
    .filter((el) => el.style.viewTransitionName)
    .map((el) => `${el.dataset.id} ${el.style.viewTransitionName}`);
}

interface Pictures {
  /** The names when the browser took its picture of the old page. */
  old: string[];
  /** The names when the update had finished: the new page's picture. */
  new: string[];
}

/**
 * document.startViewTransition: it takes its picture of the old page, calls the update, takes its
 * picture of the new page once the update has finished, and then finishes. `skip` rejects `ready`
 * as a skipped transition does; `fail` rejects `finished`.
 */
function fakeViewTransitions(mode: 'run' | 'skip' | 'fail' = 'run') {
  const pictures: Pictures[] = [];
  const start = vi.fn((update: () => Promise<void>) => {
    const picture: Pictures = { old: namesNow(), new: [] };
    pictures.push(picture);
    const updateCallbackDone = Promise.resolve()
      .then(update)
      .then(() => {
        picture.new = namesNow();
      });
    const ready = mode === 'skip' ? updateCallbackDone.then(() => Promise.reject(new DOMException('Skipped', 'AbortError'))) : updateCallbackDone;
    const finished = mode === 'fail' ? updateCallbackDone.then(() => Promise.reject(new DOMException('Failed', 'InvalidStateError'))) : updateCallbackDone;
    return { updateCallbackDone, ready, finished, skipTransition: () => undefined };
  });
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true, writable: true });
  return { start, pictures };
}

function noViewTransitions(): void {
  delete (document as { startViewTransition?: unknown }).startViewTransition;
}

/** The list with Raven's card (its photo has loaded). */
function listPage(): HTMLElement {
  document.body.innerHTML = `
    <main>
      <article class="ar-card" data-card="">
        <div class="ar-card__cover" ${CARD_COVER_ATTR}="raven"><div class="ar-well" data-id="card-well"><img src="/card.webp" alt="" data-id="card-img"></div></div>
        <h3><a class="ar-card__link" href="/projects/raven">Raven</a></h3>
      </article>
    </main>`;
  const img = document.querySelector<HTMLImageElement>('[data-id="card-img"]');
  if (img) Object.defineProperty(img, 'complete', { value: true });
  return document.querySelector('article') as HTMLElement;
}

/** Raven's page: its cover is a video's poster, lazy, as VideoPlayer's Poster draws it. */
function projectPage(): void {
  document.body.innerHTML = `
    <main>
      <div class="pj-cover" ${PAGE_COVER_ATTR}="raven"><figure class="ar-mv"><div class="ar-mv__well" data-id="page-well"><img src="/poster.webp" alt="" loading="lazy" data-id="page-img"></div></figure></div>
    </main>`;
}

/**
 * The App Router, as far as the transition meets it: `push` adds a history entry and renders the
 * new page a moment later; its popstate listener, added after lib/cardTransition.ts's (as Next adds
 * its own during hydration), renders the page of the entry it lands on at once.
 */
function fakeRouter() {
  const heard: PopStateEvent[] = [];
  const render = () => (window.location.pathname.startsWith('/projects/') ? projectPage() : listPage());
  const onPopState = (event: PopStateEvent) => {
    heard.push(event);
    render();
  };
  window.addEventListener('popstate', onPopState);
  return {
    heard,
    push: vi.fn((href: string) => {
      window.history.pushState({ __NA: true, tree: href }, '', href);
      window.setTimeout(render, 5);
    }),
    stop: () => window.removeEventListener('popstate', onPopState),
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once `ready()` holds, checking every few ms, or fails after `timeout` ms. */
async function until(ready: () => boolean, timeout = 2000): Promise<void> {
  const end = Date.now() + timeout;
  while (!ready()) {
    if (Date.now() > end) throw new Error('Timed out');
    await wait(5);
  }
}

/** Waits for the transition in flight, if any, to finish. */
async function landed(): Promise<void> {
  await wait(20);
  const landing = coverLanding();
  if (landing) await landing;
}

/** Opens Raven from its card on the list and lets its cover land; returns the router. */
async function openRaven(router: ReturnType<typeof fakeRouter>): Promise<void> {
  const card = listPage();
  expect(openProject({ card, href: '/projects/raven', slug: 'raven', push: router.push })).toBe(true);
  await until(() => document.querySelector('[data-id="page-img"]')?.getAttribute('loading') === 'eager');
  document.querySelector('[data-id="page-img"]')?.dispatchEvent(new Event('load'));
  await landed();
}

// ---------------------------------------------------------------------------------------------

describe('opening a project from its card (lib/cardTransition.ts)', () => {
  let scrollY = 0;
  let restoration: ScrollRestoration = 'auto';
  const restorations: ScrollRestoration[] = [];

  beforeAll(() => {
    Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true });
    Object.defineProperty(window.history, 'scrollRestoration', {
      configurable: true,
      get: () => restoration,
      set: (mode: ScrollRestoration) => {
        restoration = mode;
        restorations.push(mode);
      },
    });
    // On screen: the box every element reports, so the card counts as in view on Back.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 40, y: 120, width: 400, height: 250 }));
  });

  beforeEach(() => {
    reducedMotion.matches = false;
    window.localStorage.clear();
    noViewTransitions();
    scrollY = 0;
    restorations.length = 0;
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    window.history.replaceState({ __NA: true, tree: '/projects', kept: 'yes' }, '', '/projects');
  });

  it('leaves the link alone without the API, under reduced motion, and while motion is paused', () => {
    const push = vi.fn();
    const tryOpen = () => openProject({ card: listPage(), href: '/projects/raven', slug: 'raven', push });

    expect(tryOpen()).toBe(false);

    const { start } = fakeViewTransitions();
    reducedMotion.matches = true;
    expect(tryOpen()).toBe(false);
    reducedMotion.matches = false;

    window.localStorage.setItem(stored.motionPaused, '1');
    expect(tryOpen()).toBe(false);

    expect(start).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute('data-card-vt')).toBe(false);
    expect(window.history.state).toEqual({ __NA: true, tree: '/projects', kept: 'yes' });
    expect(coverLanding()).toBeNull();
  });

  it("carries the cover from the card to the header, made eager, and clears every name and mark after", async () => {
    const { start, pictures } = fakeViewTransitions();
    const router = fakeRouter();
    try {
      const card = listPage();
      expect(openProject({ card, href: '/projects/raven', slug: 'raven', push: router.push })).toBe(true);

      // The page the card was opened from: its entry keeps the router's fields and gains the key.
      expect(window.history.state).toMatchObject({ __NA: true, tree: '/projects', kept: 'yes' });
      expect(typeof window.history.state[FROM_KEY]).toBe('string');
      expect(start).toHaveBeenCalledTimes(1);
      expect(pictures[0].old).toEqual(['card-well cover-raven']);
      const root = document.documentElement;
      expect(root.hasAttribute('data-card-vt')).toBe(true);
      expect(root.style.getPropertyValue('--ar-vt-cover')).toBe(`${toMs(page.cardToPage.cover.duration)}ms`);
      expect(coverLanding()).not.toBeNull();

      // The header's poster is lazy: it is made eager, or it would never load while the page is held.
      await until(() => document.querySelector('[data-id="page-img"]')?.getAttribute('loading') === 'eager');
      expect(router.push).toHaveBeenCalledWith('/projects/raven');
      expect(namesNow()).toEqual([]);
      document.querySelector('[data-id="page-img"]')?.dispatchEvent(new Event('load'));
      await landed();

      expect(pictures[0].new).toEqual(['page-well cover-raven']);
      expect(namesNow()).toEqual([]);
      expect(root.hasAttribute('data-card-vt')).toBe(false);
      expect(root.style.getPropertyValue('--ar-vt-cover')).toBe('');
      expect(coverLanding()).toBeNull();
    } finally {
      router.stop();
    }
  });

  it('lands after page.cardToPage.wait at the latest when the picture never arrives', async () => {
    const { pictures } = fakeViewTransitions();
    const router = fakeRouter();
    try {
      const began = performance.now();
      expect(openProject({ card: listPage(), href: '/projects/raven', slug: 'raven', push: router.push })).toBe(true);
      await landed();
      const held = performance.now() - began;
      expect(held).toBeGreaterThanOrEqual(toMs(page.cardToPage.wait) - 20);
      expect(held).toBeLessThan(toMs(page.cardToPage.wait) + 400);
      expect(pictures[0].new).toEqual(['page-well cover-raven']);
      expect(namesNow()).toEqual([]);
    } finally {
      router.stop();
    }
  });

  it('clears every name and mark when the browser skips the transition, or it fails', async () => {
    for (const mode of ['skip', 'fail'] as const) {
      window.history.replaceState({ __NA: true, tree: '/projects' }, '', '/projects');
      fakeViewTransitions(mode);
      const router = fakeRouter();
      try {
        await openRaven(router);
        expect(router.push).toHaveBeenCalledTimes(1);
        expect(namesNow()).toEqual([]);
        expect(document.documentElement.hasAttribute('data-card-vt')).toBe(false);
        expect(coverLanding()).toBeNull();
      } finally {
        router.stop();
      }
    }
  });

  it("runs Back in reverse once: holds the router's event, hands it over once, and puts the list back where it was", async () => {
    const { start, pictures } = fakeViewTransitions();
    const router = fakeRouter();
    try {
      scrollY = 640;
      await openRaven(router);
      expect(window.location.pathname).toBe('/projects/raven');
      scrollY = 0;

      window.history.back();
      await until(() => start.mock.calls.length === 2);
      await landed();

      // The router heard only the event handed to it (untrusted), never the browser's own, once.
      expect(router.heard).toHaveLength(1);
      expect(router.heard[0].isTrusted).toBe(false);
      expect(router.heard[0].state).toMatchObject({ __NA: true, tree: '/projects' });
      expect(window.location.pathname).toBe('/projects');
      expect(pictures[1]).toEqual({ old: ['page-well cover-raven'], new: ['card-well cover-raven'] });
      expect(window.scrollTo).toHaveBeenCalledWith(0, 640);
      expect(restorations).toEqual(['manual', 'auto']);
      expect(namesNow()).toEqual([]);
      expect(document.documentElement.hasAttribute('data-card-vt')).toBe(false);

      // The record is used once: Forward and Back again are the router's.
      window.history.forward();
      await until(() => router.heard.length === 2);
      window.history.back();
      await until(() => router.heard.length === 3);
      await landed();
      expect(start).toHaveBeenCalledTimes(2);
      expect(router.heard.slice(1).every((event) => event.isTrusted)).toBe(true);
      expect(window.scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      router.stop();
    }
  });

  it('leaves Forward to the same address, and a return to any other entry, to the router', async () => {
    const { start } = fakeViewTransitions();
    const router = fakeRouter();
    try {
      // From the list, at 2058 px, open Raven; then follow a link back to the list (a new entry).
      scrollY = 2058;
      await openRaven(router);
      router.push('/projects');
      await until(() => document.querySelector('[data-id="card-well"]') !== null);
      scrollY = 120;

      // Back to Raven's page, then Forward to the list it is the same address as: both the router's.
      window.history.back();
      await until(() => router.heard.length === 1);
      expect(window.location.pathname).toBe('/projects/raven');
      window.history.forward();
      await until(() => router.heard.length === 2);
      await landed();
      expect(window.location.pathname).toBe('/projects');
      expect(start).toHaveBeenCalledTimes(1);
      expect(router.heard.every((event) => event.isTrusted)).toBe(true);
      expect(window.scrollTo).not.toHaveBeenCalled();
      expect(restorations).toEqual([]);

      // Back to Raven's page, and Back again to the entry the card was opened from: that one still
      // runs in reverse, and puts the list at the position it was left at.
      window.history.back();
      await until(() => router.heard.length === 3);
      expect(window.location.pathname).toBe('/projects/raven');
      window.history.back();
      await until(() => start.mock.calls.length === 2);
      await landed();
      expect(router.heard).toHaveLength(4);
      expect(router.heard[3].isTrusted).toBe(false);
      expect(window.scrollTo).toHaveBeenCalledWith(0, 2058);
    } finally {
      router.stop();
    }
  });
});

// ---------------------------------------------------------------------------------------------

/** IntersectionObserver: reports only when a test says how much of a card is in view. */
class FakeIntersectionObserver {
  static all: FakeIntersectionObserver[] = [];

  static report(target: Element, ratio: number): void {
    for (const observer of FakeIntersectionObserver.all) {
      if (!observer.targets.has(target)) continue;
      const entry = { target, isIntersecting: ratio > 0, intersectionRatio: ratio } as unknown as IntersectionObserverEntry;
      observer.callback([entry], observer as unknown as IntersectionObserver);
    }
  }

  readonly targets = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.all.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

describe('a moving card cover (components/sheet/CardCover.tsx)', () => {
  const roots: Root[] = [];
  const labels = { kind: 'Video', live: 'Playing, muted', didNotLoad: 'Photo did not load', tryAgain: 'Try again' };

  beforeAll(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Motion's features arrive in a chunk of their own; have it ready, as a warm cache would.
    await import('../components/sheet/motionFeatures');
  });

  beforeEach(() => {
    reducedMotion.matches = false;
    finePointer.matches = true;
    window.localStorage.clear();
    FakeIntersectionObserver.all = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = '';
    delete (window.navigator as { connection?: unknown }).connection;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Renders a card with a moving cover, the card nearly in view; returns the card's element. */
  async function card(kind: 'video' | 'model', slug: string = kind): Promise<HTMLElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const shell = { variant: 'regular', slug, domains: '' } as Parameters<typeof CardShell>[0];
    await act(async () => {
      root.render(
        h(
          CardShell,
          shell,
          h(
            'div',
            { className: 'ar-card__cover', [CARD_COVER_ATTR]: slug },
            h(CardCover, { kind, poster: null, video: kind === 'video' ? '/media/demo.mp4' : undefined, sizes: '100vw', priority: false, labels }),
          ),
        ),
      );
    });
    await act(async () => {
      await wait(0);
    });
    return container.querySelector('[data-card]') as HTMLElement;
  }

  async function inView(target: Element, ratio: number): Promise<void> {
    await act(async () => {
      FakeIntersectionObserver.report(target, ratio);
    });
  }

  const live = (target: Element) => Boolean(target.querySelector('.ar-card__motion.is-live'));

  it('loads a video cover once its card nears the view, and plays it muted only while hovered', async () => {
    const target = await card('video');
    expect(target.querySelector('video')).toBeNull();
    await inView(target, 1);
    const video = target.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    const frame = target.parentElement as HTMLElement;
    await act(async () => {
      frame.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(video?.muted).toBe(true);
    await act(async () => {
      video?.dispatchEvent(new Event('playing'));
    });
    expect(live(target)).toBe(true);
    expect(target.querySelector('.ar-card__progress')).not.toBeNull();
  });

  it('never loads a video under reduced motion, with Save-Data on, or while motion is paused', async () => {
    reducedMotion.matches = true;
    let target = await card('video', 'reduced');
    await inView(target, 1);
    expect(target.querySelector('video')).toBeNull();
    reducedMotion.matches = false;

    Object.defineProperty(window.navigator, 'connection', { value: { saveData: true }, configurable: true });
    target = await card('video', 'save-data');
    await inView(target, 1);
    expect(target.querySelector('video')).toBeNull();
    delete (window.navigator as { connection?: unknown }).connection;

    window.localStorage.setItem(stored.motionPaused, '1');
    target = await card('video', 'paused');
    await inView(target, 1);
    expect(target.querySelector('video')).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('on a phone runs one cover at a time: the one most in view, at 0.6 or more', async () => {
    finePointer.matches = false;
    const a = await card('model', 'a');
    const b = await card('model', 'b');
    await inView(a, 0.9);
    await inView(b, 0.7);
    expect([live(a), live(b)]).toEqual([true, false]);
    await inView(a, 0.3);
    expect([live(a), live(b)]).toEqual([false, true]);
    await inView(b, 0.5);
    expect([live(a), live(b)]).toEqual([false, false]);
  });

  it('on a phone keeps every cover still under reduced motion', async () => {
    finePointer.matches = false;
    reducedMotion.matches = true;
    const a = await card('model', 'still');
    await inView(a, 1);
    expect(live(a)).toBe(false);
  });
});
