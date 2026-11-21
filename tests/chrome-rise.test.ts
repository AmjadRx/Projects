// @vitest-environment jsdom
/**
 * The panel rise (motion sheet 7.2; components/site/risePanels.ts) in a DOM, with the window's
 * geometry, the IntersectionObserver and the Web Animations faked: which panels wait, when they
 * rise, in which groups and with which delays, that nothing stays hidden where it can be seen,
 * and that keyboard focus never lands in a panel that cannot be seen. Then the leaf that runs it
 * on every page (components/site/PanelRise), rendered: once per page view, and stopped when
 * motion may no longer play.
 */
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssEasing, page, toMs } from '../lib/motion';
import { PANEL_SELECTOR, RISE_ATTR, startPanelRise } from '../components/site/risePanels';
import PanelRise from '../components/site/PanelRise';

// Hoisted above the imports by Vitest: the leaf and lib/useMotionOk.ts read the path the test sets.
const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

/**
 * The reduced-motion query. lib/useMotionOk.ts keeps the first query it is given for the rest of
 * the page, so the fake window hands out this one object, and `set` changes its answer the way
 * the browser does.
 */
const reduced = {
  matches: false,
  listeners: new Set<() => void>(),
  addEventListener(_type: string, listener: () => void) {
    reduced.listeners.add(listener);
  },
  removeEventListener(_type: string, listener: () => void) {
    reduced.listeners.delete(listener);
  },
  set(value: boolean) {
    reduced.matches = value;
    for (const listener of Array.from(reduced.listeners)) listener();
  },
};

/** Frames asked for and not yet run; `nextFrame` runs them. */
const frames = new Map<number, FrameRequestCallback>();
let lastFrame = 0;
function nextFrame() {
  const due = Array.from(frames.values());
  frames.clear();
  for (const callback of due) callback(0);
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (() => reduced) as unknown as typeof window.matchMedia;
});

interface Box {
  top: number;
  left?: number;
  width?: number;
  height?: number;
}

/** The observers the module made, in order: [the line, the whole window]. */
class FakeObserver {
  static made: FakeObserver[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(
    public callback: IntersectionObserverCallback,
    public options: IntersectionObserverInit = {},
  ) {
    FakeObserver.made.push(this);
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
  /** Reports these targets as intersecting, as the browser would in one frame. */
  fire(targets: Element[]) {
    const entries = targets.map(
      (target) => ({ target, isIntersecting: true, boundingClientRect: target.getBoundingClientRect() }) as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

/** A fake Web Animation: its play state, and a `finished` that settles as the real one does. */
function fakeAnimation() {
  let settle = { resolve: () => {}, reject: (_reason: unknown) => {} };
  const finished = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  finished.catch(() => {});
  const animation = {
    playState: 'running' as AnimationPlayState,
    finished,
    finish() {
      animation.playState = 'finished';
      settle.resolve();
    },
    cancel() {
      animation.playState = 'idle';
      settle.reject(new Error('cancelled'));
    },
  };
  return animation;
}

const boxes = new Map<Element, Box>();
const animations: {
  target: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: ReturnType<typeof fakeAnimation>;
}[] = [];

/** Places an element in the window (px from the window's top and left). */
function place(element: Element, box: Box) {
  boxes.set(element, box);
}

function panel(className = 'ar-glass', parent: Element = document.getElementById('main')!): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  parent.appendChild(element);
  return element;
}

/** Puts a link in `parent`, for focus to land on. */
function link(parent: Element): HTMLAnchorElement {
  const element = document.createElement('a');
  element.href = '/projects/raven';
  parent.appendChild(element);
  return element;
}

const main = () => document.getElementById('main')!;

beforeEach(() => {
  const main = document.createElement('main');
  main.id = 'main';
  document.body.replaceChildren(main);
  boxes.clear();
  animations.length = 0;
  FakeObserver.made = [];
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const box = boxes.get(this) ?? { top: 0, width: 0, height: 0 };
    const width = box.width ?? 300;
    const height = box.height ?? 200;
    const left = box.left ?? 0;
    return { top: box.top, left, width, height, bottom: box.top + height, right: left + width, x: left, y: box.top, toJSON() {} } as DOMRect;
  };
  HTMLElement.prototype.animate = function (this: HTMLElement, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
    const animation = fakeAnimation();
    animations.push({ target: this, keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions, animation });
    return animation as unknown as Animation;
  };
  frames.clear();
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    lastFrame += 1;
    frames.set(lastFrame, callback);
    return lastFrame;
  };
  window.cancelAnimationFrame = (id: number) => {
    frames.delete(id);
  };
});

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.replaceChildren();
});

describe('the panels that wait', () => {
  it('are the outermost glass panels and cards wholly below the window, and no other', () => {
    const inView = panel();
    place(inView, { top: 100 });
    const atFoot = panel('ar-card');
    place(atFoot, { top: 790 });
    const above = panel();
    place(above, { top: -900 });
    const below = panel('ar-card');
    place(below, { top: 1000 });
    const inner = panel('ar-glass', below);
    place(inner, { top: 1100 });
    const notDrawn = panel();
    place(notDrawn, { top: 1200, width: 0, height: 0 });
    const plain = panel('hm-wrap');
    place(plain, { top: 1300 });

    startPanelRise(document.getElementById('main')!);

    const waiting = [...document.querySelectorAll(`[${RISE_ATTR}]`)];
    expect(waiting).toEqual([below]);
    expect(PANEL_SELECTOR).toBe('.ar-glass, .ar-card');
    // Watched by both observers: the line, and the whole window for the end of the page.
    expect(FakeObserver.made).toHaveLength(2);
    expect(FakeObserver.made[0].options.rootMargin).toBe('0px 0px -15% 0px');
    expect(FakeObserver.made[1].options.rootMargin).toBeUndefined();
    for (const observer of FakeObserver.made) expect([...observer.observed]).toEqual([below]);
  });

  it('are none when every panel is in the first view, and then nothing is watched', () => {
    place(panel(), { top: 10 });
    place(panel('ar-card'), { top: 700 });
    const stop = startPanelRise(document.getElementById('main')!);
    expect(document.querySelectorAll(`[${RISE_ATTR}]`)).toHaveLength(0);
    expect(FakeObserver.made).toHaveLength(0);
    stop();
  });

  it('are none where the browser has no IntersectionObserver', () => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = undefined;
    place(panel(), { top: 1500 });
    startPanelRise(document.getElementById('main')!);
    expect(document.querySelectorAll(`[${RISE_ATTR}]`)).toHaveLength(0);
  });
});

describe('a panel rising', () => {
  it('rises 16 px and fades in over 300 ms (settle) once its top passes 0.85 of the window', () => {
    const one = panel();
    place(one, { top: 1200 });
    startPanelRise(document.getElementById('main')!);
    const [line, end] = FakeObserver.made;

    place(one, { top: 600 });
    line.fire([one]);

    expect(one.hasAttribute(RISE_ATTR)).toBe(false);
    expect(animations).toHaveLength(1);
    expect(animations[0].keyframes).toEqual([
      { opacity: 0, translate: `0 ${page.panels.rise}px` },
      { opacity: 1, translate: '0 0' },
    ]);
    expect(animations[0].options).toEqual({
      duration: toMs(page.panels.duration),
      easing: cssEasing(page.panels.ease),
      fill: 'backwards',
      delay: 0,
    });
    expect(animations[0].options).toMatchObject({ duration: 300, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    // Once per page view: neither observer watches it any more.
    expect(line.observed.size + end.observed.size).toBe(0);
  });

  it('starts a group 60 ms apart in reading order, a fourth with the third', () => {
    const row = [panel(), panel(), panel(), panel()];
    row.forEach((p) => place(p, { top: 1500 }));
    const next = panel();
    place(next, { top: 2400 });
    startPanelRise(document.getElementById('main')!);
    const [line] = FakeObserver.made;

    // The row comes up together; the observer names them in any order.
    [900, 300, 0, 600].forEach((left, i) => place(row[i], { top: 640, left }));
    line.fire([row[3], row[0], row[2], row[1]]);

    const byTarget = new Map(animations.map((a) => [a.target, a.options.delay]));
    expect([row[2], row[1], row[3], row[0]].map((p) => byTarget.get(p))).toEqual([0, 60, 120, 120]);
    expect(next.hasAttribute(RISE_ATTR)).toBe(true);
  });

  it('takes with its row the panels a scroller hides from the observer (a swipe strip)', () => {
    const strip = [panel('ar-card'), panel('ar-card'), panel('ar-card')];
    strip.forEach((p) => place(p, { top: 1500 }));
    startPanelRise(document.getElementById('main')!);
    const [line] = FakeObserver.made;

    strip.forEach((p, i) => place(p, { top: 650, left: i * 330 }));
    // Only the first card shows in the strip's window.
    line.fire([strip[0]]);

    expect(strip.map((p) => p.hasAttribute(RISE_ATTR))).toEqual([false, false, false]);
    expect(animations.map((a) => a.options.delay)).toEqual([0, 60, 120]);
  });

  it('leaves the panels still below the line waiting', () => {
    const first = panel();
    const second = panel();
    place(first, { top: 1500 });
    place(second, { top: 1900 });
    startPanelRise(document.getElementById('main')!);
    const [line] = FakeObserver.made;
    place(first, { top: 650 });
    place(second, { top: 1050 });
    line.fire([first]);
    expect(first.hasAttribute(RISE_ATTR)).toBe(false);
    expect(second.hasAttribute(RISE_ATTR)).toBe(true);
    expect(animations).toHaveLength(1);
  });

  it('ignores a report about a panel that no longer waits', () => {
    const one = panel();
    place(one, { top: 1500 });
    startPanelRise(document.getElementById('main')!);
    const [line] = FakeObserver.made;
    place(one, { top: 600 });
    line.fire([one]);
    line.fire([one]);
    expect(animations).toHaveLength(1);
  });
});

describe('the end of a page', () => {
  it('raises a panel at the foot of the window that the page can no longer scroll up to the line', () => {
    const last = panel();
    place(last, { top: 1500 });
    startPanelRise(document.getElementById('main')!);
    const [, end] = FakeObserver.made;

    // Scrolled to the end: no room left, and the panel's top is at 760, under the line at 680.
    Object.defineProperty(window, 'scrollY', { value: 4200, configurable: true });
    place(last, { top: 760 });
    end.fire([last]);

    expect(last.hasAttribute(RISE_ATTR)).toBe(false);
    expect(animations).toHaveLength(1);
  });

  it('lets a panel at the foot wait while the page can still bring it to the line', () => {
    const later = panel();
    place(later, { top: 1500 });
    startPanelRise(document.getElementById('main')!);
    const [, end] = FakeObserver.made;

    Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true });
    place(later, { top: 760 });
    end.fire([later]);

    expect(later.hasAttribute(RISE_ATTR)).toBe(true);
    expect(animations).toHaveLength(0);
  });
});

describe('focus (DESIGN_DIRECTION.md 8: focus stays visible)', () => {
  it('draws a waiting panel in place at once, with no rise, when focus enters it, and the waiting panels level with it or above', () => {
    const before = panel();
    const holder = panel('ar-card');
    const beside = panel('ar-card');
    const after = panel();
    place(before, { top: 1000 });
    place(holder, { top: 1300 });
    place(beside, { top: 1300, left: 330 });
    place(after, { top: 1700 });
    const target = link(holder);
    startPanelRise(main());
    const [line, end] = FakeObserver.made;

    // Tab: the browser brings the link only to the window's foot, its panel's top under the line.
    place(before, { top: 460 });
    place(holder, { top: 760 });
    place(beside, { top: 760, left: 330 });
    place(after, { top: 1160 });
    target.focus();

    expect([before, holder, beside, after].map((p) => p.hasAttribute(RISE_ATTR))).toEqual([false, false, false, true]);
    expect(animations).toHaveLength(0);
    for (const observer of [line, end]) expect([...observer.observed]).toEqual([after]);
    // The observer's report that the row has reached the line comes after, and raises nothing.
    line.fire([holder, beside, before]);
    expect(animations).toHaveLength(0);
  });

  it('draws a panel that is itself the focused link (a project page pager link) in place at once', () => {
    const pager = link(main());
    pager.className = 'pj-pager__link ar-glass';
    place(pager, { top: 1500 });
    startPanelRise(main());
    place(pager, { top: 750 });
    pager.focus();
    expect(pager.hasAttribute(RISE_ATTR)).toBe(false);
    expect(animations).toHaveLength(0);
  });

  it('finishes a rise under way at once when focus enters the panel', () => {
    const one = panel();
    place(one, { top: 1500 });
    const target = link(one);
    startPanelRise(main());
    const [line] = FakeObserver.made;
    place(one, { top: 600 });
    line.fire([one]);
    expect(animations[0].animation.playState).toBe('running');
    target.focus();
    expect(animations[0].animation.playState).toBe('finished');
  });

  it('never holds back a panel that has the focus when the page is read', () => {
    const holder = panel();
    place(holder, { top: 1500 });
    const other = panel();
    place(other, { top: 1900 });
    link(holder).focus();
    startPanelRise(main());
    expect(holder.hasAttribute(RISE_ATTR)).toBe(false);
    expect(other.hasAttribute(RISE_ATTR)).toBe(true);
  });

  it('leaves the waiting panels waiting when focus lands outside them', () => {
    const inView = panel();
    place(inView, { top: 100 });
    const later = panel();
    place(later, { top: 1500 });
    startPanelRise(main());
    link(inView).focus();
    link(main()).focus();
    expect(later.hasAttribute(RISE_ATTR)).toBe(true);
  });
});

describe('stopping', () => {
  it('draws every waiting panel in place at once and stops watching', () => {
    const one = panel();
    const two = panel('ar-card');
    place(one, { top: 1500 });
    place(two, { top: 2500 });
    const stop = startPanelRise(document.getElementById('main')!);
    expect(document.querySelectorAll(`[${RISE_ATTR}]`)).toHaveLength(2);

    stop();

    expect(document.querySelectorAll(`[${RISE_ATTR}]`)).toHaveLength(0);
    expect(FakeObserver.made.every((observer) => observer.disconnected)).toBe(true);
    expect(animations).toHaveLength(0);
  });

  it('finishes the rises under way, and stops listening for focus', () => {
    const rising = panel();
    const waiting = panel();
    place(rising, { top: 1500 });
    place(waiting, { top: 2500 });
    const stop = startPanelRise(main());
    const [line] = FakeObserver.made;
    place(rising, { top: 600 });
    line.fire([rising]);
    const removed = vi.spyOn(main(), 'removeEventListener');

    stop();

    expect(animations[0].animation.playState).toBe('finished');
    expect(removed).toHaveBeenCalledWith('focusin', expect.any(Function));
    expect(waiting.hasAttribute(RISE_ATTR)).toBe(false);
  });
});

describe('the leaf on every page (components/site/PanelRise)', () => {
  let root: Root | null = null;
  const leaf = () => h(PanelRise, { mainId: 'main' });

  async function render() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(leaf()));
  }

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    route.pathname = '/';
    reduced.matches = false;
  });

  it('starts one frame after the page has painted, and again after each route change, the old watch stopped', async () => {
    const below = panel();
    place(below, { top: 1500 });
    await render();
    expect(FakeObserver.made).toHaveLength(0);
    nextFrame();
    expect(below.hasAttribute(RISE_ATTR)).toBe(true);
    expect(FakeObserver.made).toHaveLength(2);

    route.pathname = '/projects';
    await act(async () => root!.render(leaf()));
    // The old page's watch stops at once, drawing its panels in place...
    expect(FakeObserver.made.every((observer) => observer.disconnected)).toBe(true);
    expect(below.hasAttribute(RISE_ATTR)).toBe(false);
    // ...and the new page's starts a frame later.
    expect(FakeObserver.made).toHaveLength(2);
    nextFrame();
    expect(FakeObserver.made).toHaveLength(4);
    expect(below.hasAttribute(RISE_ATTR)).toBe(true);
  });

  it('stops, drawing every waiting panel in place, when motion may no longer play, and starts nothing more', async () => {
    const below = panel();
    place(below, { top: 1500 });
    await render();
    nextFrame();
    expect(below.hasAttribute(RISE_ATTR)).toBe(true);

    await act(async () => reduced.set(true));

    expect(below.hasAttribute(RISE_ATTR)).toBe(false);
    expect(FakeObserver.made.every((observer) => observer.disconnected)).toBe(true);
    nextFrame();
    expect(FakeObserver.made).toHaveLength(2);
  });

  it('starts nothing when motion is turned off before its frame', async () => {
    place(panel(), { top: 1500 });
    await render();
    await act(async () => reduced.set(true));
    nextFrame();
    expect(FakeObserver.made).toHaveLength(0);
    expect(document.querySelectorAll(`[${RISE_ATTR}]`)).toHaveLength(0);
  });
});
