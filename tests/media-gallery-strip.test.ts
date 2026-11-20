// @vitest-environment jsdom
/**
 * The gallery's strip in a page (components/viewers/image/Gallery.tsx; motion sheet 6.4 and 8.1):
 * Previous, Next, the arrow keys, Tab, the counter, the click that ends a drag, a wheel at an end,
 * reduced motion, and Carousel there only near the view, around a stand-in for Motion+ Carousel.
 * jsdom lays nothing out, so the stand-in takes the frames' positions from the test and lets it
 * move Carousel's offset as a drag or a wheel would; Motion's `animate` is recorded and lands at
 * once, so each move shows its target and its transition. The real Carousel's markup is in
 * media-gallery.test.ts, and its motion was checked in a browser.
 */
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MotionValue } from 'motion/react';
import type { ResolvedMedia } from '../lib/media';
import { media, spring } from '../lib/motion';

vi.mock('next/navigation', () => ({ usePathname: () => '/projects/raven' }));

// A plain image: next/image's own work is not under test.
vi.mock('next/image', async () => {
  const { createElement, forwardRef } = await import('react');
  return {
    default: forwardRef<HTMLImageElement, { src: string; alt: string; className?: string }>(({ src, alt, className }, ref) =>
      createElement('img', { ref, src, alt, className }),
    ),
  };
});

const lightbox = vi.hoisted(() => ({ opened: [] as number[], openAt: null as number | null }));
vi.mock('../components/viewers/image/useLightbox', () => ({
  useLightbox: () => ({ openAt: lightbox.openAt, open: (index: number) => lightbox.opened.push(index), close() {} }),
  LazyLightbox: () => null,
}));

interface Move {
  value: MotionValue<number>;
  target: number;
  transition: unknown;
}
const moves = vi.hoisted(() => ({ list: [] as Move[] }));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    animate: (value: MotionValue<number>, target: number, transition: unknown) => {
      moves.list.push({ value, target, transition });
      value.set(target);
      return { stop() {} };
    },
  };
});

/** The stand-in Carousel's last props, its offsets, and the measurements the test gives it. */
const fake = vi.hoisted(() => ({
  props: {} as Record<string, unknown>,
  positions: [] as { start: number; end: number }[],
  maxInset: null as number | null,
  offset: null as unknown as MotionValue<number>,
  targetOffset: null as unknown as MotionValue<number>,
}));

vi.mock('motion-plus/react', async () => {
  const React = await import('react');
  const { motionValue } = await import('motion/react');
  type Values = { offset: MotionValue<number>; targetOffset: MotionValue<number> };
  const Context = React.createContext<Values | null>(null);
  // What the real Carousel puts on its box: its own role and description, then the props given.
  const BOX = ['className', 'role', 'aria-roledescription', 'onKeyDown', 'onFocus', 'onBlur', 'onClickCapture', 'onPointerDownCapture', 'onPointerDown'];
  function Carousel(props: Record<string, unknown> & { items: unknown[]; children?: unknown }) {
    fake.props = props;
    const [values] = React.useState<Values>(() => ({ offset: motionValue(0), targetOffset: motionValue(0) }));
    fake.offset = values.offset;
    fake.targetOffset = values.targetOffset;
    // The drawn offset follows the target straight through while nothing pages (subscribed before
    // any effect, as Motion's useMotionValueEvent is).
    React.useInsertionEffect(() => values.targetOffset.on('change', (latest: number) => values.offset.set(latest)), [values]);
    const box = {
      role: 'region',
      'aria-roledescription': 'carousel',
      // The test's mark: this box is Carousel's, not the still strip's.
      'data-carousel': '',
      ...Object.fromEntries(BOX.filter((key) => key in props).map((key) => [key, props[key]])),
    };
    const list = props.items.map((item, index) => React.createElement('li', { key: index, className: 'ticker-item' }, item as never));
    return React.createElement(
      Context.Provider,
      { value: values },
      React.createElement('div', box, React.createElement('ul', null, list)),
      props.children as never,
    );
  }
  return {
    Carousel,
    useCarousel: () => React.useContext(Context),
    useTicker: () => ({ itemPositions: fake.positions, maxInset: fake.maxInset, direction: 'ltr' }),
  };
});

const { default: Gallery } = await import('../components/viewers/image/Gallery');

/** Four frames in an 800 px column (as in media-gallery.test.ts): the last two both rest at the 872 px end. */
const FRAMES = [
  { start: 0, end: 440 },
  { start: 456, end: 1144 },
  { start: 1160, end: 1408 },
  { start: 1424, end: 1672 },
];
const MAX = 872;
const SETTLE = 120;

const photo = (n: number): ResolvedMedia => ({
  kind: 'image',
  file: { src: `/dev/samples/photo-${n}.webp`, name: `photo-${n}.webp`, ext: 'webp', typeLabel: 'WebP image', downloadHref: `/dev/samples/photo-${n}.webp` },
  alt: '',
  width: 1600,
  height: 1000,
  store: 'repo',
});
const ITEMS = [photo(1), photo(2), photo(3), photo(4)];

/** The reduced-motion setting the page reads, and whoever listens for its changes. */
const reduced = { matches: false, listeners: new Set<() => void>() };

let container: HTMLDivElement;
let root: Root;

const draw = () => act(() => root.render(h(Gallery, { items: ITEMS })));
const box = () => container.querySelector<HTMLElement>('.mm-gal')!;
const frameButton = (index: number) => box().querySelectorAll<HTMLButtonElement>('.ar-gal__frame')[index];
const counter = () => container.querySelector('.ar-gal__count')?.textContent;
const previous = () => container.querySelector<HTMLButtonElement>('[aria-label="Previous"]')!;
const next = () => container.querySelector<HTMLButtonElement>('[aria-label="Next"]')!;
const press = (element: Element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
const key = (element: Element, name: string, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra });
  act(() => element.dispatchEvent(event));
  return event;
};
/** Carousel's offset moved as a drag or a wheel moves it (the strip moves left as the offset falls). */
const moveTo = (offset: number) => act(() => fake.targetOffset.set(offset));
const settle = () => act(() => vi.advanceTimersByTime(SETTLE));
const lastMove = () => moves.list.at(-1);
/** A wheel over `target`; returns the event, to see whether its default was taken. */
const wheel = (target: Element, init: WheelEventInit) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  act(() => target.dispatchEvent(event));
  return event;
};

/** A stand-in IntersectionObserver, through which the test says whether the gallery is near the view. */
const views = { observers: new Set<FakeObserver>() };
class FakeObserver {
  target: Element | null = null;
  constructor(readonly callback: IntersectionObserverCallback) {
    views.observers.add(this);
  }
  observe(target: Element) {
    this.target = target;
  }
  unobserve() {}
  disconnect() {
    views.observers.delete(this);
  }
  takeRecords() {
    return [];
  }
}
const view = (near: boolean) =>
  act(() => {
    for (const observer of views.observers) {
      observer.callback([{ isIntersecting: near, target: observer.target } as IntersectionObserverEntry], observer as never);
    }
  });
/** The strip's box is Carousel's (and not the still strip's). */
const carousel = () => container.querySelector('[data-carousel]');
/**
 * Lets the check the gallery defers to after the event in hand run (a 0 ms timeout; the fake
 * timers make one set inside another timer 1 ms).
 */
const afterEvent = () => act(() => vi.advanceTimersByTime(1));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  moves.list.length = 0;
  lightbox.opened.length = 0;
  lightbox.openAt = null;
  fake.positions = FRAMES;
  fake.maxInset = MAX;
  reduced.matches = false;
  reduced.listeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('reduce') ? reduced.matches : false;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => reduced.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => reduced.listeners.delete(listener),
    addListener: (listener: () => void) => reduced.listeners.add(listener),
    removeListener: (listener: () => void) => reduced.listeners.delete(listener),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('the strip on Carousel', () => {
  it("gives Carousel the sheet's strip: ends, loose snapping, the snap spring, a fifth of the travel past the ends", () => {
    draw();
    expect(fake.props).toMatchObject({ loop: false, snap: 'loose', gap: 16, align: 'start', dragElastic: media.gallery.overdrag });
    expect(fake.props.transition).toEqual(spring.snap);
    // Carousel's own release (the glide and the snap) and its own press.
    expect(fake.props.onDragEnd).toBeUndefined();
    expect(fake.props.onPointerDown).toBeUndefined();
    // The section is the region: the box drops Carousel's role and description.
    expect(box().hasAttribute('role')).toBe(false);
    expect(box().hasAttribute('aria-roledescription')).toBe(false);
    expect(container.querySelector('section')?.getAttribute('aria-roledescription')).toBe('gallery');
  });

  it('moves one frame with Previous and Next on the snap spring, and turns the end buttons phantom at once', () => {
    draw();
    expect(counter()).toBe('1 of 4');
    expect(previous().getAttribute('aria-disabled')).toBe('true');
    press(previous());
    expect(moves.list).toHaveLength(0);

    press(next());
    expect(lastMove()).toMatchObject({ value: fake.targetOffset, target: -456, transition: spring.snap });
    expect(counter()).toBe('2 of 4');
    expect(previous().hasAttribute('aria-disabled')).toBe(false);

    press(next());
    expect(lastMove()?.target).toBe(-MAX);
    expect(counter()).toBe('3 of 4');

    press(previous());
    expect(lastMove()?.target).toBe(-456);
    expect(counter()).toBe('2 of 4');
    settle();
    expect(counter()).toBe('2 of 4');
  });

  it('keeps the counter on the last frame when the last two frames share the end', () => {
    draw();
    press(next());
    press(next());
    const count = moves.list.length;
    // The strip is already at the end: nothing moves, and the counter names the last frame.
    press(next());
    expect(moves.list).toHaveLength(count);
    expect(counter()).toBe('4 of 4');
    expect(next().getAttribute('aria-disabled')).toBe('true');
    // The settle of the move before it changes nothing.
    settle();
    expect(counter()).toBe('4 of 4');
  });

  it('moves one frame with the arrow keys, taking focus along, and never wraps', () => {
    draw();
    act(() => frameButton(0).focus());
    const right = key(frameButton(0), 'ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(frameButton(1));
    expect(lastMove()).toMatchObject({ target: -456, transition: spring.snap });
    expect(counter()).toBe('2 of 4');

    key(frameButton(1), 'ArrowLeft');
    expect(document.activeElement).toBe(frameButton(0));
    expect(lastMove()?.target).toBe(-0);
    expect(counter()).toBe('1 of 4');

    // At the first frame Left stays put (no wrap to the last), and its default is still taken.
    const count = moves.list.length;
    const left = key(frameButton(0), 'ArrowLeft');
    expect(left.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(frameButton(0));
    expect(moves.list).toHaveLength(count);

    // With a modifier, the key is the browser's.
    expect(key(frameButton(0), 'ArrowRight', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(frameButton(0));
  });

  it('follows a drag or a wheel: once the strip settles, the counter names the frame starting nearest the left edge', () => {
    draw();
    moveTo(-500);
    act(() => vi.advanceTimersByTime(SETTLE - 1));
    expect(counter()).toBe('1 of 4');
    act(() => vi.advanceTimersByTime(1));
    expect(counter()).toBe('2 of 4');
    moveTo(-MAX);
    settle();
    expect(counter()).toBe('3 of 4');
    // No move of its own: the counter follows, the strip stays.
    expect(moves.list).toHaveLength(0);
  });

  it('names no frame while a pointer is down, and names one once it lifts', () => {
    draw();
    act(() => box().dispatchEvent(new Event('pointerdown', { bubbles: true })));
    moveTo(-500);
    settle();
    expect(counter()).toBe('1 of 4');
    act(() => window.dispatchEvent(new Event('pointerup')));
    settle();
    expect(counter()).toBe('2 of 4');
  });

  it('leaves the counter alone after a click that moves nothing', () => {
    draw();
    press(next());
    press(next());
    press(next());
    settle();
    expect(counter()).toBe('4 of 4');
    act(() => box().dispatchEvent(new Event('pointerdown', { bubbles: true })));
    act(() => window.dispatchEvent(new Event('pointerup')));
    settle();
    expect(counter()).toBe('4 of 4');
  });

  it('brings back a strip wheeled past an end', () => {
    // Carousel does not hold a wheel to the ends when every frame fits.
    fake.maxInset = 0;
    draw();
    moveTo(-120);
    settle();
    expect(lastMove()).toMatchObject({ target: -0, transition: spring.snap });
    expect(counter()).toBe('1 of 4');
  });

  it('opens nothing from the click that ends a drag, and still opens on a tap or a key', () => {
    draw();
    const onDragStart = fake.props.onDragStart as () => void;
    act(() => box().dispatchEvent(new Event('pointerdown', { bubbles: true })));
    act(() => onDragStart());
    press(frameButton(1));
    expect(lightbox.opened).toEqual([]);

    // A tap: pressed and let go without a drag.
    act(() => box().dispatchEvent(new Event('pointerdown', { bubbles: true })));
    press(frameButton(1));
    expect(lightbox.opened).toEqual([1]);

    // Enter or Space clicks with no pointer (detail 0): it opens, whatever came before.
    act(() => onDragStart());
    act(() => frameButton(2).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    expect(lightbox.opened).toEqual([1, 2]);
  });

  it("keeps Carousel's focus trap out, and brings a frame reached by Tab into view", () => {
    draw();
    // Carousel's Ticker starts its focus trap from a capturing focus listener on its box.
    const trap = vi.fn();
    box().addEventListener('focus', trap, true);
    act(() => frameButton(3).focus());
    expect(trap).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(frameButton(3));
    // The fourth frame was outside the strip: the strip comes to it, and the counter with it.
    expect(lastMove()).toMatchObject({ target: -MAX, transition: spring.snap });
    expect(counter()).toBe('4 of 4');

    // A frame already in view stays where it is.
    const count = moves.list.length;
    act(() => frameButton(2).focus());
    expect(moves.list).toHaveLength(count);
    expect(counter()).toBe('4 of 4');
  });

  it("puts the strip back on the counter's frame when the frames are measured again", () => {
    draw();
    press(next());
    expect(fake.targetOffset.get()).toBe(-456);
    // The phone's 360 px strip: every frame shorter, so the second starts sooner.
    fake.positions = FRAMES.map(({ start, end }) => ({ start: (start * 360) / 440, end: (end * 360) / 440 }));
    fake.maxInset = 1672 * (360 / 440) - 358;
    draw();
    expect(fake.targetOffset.get()).toBeCloseTo(-373.09, 2);
    expect(counter()).toBe('2 of 4');
    settle();
    expect(counter()).toBe('2 of 4');
  });

  it('keeps the counter on the last frame when the frames are measured again at the shared end', () => {
    draw();
    press(next());
    press(next());
    press(next());
    settle();
    expect(counter()).toBe('4 of 4');
    // Measured again (a resize): the strip goes back to the end, and its settle keeps the last frame named.
    fake.positions = FRAMES.map(({ start, end }) => ({ start: start + 1, end: end + 1 }));
    fake.maxInset = MAX + 40;
    draw();
    expect(fake.targetOffset.get()).toBe(-(MAX + 40));
    settle();
    expect(counter()).toBe('4 of 4');
  });
});

describe('a wheel at an end', () => {
  it('never reaches Carousel, whose bounce would shake the strip; any other wheel does', () => {
    draw();
    // Where Carousel listens for a wheel (motion-plus `wheel`, on its box).
    const heard = vi.fn();
    box().addEventListener('wheel', heard);
    // At the first frame, a wheel toward it: taken, as Carousel would take it, and kept from Carousel.
    expect(wheel(frameButton(0), { deltaX: -40 }).defaultPrevented).toBe(true);
    expect(heard).toHaveBeenCalledTimes(0);
    // Toward the last frame: Carousel's.
    expect(wheel(frameButton(0), { deltaX: 40 }).defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    // Mostly vertical: the page's scroll, at an end too.
    expect(wheel(frameButton(0), { deltaX: -2, deltaY: 60 }).defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    // Shift turns a vertical wheel sideways, as Carousel reads it.
    expect(wheel(frameButton(0), { deltaY: -40, shiftKey: true }).defaultPrevented).toBe(true);
    expect(heard).toHaveBeenCalledTimes(2);

    // At the last end, a wheel past it is kept; one back is Carousel's.
    press(next());
    press(next());
    expect(wheel(frameButton(2), { deltaX: 40 }).defaultPrevented).toBe(true);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(wheel(frameButton(2), { deltaX: -40 }).defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(3);
    // Over the bar: not the strip's.
    expect(wheel(next(), { deltaX: 40 }).defaultPrevented).toBe(false);
    // Nothing moved for any of them.
    expect(fake.targetOffset.get()).toBe(-MAX);
  });

  it('keeps every sideways wheel from Carousel when every frame fits', () => {
    fake.maxInset = 0;
    draw();
    expect(wheel(frameButton(1), { deltaX: 40 }).defaultPrevented).toBe(true);
    expect(wheel(frameButton(1), { deltaX: -40 }).defaultPrevented).toBe(true);
    expect(wheel(frameButton(1), { deltaY: 40 }).defaultPrevented).toBe(false);
  });
});

describe('Carousel near the view only (its Ticker runs the frame loop while it is mounted)', () => {
  beforeEach(() => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
  });
  afterEach(() => {
    delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    views.observers.clear();
  });

  it('is in the server markup and stays near the view; far, the still strip stands in, frames and bar as they were', () => {
    draw();
    expect(carousel()).not.toBeNull();
    view(true);
    afterEvent();
    expect(carousel()).not.toBeNull();
    press(next());
    settle();
    afterEvent();
    expect(carousel()).not.toBeNull();

    view(false);
    afterEvent();
    expect(carousel()).toBeNull();
    // The still strip: the same box and items, every frame in order, and the counter where it was.
    expect(box().querySelectorAll(':scope > ul > li.ticker-item')).toHaveLength(4);
    expect(frameButton(2).textContent).toContain('Open item 3 of 4');
    expect(counter()).toBe('2 of 4');
    expect(previous().hasAttribute('aria-disabled')).toBe(false);
    // Next still counts; the strip is placed when Carousel is back.
    press(next());
    expect(counter()).toBe('3 of 4');
    view(true);
    expect(carousel()).not.toBeNull();
    expect(fake.targetOffset.get()).toBe(-MAX);
    settle();
    expect(counter()).toBe('3 of 4');
  });

  it("comes back near on the counter's frame, also where two frames share the end", () => {
    draw();
    view(true);
    press(next());
    press(next());
    press(next());
    settle();
    afterEvent();
    view(false);
    afterEvent();
    expect(carousel()).toBeNull();
    view(true);
    expect(carousel()).not.toBeNull();
    expect(fake.targetOffset.get()).toBe(-MAX);
    settle();
    expect(counter()).toBe('4 of 4');
  });

  it('stays while focus is in the strip, and goes when focus leaves it, focus kept on the bar', () => {
    draw();
    view(true);
    act(() => frameButton(1).focus());
    settle();
    afterEvent();
    view(false);
    afterEvent();
    expect(carousel()).not.toBeNull();
    act(() => next().focus());
    afterEvent();
    expect(carousel()).toBeNull();
    expect(document.activeElement).toBe(next());
  });

  it('stays while the lightbox is open, so focus can go back to the frame it opened from', () => {
    draw();
    view(true);
    lightbox.openAt = 1;
    draw();
    view(false);
    afterEvent();
    expect(carousel()).not.toBeNull();
    lightbox.openAt = null;
    draw();
    afterEvent();
    expect(carousel()).toBeNull();
  });

  it('stays until the strip has settled', () => {
    draw();
    view(true);
    // A drag or a wheel moved the strip; the counter waits for it to settle.
    moveTo(-500);
    view(false);
    afterEvent();
    expect(carousel()).not.toBeNull();
    settle();
    afterEvent();
    expect(carousel()).toBeNull();
    expect(counter()).toBe('2 of 4');
  });

  it('comes back when a frame of the still strip takes focus, with focus on that frame and the strip on it', () => {
    draw();
    view(true);
    view(false);
    afterEvent();
    expect(carousel()).toBeNull();
    act(() => frameButton(3).focus());
    expect(carousel()).not.toBeNull();
    expect(document.activeElement).toBe(frameButton(3));
    expect(carousel()?.contains(document.activeElement)).toBe(true);
    expect(lastMove()).toMatchObject({ target: -MAX, transition: spring.snap });
    expect(counter()).toBe('4 of 4');
  });
});

describe('the strip without motion (sheet 8.1)', () => {
  it('moves at once, stops at the ends, and settles a release on the nearest place it can rest', () => {
    reduced.matches = true;
    draw();
    expect(fake.props.transition).toEqual({ duration: 0 });
    expect(fake.props.dragElastic).toBe(0);
    // No wheel swipe pages the strip, so Carousel never plays its bounce at an end.
    expect(fake.props.snap).toBe(false);
    press(next());
    expect(lastMove()).toMatchObject({ target: -456, transition: media.gallery.atOnce });

    // A drag let go at 700 px: the end (872) is nearer than the wide frame's start (456), whatever the flick.
    expect(typeof fake.props.onDragEnd).toBe('function');
    act(() => (fake.props.onPointerDown as () => void)());
    moveTo(-700);
    act(() => (fake.props.onDragEnd as () => void)());
    expect(lastMove()).toMatchObject({ target: -MAX, transition: media.gallery.atOnce });
    expect(counter()).toBe('3 of 4');
  });

  it("switches with the setting, in the transition object Carousel keeps for its own paging", () => {
    draw();
    const held = fake.props.transition;
    expect(held).toEqual(spring.snap);
    reduced.matches = true;
    act(() => reduced.listeners.forEach((listener) => listener()));
    expect(fake.props.transition).toBe(held);
    expect(held).toEqual({ duration: 0 });
    expect(fake.props.dragElastic).toBe(0);
    expect(fake.props.snap).toBe(false);
    reduced.matches = false;
    act(() => reduced.listeners.forEach((listener) => listener()));
    expect(held).toEqual(spring.snap);
    expect(fake.props.onDragEnd).toBeUndefined();
    expect(fake.props.snap).toBe('loose');
  });

  it('settles a strip a wheel left between frames on the nearest one, at once', () => {
    reduced.matches = true;
    draw();
    // The wheel moves the strip directly (Carousel's own reading, within its ends) and stops 300 px in.
    moveTo(-300);
    settle();
    expect(lastMove()).toMatchObject({ target: -456, transition: media.gallery.atOnce });
    expect(counter()).toBe('2 of 4');
    // At the shared end it stays, and names the frame that starts nearest the left edge.
    const count = moves.list.length;
    moveTo(-MAX);
    settle();
    expect(moves.list).toHaveLength(count);
    expect(counter()).toBe('3 of 4');
  });

  it('with motion, leaves a strip a wheel moved where it is, and only names the frame', () => {
    draw();
    moveTo(-300);
    settle();
    expect(moves.list).toHaveLength(0);
    expect(counter()).toBe('2 of 4');
  });
});
