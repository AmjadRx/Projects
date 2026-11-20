// @vitest-environment jsdom
/**
 * The lens on the Motion+ Cursor (DESIGN_DIRECTION.md 6.1 and 6.4; ARCHITECTURE.md 8; motion
 * sheets 4.1 and 4.5): the follow rules (components/home/hero/lensFollow.ts), the drawing's driver
 * (PointerLens.tsx) and the model's (components/viewers/model/useHeroLens.ts). The Cursor itself
 * (LensCursor.tsx) is replaced by a stand-in that records each follow it is given, so these tests
 * drive the drivers' side of the contract: where a follow starts, how `place` clamps and writes the
 * thermal view, and what is left when it ends. tests/hero-lens-browser checks the real Cursor.
 */
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hero, toMs } from '../lib/motion';
import type { LensCursorProps } from '../components/home/hero/lensFollow';

const state = vi.hoisted(() => ({
  follows: [] as LensCursorProps[],
  mounted: 0,
  unmounted: 0,
  pointer: [] as [number, number][],
  primed: 0,
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('../components/home/hero/LensCursor', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    /** Records the props of each follow it is mounted for (once: the host remounts it per follow). */
    default: function StandInCursor(props: LensCursorProps) {
      const first = useRef(props);
      useEffect(() => {
        state.follows.push(first.current);
        state.mounted += 1;
        return () => {
          state.unmounted += 1;
        };
      }, []);
      return null;
    },
    primePointer: () => {
      state.primed += 1;
    },
    setPointer: (x: number, y: number) => {
      state.pointer.push([x, y]);
    },
    clipPolygon: () => '',
  };
});

const { default: PointerLens } = await import('../components/home/hero/PointerLens');
const { default: RavenDrawing } = await import('../components/home/hero/RavenDrawing');
const { FOLLOW_ATTR, LensFollowMachine, afterIdle, chromeClip, isLensPointer } = await import('../components/home/hero/lensFollow');
const { VIEW, fromDrawing, lensBox, lensTicks, toDrawing } = await import('../components/home/hero/raven');
const { restPoint, useHeroLens } = await import('../components/viewers/model/useHeroLens');
const { clampLensCenter } = await import('../components/viewers/model/orbit');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Lets promise callbacks run (the on-demand import, then what waits on it). */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function pointer(type: string, pointerType: string, clientX = 0, clientY = 0): PointerEvent {
  return new PointerEvent(type, { pointerType, clientX, clientY, bubbles: type !== 'pointerenter' && type !== 'pointerleave' });
}

beforeEach(() => {
  state.follows = [];
  state.mounted = 0;
  state.unmounted = 0;
  state.pointer = [];
});

describe('LensFollowMachine: when a follow starts and stops', () => {
  function machine(canFollow = true, starts = true) {
    const log: string[] = [];
    const m = new LensFollowMachine<string>({
      canFollow: () => canFollow,
      start: (event) => {
        log.push(`start ${event}`);
        return starts;
      },
      stop: () => log.push('stop'),
      rest: () => log.push('rest'),
    });
    return { m, log };
  }

  it('starts on the first move while following may start, and only once', () => {
    const { m, log } = machine();
    m.move('a');
    m.move('b');
    expect(m.following).toBe(true);
    expect(log).toEqual(['start a']);
  });

  it('does not start while following may not, or when the start fails', () => {
    const closed = machine(false);
    closed.m.move('a');
    expect(closed.m.following).toBe(false);
    expect(closed.log).toEqual([]);
    const failing = machine(true, false);
    failing.m.move('a');
    expect(failing.m.following).toBe(false);
    failing.m.move('b');
    expect(failing.log).toEqual(['start a', 'start b']);
  });

  it('leaving stops the follow, then sends the lens back to rest; leaving with no follow only rests', () => {
    const { m, log } = machine();
    m.move('a');
    m.leave();
    expect(m.following).toBe(false);
    expect(log).toEqual(['start a', 'stop', 'rest']);
    m.leave();
    expect(log.slice(3)).toEqual(['rest']);
  });

  it('a scroll or a resize stops the follow and leaves the lens where it is; the next move starts again', () => {
    const { m, log } = machine();
    m.move('a');
    m.interrupt();
    m.interrupt();
    expect(log).toEqual(['start a', 'stop']);
    m.move('b');
    expect(log).toEqual(['start a', 'stop', 'start b']);
  });

  it('reset forgets a follow without stopping it (an unmount, where React takes the Cursor away)', () => {
    const { m, log } = machine();
    m.move('a');
    m.reset();
    expect(m.following).toBe(false);
    expect(log).toEqual(['start a']);
  });
});

describe('the shared helpers', () => {
  it('follows a mouse or a pen, never touch', () => {
    expect(isLensPointer('mouse')).toBe(true);
    expect(isLensPointer('pen')).toBe(true);
    expect(isLensPointer('touch')).toBe(false);
    expect(isLensPointer('')).toBe(false);
  });

  it('loads the Cursor in an idle moment, or after a short delay where there is none (hero.lens.load)', () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn();
      const idle = vi.fn((callback: () => void, options?: { timeout?: number }) => {
        expect(options?.timeout).toBe(toMs(hero.lens.load.idleTimeout));
        callback();
        return 7;
      });
      const cancelIdle = vi.fn();
      vi.stubGlobal('requestIdleCallback', idle);
      vi.stubGlobal('cancelIdleCallback', cancelIdle);
      afterIdle(run, hero.lens.load)();
      expect(run).toHaveBeenCalledTimes(1);
      expect(cancelIdle).toHaveBeenCalledWith(7);
      vi.unstubAllGlobals();

      const later = vi.fn();
      const cancel = afterIdle(later, hero.lens.load);
      vi.advanceTimersByTime(toMs(hero.lens.load.noIdleDelay) - 1);
      expect(later).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(later).toHaveBeenCalledTimes(1);
      cancel();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('clips the ring to the page content: inside the sheet frame, under the sticky nav', () => {
    expect(chromeClip()).toEqual({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
    const frame = document.createElement('div');
    frame.className = 'ar-sheetframe__border';
    frame.getBoundingClientRect = () => rect(16, 16, 1408, 868);
    const nav = document.createElement('header');
    nav.className = 'ar-nav';
    nav.getBoundingClientRect = () => rect(16, 16, 1408, 65);
    document.body.append(frame, nav);
    expect(chromeClip()).toEqual({ left: 16, top: 81, right: 1424, bottom: 884 });
    // Below 1024 px the sheet frame is not shown (no box): the whole window, under the nav.
    frame.getBoundingClientRect = () => rect(0, 0, 0, 0);
    nav.getBoundingClientRect = () => rect(0, 0, 390, 64);
    expect(chromeClip()).toEqual({ left: 0, top: 64, right: window.innerWidth, bottom: window.innerHeight });
    frame.remove();
    nav.remove();
  });

  it("draws the Cursor's ring in a square that holds the ring, its ticks and their stroke", () => {
    const outer = Number(/H(\d+)/.exec(lensTicks(hero.lens.radius))?.[1]);
    expect(lensBox(hero.lens.radius)).toBeGreaterThan(outer);
    expect(lensBox(hero.lens.radius) - outer).toBeLessThanOrEqual(2);
  });

  it('turns drawing units back into the page, as toDrawing turns the page into drawing units', () => {
    const box = { left: 840, top: 225, width: 552, height: 515.2 };
    const p = fromDrawing(hero.lens.rest, box);
    expect(toDrawing(p.x, p.y, box).x).toBeCloseTo(hero.lens.rest.x, 9);
    expect(toDrawing(p.x, p.y, box).y).toBeCloseTo(hero.lens.rest.y, 9);
    expect(fromDrawing({ x: 0, y: 0 }, box)).toEqual({ x: 840, y: 225 });
    expect(fromDrawing({ x: VIEW.width, y: VIEW.height }, box)).toEqual({ x: 840 + 552, y: 225 + 515.2 });
  });
});

describe("PointerLens: the drawing's lens follows a mouse or a pen through the Cursor", () => {
  let root: Root | null = null;
  const BOX = rect(100, 50, 600, 560);

  /** The drawing's box as the server sends it, in a hero section, with PointerLens mounted on it. */
  function mount({ intro = false } = {}) {
    const section = document.createElement('section');
    section.className = 'hm-hero';
    if (intro) section.setAttribute('data-intro', String(Math.round(performance.now())));
    const box = document.createElement('div');
    box.className = 'hm-art';
    box.innerHTML = renderToStaticMarkup(createElement(RavenDrawing, { label: 'Raven' }));
    box.getBoundingClientRect = () => BOX;
    const host = document.createElement('div');
    section.append(box, host);
    document.body.append(section);
    root = createRoot(host);
    const r = root;
    act(() => r.render(createElement(PointerLens, { art: { current: box } })));
    return { section, box };
  }

  const lensAt = (box: Element) => Array.from(box.querySelectorAll('[data-hd="lens"]'), (el) => el.getAttribute('transform'));
  const REST = `translate(${hero.lens.rest.x} ${hero.lens.rest.y})`;

  /** Brings the Cursor's code in: a pointer over the drawing asks for it at once. */
  async function ready(box: Element) {
    await act(async () => {
      box.dispatchEvent(pointer('pointerover', 'mouse', 0, 0));
      await flush();
    });
  }

  function send(box: Element, event: PointerEvent) {
    act(() => {
      box.dispatchEvent(event);
    });
  }

  afterEach(() => {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it('starts a follow from where the lens rests, hides the drawn ring, and starts the Cursor at the pointer', async () => {
    const { box } = mount();
    await ready(box);
    expect(state.primed).toBeGreaterThan(0);
    send(box, pointer('pointermove', 'mouse', 640, 400));
    expect(state.mounted).toBe(1);
    expect(box.hasAttribute(FOLLOW_ATTR)).toBe(true);
    const follow = state.follows[0];
    // The rest point over the battery bay, in the page: the box is at (100, 50) at one px a unit.
    expect(follow.start).toEqual({ x: 100 + hero.lens.rest.x, y: 50 + hero.lens.rest.y });
    // The drawing's clip moves in the same frame as the ring: no frame behind.
    expect(follow.frameBehind).toBeFalsy();
    expect(state.pointer.at(-1)).toEqual([640, 400]);
    expect(follow.clip).toEqual({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
    // The ring: the drawing's circle and ticks, at the drawing's scale.
    const ring = renderToStaticMarkup(follow.children as never);
    expect(ring).toContain(`r="${hero.lens.radius}"`);
    expect(ring).toContain(`d="${lensTicks(hero.lens.radius)}"`);
    expect(ring).toContain(`width="${2 * lensBox()}"`);
    // Moving on during the follow starts nothing new: the Cursor follows by itself.
    send(box, pointer('pointermove', 'mouse', 660, 420));
    expect(state.mounted).toBe(1);
  });

  it("clamps the Cursor's point to the inner frame and writes it to the thermal clip and the drawn ring", async () => {
    const { box } = mount();
    await ready(box);
    send(box, pointer('pointermove', 'mouse', 400, 300));
    const { place } = state.follows[0];
    expect(place({ x: 100 + 450, y: 50 + 140 })).toEqual({ x: 550, y: 190 });
    expect(lensAt(box)).toEqual(['translate(450 140)', 'translate(450 140)']);
    // Past the frame's corner: the centre stops at (560, 40), the clip and the ring with it.
    expect(place({ x: 1000, y: -20 })).toEqual({ x: 100 + hero.lens.frame.right, y: 50 + hero.lens.frame.top });
    expect(lensAt(box)).toEqual([`translate(${hero.lens.frame.right} ${hero.lens.frame.top})`, `translate(${hero.lens.frame.right} ${hero.lens.frame.top})`]);
  });

  it('on leaving, the drawn ring takes over where the Cursor left it and goes back to rest with the rest spring', async () => {
    const { box } = mount();
    await ready(box);
    send(box, pointer('pointermove', 'mouse', 400, 300));
    state.follows[0].place({ x: 100 + 520, y: 50 + 90 });
    send(box, pointer('pointerleave', 'mouse', 900, 20));
    expect(state.unmounted).toBe(1);
    expect(box.hasAttribute(FOLLOW_ATTR)).toBe(false);
    // Taken over at the Cursor's last place, then on its way back.
    const first = lensAt(box)[0];
    expect(first).not.toBe(REST);
    await vi.waitFor(() => expect(lensAt(box)).toEqual([REST, REST]), { timeout: 4000, interval: 50 });
  });

  it('a scroll under the pointer ends the follow and leaves the lens on the drawing; the next move follows again from there', async () => {
    const { box } = mount();
    await ready(box);
    send(box, pointer('pointermove', 'mouse', 400, 300));
    state.follows[0].place({ x: 100 + 200, y: 50 + 400 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(state.unmounted).toBe(1);
    expect(box.hasAttribute(FOLLOW_ATTR)).toBe(false);
    expect(lensAt(box)).toEqual(['translate(200 400)', 'translate(200 400)']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(lensAt(box)).toEqual(['translate(200 400)', 'translate(200 400)']);
    send(box, pointer('pointermove', 'mouse', 320, 470));
    expect(state.mounted).toBe(2);
    expect(state.follows[1].start).toEqual({ x: 300, y: 450 });
  });

  it('starts no follow while the load sequence plays, then follows once it has ended', async () => {
    const { section, box } = mount({ intro: true });
    await ready(box);
    send(box, pointer('pointermove', 'mouse', 400, 300));
    expect(state.mounted).toBe(0);
    expect(box.hasAttribute(FOLLOW_ATTR)).toBe(false);
    section.removeAttribute('data-intro');
    send(box, pointer('pointermove', 'mouse', 410, 300));
    expect(state.mounted).toBe(1);
  });

  it('leaves touch to the touch lens', async () => {
    const { box } = mount();
    await ready(box);
    send(box, pointer('pointermove', 'touch', 400, 300));
    expect(state.mounted).toBe(0);
  });

  it("hands a pen's moves to the Cursor, which reads only mice", async () => {
    const { box } = mount();
    await ready(box);
    send(box, pointer('pointerenter', 'pen', 400, 300));
    expect(state.mounted).toBe(1);
    send(box, pointer('pointermove', 'pen', 420, 310));
    expect(state.pointer.slice(-2)).toEqual([
      [400, 300],
      [420, 310],
    ]);
  });

  it('unmounting (motion turned off) puts the drawing back as the server sent it', async () => {
    const { box } = mount();
    const before = box.innerHTML;
    await ready(box);
    send(box, pointer('pointermove', 'mouse', 400, 300));
    state.follows[0].place({ x: 100 + 150, y: 50 + 128 });
    const r = root!;
    act(() => r.unmount());
    root = null;
    expect(state.unmounted).toBe(1);
    expect(box.hasAttribute(FOLLOW_ATTR)).toBe(false);
    expect(box.innerHTML.replace(/ style=""/g, '')).toBe(before);
  });
});

describe("useHeroLens: the model's lens rests where the board draws it and follows through the Cursor", () => {
  let root: Root | null = null;
  const STAGE = rect(800, 200, 600, 560);
  const lens: { current: ReturnType<typeof useHeroLens> | null } = { current: null };

  function Harness({ enabled }: { enabled: boolean }) {
    const stage = useRef<HTMLDivElement>(null);
    const hook = useHeroLens(stage, enabled);
    lens.current = hook;
    return createElement(
      'div',
      {
        ref: (el: HTMLDivElement | null) => {
          (stage as { current: HTMLDivElement | null }).current = el;
          if (el) el.getBoundingClientRect = () => STAGE;
        },
        className: 'hm-model__stage',
      },
      createElement('span', { ref: hook.ringRef, className: 'hm-model__ring' }),
      hook.follow,
    );
  }

  function render(enabled: boolean) {
    if (!root) {
      const host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
    }
    const r = root;
    act(() => r.render(createElement(Harness, { enabled })));
  }

  const stage = () => document.querySelector('.hm-model__stage')!;
  const values = () => {
    const v = lens.current!.values;
    return { x: v.x.get(), y: v.y.get(), opacity: v.opacity.get(), radius: v.radius.get() };
  };
  const move = (pointerType: string, clientX: number, clientY: number) =>
    act(() => lens.current!.handlers.onPointerMove({ pointerType, clientX, clientY } as never));
  const leave = () => act(() => lens.current!.handlers.onPointerLeave({ pointerType: 'mouse', clientX: 0, clientY: 0 } as never));

  beforeEach(() => {
    // jsdom lays nothing out: the stage is 600 by 560 px, one px a drawing unit.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => STAGE.width });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => STAGE.height });
  });

  afterEach(() => {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    document.body.replaceChildren();
    // Back to jsdom's own (on Element.prototype).
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("puts the rest point where the Realistic board draws the lens: 56% across, 38% down the model's box", () => {
    expect(restPoint(600, 560)).toEqual({ x: 336, y: 205.4 });
    const double = restPoint(1200, 1120);
    expect(double.x).toBeCloseTo(672, 9);
    expect(double.y).toBeCloseTo(410.8, 9);
    expect(hero.model.lensRest.x / hero.drawing.width).toBeCloseTo(0.56, 9);
    expect(hero.model.lensRest.y / hero.drawing.height).toBeCloseTo(0.04 + 0.86 * 0.38, 3);
  });

  it('rests at that point, hidden, until it may show; then fades in there', async () => {
    render(false);
    expect(values()).toMatchObject({ x: 336, y: 205.4, opacity: 0, radius: 128 });
    render(true);
    await vi.waitFor(() => expect(values().opacity).toBe(1), { timeout: 4000, interval: 25 });
    expect(values()).toMatchObject({ x: 336, y: 205.4 });
  });

  it("follows from its rest point, clamped as the drawing's, writes the engine's values, and goes back to rest on leaving", async () => {
    render(true);
    await act(async () => {
      await flush();
    });
    move('mouse', 1000, 400);
    expect(state.mounted).toBe(1);
    expect(stage().hasAttribute(FOLLOW_ATTR)).toBe(true);
    const follow = state.follows[0];
    expect(follow.start).toEqual({ x: 800 + 336, y: 200 + 205.4 });
    expect(state.pointer.at(-1)).toEqual([1000, 400]);
    // The engine draws the pass on its next frame: the Cursor's ring follows a frame behind.
    expect(follow.frameBehind).toBe(true);
    // The engine's values take the clamped centre, in px of the stage.
    expect(follow.place({ x: 800 + 590, y: 200 + 10 })).toEqual({ x: 800 + 560, y: 200 + 40 });
    expect(clampLensCenter(590, 10, 600, 560)).toEqual({ x: 560, y: 40 });
    expect(values()).toMatchObject({ x: 560, y: 40 });
    // The Cursor's ring is the stage's ring, at the lens's size.
    expect(renderToStaticMarkup(follow.children as never)).toBe(
      '<span class="hm-model__ring hm-model__ring--cursor" style="width:256px;height:256px" aria-hidden="true"></span>',
    );
    leave();
    expect(state.unmounted).toBe(1);
    expect(stage().hasAttribute(FOLLOW_ATTR)).toBe(false);
    await vi.waitFor(() => expect(values()).toMatchObject({ x: 336, y: 205.4 }), { timeout: 4000, interval: 50 });
    expect(values().opacity).toBe(1);
  });

  it('a scroll ends the follow where it is; the lens turned off mid-follow fades out where it is', async () => {
    render(true);
    await act(async () => {
      await flush();
    });
    move('mouse', 1000, 400);
    state.follows[0].place({ x: 800 + 100, y: 200 + 300 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(state.unmounted).toBe(1);
    expect(values()).toMatchObject({ x: 100, y: 300 });
    move('mouse', 900, 520);
    expect(state.mounted).toBe(2);
    expect(state.follows[1].start).toEqual({ x: 900, y: 500 });
    render(false);
    expect(state.unmounted).toBe(2);
    expect(stage().hasAttribute(FOLLOW_ATTR)).toBe(false);
    await vi.waitFor(() => expect(values().opacity).toBe(0), { timeout: 4000, interval: 25 });
    expect(values()).toMatchObject({ x: 100, y: 300 });
  });

  it("writes the stage's own ring on the next frame, when the engine draws the pass", async () => {
    render(true);
    await vi.waitFor(() => expect(values().opacity).toBe(1), { timeout: 4000, interval: 25 });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const ring = document.querySelector<HTMLElement>('.hm-model__stage > .hm-model__ring')!;
    const centre = () => {
      const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0(?:px)?\)/.exec(ring.style.transform);
      return m ? { x: Math.round((Number(m[1]) + 128) * 1000) / 1000, y: Math.round((Number(m[2]) + 128) * 1000) / 1000 } : null;
    };
    expect(centre()).toEqual({ x: 336, y: 205.4 });
    act(() => {
      lens.current!.values.x.jump(200);
      lens.current!.values.y.jump(300);
    });
    // Not yet: the engine has not drawn the new place either.
    expect(centre()).toEqual({ x: 336, y: 205.4 });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(centre()).toEqual({ x: 200, y: 300 });
    expect(ring.style.width).toBe('256px');
    expect(ring.style.opacity).toBe('1');
  });

  it('touch never moves the lens (it orbits the model), and nothing follows while the lens may not show', async () => {
    render(true);
    await act(async () => {
      await flush();
    });
    move('touch', 1000, 400);
    expect(state.mounted).toBe(0);
    render(false);
    move('mouse', 1000, 400);
    expect(state.mounted).toBe(0);
  });
});
