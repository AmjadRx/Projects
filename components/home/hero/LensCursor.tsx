'use client';

import { Cursor, usePointerPosition } from 'motion-plus/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { hero } from '@/lib/motion';
import type { Box, LensCursorProps } from './lensFollow';
import type { Point } from './raven';

/**
 * The lens's ring as the Motion+ Cursor (DESIGN_DIRECTION.md 6.4: "The thermal lens that follows
 * the pointer: Cursor from motion-plus/react"; ARCHITECTURE.md 8), in follow mode, so the browser's
 * own cursor elsewhere on the page is left alone. This module loads on demand (lensFollow.ts
 * loadLensCursor) and mounts for one follow at a time (LensFollowHost).
 *
 * - The Cursor's point follows the pointer with the lens spring (hero.lens.follow) and starts at
 *   the lens's centre (`start`): its first `offset` puts the point there, and the next, zero, sends
 *   it after the pointer, so the lens glides to the pointer as it always did. The Cursor mounts its
 *   element one render after itself (it portals to the body from a layout effect), and that mount
 *   writes the element's first values back into its spring, which would turn back a spring already
 *   sent on. So the zero offset goes in once the element is there: from its child's ref.
 * - Every frame the point moves, `onUpdate` hands it to the driver's `place`, which clamps the
 *   centre to the inner frame and moves the thermal view there, and draws the ring at the centre
 *   that `place` returns, in the same frame. Ring and thermal view never part. Where the thermal
 *   view is drawn a frame later (`frameBehind`, the model's WebGL pass), the ring shows the centre
 *   of the frame before, and takes the last one a frame after the spring stops.
 * - The ring sits in a layer that undoes the Cursor's own translation, so it is placed in window
 *   coordinates and clipped, with one clip for the whole follow, to where the page's content shows
 *   (`clip`): the Cursor is portalled to the body, above the page, and the sticky nav and the
 *   sheet frame would otherwise not cover it as they cover the drawing.
 */

/** hero.lens.follow, as the Cursor's spring option takes it. */
const FOLLOW = { visualDuration: hero.lens.follow.visualDuration, bounce: hero.lens.follow.bounce };

const ZERO: Point = { x: 0, y: 0 };

/**
 * The pointer position the Cursor follows: two motion values that Motion+ keeps current from its
 * own window listener, for mouse moves only (dist/es/components/Cursor/hooks/use-pointer-position.mjs).
 * Despite its name it holds no React state, so it is read here outside a component too, under a
 * plain name.
 */
const pointerValues = usePointerPosition;

/** Starts Motion+'s pointer listener, so the pointer has a place before the first follow. */
export function primePointer(): void {
  pointerValues();
}

/**
 * Puts the pointer the Cursor follows at (x, y), in client px: for a pen, which Motion+'s listener
 * leaves out, and for the move that starts a follow, which that listener reads only a frame later.
 */
export function setPointer(x: number, y: number): void {
  const pointer = pointerValues();
  pointer.x.set(x);
  pointer.y.set(y);
}

function translate(x: number, y: number): string {
  return `translate(${x}px, ${y}px)`;
}

/** A rectangle in window coordinates as a clip path for a layer whose origin is the window's. */
export function clipPolygon({ left, top, right, bottom }: Box): string {
  return `polygon(${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px)`;
}

export default function LensCursor({ start, place, clip, frameBehind = false, children }: LensCursorProps) {
  const pointer = usePointerPosition();
  const [offset, setOffset] = useState<Point>(() => ({ x: start.x - pointer.x.get(), y: start.y - pointer.y.get() }));
  const view = useRef<HTMLDivElement | null>(null);
  const centre = useRef<HTMLDivElement>(null);
  /** frameBehind: the centre the ring shows, and the frame request that moves it on to the latest. */
  const shown = useRef<Point>(start);
  const catchUp = useRef(0);

  // The Cursor's element is in: from now on its point heads for the pointer.
  const viewRef = useCallback((element: HTMLDivElement | null) => {
    view.current = element;
    if (element) setOffset(ZERO);
  }, []);

  useEffect(() => () => cancelAnimationFrame(catchUp.current), []);

  const showAt = (at: Point) => {
    if (centre.current) centre.current.style.transform = translate(at.x, at.y);
  };

  return (
    <Cursor
      follow
      spring={FOLLOW}
      offset={offset}
      initial={false}
      className="hm-lens-cursor"
      aria-hidden="true"
      onUpdate={(latest) => {
        const x = Number(latest.x);
        const y = Number(latest.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const at = place({ x, y });
        if (view.current) view.current.style.transform = translate(-x, -y);
        if (!frameBehind) {
          showAt(at);
          return;
        }
        // Painted with the thermal view: this frame the centre of the frame before, the next frame
        // this one (which the next update, if there is one, writes too).
        showAt(shown.current);
        shown.current = at;
        cancelAnimationFrame(catchUp.current);
        catchUp.current = requestAnimationFrame(() => showAt(at));
      }}
    >
      <div ref={viewRef} className="hm-lens-cursor__view" style={{ transform: translate(-start.x, -start.y), clipPath: clipPolygon(clip) }}>
        <div ref={centre} className="hm-lens-cursor__at" style={{ transform: translate(start.x, start.y) }}>
          {children}
        </div>
      </div>
    </Cursor>
  );
}
