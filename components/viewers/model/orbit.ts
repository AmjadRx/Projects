/**
 * The model viewers' motion numbers (lib/motion.ts: `media.model` for every viewer, sheet 6.3;
 * `hero.lens`, `hero.rotor` and `hero.model` for the hero, sheets 4.1, 4.3 and 4.5) turned into
 * geometry and timing, as plain functions with no three.js and no DOM, so the engine, the two
 * shells, and the tests read one source.
 *
 * Angles follow three.js's Spherical: `theta` turns about the vertical axis from +z toward +x,
 * `phi` is measured down from straight up. Pitch, as the sheets give it, is the angle above the
 * horizon, so phi = 90 degrees minus pitch.
 */
import { cubicBezier } from 'motion/react';
import { easeCss, hero, media, toMs, type Bezier } from '@/lib/motion';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Clamps to 0 to 1; anything that is not a number is 0. */
export function clamp01(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

/** Degrees to radians. */
export function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** The orbit's polar angle for a pitch above the horizon, in degrees. */
export function polarFromPitch(pitch: number): number {
  return radians(90 - pitch);
}

/** Sheet 6.3: pitch stays between 10 degrees below the horizon and 60 above (phi 30 to 100 degrees). */
export const POLAR_MIN = polarFromPitch(media.model.pitchMax);
export const POLAR_MAX = polarFromPitch(media.model.pitchMin);

/** Sheet 6.3: a model turns 6 degrees a second until it is first touched, in radians a second. */
export const AUTO_TURN = radians(media.model.autoTurn);

/** Sheet 4.5: the hero's slow turn after a tap on phones and tablets, in radians a second. */
export const HERO_TURN = radians(hero.model.phoneTurn);

/**
 * The three-quarter view every viewer starts from and the hero goes back to: from the front right
 * and a little above. The admin draws each model's poster from the same view
 * (lib/admin/convert/model.ts), so the poster and the first frame agree.
 */
export const HOME_THETA = 0.7;
export const HOME_PHI = Math.PI / 2 - 0.38;

/** The camera's field of view, in degrees (the admin's poster camera uses the same). */
export const FOV = 35;

/** Sheet 6.3: the zoom ratio (camera distance over the fitted distance) stays within 0.6 to 2. */
export function clampZoom(ratio: number): number {
  return clamp(Number.isFinite(ratio) ? ratio : 1, media.model.zoomMin, media.model.zoomMax);
}

/** Distance at which a sphere of radius 1 (the normalized model) fills a view of this aspect. */
export function fitDistance(fov: number, aspect: number): number {
  const vertical = radians(fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(aspect, 0.1));
  return 1.02 / Math.sin(Math.min(vertical, horizontal) / 2);
}

/**
 * The fitted distance when the first frame must match a poster drawn contained in the canvas (the
 * hero, whose stage is narrower than the admin's 4:3 posters): the poster was drawn at the fit of
 * its own aspect, and a poster wider than the canvas fills only `canvas / poster` of its height,
 * so the model is drawn that much smaller. With no poster size it is the plain fit.
 */
export function posterFitDistance(fov: number, canvasAspect: number, posterAspect?: number): number {
  if (!posterAspect || !Number.isFinite(posterAspect) || posterAspect <= 0) return fitDistance(fov, canvasAspect);
  const share = canvasAspect >= posterAspect ? 1 : canvasAspect / posterAspect;
  return fitDistance(fov, posterAspect) / share;
}

/** Sheet 4.3: the rotor tilt for the hero's scroll progress, 0 to 90 degrees, linear and clamped, in radians. */
export function rotorTilt(progress: number): number {
  return radians(hero.rotor.modelMax) * clamp01(progress);
}

/**
 * The tilt the hero's rotors show: they follow the scroll while motion may play, and stay at hover
 * (0) under reduced motion or the pause control (sheets 4.3 and 8).
 */
export function heroRotorTilt(progress: number, motion: boolean): number {
  return motion ? rotorTilt(progress) : 0;
}

/**
 * Sheet 4.3: the hero's own scroll progress, 0 with the page at rest and 1 when the hero's bottom
 * edge reaches the bottom of the nav. The hero starts where the nav ends and the nav sticks at the
 * place it starts from, so that is the hero's height (`length`) of scrolling.
 */
export function heroScrollProgress(scrollY: number, length: number): number {
  return length > 0 ? clamp01(scrollY / length) : 0;
}

/**
 * Sheets 4.1 and 4.5: the lens over the model has the drawing's size, radius 128 of the drawing's
 * 600 units (220 px across at a 1440 px window), so it scales with the stage. In CSS px.
 */
export function lensRadius(stageWidth: number): number {
  return Math.max(0, (stageWidth * hero.lens.radius) / hero.drawing.width);
}

/**
 * Sheet 4.1: the lens centre stays inside the inner frame, 40 to 560 across and 40 to 520 down in
 * the drawing's 600 by 560 units, scaled to a stage `width` by `height` CSS px.
 */
export function clampLensCenter(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const { drawing, lens } = hero;
  return {
    x: clamp(x, (lens.frame.left / drawing.width) * width, (lens.frame.right / drawing.width) * width),
    y: clamp(y, (lens.frame.top / drawing.height) * height, (lens.frame.bottom / drawing.height) * height),
  };
}

/** The square around the lens in CSS px of a `width` by `height` canvas, and the same square in clip space. */
export interface LensSquare {
  left: number;
  top: number;
  side: number;
  /** x0, y0 (bottom left) and x1, y1 (top right), from -1 to 1. */
  clip: [number, number, number, number];
}

/** The lens's bounding square, or null when the lens has no size or the canvas has none. */
export function lensSquare(cx: number, cy: number, radius: number, width: number, height: number): LensSquare | null {
  if (!(radius > 0) || !(width > 0) || !(height > 0)) return null;
  const side = 2 * radius;
  const left = cx - radius;
  const top = cy - radius;
  return {
    left,
    top,
    side,
    clip: [(left / width) * 2 - 1, 1 - ((top + side) / height) * 2, ((left + side) / width) * 2 - 1, 1 - (top / height) * 2],
  };
}

/**
 * Sheet 6.3: "Drag to orbit" fades out over 150 ms after the first drag. The stylesheet reads the
 * fade from these custom properties (ModelViewer.module.css .hint); a shell sets them only while
 * motion may play, so without motion the hint goes at once.
 */
export const HINT_FADE_VARS: Record<'--mv-hint-fade' | '--mv-hint-ease', string> = {
  '--mv-hint-fade': `${toMs(media.model.hintFade.duration)}ms`,
  '--mv-hint-ease': easeCss.fade,
};

/** Sheet 6.3: an arrow key steps the exploded view by 0.1, held between 0 and 1. */
export function stepExplode(amount: number, direction: 1 | -1): number {
  return clamp01(Math.round((amount + direction * media.model.explode.keyStep) * 1000) / 1000);
}

/**
 * Sheet 6.3: at full explode each part has moved out along the line from the model's centre to its
 * own, "up to 0.6 of the model's radius": the part farthest from the centre moves 0.6 of the
 * radius, and every other part in proportion to its own distance, so parts on one line still come
 * apart. `toPart` is the part's line (its centre minus the model's), `farthest` the longest such
 * line in the model; a part at the centre stays where it is.
 */
export function explodeOffset(
  toPart: readonly [number, number, number],
  farthest: number,
  modelRadius: number,
): [number, number, number] {
  if (!(farthest > 1e-6)) return [0, 0, 0];
  const scale = (media.model.explode.max * modelRadius) / farthest;
  return [toPart[0] * scale, toPart[1] * scale, toPart[2] * scale];
}

/** The change from one angle to another the short way round, in (-pi, pi]. */
export function shortestTurn(from: number, to: number): number {
  const full = Math.PI * 2;
  let turn = (to - from) % full;
  if (turn > Math.PI) turn -= full;
  if (turn <= -Math.PI) turn += full;
  return turn;
}

/** Where the camera is: its angles and distance about the point it looks at. */
export interface OrbitState {
  theta: number;
  phi: number;
  radius: number;
  target: readonly [number, number, number];
}

/** The camera `t` of the way (0 to 1, already eased) from one state to another, theta the short way round. */
export function blendOrbit(from: OrbitState, to: OrbitState, t: number): OrbitState {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    theta: from.theta + shortestTurn(from.theta, to.theta) * t,
    phi: mix(from.phi, to.phi),
    radius: mix(from.radius, to.radius),
    target: [mix(from.target[0], to.target[0]), mix(from.target[1], to.target[1]), mix(from.target[2], to.target[2])],
  };
}

/** True when two camera states are the same to within a hair: there is nothing to ease. */
export function sameOrbit(a: OrbitState, b: OrbitState): boolean {
  const scale = Math.max(a.radius, b.radius, 1e-6);
  return (
    Math.abs(shortestTurn(a.theta, b.theta)) < 1e-4 &&
    Math.abs(a.phi - b.phi) < 1e-4 &&
    Math.abs(a.radius - b.radius) < scale * 1e-4 &&
    Math.hypot(a.target[0] - b.target[0], a.target[1] - b.target[1], a.target[2] - b.target[2]) < scale * 1e-4
  );
}

const curves = new Map<Bezier, (t: number) => number>();

/** A lib/motion.ts curve as a function from 0 to 1, made once per curve. */
export function easing(curve: Bezier): (t: number) => number {
  let fn = curves.get(curve);
  if (!fn) {
    const [x1, y1, x2, y2] = curve;
    fn = cubicBezier(x1, y1, x2, y2);
    curves.set(curve, fn);
  }
  return fn;
}

/** The timers IdleReturn uses: the browser's by default, a fake one in tests. */
export interface Timers {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const browserTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Sheet 4.5: the hero model goes back to its three-quarter view 1.5 s after the last input. Each
 * input calls `cancel` when it starts and `schedule` when it ends; a new input before the wait is
 * over starts the wait again. Without motion nothing is scheduled: the model stays where it is
 * left.
 */
export class IdleReturn {
  private handle: unknown = null;

  constructor(
    private readonly fire: () => void,
    private readonly wait = toMs(hero.model.returnWait),
    private readonly timers: Timers = browserTimers,
  ) {}

  /** The last input ended: go back after the wait, if motion may play. */
  schedule(motion: boolean): void {
    this.cancel();
    if (!motion) return;
    this.handle = this.timers.set(() => {
      this.handle = null;
      this.fire();
    }, this.wait);
  }

  /** An input started, or the viewer is going away. */
  cancel(): void {
    if (this.handle === null) return;
    this.timers.clear(this.handle);
    this.handle = null;
  }

  /** True while a return is waiting. */
  get pending(): boolean {
    return this.handle !== null;
  }
}
