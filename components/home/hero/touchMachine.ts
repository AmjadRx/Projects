/**
 * The touch lens's rules (motion sheet 4.2; `hero.touch` in lib/motion.ts), as a small state
 * machine with its effects passed in, so tests can drive it with fake timers:
 *
 * - A finger down on the drawing shows the lens at the finger: it fades in there over
 *   hero.touch.fadeIn, or, if the lens is still showing from a moment ago, moves there with the lens
 *   spring instead of jumping.
 * - While that finger moves, the lens follows it with the lens spring.
 * - When it lifts, the lens holds for hero.touch.hold, then fades out over hero.touch.fadeOut. A tap
 *   that does not move shows it for the same time.
 * - When the browser takes the gesture for scrolling (pointercancel), the lens fades out over
 *   hero.touch.cancelFadeOut. Scrolling always wins: nothing here stops the page from moving.
 *
 * Only the first finger drives the lens; another finger meanwhile is ignored.
 */
import { hero, toMs } from '@/lib/motion';
import type { Point } from './raven';

export type TouchLensEffects = {
  /** Show the lens at `p`: `jump` puts it there at once (it was hidden), else it springs there. */
  show: (p: Point, jump: boolean) => void;
  /** Follow the finger to `p`. */
  follow: (p: Point) => void;
  /** Fade the lens out over `seconds`. */
  hide: (seconds: number) => void;
  /** Call `run` after `ms`; returns the function that cancels it. */
  later: (ms: number, run: () => void) => () => void;
};

export class TouchLensMachine {
  private finger: number | null = null;
  /** True while any of the lens can be seen: shown, holding, or still fading out. */
  private visible = false;
  private pending: (() => void) | null = null;

  constructor(private readonly fx: TouchLensEffects) {}

  private clear(): void {
    this.pending?.();
    this.pending = null;
  }

  /** The lens can be seen (for tests and for the stage's own checks). */
  get showing(): boolean {
    return this.visible;
  }

  down(pointerId: number, p: Point): void {
    if (this.finger !== null) return;
    this.finger = pointerId;
    this.clear();
    this.fx.show(p, !this.visible);
    this.visible = true;
  }

  move(pointerId: number, p: Point): void {
    if (pointerId !== this.finger) return;
    this.fx.follow(p);
  }

  up(pointerId: number): void {
    if (pointerId !== this.finger) return;
    this.finger = null;
    this.clear();
    this.pending = this.fx.later(toMs(hero.touch.hold), () => this.fadeOut(hero.touch.fadeOut));
  }

  cancel(pointerId: number): void {
    if (pointerId !== this.finger) return;
    this.finger = null;
    this.clear();
    this.fadeOut(hero.touch.cancelFadeOut);
  }

  private fadeOut(seconds: number): void {
    this.fx.hide(seconds);
    this.pending = this.fx.later(toMs(seconds), () => {
      this.pending = null;
      this.visible = false;
    });
  }

  /** Stops any timer; the caller puts the drawing back. */
  dispose(): void {
    this.clear();
    this.finger = null;
    this.visible = false;
  }
}
