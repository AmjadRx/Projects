// @vitest-environment jsdom
/**
 * The lens's ring on the real Motion+ Cursor (components/home/hero/LensCursor.tsx; motion-plus
 * 4.3.0): the parts of the hand-over that rest on how the Cursor works inside, so a new Motion+
 * that works differently fails here rather than on the page.
 * - In follow mode, the Cursor leaves the browser's cursor alone (no global "cursor: none" style).
 * - Its spring starts at the lens's centre, not at the pointer (the first `offset`), then heads
 *   for the pointer (the next, zero) and settles there.
 * - Every frame it moves, `place` gets its point, and the ring's layers are placed from it: one
 *   undoing the Cursor's own translation, one at the centre `place` returns; with `frameBehind`,
 *   the centre of the frame before, and the last one a frame after the spring stops.
 */
import { frame } from 'motion/react';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Point } from '../components/home/hero/raven';

const { default: LensCursor, clipPolygon, primePointer, setPointer } = await import('../components/home/hero/LensCursor');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The x and y in a transform such as "translateX(12px) translateY(34px)" or "translate(12px, 34px)". */
function translation(transform: string): Point {
  const pair = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(transform);
  if (pair) return { x: Number(pair[1]), y: Number(pair[2]) };
  const x = /translateX\((-?[\d.]+)px\)/.exec(transform);
  const y = /translateY\((-?[\d.]+)px\)/.exec(transform);
  return { x: x ? Number(x[1]) : 0, y: y ? Number(y[1]) : 0 };
}

describe('LensCursor on the real Motion+ Cursor', () => {
  let root: Root | null = null;

  afterEach(() => {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it('starts at the lens, glides to the pointer with the lens spring, and places the ring from each frame', async () => {
    primePointer();
    setPointer(700, 420);
    const start = { x: 400, y: 300 };
    const seen: Point[] = [];
    const place = (pointer: Point) => {
      seen.push(pointer);
      // The driver's clamp: here, nothing below y 320.
      return { x: pointer.x, y: Math.max(320, pointer.y) };
    };
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const r = root;
    act(() =>
      r.render(createElement(LensCursor, { start, place, clip: { left: 16, top: 81, right: 1424, bottom: 884 } }, createElement('i', { className: 'ring' }))),
    );

    // Portalled to the body, in follow mode, decorative.
    const cursor = document.body.querySelector<HTMLElement>('[data-motion-cursor="follow"]');
    expect(cursor).not.toBeNull();
    expect(cursor!.parentElement).toBe(document.body);
    expect(cursor!.getAttribute('aria-hidden')).toBe('true');
    expect(cursor!.style.position).toBe('fixed');
    expect(cursor!.style.pointerEvents).toBe('none');
    // Follow mode leaves the browser's cursor alone: no stylesheet hiding it everywhere.
    expect(Array.from(document.head.querySelectorAll('style')).some((style) => /cursor:\s*none/.test(style.textContent ?? ''))).toBe(false);

    // First paint: the Cursor's point, the ring's window layer and its centre all at the lens.
    const view = cursor!.querySelector<HTMLElement>('.hm-lens-cursor__view')!;
    const at = cursor!.querySelector<HTMLElement>('.hm-lens-cursor__at')!;
    expect(translation(cursor!.style.transform)).toEqual(start);
    expect(translation(view.style.transform)).toEqual({ x: -start.x, y: -start.y });
    expect(translation(at.style.transform)).toEqual(start);
    expect(view.style.clipPath).toBe(clipPolygon({ left: 16, top: 81, right: 1424, bottom: 884 }));
    expect(at.querySelector('.ring')).not.toBeNull();

    // Then it heads for the pointer and settles there; each frame goes through `place`.
    await vi.waitFor(
      () => {
        expect(seen.length).toBeGreaterThan(2);
        const last = seen.at(-1)!;
        expect(last.x).toBeCloseTo(700, 1);
        expect(last.y).toBeCloseTo(420, 1);
      },
      { timeout: 4000, interval: 25 },
    );
    // It moved from the lens toward the pointer, not from the pointer.
    expect(seen[0].x).toBeGreaterThanOrEqual(start.x);
    expect(seen[0].x).toBeLessThan(700);
    const point = translation(cursor!.style.transform);
    expect(point.x).toBeCloseTo(700, 1);
    expect(point.y).toBeCloseTo(420, 1);
    // The window layer undoes the Cursor's translation; the centre is where `place` put it.
    expect(translation(view.style.transform).x).toBeCloseTo(-700, 1);
    const centre = translation(at.style.transform);
    expect(centre.x).toBeCloseTo(seen.at(-1)!.x, 2);
    expect(centre.y).toBeCloseTo(Math.max(320, seen.at(-1)!.y), 2);

    // A pen move handed over by the driver moves it on.
    act(() => setPointer(650, 200));
    await vi.waitFor(
      () => {
        const last = seen.at(-1)!;
        expect(last.x).toBeCloseTo(650, 1);
        expect(last.y).toBeCloseTo(200, 1);
        expect(translation(at.style.transform).y).toBe(320);
      },
      { timeout: 4000, interval: 25 },
    );
  });

  it("frameBehind (the model's pass, drawn on the engine's next frame): the ring shows the frame before's centre, then the last", async () => {
    setPointer(300, 200);
    const start = { x: 100, y: 100 };
    /** Each frame: the centre `place` gave, and the ring's centre once that frame's writes are done. */
    const frames: { placed: Point; painted: Point }[] = [];
    let at: HTMLElement | null = null;
    const place = (pointer: Point) => {
      const placed = { ...pointer };
      // After this frame's render step: what the page paints this frame.
      frame.postRender(() => frames.push({ placed, painted: translation(at!.style.transform) }));
      return placed;
    };
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const r = root;
    act(() => r.render(createElement(LensCursor, { start, place, clip: { left: 0, top: 0, right: 2000, bottom: 2000 }, frameBehind: true })));
    at = document.body.querySelector<HTMLElement>('.hm-lens-cursor__at');
    await vi.waitFor(
      () => {
        expect(frames.length).toBeGreaterThan(4);
        expect(frames.at(-1)!.placed.x).toBeCloseTo(300, 1);
      },
      { timeout: 4000, interval: 25 },
    );
    // Once under way, every frame paints the centre of the frame before (the first frame of a follow,
    // where the spring has barely moved, may already show its own).
    for (let i = 2; i < frames.length; i++) {
      expect(frames[i].painted.x).toBeCloseTo(frames[i - 1].placed.x, 2);
      expect(frames[i].painted.y).toBeCloseTo(frames[i - 1].placed.y, 2);
    }
    expect(frames.slice(2).some(({ placed, painted }) => Math.abs(placed.x - painted.x) > 1)).toBe(true);
    // A frame after the spring stops, the ring takes the last centre.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const last = frames.at(-1)!.placed;
    expect(translation(at!.style.transform).x).toBeCloseTo(last.x, 2);
    expect(translation(at!.style.transform).y).toBeCloseTo(last.y, 2);
  });
});
