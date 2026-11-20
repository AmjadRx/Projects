// @vitest-environment jsdom
/**
 * The tools ticker (motion sheet 7.7; components/home/tickerMotion.ts, TickerStrip.tsx): the slide's
 * speed and the arrow keys' step, what holds it still, and when the moving ticker takes the still
 * row's place. The moving ticker itself is faked here (tests/home-motion-plus.test.ts renders it
 * against a fake Motion+ Ticker; the browser checks cover the real one).
 */
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, spring } from '../lib/motion';

const state = vi.hoisted(() => ({
  motionOk: true,
  paused: false,
  saveData: false,
  mounts: 0,
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('../lib/useMotionOk', () => ({ useMotionOk: () => state.motionOk, motionOk: () => state.motionOk }));
vi.mock('../lib/motionPause', () => ({ useMotionPaused: () => state.paused }));
vi.mock('../lib/sky/tier', () => ({ saveDataOn: () => state.saveData }));
// The moving ticker, as TickerStrip mounts it: a focusable view.
vi.mock('../components/home/MovingTicker', () => ({
  default: ({ labelledBy }: { labelledBy: string }) => {
    state.mounts += 1;
    return h('div', { className: 'hm-ticker__view hm-ticker__view--moving', tabIndex: 0, role: 'region', 'aria-labelledby': labelledBy });
  },
}));

const { cardTarget, keyboardFocus, nearestCardTarget, NO_HOLDS, tickerAdvance, tickerHeld, tickerHolds, tickerSpeed, tickerStep } =
  await import('../components/home/tickerMotion');
type TickerInput = import('../components/home/tickerMotion').TickerInput;
const { default: TickerStrip } = await import('../components/home/TickerStrip');

class FakeObserver {
  static made: FakeObserver[] = [];
  observed: Element[] = [];
  constructor(
    public callback: IntersectionObserverCallback,
    public options: IntersectionObserverInit = {},
  ) {
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
    const entries = this.observed.map((target) => ({ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

/** The observers' margins: where the code loads, where the moving ticker is mounted, and where it goes. */
const MARGIN = { load: '100% 0px', near: '25% 0px', far: '50% 0px' } as const;

/** The strip crosses one of the margins: inward (true) or outward (false). */
function see(kind: keyof typeof MARGIN, on: boolean) {
  for (const o of FakeObserver.made.filter((x) => x.options.rootMargin === MARGIN[kind])) o.report(on);
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
});

describe('the slide and the step', () => {
  it('slides one full copy of the list every 80 s', () => {
    expect(page.ticker).toMatchObject({ loop: 80, minWidth: 768, load: 1, near: 0.25, far: 0.5 });
    expect(page.ticker.key).toBe(spring.snap);
    expect(tickerSpeed(8000, page.ticker.loop)).toBe(100);
    expect(tickerSpeed(0, page.ticker.loop)).toBe(0);
    expect(tickerAdvance(0, 16, 100)).toBeCloseTo(-1.6, 12);
    expect(tickerAdvance(-50, -5, 100)).toBe(-50);
    // 80 s of frames at 100 px a second carry the list exactly one copy along.
    let offset = 0;
    for (let t = 0; t < 80_000; t += 16) offset = tickerAdvance(offset, 16, tickerSpeed(8000, 80));
    expect(offset).toBeCloseTo(-8000, 0);
  });

  it('steps one item either way, from an item or from between two, and across the seam', () => {
    const starts = [0, 100, 250, 400];
    const period = 500;
    expect(tickerStep(0, starts, period, 1)).toBe(-100);
    expect(tickerStep(-100, starts, period, 1)).toBe(-250);
    expect(tickerStep(-150, starts, period, 1)).toBe(-250);
    expect(tickerStep(-150, starts, period, -1)).toBe(-100);
    expect(tickerStep(-250, starts, period, -1)).toBe(-100);
    // Past the last item: the first item of the next copy; back past the first: the last of the copy before.
    expect(tickerStep(-400, starts, period, 1)).toBe(-500);
    expect(tickerStep(-450, starts, period, 1)).toBe(-500);
    expect(tickerStep(0, starts, period, -1)).toBe(100);
    expect(tickerStep(-1000, starts, period, -1)).toBe(-900);
    // Half a pixel off an item's start counts as on it.
    expect(tickerStep(-99.7, starts, period, 1)).toBe(-250);
    // Nothing measured: no step.
    expect(tickerStep(-30, [], period, 1)).toBe(-30);
    expect(tickerStep(-30, starts, 0, 1)).toBe(-30);
  });
});

describe('what holds the moving ticker still', () => {
  const after = (inputs: TickerInput[]) => inputs.reduce(tickerHolds, NO_HOLDS);
  const held = (inputs: TickerInput[]) => tickerHeld(after(inputs), true, true);
  const mouse = (type: 'enter' | 'leave'): TickerInput => ({ type, pointer: 'mouse' });

  it('a mouse or a pen over it holds it; a touch, which has no hover, does not', () => {
    expect(after([mouse('enter')])).toEqual({ hover: true, focus: false, press: false });
    expect(held([{ type: 'enter', pointer: 'pen' }])).toBe(true);
    expect(after([{ type: 'enter', pointer: 'touch' }])).toBe(NO_HOLDS);
    expect(held([mouse('enter'), mouse('leave')])).toBe(false);
  });

  it('a press or a drag holds it until the release, wherever that happens', () => {
    expect(held([{ type: 'press' }])).toBe(true);
    expect(held([{ type: 'press' }, { type: 'release' }])).toBe(false);
  });

  it('focus that a click or a tap gives it holds nothing once the pointer has left', () => {
    // A mouse press focuses the strip (it takes focus), with no focus ring.
    expect(held([mouse('enter'), { type: 'press' }, { type: 'focus', keyboard: false }, { type: 'release' }])).toBe(true);
    expect(held([mouse('enter'), { type: 'press' }, { type: 'focus', keyboard: false }, { type: 'release' }, mouse('leave')])).toBe(false);
    // A tap on a tablet.
    const tap: TickerInput[] = [{ type: 'enter', pointer: 'touch' }, { type: 'press' }, { type: 'focus', keyboard: false }, { type: 'release' }];
    expect(held(tap)).toBe(false);
  });

  it('keyboard focus holds it until focus leaves, and so does a key pressed inside', () => {
    expect(held([{ type: 'focus', keyboard: true }])).toBe(true);
    expect(held([{ type: 'focus', keyboard: true }, { type: 'blur' }])).toBe(false);
    // Clicked, then the arrow keys: keyboard use from then on.
    expect(held([{ type: 'press' }, { type: 'focus', keyboard: false }, { type: 'release' }, { type: 'key' }])).toBe(true);
    // A press after keyboard focus is pointer use: the focus holds it no longer.
    expect(held([{ type: 'focus', keyboard: true }, { type: 'press' }, { type: 'release' }])).toBe(false);
  });

  it('out of view or in a hidden tab it holds still too', () => {
    expect(tickerHeld(NO_HOLDS, true, true)).toBe(false);
    expect(tickerHeld(NO_HOLDS, false, true)).toBe(true);
    expect(tickerHeld(NO_HOLDS, true, false)).toBe(true);
  });

  it('an input that changes nothing keeps the same holds, so nothing renders again', () => {
    const over = after([mouse('enter')]);
    expect(tickerHolds(over, mouse('enter'))).toBe(over);
    expect(tickerHolds(NO_HOLDS, { type: 'blur' })).toBe(NO_HOLDS);
    expect(tickerHolds(NO_HOLDS, { type: 'focus', keyboard: false })).toBe(NO_HOLDS);
  });

  it('keyboard focus is the focus the browser marks :focus-visible; a browser without the selector counts all focus', () => {
    const el = (matches: (selector: string) => boolean) => ({ matches }) as unknown as Element;
    expect(keyboardFocus(el((s) => s === ':focus-visible'))).toBe(true);
    expect(keyboardFocus(el(() => false))).toBe(false);
    expect(
      keyboardFocus(
        el(() => {
          throw new SyntaxError('unknown pseudo-class');
        }),
      ),
    ).toBe(true);
  });
});

describe('the phone strip turning to a card', () => {
  it('brings the card to the strip\'s start, and the last cards no further than the strip goes', () => {
    const positions = [{ start: 0 }, { start: 312 }, { start: 624 }, { start: 936 }];
    expect(cardTarget(positions, 700, 0)).toBe(0);
    expect(cardTarget(positions, 700, 1)).toBe(-312);
    expect(cardTarget(positions, 700, 3)).toBe(-700);
    expect(cardTarget(positions, null, 3)).toBe(-936);
    // Not measured: no turn.
    expect(cardTarget(positions, 700, 4)).toBeNull();
    expect(cardTarget([], null, 0)).toBeNull();
  });

  it('a press the browser takes over leaves it on the nearest card, counting the one it rests on', () => {
    const positions = [{ start: 0 }, { start: 312 }, { start: 624 }, { start: 936 }];
    // Resting on the second card (where the Carousel's own release would pick the first).
    expect(nearestCardTarget(positions, 700, -312)).toBe(-312);
    // Moved a little either way: back to it.
    expect(nearestCardTarget(positions, 700, -318)).toBe(-312);
    expect(nearestCardTarget(positions, 700, -300)).toBe(-312);
    // Past halfway to the next.
    expect(nearestCardTarget(positions, 700, -470)).toBe(-624);
    // Near the end: the strip's end.
    expect(nearestCardTarget(positions, 700, -760)).toBe(-700);
    expect(nearestCardTarget(positions, 700, 40)).toBe(0);
    expect(nearestCardTarget([], 700, -30)).toBeNull();
  });
});

describe('TickerStrip', () => {
  const labels = ['KiCad 9', 'LTspice', 'Python'];
  let root: Root | null = null;
  let frame: HTMLElement;

  beforeEach(() => {
    FakeObserver.made = [];
    state.motionOk = true;
    state.paused = false;
    state.saveData = false;
    state.mounts = 0;
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  /** The strip in a page frame `width` px wide. */
  function mount(width: number) {
    frame = document.createElement('div');
    frame.className = 'ar-frame';
    frame.getBoundingClientRect = () => ({ width }) as DOMRect;
    document.body.append(frame);
    root = createRoot(frame);
    act(() => root!.render(h(TickerStrip, { labels, labelledBy: 'tools-title' })));
  }

  /** The strip comes within a window of the view (its code loads), then a quarter of one (it moves). */
  async function arrive() {
    await act(async () => {
      see('load', true);
      await flush();
    });
    act(() => see('near', true));
  }

  const moving = () => frame.querySelector('.hm-ticker__view--moving') !== null;

  it('the server draws the still row: a labelled region that takes focus, every tool in order', () => {
    expect(renderToStaticMarkup(h(TickerStrip, { labels, labelledBy: 'tools-title' }))).toBe(
      '<div class="hm-ticker ar-glassy"><div class="hm-ticker__view" tabindex="0" role="region" aria-labelledby="tools-title">' +
        '<ul class="hm-ticker__list"><li>KiCad 9</li><li>LTspice</li><li>Python</li></ul></div></div>',
    );
  });

  it('from a 768 px frame, loads the moving ticker within a window of the view and mounts it only just before it shows', async () => {
    mount(1024);
    await act(async () => {
      see('load', true);
      await flush();
    });
    // Loaded, but a mounted Ticker asks for every frame: the still row stays until the strip is near.
    expect(moving()).toBe(false);
    expect(state.mounts).toBe(0);
    act(() => see('near', true));
    expect(moving()).toBe(true);
    // Half a window past the view, the still row comes back; nearer again, the ticker.
    act(() => see('far', false));
    expect(moving()).toBe(false);
    act(() => see('near', true));
    expect(moving()).toBe(true);
    // The code loads once: its observer is gone.
    expect(FakeObserver.made.filter((o) => o.options.rootMargin === MARGIN.load)).toHaveLength(0);
  });

  it('keeps the still row on a phone, which has no hover to pause it', async () => {
    mount(767);
    expect(FakeObserver.made).toHaveLength(0);
    await arrive();
    expect(moving()).toBe(false);
  });

  it('keeps the still row under reduced motion, with motion paused, and with Save-Data on', async () => {
    for (const set of [() => (state.motionOk = false), () => (state.paused = true), () => (state.saveData = true)]) {
      state.motionOk = true;
      state.paused = false;
      state.saveData = false;
      set();
      mount(1440);
      await arrive();
      expect(moving()).toBe(false);
      act(() => root?.unmount());
      root = null;
      document.body.replaceChildren();
    }
  });

  it('goes back to the still row at once when motion is paused, with focus kept inside the strip', async () => {
    mount(1440);
    await arrive();
    expect(moving()).toBe(true);
    frame.querySelector<HTMLElement>('.hm-ticker__view')!.focus();
    state.paused = true;
    act(() => root!.render(h(TickerStrip, { labels, labelledBy: 'tools-title' })));
    expect(moving()).toBe(false);
    expect(document.activeElement).toBe(frame.querySelector('.hm-ticker__view'));
  });
});
