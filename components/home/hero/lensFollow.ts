/**
 * The lens following a mouse or a pen on the Motion+ Cursor (DESIGN_DIRECTION.md 6.1 and 6.4;
 * ARCHITECTURE.md 8; motion sheets 4.1 and 4.5; `hero.lens` in lib/motion.ts): the parts the
 * drawing's lens (PointerLens) and the model's lens (components/viewers/model/useHeroLens.ts)
 * share. This file is in the home page's first load and holds no Motion+ code: the Cursor itself
 * is ./LensCursor.tsx, which loadLensCursor() fetches on demand.
 *
 * A follow, while a mouse or a pen is over the art box:
 * - it starts where the lens is: the Cursor's spring sets out from the lens's centre, so the lens
 *   glides to the pointer with the lens spring, as it always did;
 * - every frame, the Cursor's point goes through the driver's `place`, which clamps the centre to
 *   the inner frame and moves the thermal view there (the drawing's clip, the model's pass); the
 *   ring is drawn at the same centre, so ring and thermal view share one position each frame;
 * - it stops when the pointer leaves (the lens then goes back to rest with the rest spring and
 *   stays drawn there), and when the page scrolls or the window resizes under it (the lens then
 *   stays where it was, on the drawing, until the pointer moves again). The ring is a fixed
 *   element and the thermal view scrolls with the page, so following through a scroll could part
 *   them for a frame; stopping keeps them together.
 *
 * No React here, so tests can drive the rules (LensFollowMachine) on their own.
 */
import type { ReactNode } from 'react';
import { toMs } from '@/lib/motion';
import type { Point } from './raven';

/** On the art box while the Cursor draws the ring: the box's own ring hides (app/motion-drawing.css). */
export const FOLLOW_ATTR = 'data-lens-follow';

/** A rectangle in client px. */
export type Box = { left: number; top: number; right: number; bottom: number };

/** What ./LensCursor.tsx takes for one follow. */
export type LensCursorProps = {
  /** The lens's centre when the follow starts, in client px: the Cursor's spring starts here. */
  start: Point;
  /**
   * Called every frame the Cursor moves, with its point in client px. Returns the lens's centre in
   * client px, after the driver has clamped it and moved the thermal view there.
   */
  place: (pointer: Point) => Point;
  /** Where the page's content shows (inside the sheet frame, under the sticky nav): the ring is clipped to it. */
  clip: Box;
  /**
   * The thermal view under the ring is drawn a frame after `place` moves it, as the model's is (its
   * engine draws on the next animation frame after a change): the ring then follows a frame
   * behind, so the two are painted together. The drawing's clip moves in the same frame: off there.
   */
  frameBehind?: boolean;
  /** The ring, drawn centred on (0, 0). */
  children?: ReactNode;
};

/** The on-demand module: the Cursor, and the pointer position it follows. */
export type LensCursorModule = typeof import('./LensCursor');

let loading: Promise<LensCursorModule> | null = null;

/** Fetches ./LensCursor.tsx once; a failed fetch may be tried again. */
export function loadLensCursor(): Promise<LensCursorModule> {
  if (!loading) {
    loading = import('./LensCursor').catch((error: unknown) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

/** Runs `run` in the browser's next idle period, or after a short delay where there is none. Returns the cancel. */
export function afterIdle(run: () => void, { idleTimeout, noIdleDelay }: { idleTimeout: number; noIdleDelay: number }): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => run(), { timeout: toMs(idleTimeout) });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, toMs(noIdleDelay));
  return () => window.clearTimeout(id);
}

/** The lens follows a mouse or a pen; touch has its own lens (TouchLens) or orbits the model. */
export function isLensPointer(pointerType: string): boolean {
  return pointerType === 'mouse' || pointerType === 'pen';
}

/** Where the page's content shows in the window now: the sheet frame (1024 px and up) and the sticky nav cover the rest. */
export function chromeClip(): Box {
  const box: Box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const frame = document.querySelector('.ar-sheetframe__border')?.getBoundingClientRect();
  if (frame && frame.width > 0 && frame.height > 0) {
    box.left = frame.left;
    box.top = frame.top;
    box.right = frame.right;
    box.bottom = frame.bottom;
  }
  const nav = document.querySelector('.ar-nav')?.getBoundingClientRect();
  if (nav && nav.height > 0 && nav.bottom > box.top) box.top = nav.bottom;
  return box;
}

export type LensFollowEffects<E> = {
  /** A follow may start now (the Cursor's code is in, the load sequence is not playing, and so on). */
  canFollow: () => boolean;
  /** Starts a follow from the lens's place now; false if it could not. */
  start: (event: E) => boolean;
  /** Stops the follow: the lens stays where the Cursor left it. */
  stop: () => void;
  /** Sends the lens back to its rest point with the rest spring. */
  rest: () => void;
};

/**
 * When a follow starts and stops: on the first move over the art box while following may start;
 * at the pointer leaving (then back to rest); at a scroll or a resize under the pointer (the lens
 * stays, and the next move starts a new follow from there).
 */
export class LensFollowMachine<E> {
  private active = false;

  constructor(private readonly fx: LensFollowEffects<E>) {}

  /** A follow is under way. */
  get following(): boolean {
    return this.active;
  }

  /** The pointer moved over the art box (or came onto it). */
  move(event: E): void {
    if (!this.active && this.fx.canFollow()) this.active = this.fx.start(event);
  }

  /** The pointer left the art box. */
  leave(): void {
    this.interrupt();
    this.fx.rest();
  }

  /** The page moved under the pointer, the tab was hidden, or following is no longer allowed. */
  interrupt(): void {
    if (!this.active) return;
    this.active = false;
    this.fx.stop();
  }

  /** Forgets the follow without stopping it: for an unmount, where React removes the Cursor itself. */
  reset(): void {
    this.active = false;
  }
}
