/**
 * The thermal lens's moving parts, outside React (motion sheet 4; `hero.lens` and `hero.touch` in
 * lib/motion.ts). The lens is one position in drawing units, written to the two elements named
 * data-hd="lens" in the drawing: the circle that clips the thermal layer and the ring with its
 * ticks, so they never part. The drivers (PointerLens for mouse and pen, TouchLens for touch) only
 * say where the lens goes and with which spring, and when it fades. While a mouse or a pen moves
 * the lens, its ring is the Motion+ Cursor instead (PointerLens), and the Cursor writes the clip
 * through jumpTo every frame, so the drawing's ring and clip stay together underneath.
 *
 * Weight: the springs follow through Motion's attachSpring, a few kB, rather than `animate`,
 * which would bring Motion's whole element animation code into the home page's first load. The
 * fades are CSS transitions on opacity.
 */
import { attachSpring, cancelFrame, frame, motionValue, type MotionValue } from 'motion/react';
import { easeCss, hero, toMs, type SpringTransition } from '@/lib/motion';
import { PART, type Point } from './raven';

/** Runs `write` in the render step of the next frame, once however often it is asked. */
export function perFrame(write: () => void): { request: () => void; cancel: () => void } {
  let queued = false;
  const run = () => {
    queued = false;
    write();
  };
  return {
    request() {
      if (queued) return;
      queued = true;
      frame.render(run);
    },
    cancel() {
      if (!queued) return;
      queued = false;
      cancelFrame(run);
    },
  };
}

/**
 * One axis of the lens: a motion value that springs to each new target, with whichever spring the
 * move asks for (the lens spring to follow, the rest spring to go back). Changing spring keeps the
 * value's place and velocity, so a move that starts during another stays smooth.
 */
class Axis {
  readonly value: MotionValue<number>;
  private detach: () => void;
  private spring: SpringTransition;

  constructor(start: number, spring: SpringTransition) {
    this.value = motionValue(start);
    this.spring = spring;
    this.detach = this.attach(spring);
  }

  private attach({ visualDuration, bounce }: SpringTransition): () => void {
    return attachSpring(this.value, this.value.get(), { visualDuration, bounce });
  }

  to(target: number, spring: SpringTransition): void {
    if (spring !== this.spring) {
      this.detach();
      this.detach = this.attach(spring);
      this.spring = spring;
    }
    this.value.set(target);
  }

  jump(target: number): void {
    this.value.jump(target);
  }

  stop(): void {
    this.detach();
    this.value.destroy();
  }
}

export type Lens = {
  /** Where the centre is now, in drawing units (part way along a spring, if one is moving it). */
  position: () => Point;
  /** Moves the centre to `p` (drawing units) with `spring`. */
  springTo: (p: Point, spring: SpringTransition) => void;
  /** Puts the centre at `p` at once, stopping any spring. */
  jumpTo: (p: Point) => void;
  /** Fades the lens and its thermal view in (1) or out (0) over `seconds` (touch only). */
  fade: (opacity: 0 | 1, seconds: number) => void;
  /** Stops every spring and puts the drawing back as the server sent it: the lens at rest. */
  destroy: () => void;
};

/** "translate(x y)" in drawing units, to two decimals. */
export function lensTransform(p: Point): string {
  return `translate(${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100})`;
}

/** The lens inside the drawing whose root element is `root` (the .hm-art box). */
export function createLens(root: HTMLElement): Lens {
  const placed = Array.from(root.querySelectorAll<SVGElement>(`[data-hd="${PART.lens}"]`));
  const faded = Array.from(root.querySelectorAll<SVGElement>('.hd-th, .hd-ring'));
  const { rest } = hero.lens;
  const x = new Axis(rest.x, hero.lens.follow);
  const y = new Axis(rest.y, hero.lens.follow);

  const write = () => {
    const transform = lensTransform({ x: x.value.get(), y: y.value.get() });
    for (const el of placed) el.setAttribute('transform', transform);
  };
  const writer = perFrame(write);
  const stopX = x.value.on('change', writer.request);
  const stopY = y.value.on('change', writer.request);

  return {
    position() {
      return { x: x.value.get(), y: y.value.get() };
    },
    springTo(p, spring) {
      x.to(p.x, spring);
      y.to(p.y, spring);
    },
    jumpTo(p) {
      x.jump(p.x);
      y.jump(p.y);
      writer.cancel();
      write();
    },
    fade(opacity, seconds) {
      for (const el of faded) {
        el.style.transition = `opacity ${toMs(seconds)}ms ${easeCss.fade}`;
        el.style.opacity = String(opacity);
      }
    },
    destroy() {
      stopX();
      stopY();
      writer.cancel();
      x.stop();
      y.stop();
      const transform = lensTransform(rest);
      for (const el of placed) el.setAttribute('transform', transform);
      for (const el of faded) {
        el.style.removeProperty('transition');
        el.style.removeProperty('opacity');
      }
    },
  };
}
