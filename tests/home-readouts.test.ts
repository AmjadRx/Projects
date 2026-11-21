// @vitest-environment jsdom
/**
 * The readouts' count-up (motion sheet 2.3; components/sheet/readoutPlan.ts, readoutCount.ts,
 * ReadoutValue.tsx): which values count and how they print, the row's once-a-visit decision and
 * its phases (wait, ready, run, done) with the observers, the load and the timers faked, and the
 * markup each phase draws, which ends as the server's.
 */
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { load, toMs } from '../lib/motion';

const state = vi.hoisted(() => ({ playing: true, allowed: true }));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('../lib/intro', () => ({
  introPlaying: () => state.playing,
  afterIntro: (run: () => void) => {
    run();
    return () => {};
  },
}));
vi.mock('../lib/useMotionOk', () => ({ motionOk: () => state.allowed, subscribeMotionOk: () => () => {} }));
vi.mock('../lib/motionPause', () => ({ motionPaused: () => false, subscribeMotionPaused: () => () => {} }));
// AnimateNumber's leaf, as the count draws it: the number it shows, and whether it counts.
vi.mock('../components/sheet/ReadoutRoll', () => ({
  default: ({ plan, on }: { plan: { n: number }; on: boolean }) => h('i', { 'data-roll-to': on ? plan.n : 0 }),
}));

const { countDelay, countLength, countPlan, DONE } = await import('../components/sheet/readoutPlan');
const { joinReadoutCount } = await import('../components/sheet/readoutCount');
const { default: ReadoutValue } = await import('../components/sheet/ReadoutValue');
const { default: ReadoutRow } = await import('../components/sheet/Readout');
type CountView = import('../components/sheet/readoutPlan').CountView;
type CountDeps = import('../components/sheet/readoutCount').CountDeps;
type RollComponent = import('../components/sheet/readoutPlan').RollComponent;

/** Observers the count made: the near one (rootMargin) and the in-view one (threshold). */
class FakeObserver {
  static made: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
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
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  /** Reports `ratio` of each observed element in view, and where it is in the window if given. */
  report(ratio: number, boundingClientRect?: { top: number; bottom: number }) {
    const entries = this.observed.map((target) => ({ target, isIntersecting: ratio > 0, intersectionRatio: ratio, boundingClientRect }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}
const nearObserver = () => FakeObserver.made.find((o) => o.options.rootMargin !== undefined)!;
const inViewObserver = () => FakeObserver.made.find((o) => o.options.threshold !== undefined)!;

/** Lets promise callbacks run. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
});

beforeEach(() => {
  FakeObserver.made = [];
  state.playing = true;
  state.allowed = true;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('countPlan: only a plain number counts, and it prints exactly as the seed writes it', () => {
  const print = (value: string, n: number) => {
    const plan = countPlan(value)!;
    return new Intl.NumberFormat('en-US', plan.format).format(n);
  };

  it('counts the seed numbers from 0 at their own width', () => {
    expect(countPlan('504')).toEqual({ n: 504, format: { minimumIntegerDigits: 3, minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: false } });
    expect(print('504', 0)).toBe('000');
    expect(print('504', 504)).toBe('504');
    expect(print('140', 0)).toBe('000');
    expect(print('50', 0)).toBe('00');
    expect(print('8', 0)).toBe('0');
  });

  it('keeps decimals, grouping and leading zeros', () => {
    expect(print('3.65', 0)).toBe('0.00');
    expect(print('3.65', 3.65)).toBe('3.65');
    expect(print('1,500', 0)).toBe('0,000');
    expect(print('1,500', 1500)).toBe('1,500');
    expect(print('1500', 1500)).toBe('1500');
    expect(print('08', 8)).toBe('08');
    expect(print('1.0', 1)).toBe('1.0');
  });

  it('sets a rank, a word, a sign or anything unusual as it is', () => {
    for (const value of ['1st', '2nd', '~50', '50%', '-5', '+5', '1e3', '.5', '5.', ' 504', '504 ', '12,34', '1,50', '', 'eight', '1234567890123456']) {
      expect(countPlan(value), value).toBeNull();
    }
  });

  it('starts each value 40 ms after the one before, and ends when the last has run 800 ms', () => {
    expect(countDelay(0)).toBe(0);
    expect(countDelay(3)).toBeCloseTo(3 * load.readouts.step, 12);
    expect(countLength(3)).toBeCloseTo(3 * load.readouts.step + load.readouts.duration, 12);
    expect(load.readouts).toMatchObject({ inView: 0.3, duration: 0.8, step: 0.04, near: 1 });
    expect(load.readouts.giveUpAfter).toBe(load.headline.giveUpAfter);
  });
});

describe("joinReadoutCount: a row's count", () => {
  const Roll = (() => null) as unknown as RollComponent;

  /** A row of `n` values in a page; returns the values. */
  function row(n: number) {
    const ul = document.createElement('ul');
    ul.className = 'ar-readouts';
    const values = Array.from({ length: n }, () => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      li.append(span);
      ul.append(li);
      return span;
    });
    document.body.append(ul);
    return values;
  }

  /** Browser answers the test controls, and a load the test settles. */
  function deps() {
    let settle!: (roll: RollComponent) => void;
    let fail!: () => void;
    const loads: Promise<RollComponent>[] = [];
    let changed: (() => void) | null = null;
    const d: CountDeps = {
      playing: () => state.playing,
      allowed: () => state.allowed,
      subscribe: (onChange) => {
        changed = onChange;
        return () => {
          changed = null;
        };
      },
      load: () => {
        const promise = new Promise<RollComponent>((resolve, reject) => {
          settle = resolve;
          fail = () => reject(new Error('offline'));
        });
        loads.push(promise);
        return promise;
      },
    };
    return { d, loads, settle: (r: RollComponent) => settle(r), fail: () => fail(), change: () => changed?.() };
  }

  it('sets every value at once when the sequence is not playing: no observer, no load', () => {
    state.playing = false;
    const [a, b] = row(2);
    const { d, loads } = deps();
    const seen: CountView[][] = [[], []];
    joinReadoutCount(a, 0, (v) => seen[0].push(v), d);
    joinReadoutCount(b, 1, (v) => seen[1].push(v), d);
    expect(seen).toEqual([[DONE], [DONE]]);
    expect(FakeObserver.made).toHaveLength(0);
    expect(loads).toHaveLength(0);
  });

  it('sets every value at once when motion may not play', () => {
    state.allowed = false;
    const [a] = row(1);
    const { d } = deps();
    const seen: CountView[] = [];
    joinReadoutCount(a, 0, (v) => seen.push(v), d);
    expect(seen).toEqual([DONE]);
  });

  it('waits, loads when near, shows 0, counts in view, and ends as plain text when the last value has settled', async () => {
    vi.useFakeTimers();
    const [a, b, c] = row(3);
    const { d, loads, settle } = deps();
    const phases: string[][] = [[], [], []];
    joinReadoutCount(a, 0, (v) => phases[0].push(v.phase), d);
    joinReadoutCount(b, 1, (v) => phases[1].push(v.phase), d);
    joinReadoutCount(c, 2, (v) => phases[2].push(v.phase), d);
    expect(phases.map((p) => p.at(-1))).toEqual(['wait', 'wait', 'wait']);
    // One controller for the row: two observers, on the row itself.
    expect(FakeObserver.made).toHaveLength(2);
    expect(nearObserver().observed[0]).toBe(a.closest('ul'));
    expect(nearObserver().options.rootMargin).toBe('100% 0px');
    expect(inViewObserver().options.threshold).toBe(load.readouts.inView);

    nearObserver().report(0);
    expect(loads).toHaveLength(0);
    nearObserver().report(0.01);
    expect(loads).toHaveLength(1);
    settle(Roll);
    await flush();
    expect(phases.map((p) => p.at(-1))).toEqual(['ready', 'ready', 'ready']);

    // Under 0.3 of the row in view: it waits at 0.
    inViewObserver().report(0.2);
    expect(phases[0].at(-1)).toBe('ready');
    inViewObserver().report(load.readouts.inView);
    expect(phases.map((p) => p.at(-1))).toEqual(['run', 'run', 'run']);

    vi.advanceTimersByTime(toMs(countLength(2)) - 1);
    expect(phases[0].at(-1)).toBe('run');
    vi.advanceTimersByTime(1);
    expect(phases.map((p) => p.at(-1))).toEqual(['done', 'done', 'done']);
    expect(FakeObserver.made.every((o) => o.disconnected)).toBe(true);
  });

  it('loads at once for a row on screen, and waits for the end of the load sequence for a row below the fold', async () => {
    // On screen: part of the load sequence, so the chunk comes at once even with a wait to offer.
    const [a] = row(1);
    const first = deps();
    const waits: Array<() => void> = [];
    first.d.later = (run) => {
      waits.push(run);
      return () => {};
    };
    joinReadoutCount(a, 0, () => {}, first.d);
    nearObserver().report(0.01, { top: 600, bottom: 760 });
    expect(first.loads).toHaveLength(1);
    expect(waits).toHaveLength(0);

    // Below the fold: the chunk waits until the sequence has ended, then loads.
    document.body.replaceChildren();
    FakeObserver.made = [];
    const [b] = row(1);
    const second = deps();
    let cancelled = 0;
    second.d.later = (run) => {
      waits.push(run);
      return () => {
        cancelled += 1;
      };
    };
    const phases: string[] = [];
    const leave = joinReadoutCount(b, 0, (v) => phases.push(v.phase), second.d);
    nearObserver().report(0.01, { top: window.innerHeight + 40, bottom: window.innerHeight + 200 });
    expect(second.loads).toHaveLength(0);
    expect(waits).toHaveLength(1);
    expect(phases.at(-1)).toBe('wait');
    waits[0]();
    expect(second.loads).toHaveLength(1);
    second.settle(Roll);
    await flush();
    expect(phases.at(-1)).toBe('ready');
    // Leaving stops the wait with everything else.
    leave();
    expect(cancelled).toBe(1);
  });

  it('counts at once when the row is in view before AnimateNumber arrives', async () => {
    vi.useFakeTimers();
    const [a] = row(1);
    const { d, settle } = deps();
    const phases: string[] = [];
    joinReadoutCount(a, 0, (v) => phases.push(v.phase), d);
    nearObserver().report(1);
    inViewObserver().report(1);
    expect(phases.at(-1)).toBe('wait');
    settle(Roll);
    await flush();
    expect(phases.slice(-2)).toEqual(['ready', 'run']);
  });

  it('gives up and sets the values at once when the row is in view and the count has not started in time', async () => {
    vi.useFakeTimers();
    const [a] = row(1);
    const { d, settle } = deps();
    const phases: string[] = [];
    joinReadoutCount(a, 0, (v) => phases.push(v.phase), d);
    nearObserver().report(1);
    inViewObserver().report(1);
    vi.advanceTimersByTime(toMs(load.readouts.giveUpAfter));
    expect(phases.at(-1)).toBe('done');
    // A load that arrives later changes nothing.
    settle(Roll);
    await flush();
    expect(phases.at(-1)).toBe('done');
  });

  it('sets the values at once when AnimateNumber fails to load', async () => {
    const [a] = row(1);
    const { d, fail } = deps();
    const phases: string[] = [];
    joinReadoutCount(a, 0, (v) => phases.push(v.phase), d);
    nearObserver().report(1);
    fail();
    await flush();
    expect(phases.at(-1)).toBe('done');
  });

  it('sets the values at once when motion is turned off while it waits or counts', async () => {
    const [a] = row(1);
    const { d, settle, change } = deps();
    const phases: string[] = [];
    joinReadoutCount(a, 0, (v) => phases.push(v.phase), d);
    nearObserver().report(1);
    settle(Roll);
    await flush();
    inViewObserver().report(1);
    expect(phases.at(-1)).toBe('run');
    state.allowed = false;
    change();
    expect(phases.at(-1)).toBe('done');
  });

  it('stops the row when its last value leaves, and a load still on its way draws nothing', async () => {
    const [a, b] = row(2);
    const { d, settle } = deps();
    const phases: string[] = [];
    const leaveA = joinReadoutCount(a, 0, (v) => phases.push(`a:${v.phase}`), d);
    const leaveB = joinReadoutCount(b, 1, (v) => phases.push(`b:${v.phase}`), d);
    nearObserver().report(1);
    // The near observer is done once the load starts; the row still waits to be in view.
    expect(nearObserver().disconnected).toBe(true);
    leaveA();
    expect(inViewObserver().disconnected).toBe(false);
    leaveB();
    expect(FakeObserver.made.every((o) => o.disconnected)).toBe(true);
    settle(Roll);
    await flush();
    expect(phases).toEqual(['a:wait', 'b:wait']);
    // Joined again (a remount), the row decides afresh.
    const again: string[] = [];
    joinReadoutCount(a, 0, (v) => again.push(v.phase), d);
    expect(again).toEqual(['wait']);
  });

  it('sets a value outside a row at once', () => {
    const span = document.createElement('span');
    document.body.append(span);
    const seen: CountView[] = [];
    joinReadoutCount(span, 0, (v) => seen.push(v), deps().d);
    expect(seen).toEqual([DONE]);
  });
});

describe('ReadoutValue and ReadoutRow: the markup', () => {
  const stats = [
    { value: '504', suffix: ' V', label: 'Volts' },
    { prefix: '~', value: '50', suffix: '%', label: 'Gain' },
    { value: '1st', label: 'Place' },
  ];
  const resolveLink = () => null;

  it('the server draws the final value, its digits a bare run between the affixes, marked for the start state', () => {
    expect(renderToStaticMarkup(h(ReadoutValue, { prefix: '~', value: '50', suffix: '%', index: 1 }))).toBe(
      '<span class="ar-readout__value readout ar-fluid-readout" data-count=""><span class="ar-readout__affix">~</span>50<span class="ar-readout__affix">%</span></span>',
    );
  });

  it('a row that counts marks only its plain numbers; a row that does not marks nothing', () => {
    const counting = renderToStaticMarkup(h(ReadoutRow, { stats, resolveLink, projects: [], count: true }));
    expect(counting.match(/data-count/g)).toHaveLength(2);
    expect(counting).toContain('<span class="ar-readout__value readout ar-fluid-readout">1st</span>');
    const still = renderToStaticMarkup(h(ReadoutRow, { stats, resolveLink, projects: [] }));
    expect(still).not.toContain('data-count');
    // Both read the same values in the same order.
    const text = (html: string) => html.replace(/<[^>]+>/g, '|').split('|').filter(Boolean);
    expect(text(counting)).toEqual(text(still));
  });

  describe('in the browser', () => {
    let root: Root | null = null;
    let host: HTMLElement;

    beforeEach(() => {
      vi.useFakeTimers();
      host = document.createElement('div');
      document.body.append(host);
    });

    afterEach(() => {
      act(() => root?.unmount());
      root = null;
    });

    function mount() {
      root = createRoot(host);
      act(() => root!.render(h(ReadoutRow, { stats, resolveLink, projects: [], count: true })));
      return () => Array.from(host.querySelectorAll('.ar-readout__value'));
    }

    it('counts: the digits stay in place, unseen, under AnimateNumber; then it is the plain markup again', async () => {
      const values = mount();
      const server = renderToStaticMarkup(h(ReadoutRow, { stats, resolveLink, projects: [] }));
      expect(values().map((v) => v.getAttribute('data-roll'))).toEqual(['wait', 'wait', null]);
      // Waiting: the digits are wrapped in place, nothing over them yet; the text still reads "504 V".
      expect(values()[0].textContent).toBe('504 V');
      expect(values()[0].querySelector('.ar-readout__roll')?.childElementCount).toBe(0);

      await act(async () => {
        nearObserver().report(1);
        await flush();
      });
      expect(values().map((v) => v.getAttribute('data-roll'))).toEqual(['ready', 'ready', null]);
      expect(values()[1].querySelector('[data-roll-to]')?.getAttribute('data-roll-to')).toBe('0');
      expect(values()[1].querySelector('.ar-readout__roll')?.getAttribute('aria-hidden')).toBe('true');

      act(() => inViewObserver().report(1));
      expect(values()[0].querySelector('[data-roll-to]')?.getAttribute('data-roll-to')).toBe('504');
      expect(values()[1].querySelector('[data-roll-to]')?.getAttribute('data-roll-to')).toBe('50');

      act(() => vi.advanceTimersByTime(toMs(countLength(1))));
      expect(values().map((v) => v.getAttribute('data-roll'))).toEqual([null, null, null]);
      expect(host.querySelector('ul')!.outerHTML).toBe(server);
    });

    it('sets the values at once when the sequence is not playing', () => {
      state.playing = false;
      const values = mount();
      const server = renderToStaticMarkup(h(ReadoutRow, { stats, resolveLink, projects: [] }));
      expect(values().map((v) => v.hasAttribute('data-count') || v.hasAttribute('data-roll'))).toEqual([false, false, false]);
      expect(host.querySelector('ul')!.outerHTML).toBe(server);
    });
  });
});
