// @vitest-environment jsdom
/**
 * The home page's Motion+ leaves (components/home/MovingTicker.tsx and PhoneCarousel.tsx), each
 * against a fake Motion+ Ticker or Carousel that hands it the measures a real layout would. The
 * moving ticker: where it starts, what holds it still (a click must not leave it still; keyboard
 * focus must), when it asks for frames, and its arrow-key step. The phone carousel: what it hands
 * the Carousel, how it reports its place, and how it turns to a card.
 */
import { act, createElement as h, useLayoutEffect, type ReactNode, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionValue, type MotionValue } from 'motion/react';
import { page } from '../lib/motion';

const state = vi.hoisted(() => ({
  ticker: null as null | Record<string, unknown>,
  carousel: null as null | Record<string, unknown>,
  /** What useTicker returns, apart from the offset the Ticker was given. */
  measures: {} as Record<string, unknown>,
  /** What useCarousel returns. */
  place: {} as Record<string, unknown>,
  /** The frame callbacks registered with Motion's frame loop. */
  frames: new Set<unknown>(),
  animations: [] as unknown[][],
}));

vi.mock('motion-plus/react', async () => {
  const { createElement, forwardRef } = await import('react');
  return {
    Ticker: forwardRef(function FakeTicker(props: Record<string, unknown>, ref: Ref<HTMLDivElement>) {
      state.ticker = props;
      const { items: _items, offset: _offset, drag: _drag, _dragX, gap: _gap, align: _align, children, ...dom } = props;
      return createElement('div', { ref, ...dom }, children as ReactNode);
    }),
    // Inside a Carousel the Ticker's offset is the carousel's drawn offset (measures.offset here).
    useTicker: () => ({ offset: state.ticker?.offset, ...state.measures }),
    Carousel: (props: Record<string, unknown>) => {
      state.carousel = props;
      const {
        items: _items,
        loop: _loop,
        snap: _snap,
        page: _page,
        gap: _gap,
        align: _align,
        transition: _t,
        dragElastic: _d,
        dragControls: _c,
        onDragStart: _o,
        children,
        ...dom
      } = props;
      return createElement('div', dom, children as ReactNode);
    },
    useCarousel: () => state.place,
  };
});

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    frame: {
      ...actual.frame,
      update: (callback: unknown) => {
        state.frames.add(callback);
        return callback;
      },
    },
    cancelFrame: (callback: unknown) => {
      state.frames.delete(callback);
    },
    animate: (...args: unknown[]) => {
      state.animations.push(args);
      return { stop() {} };
    },
  };
});

const { default: MovingTicker } = await import('../components/home/MovingTicker');
const { default: PhoneCarousel } = await import('../components/home/PhoneCarousel');
type Api = import('../components/home/PhoneCarousel').StripApi;

class FakeObserver {
  static made: FakeObserver[] = [];
  observed: Element[] = [];
  constructor(public callback: IntersectionObserverCallback) {
    FakeObserver.made.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    FakeObserver.made = FakeObserver.made.filter((o) => o !== this);
  }
  takeRecords() {
    return [];
  }
  report(isIntersecting: boolean) {
    const entries = this.observed.map((target) => ({ target, isIntersecting }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

/** Whether the browser marks the focused element :focus-visible (keyboard focus); jsdom always would. */
let keyboard = true;
const realMatches = Element.prototype.matches;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  Element.prototype.matches = function matches(this: Element, selector: string) {
    return selector === ':focus-visible' ? keyboard && this === document.activeElement : realMatches.call(this, selector);
  };
});

afterAll(() => {
  Element.prototype.matches = realMatches;
});

let root: Root | null = null;
let host: HTMLElement;

function render(node: ReturnType<typeof h>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe('MovingTicker', () => {
  const labels = ['KiCad 9', 'LTspice', 'Python'];

  beforeEach(() => {
    FakeObserver.made = [];
    state.ticker = null;
    state.frames.clear();
    state.animations = [];
    keyboard = true;
    // Three items of 100 px: one copy of the list is 300 px.
    state.measures = {
      totalItemLength: 300,
      gap: 0,
      itemPositions: [
        { start: 0, end: 100 },
        { start: 100, end: 200 },
        { start: 200, end: 300 },
      ],
      isMeasured: true,
    };
  });

  /** Mounts the ticker in view. */
  function mount() {
    render(h(MovingTicker, { labels, labelledBy: 'tools-title' }));
    act(() => FakeObserver.made.forEach((o) => o.report(true)));
  }

  const view = () => host.querySelector<HTMLElement>('.hm-ticker__view--moving')!;
  const offset = () => state.ticker!.offset as MotionValue<number>;
  /** Whether it slides: its frame callback is registered. */
  const sliding = () => state.frames.size > 0;
  const pointer = (type: string, pointerType: string, target: EventTarget = view()) =>
    act(() => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType }));
    });

  it('is the strip the still row was: a labelled region that takes focus, dragged by its own offset', () => {
    mount();
    expect(view().getAttribute('role')).toBe('region');
    expect(view().getAttribute('aria-labelledby')).toBe('tools-title');
    expect(view().tabIndex).toBe(0);
    expect(state.ticker).toMatchObject({ drag: 'x', gap: 0 });
    expect(state.ticker!._dragX).toBe(offset());
  });

  it('starts at the start of the list, where the still row stands, every time it is mounted', () => {
    mount();
    expect(offset().get()).toBe(0);
    offset().set(-520);
    act(() => root?.unmount());
    mount();
    expect(offset().get()).toBe(0);
  });

  it('slides while nothing holds it, and holds still while a mouse or a pen is over it, not a touch', () => {
    mount();
    expect(sliding()).toBe(true);
    pointer('pointerenter', 'mouse');
    expect(sliding()).toBe(false);
    pointer('pointerleave', 'mouse');
    expect(sliding()).toBe(true);
    pointer('pointerenter', 'pen');
    expect(sliding()).toBe(false);
    pointer('pointerleave', 'pen');
    pointer('pointerenter', 'touch');
    expect(sliding()).toBe(true);
  });

  it('moves on after a click or a drag once the pointer has left, though the press gave it focus', () => {
    mount();
    keyboard = false;
    pointer('pointerenter', 'mouse');
    pointer('pointerdown', 'mouse');
    act(() => view().focus());
    expect(sliding()).toBe(false);
    pointer('pointerup', 'mouse', window);
    pointer('pointerleave', 'mouse');
    expect(document.activeElement).toBe(view());
    expect(sliding()).toBe(true);
  });

  it('holds still with keyboard focus until focus leaves, and after a key pressed inside', () => {
    mount();
    act(() => view().focus());
    expect(sliding()).toBe(false);
    act(() => view().blur());
    expect(sliding()).toBe(true);
    // Focused by a click, then an arrow key: keyboard use from then on.
    keyboard = false;
    act(() => view().focus());
    expect(sliding()).toBe(true);
    act(() => {
      view().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    expect(sliding()).toBe(false);
  });

  it('keyboard focus carried in from the still row holds it from the start', () => {
    // TickerStrip carries focus in from a layout effect, before the ticker's own listeners are set.
    function Carried() {
      useLayoutEffect(() => {
        document.querySelector<HTMLElement>('.hm-ticker__view--moving')!.focus({ preventScroll: true });
      }, []);
      return h(MovingTicker, { labels, labelledBy: 'tools-title' });
    }
    render(h(Carried));
    act(() => FakeObserver.made.forEach((o) => o.report(true)));
    expect(document.activeElement).toBe(view());
    expect(sliding()).toBe(false);
  });

  it('asks for no frames out of view, in a hidden tab, or before it has measured itself', () => {
    mount();
    expect(sliding()).toBe(true);
    act(() => FakeObserver.made.forEach((o) => o.report(false)));
    expect(sliding()).toBe(false);
    act(() => FakeObserver.made.forEach((o) => o.report(true)));
    expect(sliding()).toBe(true);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(sliding()).toBe(false);
    visibility.mockRestore();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(sliding()).toBe(true);
    act(() => root?.unmount());
    state.measures = { ...state.measures, isMeasured: false };
    mount();
    expect(sliding()).toBe(false);
  });

  it('the arrow keys step it one item either way, with the snap spring', () => {
    mount();
    act(() => {
      view().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    expect(state.animations.at(-1)).toEqual([offset(), -100, page.ticker.key]);
    act(() => {
      view().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    });
    expect(state.animations.at(-1)).toEqual([offset(), 100, page.ticker.key]);
    // With a modifier, the keys are the browser's.
    const count = state.animations.length;
    act(() => {
      view().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(state.animations).toHaveLength(count);
  });

  it('keeps every copy of the list hidden from assistive technology, even one the Ticker uncovers on a press', () => {
    mount();
    const copy = document.createElement('li');
    copy.className = 'clone-item';
    view().append(copy);
    pointer('pointerdown', 'mouse', copy);
    expect(copy.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('PhoneCarousel', () => {
  const items = [h('article', { key: 1 }, 'One'), h('article', { key: 2 }, 'Two'), h('article', { key: 3 }, 'Three'), h('article', { key: 4 }, 'Four')];
  let targetOffset: MotionValue<number>;
  /** Where the carousel is drawn. */
  let drawn: MotionValue<number>;
  let apis: Api[];

  beforeEach(() => {
    state.carousel = null;
    state.animations = [];
    apis = [];
    targetOffset = motionValue(-312);
    drawn = motionValue(-312);
    state.place = { currentPage: 1, totalPages: 4, isPrevActive: true, isNextActive: true, targetOffset };
    state.measures = {
      itemPositions: [
        { start: 0, end: 300 },
        { start: 312, end: 612 },
        { start: 624, end: 924 },
        { start: 936, end: 1236 },
      ],
      maxInset: 880,
      offset: drawn,
    };
  });

  const carousel = (props: { start?: number } = {}) =>
    h(PhoneCarousel, {
      id: 'featured-work',
      items,
      start: props.start ?? 2,
      gap: 12,
      label: 'Featured projects',
      kind: 'carousel',
      onApi: (api: Api) => apis.push(api),
      onDragStart: () => {},
    });

  function mount(props: { start?: number } = {}) {
    render(carousel(props));
  }

  it('hands the Carousel the strip\'s numbers, and its name and kind from lib/strings.ts', () => {
    mount();
    expect(state.carousel).toMatchObject({
      id: 'featured-work',
      loop: false,
      snap: 'page',
      page: 2,
      gap: 12,
      align: 'start',
      transition: page.strip.snap,
      dragElastic: page.strip.overdrag,
      className: 'hm-feat hm-feat--carousel',
      'aria-label': 'Featured projects',
      'aria-roledescription': 'carousel',
    });
    expect(host.firstElementChild!.getAttribute('aria-roledescription')).toBe('carousel');
    // Each card in a strip item of its own.
    expect((state.carousel!.items as unknown[]).length).toBe(4);
  });

  it('on the first card, its cards show before it has measured them, where the strip drew them', () => {
    mount({ start: 0 });
    expect(state.carousel!.className).toBe('hm-feat hm-feat--carousel hm-feat--from-start');
  });

  it('always moves with the snap spring and stretches at the ends: it is never there without motion (FeaturedStrip)', () => {
    mount();
    expect(state.carousel).toMatchObject({ transition: page.strip.snap, dragElastic: page.strip.overdrag });
    expect(state.carousel).not.toHaveProperty('reduced');
  });

  it('reports its place, and again when it changes', () => {
    mount();
    expect(apis.at(-1)).toMatchObject({ page: 1, pages: 4, canPrev: true, canNext: true });
    state.place = { ...state.place, currentPage: 3, isNextActive: false };
    act(() => root!.render(carousel()));
    expect(apis.at(-1)).toMatchObject({ page: 3, canNext: false });
  });

  it('turns to a card by its own target, with the snap spring, the last cards no further than it goes', () => {
    mount();
    const api = apis.at(-1)!;
    api.toCard(1);
    expect(state.animations.at(-1)).toEqual([targetOffset, -312, page.strip.snap]);
    api.toCard(3);
    expect(state.animations.at(-1)).toEqual([targetOffset, -880, page.strip.snap]);
    const count = state.animations.length;
    api.toCard(9);
    expect(state.animations).toHaveLength(count);
  });

  it('released by the browser (a page scroll), it ends its drag with no release of its own and rests on the nearest card', () => {
    mount();
    const controls = state.carousel!.dragControls as { cancel: () => void };
    const cancel = vi.spyOn(controls, 'cancel');
    // Resting on the second card: the drag ends, and it stays.
    apis.at(-1)!.release();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(state.animations).toHaveLength(0);
    // Moved a few px by the start of the scroll: back to the same card, never the previous one.
    drawn.set(-316);
    targetOffset.set(-316);
    apis.at(-1)!.release();
    expect(state.animations.at(-1)).toEqual([targetOffset, -312, page.strip.snap]);
    // Caught halfway by a touch that became a scroll: on to the nearer card.
    drawn.set(-480);
    targetOffset.set(-480);
    apis.at(-1)!.release();
    expect(state.animations.at(-1)).toEqual([targetOffset, -624, page.strip.snap]);
  });
});
