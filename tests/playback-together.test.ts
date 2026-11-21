// @vitest-environment jsdom
/**
 * Who plays, with every kind of player on one page (components/viewers/video/playback.ts; motion
 * sheets 5.2, 6.1 and 8.1; DESIGN_DIRECTION.md 6.3 and 7): the hero video, two video covers on their
 * cards, a video block, the audio player, and a lightbox over the page with a video of its own. The
 * real components render in jsdom against the real playback.ts. The browser is stood in for only
 * where jsdom has nothing: media playback (play and pause change `paused` at once and queue their
 * events, as a browser does; a test may have the browser refuse every start the visitor's own press
 * did not ask for, as a phone saving power does), IntersectionObserver (a test says how much of each
 * element is in view), and the media queries for the pointer and reduced motion.
 *
 * The lightbox's whole part in playback is LazyLightbox's `openLayer()` effect
 * (components/viewers/image/useLightbox.tsx), so the tests open the layer with that call and give
 * the lightbox a video player of its own on LIGHTBOX_LAYER, as the lightbox renders one.
 */
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import HeroVideo from '../components/home/HeroVideo';
import CardCover from '../components/sheet/CardCover';
import CardShell from '../components/sheet/CardShell';
import AudioEngine from '../components/viewers/audio/AudioEngine';
import type { AudioEngineApi } from '../components/viewers/audio/contract';
import ViewerFrame from '../components/viewers/shared/ViewerFrame';
import type { VideoEngineApi } from '../components/viewers/video/contract';
import { LIGHTBOX_LAYER, openLayer } from '../components/viewers/video/playback';
import VideoEngine from '../components/viewers/video/VideoEngine';
import type { ResolvedMedia } from '../lib/media';
import { setMotionPaused } from '../lib/motionPause';

// The components read the route (useMotionOk) and the router (CardShell).
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => undefined }) }));

// ---------------------------------------------------------------------------------------------
// The browser, as far as these players need it.

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
function mediaQuery(text: string): FakeQuery {
  const known = queries.get(text);
  if (known) return known;
  const listeners = new Set<() => void>();
  const query: FakeQuery = {
    matches: false,
    media: text,
    set(matches: boolean) {
      query.matches = matches;
      listeners.forEach((listener) => listener());
    },
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    addListener: (listener) => void listeners.add(listener),
    removeListener: (listener) => void listeners.delete(listener),
  };
  queries.set(text, query);
  return query;
}

window.matchMedia = ((text: string) => mediaQuery(text)) as unknown as typeof window.matchMedia;
const reducedMotion = mediaQuery('(prefers-reduced-motion: reduce)');
const finePointer = mediaQuery('(hover: hover) and (pointer: fine)');

/** The media elements playing now. */
const playing = new WeakSet<HTMLMediaElement>();
/** How many times each player was asked to start, by its name. */
const starts = new Map<string, number>();
/**
 * The players whose start the browser refuses unless the visitor's own press asks for it, as a
 * phone in Low Power Mode refuses a video that would play by itself: play() rejects with
 * NotAllowedError, queues no event, and the element stays paused.
 */
const refusing = new Set<string>();
/** True while the visitor's press is handled: a start asked for then is one the browser allows. */
let gesture = false;
const trackLists = new WeakMap<HTMLMediaElement, EventTarget>();
const jsdomPaused = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'paused');
const jsdomTracks = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'textTracks');

/** A media event, queued as the browser queues it: after the call that caused it, never during it. */
function queueEvent(el: HTMLMediaElement, type: string, still: () => boolean = () => true): void {
  setTimeout(() => {
    if (still()) el.dispatchEvent(new Event(type));
  }, 0);
}

/** IntersectionObserver: reports only when a test says how much of an element is in view. */
class FakeIntersectionObserver {
  static all = new Set<FakeIntersectionObserver>();

  readonly targets = new Set<Element>();

  constructor(readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.all.add(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    FakeIntersectionObserver.all.delete(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Every observer watching `target` hears that `share` of it is in view (a box shorter than the view). */
function report(target: Element, share: number): void {
  for (const observer of [...FakeIntersectionObserver.all]) {
    if (!observer.targets.has(target)) continue;
    const entry = {
      target,
      isIntersecting: share > 0,
      intersectionRatio: share,
      boundingClientRect: { height: 300 },
      rootBounds: { height: 900 },
    } as unknown as IntersectionObserverEntry;
    observer.callback([entry], observer as unknown as IntersectionObserver);
  }
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Lets every queued media event, and every render and effect it causes, run. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await wait();
  });
}

async function step(action: () => void): Promise<void> {
  await act(async () => {
    action();
  });
  await flush();
}

// ---------------------------------------------------------------------------------------------
// The page.

const noop = () => undefined;

function videoFile(name: string): ResolvedMedia {
  return {
    kind: 'video',
    file: { src: `/media/${name}.mp4`, name: `${name}.mp4`, ext: 'mp4', typeLabel: 'MP4 video', downloadHref: '' },
    alt: '',
    store: 'repo',
  };
}

const audioFile: ResolvedMedia = {
  kind: 'audio',
  file: { src: '/media/talk.mp3', name: 'talk.mp3', ext: 'mp3', typeLabel: 'MP3 audio', downloadHref: '' },
  alt: '',
  store: 'repo',
};

const coverLabels = { kind: 'Video', live: 'Playing, muted', didNotLoad: 'Photo did not load', tryAgain: 'Try again' };

/** A video block's player (VideoPlayer renders the same engine in the same frame). */
function videoBlock(media: ResolvedMedia, layer: number, apiRef: { current: VideoEngineApi | null }): ReactElement {
  return h(ViewerFrame, {
    label: 'Video',
    kind: 'Video',
    aspect: 16 / 9,
    allowFullscreen: false,
    children: h(VideoEngine, {
      media,
      scrubbing: false,
      scrubRun: null,
      autoplay: true,
      layer,
      playOnReady: false,
      apiRef,
      timeRef: { current: null },
      seekRef: { current: null },
      onState: noop,
      onLeaveView: noop,
    }),
  });
}

/** A project card with a video cover, as ProjectCard renders it. */
function coverCard(slug: string): ReactElement {
  const shell = { variant: 'regular', slug, domains: '' } as Parameters<typeof CardShell>[0];
  return h(
    CardShell,
    shell,
    h(
      'div',
      { className: 'ar-card__cover', 'data-cover-card': slug },
      h(CardCover, { kind: 'video', poster: null, video: `/media/${slug}.mp4`, sizes: '100vw', priority: false, labels: coverLabels }),
    ),
  );
}

interface Page {
  heroFrame: HTMLElement;
  heroWell: HTMLElement;
  heroButton: HTMLButtonElement;
  cards: HTMLElement[];
  block: HTMLVideoElement;
  blockApi: { current: VideoEngineApi | null };
  audioApi: { current: AudioEngineApi | null };
}

const roots: Root[] = [];
const layers: (() => void)[] = [];

async function mount(node: ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(node);
  });
  await flush();
  return { container, root };
}

/** The hero, two cards with video covers, a video block and the audio player, nothing in view yet. */
async function renderPage(): Promise<Page> {
  const blockApi: Page['blockApi'] = { current: null };
  const audioApi: Page['audioApi'] = { current: null };
  const { container } = await mount(
    h(
      'main',
      null,
      h(
        'div',
        { 'data-player': 'hero' },
        h(HeroVideo, {
          src: '/media/hero.mp4',
          label: '',
          aspect: 16 / 9,
          labels: { play: 'Play video', pause: 'Pause video' },
          children: h('img', { src: '/media/hero.webp', alt: '' }),
        }),
      ),
      h('div', { 'data-player': 'cover a' }, coverCard('a')),
      h('div', { 'data-player': 'cover b' }, coverCard('b')),
      h('div', { 'data-player': 'block' }, videoBlock(videoFile('block'), 0, blockApi)),
      h('div', { 'data-player': 'audio' }, h(AudioEngine, { media: audioFile, playOnReady: false, apiRef: audioApi, timeRef: { current: null }, onState: noop })),
    ),
  );
  const heroFrame = container.querySelector<HTMLElement>('.hm-hero__media');
  const cards = [...container.querySelectorAll<HTMLElement>('[data-card]')];
  const block = container.querySelector<HTMLVideoElement>('[data-player="block"] video');
  if (!heroFrame || cards.length !== 2 || !block) throw new Error('The page did not render');
  const page: Page = {
    heroFrame,
    heroWell: heroFrame.querySelector<HTMLElement>('.ar-mv__well') as HTMLElement,
    heroButton: heroFrame.querySelector<HTMLButtonElement>('button') as HTMLButtonElement,
    cards,
    block,
    blockApi,
    audioApi,
  };
  // The cards are near the view, so their video files may load.
  await step(() => cards.forEach((card) => report(card, 0.4)));
  return page;
}

/** The name of the player an element belongs to (its `data-player`). */
function playerOf(el: Element): string {
  return el.closest('[data-player]')?.getAttribute('data-player') ?? '?';
}

/** What plays now, by the name of its player. */
function playingNow(): string[] {
  return [...document.querySelectorAll<HTMLMediaElement>('video, audio')]
    .filter((el) => playing.has(el))
    .map(playerOf)
    .sort();
}

/** Whether a card shows its cover running: the "Playing, muted" line over it. */
function coverLive(card: HTMLElement): boolean {
  return card.querySelector('.ar-card__live') !== null;
}

async function heroInView(page: Page, share: number): Promise<void> {
  await step(() => {
    report(page.heroFrame, share);
    report(page.heroWell, share);
  });
}

async function inView(target: Element, share: number): Promise<void> {
  await step(() => report(target, share));
}

/** A mouse comes onto the card (React reads pointerover and pointerout for enter and leave). */
async function hover(card: HTMLElement): Promise<void> {
  const frame = card.parentElement as HTMLElement;
  await step(() => frame.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
}

async function leave(card: HTMLElement): Promise<void> {
  const frame = card.parentElement as HTMLElement;
  await step(() =>
    frame.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body })),
  );
}

/** The visitor's own press of a button: a gesture, so the browser allows the start it asks for. */
async function press(button: HTMLButtonElement): Promise<void> {
  await step(() => {
    gesture = true;
    try {
      button.click();
    } finally {
      gesture = false;
    }
  });
}

async function setHidden(hidden: boolean): Promise<void> {
  await step(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/**
 * Opens a lightbox over the page, as LazyLightbox does, with a video of its own `share` in view.
 * Closing it removes its player and then the layer, as closing the lightbox unmounts both.
 */
async function openLightbox(share: number): Promise<{ close: () => Promise<void> }> {
  let closeLayer: () => void = noop;
  await step(() => {
    closeLayer = openLayer();
  });
  layers.push(closeLayer);
  const { container, root } = await mount(h('div', { 'data-player': 'lightbox' }, videoBlock(videoFile('box'), LIGHTBOX_LAYER, { current: null })));
  const video = container.querySelector('video');
  if (!video) throw new Error('The lightbox did not render');
  await inView(video, share);
  return {
    close: async () => {
      await step(() => {
        root.unmount();
        closeLayer();
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Motion's features arrive in a chunk of their own; have it ready, as a warm cache would.
  await import('../components/sheet/motionFeatures');
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return !playing.has(this);
    },
  });
  // The video engine listens to its captions list; jsdom has a plain array there.
  Object.defineProperty(HTMLMediaElement.prototype, 'textTracks', {
    configurable: true,
    get(this: HTMLMediaElement) {
      let list = trackLists.get(this);
      if (!list) {
        list = Object.assign(new EventTarget(), { length: 0, *[Symbol.iterator]() {} });
        trackLists.set(this, list);
      }
      return list;
    },
  });
});

afterAll(() => {
  if (jsdomPaused) Object.defineProperty(HTMLMediaElement.prototype, 'paused', jsdomPaused);
  if (jsdomTracks) Object.defineProperty(HTMLMediaElement.prototype, 'textTracks', jsdomTracks);
});

beforeEach(() => {
  reducedMotion.matches = false;
  finePointer.matches = true;
  window.localStorage.clear();
  starts.clear();
  refusing.clear();
  gesture = false;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play(this: HTMLMediaElement) {
    const name = playerOf(this);
    starts.set(name, (starts.get(name) ?? 0) + 1);
    if (refusing.has(name) && !gesture) {
      return Promise.reject(new DOMException('The request is not allowed by the user agent.', 'NotAllowedError'));
    }
    if (!playing.has(this)) {
      playing.add(this);
      queueEvent(this, 'play');
      queueEvent(this, 'playing', () => playing.has(this));
    }
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause(this: HTMLMediaElement) {
    if (playing.has(this)) {
      playing.delete(this);
      queueEvent(this, 'pause');
    }
  });
});

afterEach(async () => {
  await act(async () => {
    for (const close of layers.splice(0)) close();
    for (const root of roots.splice(0)) root.unmount();
  });
  await flush();
  setMotionPaused(false);
  document.body.innerHTML = '';
  delete (document as { visibilityState?: unknown }).visibilityState;
  FakeIntersectionObserver.all.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('on a computer (a mouse or a pen)', () => {
  it('plays one video by itself at a time: the one most in view of those at least 0.6 in view', async () => {
    const page = await renderPage();
    await heroInView(page, 0.8);
    await inView(page.block, 0.7);
    expect(playingNow()).toEqual(['hero']);
    await inView(page.block, 1);
    expect(playingNow()).toEqual(['block']);
    await inView(page.block, 0.5);
    expect(playingNow()).toEqual(['hero']);
    await heroInView(page, 0.4);
    expect(playingNow()).toEqual([]);
  });

  it('plays the hero muted while it is in view, pauses it out of view and in a hidden tab, and never by itself under reduced motion', async () => {
    const page = await renderPage();
    await heroInView(page, 0.6);
    expect(playingNow()).toEqual(['hero']);
    expect(page.heroWell.querySelector('video')?.muted).toBe(true);
    await heroInView(page, 0.5);
    expect(playingNow()).toEqual([]);
    await heroInView(page, 1);
    expect(playingNow()).toEqual(['hero']);
    await setHidden(true);
    expect(playingNow()).toEqual([]);
    await setHidden(false);
    expect(playingNow()).toEqual(['hero']);

    await step(() => reducedMotion.set(true));
    expect(playingNow()).toEqual([]);
    await heroInView(page, 0.9);
    expect(playingNow()).toEqual([]);
    // The visitor's press still plays it; leaving the view entirely pauses it, and it stays paused.
    await step(() => page.heroButton.click());
    expect(playingNow()).toEqual(['hero']);
    await heroInView(page, 0);
    await heroInView(page, 1);
    expect(playingNow()).toEqual([]);
  });

  it('plays a hovered cover, muted, over the video playing by itself, and hands back when the pointer leaves', async () => {
    const page = await renderPage();
    await heroInView(page, 0.8);
    expect(playingNow()).toEqual(['hero']);
    await hover(page.cards[0]);
    expect(playingNow()).toEqual(['cover a']);
    expect(page.cards[0].querySelector('video')?.muted).toBe(true);
    await leave(page.cards[0]);
    expect(playingNow()).toEqual(['hero']);
    // The next card takes it the same way.
    await hover(page.cards[1]);
    expect(playingNow()).toEqual(['cover b']);
    await leave(page.cards[1]);
    expect(playingNow()).toEqual(['hero']);
  });

  it('plays a hovered cover over a video playing by itself however much of that video is in view, and hands back when the pointer leaves', async () => {
    const page = await renderPage();
    // The hero wholly in view, as on a tall or zoomed-out window with the cards on screen as well.
    await heroInView(page, 1);
    expect(playingNow()).toEqual(['hero']);
    await hover(page.cards[0]);
    expect(playingNow()).toEqual(['cover a']);
    await leave(page.cards[0]);
    expect(playingNow()).toEqual(['hero']);
    // A video block wholly in view, the same.
    await heroInView(page, 0);
    await inView(page.block, 1);
    expect(playingNow()).toEqual(['block']);
    await hover(page.cards[1]);
    expect(playingNow()).toEqual(['cover b']);
    await leave(page.cards[1]);
    expect(playingNow()).toEqual(['block']);
  });

  it('pauses a hovered preview in a hidden tab and plays it again when the tab is shown', async () => {
    const page = await renderPage();
    await hover(page.cards[0]);
    expect(playingNow()).toEqual(['cover a']);
    await setHidden(true);
    expect(playingNow()).toEqual([]);
    await setHidden(false);
    expect(playingNow()).toEqual(['cover a']);
  });

  it("stops what plays by itself when the visitor pauses motion in the footer, and leaves the visitor's own playback", async () => {
    const page = await renderPage();
    await heroInView(page, 0.8);
    expect(playingNow()).toEqual(['hero']);
    await step(() => setMotionPaused(true));
    expect(playingNow()).toEqual([]);
    await hover(page.cards[0]);
    expect(playingNow()).toEqual([]);
    await leave(page.cards[0]);
    // The visitor's own press plays it, and playing motion again does not change that.
    await step(() => page.heroButton.click());
    expect(playingNow()).toEqual(['hero']);
    await step(() => setMotionPaused(false));
    expect(playingNow()).toEqual(['hero']);
  });

  it('pauses the hero playing by itself for the audio player, and plays it again when the audio stops', async () => {
    const page = await renderPage();
    await heroInView(page, 0.8);
    await step(() => page.audioApi.current?.togglePlay());
    expect(playingNow()).toEqual(['audio']);
    await heroInView(page, 1);
    expect(playingNow()).toEqual(['audio']);
    await step(() => page.audioApi.current?.togglePlay());
    expect(playingNow()).toEqual(['hero']);
  });

  it("never lets a hover preview stop the visitor's own video or audio: the cover keeps its poster until they stop", async () => {
    const page = await renderPage();
    await inView(page.block, 0.5);
    // The visitor's own start: it holds playback.
    await step(() => page.blockApi.current?.togglePlay());
    expect(playingNow()).toEqual(['block']);
    await hover(page.cards[0]);
    expect(playingNow()).toEqual(['block']);
    await leave(page.cards[0]);

    // The audio player starts: the visitor's video pauses, and the audio holds playback.
    await step(() => page.audioApi.current?.togglePlay());
    expect(playingNow()).toEqual(['audio']);
    await hover(page.cards[1]);
    expect(playingNow()).toEqual(['audio']);
    // The audio stops: the cover still under the pointer plays now.
    await step(() => page.audioApi.current?.togglePlay());
    expect(playingNow()).toEqual(['cover b']);
  });

  it("holds playback while the visitor's own play of the hero lasts: nothing plays by itself and no preview starts", async () => {
    const page = await renderPage();
    await heroInView(page, 0.5);
    await inView(page.block, 0.9);
    expect(playingNow()).toEqual(['block']);
    await step(() => page.heroButton.click());
    expect(playingNow()).toEqual(['hero']);
    await inView(page.block, 1);
    await hover(page.cards[0]);
    expect(playingNow()).toEqual(['hero']);
    await leave(page.cards[0]);
    await step(() => page.heroButton.click());
    expect(playingNow()).toEqual(['block']);
    // The hero is the visitor's now: wholly in view, it no longer plays by itself.
    await inView(page.block, 0);
    await heroInView(page, 1);
    expect(playingNow()).toEqual([]);
  });

  it('pauses a playing preview for a player the visitor starts', async () => {
    const page = await renderPage();
    await inView(page.block, 0.5);
    await hover(page.cards[0]);
    expect(playingNow()).toEqual(['cover a']);
    await step(() => page.blockApi.current?.togglePlay());
    expect(playingNow()).toEqual(['block']);
    await step(() => page.blockApi.current?.togglePlay());
    // The visitor's video paused: the preview under the pointer plays again.
    expect(playingNow()).toEqual(['cover a']);
  });

  it('pauses every video under a lightbox and plays only its own by itself; the audio plays on, and holds', async () => {
    const page = await renderPage();
    await heroInView(page, 0.8);
    await hover(page.cards[0]);
    expect(playingNow()).toEqual(['cover a']);
    const first = await openLightbox(1);
    expect(playingNow()).toEqual(['lightbox']);
    await first.close();
    expect(playingNow()).toEqual(['cover a']);

    await step(() => page.audioApi.current?.togglePlay());
    expect(playingNow()).toEqual(['audio']);
    const second = await openLightbox(1);
    expect(playingNow()).toEqual(['audio']);
    await step(() => page.audioApi.current?.togglePlay());
    expect(playingNow()).toEqual(['lightbox']);
    await second.close();
    expect(playingNow()).toEqual(['cover a']);
  });

  it('takes the hero out of the rule when the browser refuses to start it by itself: the next video most in view plays, nothing is held, and a press still plays it', async () => {
    refusing.add('hero');
    const page = await renderPage();
    await inView(page.block, 0.7);
    expect(playingNow()).toEqual(['block']);
    // The hero, now most in view, is refused: the block plays again, and the hero's button offers Play.
    await heroInView(page, 1);
    expect(starts.get('hero')).toBe(1);
    expect(playingNow()).toEqual(['block']);
    expect(page.heroButton.textContent).toBe('Play video');
    // Nothing holds playback: a hovered preview plays, and hands back to the block.
    await hover(page.cards[0]);
    expect(playingNow()).toEqual(['cover a']);
    await leave(page.cards[0]);
    expect(playingNow()).toEqual(['block']);
    // The hero never tries again by itself on this page.
    await heroInView(page, 0.5);
    await heroInView(page, 1);
    expect(starts.get('hero')).toBe(1);
    // The visitor's press plays it, and it holds playback as any start of theirs does.
    await press(page.heroButton);
    expect(playingNow()).toEqual(['hero']);
    expect(page.heroButton.textContent).toBe('Pause video');
    await hover(page.cards[1]);
    expect(playingNow()).toEqual(['hero']);
  });

  it('keeps the poster of a hovered cover the browser refuses to play: the hero plays again, and the next hover tries again', async () => {
    refusing.add('cover a');
    const page = await renderPage();
    await heroInView(page, 0.8);
    expect(playingNow()).toEqual(['hero']);
    await hover(page.cards[0]);
    expect(starts.get('cover a')).toBe(1);
    expect(coverLive(page.cards[0])).toBe(false);
    expect(playingNow()).toEqual(['hero']);
    // No second try while the pointer stays on the card.
    await flush();
    expect(starts.get('cover a')).toBe(1);
    // The next hover tries again; refused again, the poster stays and the hero plays on.
    await leave(page.cards[0]);
    await hover(page.cards[0]);
    expect(starts.get('cover a')).toBe(2);
    expect(playingNow()).toEqual(['hero']);
    // Once the browser allows it, the next hover plays the preview.
    await leave(page.cards[0]);
    refusing.delete('cover a');
    await hover(page.cards[0]);
    expect(starts.get('cover a')).toBe(3);
    expect(coverLive(page.cards[0])).toBe(true);
    expect(playingNow()).toEqual(['cover a']);
  });

  it("pauses the visitor's own hero under a lightbox, and leaves it paused when the lightbox closes", async () => {
    const page = await renderPage();
    await heroInView(page, 0.9);
    expect(playingNow()).toEqual(['hero']);
    // Pressed while it plays by itself: the visitor's Pause, which holds.
    await step(() => page.heroButton.click());
    expect(playingNow()).toEqual([]);
    await step(() => page.heroButton.click());
    expect(playingNow()).toEqual(['hero']);
    const box = await openLightbox(0);
    expect(playingNow()).toEqual([]);
    await box.close();
    expect(playingNow()).toEqual([]);
  });
});

describe('on a phone or a tablet (touch)', () => {
  beforeEach(() => {
    finePointer.matches = false;
  });

  it('plays the cover whose card is most in view, at 0.6 or more, one at a time among every video that plays by itself', async () => {
    const page = await renderPage();
    await inView(page.cards[0], 0.9);
    await inView(page.cards[1], 0.7);
    expect(playingNow()).toEqual(['cover a']);
    await inView(page.cards[0], 0.3);
    expect(playingNow()).toEqual(['cover b']);
    await heroInView(page, 1);
    expect(playingNow()).toEqual(['hero']);
    await heroInView(page, 0);
    expect(playingNow()).toEqual(['cover b']);
    await inView(page.cards[1], 0.5);
    expect(playingNow()).toEqual([]);
  });

  it("pauses the cover under a lightbox and for the visitor's own playback, and plays it again after", async () => {
    const page = await renderPage();
    await inView(page.cards[0], 0.8);
    expect(playingNow()).toEqual(['cover a']);
    const box = await openLightbox(0);
    expect(playingNow()).toEqual([]);
    await box.close();
    expect(playingNow()).toEqual(['cover a']);
    await step(() => page.audioApi.current?.togglePlay());
    expect(playingNow()).toEqual(['audio']);
    await step(() => page.audioApi.current?.togglePlay());
    expect(playingNow()).toEqual(['cover a']);
  });

  it('takes a hero the browser refuses out of the rule: the cover most in view plays instead', async () => {
    refusing.add('hero');
    const page = await renderPage();
    await inView(page.cards[0], 0.8);
    expect(playingNow()).toEqual(['cover a']);
    await heroInView(page, 1);
    expect(starts.get('hero')).toBe(1);
    expect(playingNow()).toEqual(['cover a']);
  });

  it('keeps the poster of a cover the browser refuses to play, plays the next video most in view, and tries again the next time its card comes into view', async () => {
    refusing.add('cover a');
    const page = await renderPage();
    await heroInView(page, 0.7);
    expect(playingNow()).toEqual(['hero']);
    await inView(page.cards[0], 0.9);
    expect(starts.get('cover a')).toBe(1);
    expect(coverLive(page.cards[0])).toBe(false);
    expect(playingNow()).toEqual(['hero']);
    // No second try while its card stays in view.
    await inView(page.cards[0], 1);
    expect(starts.get('cover a')).toBe(1);
    // Out of view and back: it tries again, and plays once the browser allows it.
    await inView(page.cards[0], 0.3);
    refusing.delete('cover a');
    await inView(page.cards[0], 0.9);
    expect(starts.get('cover a')).toBe(2);
    expect(coverLive(page.cards[0])).toBe(true);
    expect(playingNow()).toEqual(['cover a']);
  });
});
