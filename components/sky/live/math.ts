/**
 * The live sky's pure helpers: no three.js and no DOM, so the tests run them directly
 * (tests/sky-live.test.ts). Everything here follows the design bundle's reference renderer (its
 * Sky component) step by step; the astronomy comes from lib/sky/astro.ts and every number from SKY
 * in lib/motion.ts. The shaders in ./shaders.ts repeat the per-star and per-pixel parts in GLSL.
 */
import { SKY, type Bezier } from '@/lib/motion';
import {
  DAY_MS,
  GAL,
  SIDEREAL_DEG_PER_DAY,
  bvToKelvin,
  depthFromParallax,
  extinctionMag,
  projScale,
  project,
  starRGB,
  toHorizontal,
  wrap180,
} from '@/lib/sky/astro';
import type { StarCatalog } from '@/lib/sky/stars';

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

/** Clock milliseconds the sky turns further between the top and the end of a page: SKY.scrollTurn degrees of sidereal time. */
export const SCROLL_TURN_MS = (SKY.scrollTurn / SIDEREAL_DEG_PER_DAY) * DAY_MS;

/**
 * How far the page has scrolled since the scene drew its first frame: the scroll progress now
 * minus the progress then (`from`), both 0 to 1, so -1 to 1. The scene counts scroll from its
 * first frame, not from the top of the page, so that frame is the still's sky (scroll progress 0)
 * wherever the page was when the scene started, and the fade over the still shows no jump.
 */
export function scrolledSince(progress: number, from: number): number {
  return clamp01(progress) - clamp01(from);
}

/**
 * The moment the sky shows (the contract in SKY_API.md): the start time, plus the time the scene
 * has run times SKY.speed, plus the scroll since its first frame (`scrolledSince`, -1 to 1) times
 * SCROLL_TURN_MS.
 */
export function simTimeMs(startTimeMs: number, elapsedSeconds: number, scrolled: number): number {
  return startTimeMs + elapsedSeconds * 1000 * SKY.speed + clampUnit(scrolled) * SCROLL_TURN_MS;
}

/**
 * The ground grid's phase, in depth units: one row (SKY.scene.ground.rowStep) every SKY.rowPeriod
 * seconds while the scene runs, and SKY.scrollRows rows over a page's scroll (`scrolled`, as in
 * `simTimeMs`). Returned modulo one row, which is all the grid needs, so the number stays small
 * however long the scene runs; 0 at the scene's first frame.
 */
export function groundPhase(elapsedSeconds: number, scrolled: number): number {
  const step = SKY.scene.ground.rowStep;
  const rows = elapsedSeconds / SKY.rowPeriod + clampUnit(scrolled) * SKY.scrollRows;
  const phase = (rows - Math.floor(rows)) * step;
  return phase >= step ? 0 : phase;
}

/** The shimmer clock as an angle in [0, 2 pi): one turn every SKY.shimmer.period seconds. */
export function shimmerAngle(elapsedSeconds: number): number {
  const turns = elapsedSeconds / SKY.shimmer.period;
  return (turns - Math.floor(turns)) * TAU;
}

/**
 * How far an exponentially smoothed value moves toward its target in `dt` seconds, for a time
 * constant `tau` in seconds (the pointer: SKY.parallax.smoothing).
 */
export function smoothingFactor(dt: number, tau: number): number {
  if (!(dt > 0)) return 0;
  if (!(tau > 0)) return 1;
  return 1 - Math.exp(-dt / tau);
}

/** A number held between 0 and 1; anything that is not a finite number is 0. */
export function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** A number held between -1 and 1; anything that is not a finite number is 0. */
function clampUnit(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(-1, x)) : 0;
}

// ---------------------------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------------------------

/**
 * A cubic Bezier timing function (as CSS and Motion define it: from (0, 0) to (1, 1) through two
 * control points) as a function of progress 0 to 1.
 */
export function cubicBezier(curve: Bezier): (t: number) => number {
  const [x1, y1, x2, y2] = curve;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const xAt = (s: number) => ((ax * s + bx) * s + cx) * s;
  const yAt = (s: number) => ((ay * s + by) * s + cy) * s;
  const dxAt = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t: number) => {
    if (!(t > 0)) return 0;
    if (t >= 1) return 1;
    // Newton's method from the linear guess, then bisection if it strays.
    let s = t;
    for (let i = 0; i < 8; i += 1) {
      const err = xAt(s) - t;
      if (Math.abs(err) < 1e-7) return yAt(s);
      const d = dxAt(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 40; i += 1) {
      const x = xAt(s);
      if (Math.abs(x - t) < 1e-7) break;
      if (x < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return yAt(s);
  };
}

// ---------------------------------------------------------------------------------------------
// The view: the stereographic projection and the Milky Way's mapping
// ---------------------------------------------------------------------------------------------

/** The horizon's distance from the top, in CSS px, as the reference rounds it. */
export function horizonY(height: number): number {
  return Math.round(height * SKY.horizon);
}

/**
 * The inverse of the view's stereographic projection, as a unit vector instead of angles: a point
 * [x, y] in px from the horizon's centre point (y up), for the scale `k`, is the direction
 * [forward, right, up], where forward is the view's centre on the horizon (azimuth SKY.facing),
 * right is the horizon 90 degrees to its right, and up is the zenith. It is the same mapping as
 * `unproject` in lib/sky/astro.ts with no trigonometry: with t = rho / 2k, cos c = (1 - t^2) /
 * (1 + t^2) and sin c = 2t / (1 + t^2).
 */
export function localDirection(x: number, y: number, k: number): [number, number, number] {
  const t2 = (x * x + y * y) / (4 * k * k);
  const n = 1 + t2;
  return [(1 - t2) / n, x / k / n, y / k / n];
}

type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

function mul(a: Mat3 | readonly (readonly number[])[], b: Mat3): Mat3 {
  const out: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  }
  return out;
}

/**
 * The map from the view's local directions (`localDirection`: forward, right, up) to galactic
 * coordinates, at a local sidereal time and latitude, for a view centred on the horizon at azimuth
 * `facingDeg`. It composes the same steps the reference takes per Milky Way pixel: horizontal to
 * equatorial (lib/sky/astro.ts toEquatorial), then equatorial to galactic (GAL). It is orthonormal
 * (a rotation and a mirror: hour angle grows westward). Returned as nine numbers in column order,
 * as a GLSL mat3 takes them, so the shader computes galactic = M local.
 *
 *   horizontal (north, east, up) = B local, with B's columns the forward, right and up directions;
 *   hour-angle frame = R horizontal, R = [[-sin lat, 0, cos lat], [0, -1, 0], [cos lat, 0, sin lat]];
 *   equatorial = S hour-angle frame, S = [[cos lst, sin lst, 0], [sin lst, -cos lst, 0], [0, 0, 1]];
 *   galactic = GAL equatorial.
 */
export function skyToGalactic(lstDeg: number, latDeg: number, facingDeg: number): Float32Array {
  return columnOrder(skyToGalacticRows(lstDeg, latDeg, facingDeg));
}

function skyToGalacticRows(lstDeg: number, latDeg: number, facingDeg: number): Mat3 {
  const f = facingDeg * RAD;
  const p = latDeg * RAD;
  const L = lstDeg * RAD;
  const B: Mat3 = [
    [Math.cos(f), -Math.sin(f), 0],
    [Math.sin(f), Math.cos(f), 0],
    [0, 0, 1],
  ];
  const R: Mat3 = [
    [-Math.sin(p), 0, Math.cos(p)],
    [0, -1, 0],
    [Math.cos(p), 0, Math.sin(p)],
  ];
  const S: Mat3 = [
    [Math.cos(L), Math.sin(L), 0],
    [Math.sin(L), -Math.cos(L), 0],
    [0, 0, 1],
  ];
  return mul(GAL, mul(S, mul(R, B)));
}

/** A matrix given as rows, as nine numbers in column order, as a GLSL mat3 takes them. */
function columnOrder(M: Mat3): Float32Array {
  return new Float32Array([M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]]);
}

/** A rotation vector in degrees about the x, y and z axes (SKY.scene.milkyWayFrame). */
export interface RotationVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The rotation by a rotation vector (its direction is the axis, its length the angle in degrees),
 * as rows, by Rodrigues' formula: R v = v cos t + (k x v) sin t + k (k . v)(1 - cos t).
 */
export function rotationRows(rotation: RotationVector): Mat3 {
  const w = [rotation.x * RAD, rotation.y * RAD, rotation.z * RAD];
  const t = Math.hypot(w[0], w[1], w[2]);
  if (!(t > 0)) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }
  const [x, y, z] = [w[0] / t, w[1] / t, w[2] / t];
  const c = Math.cos(t);
  const s = Math.sin(t);
  const v = 1 - c;
  return [
    [c + x * x * v, x * y * v - z * s, x * z * v + y * s],
    [y * x * v + z * s, c + y * y * v, y * z * v - x * s],
    [z * x * v - y * s, z * y * v + x * s, c + z * z * v],
  ];
}

/**
 * The map from the view's local directions to the Milky Way panorama's own frame: `skyToGalactic`,
 * then the fixed rotation that takes a galactic direction to where the ESO photograph shows it
 * (`frame`, SKY.scene.milkyWayFrame). The shader turns the result into the panorama's u and v with
 * galacticToPanorama's formula. Column order, as `skyToGalactic`.
 */
export function skyToPanorama(lstDeg: number, latDeg: number, facingDeg: number, frame: RotationVector = SKY.scene.milkyWayFrame): Float32Array {
  return columnOrder(mul(rotationRows(frame), skyToGalacticRows(lstDeg, latDeg, facingDeg)));
}

/** Applies a column-order mat3 (as `skyToGalactic` returns it) to a vector. */
export function applyMat3(m: ArrayLike<number>, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

// ---------------------------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------------------------

/** The per-star data the star shader takes, one entry per catalogue star, brightest first. */
export interface StarAttributes {
  readonly count: number;
  /** Right ascension and declination, J2000, in radians. */
  readonly raDec: Float32Array;
  /** V magnitude. */
  readonly vmag: Float32Array;
  /** Color from B-V (bvToKelvin, then starRGB), 0 to 255 per channel. */
  readonly color: Uint8Array;
  /** Parallax depth (depthFromParallax with SKY.parallax.depth). */
  readonly depth: Float32Array;
  /** The shimmer's phase offset, in radians: the star's index, as the reference keeps each star out of step. */
  readonly phase: Float32Array;
}

/** Builds the star shader's attributes from the decoded catalogue (lib/sky/stars.ts), all at once. */
export function buildStarAttributes(catalog: StarCatalog): StarAttributes {
  const attrs = emptyStarAttributes(catalog.count);
  fillStarAttributes(catalog, attrs, 0, catalog.count);
  return attrs;
}

/** Room for the attributes of `count` stars, all zero (`fillStarAttributes` fills them). */
export function emptyStarAttributes(count: number): StarAttributes {
  const n = Math.max(0, Math.floor(count));
  return {
    count: n,
    raDec: new Float32Array(n * 2),
    vmag: new Float32Array(n),
    color: new Uint8Array(n * 3),
    depth: new Float32Array(n),
    phase: new Float32Array(n),
  };
}

/**
 * Fills the attributes of stars `from` to `to` (not included), so the work can be split across
 * tasks (components/sky/live/index.ts prepares them in slices while the data loads).
 */
export function fillStarAttributes(catalog: StarCatalog, attrs: StarAttributes, from: number, to: number): void {
  const { raDec, vmag, color, depth, phase } = attrs;
  const end = Math.min(to, attrs.count, catalog.count);
  for (let i = Math.max(0, from); i < end; i += 1) {
    raDec[i * 2] = catalog.ra[i] * RAD;
    raDec[i * 2 + 1] = catalog.dec[i] * RAD;
    vmag[i] = catalog.vmag[i];
    const [r, g, b] = starRGB(bvToKelvin(catalog.bv[i]));
    color[i * 3] = r;
    color[i * 3 + 1] = g;
    color[i * 3 + 2] = b;
    depth[i] = depthFromParallax(catalog.parallax[i], SKY.parallax.depth);
    phase[i] = i % TAU;
  }
}

/** The view at one moment, for placing stars on the CPU (the drafting lines) as the shader does. */
export interface ViewFrame {
  /** Local sidereal time, degrees. */
  readonly lst: number;
  /** The viewport, CSS px. */
  readonly width: number;
  readonly height: number;
  /** The pointer's parallax shift at depth 1, CSS px: SKY.parallax.x and .y times the smoothed pointer (-1 to 1). */
  readonly shiftX: number;
  readonly shiftY: number;
}

/** A star placed on the screen: CSS px from the top left, and its magnitude after extinction. */
export interface PlacedStar {
  readonly x: number;
  readonly y: number;
  readonly v: number;
}

/**
 * Where a star falls on the screen, exactly as the reference places it (and as the star shader
 * does): horizontal coordinates at the frame's sidereal time, hidden at SKY.scene.star.minAltitude
 * or lower, projected, shifted by its parallax depth, hidden off screen (beyond
 * SKY.scene.star.margin) or below the horizon, and hidden when fainter than SKY.scene.star.limit
 * after extinction. Null when hidden.
 */
export function placeStar(raDeg: number, decDeg: number, vmag: number, depth: number, frame: ViewFrame): PlacedStar | null {
  const { minAltitude, margin, limit } = SKY.scene.star;
  const [alt, az] = toHorizontal(raDeg, decDeg, frame.lst, SKY.site.lat);
  if (alt <= minAltitude) return null;
  const hy = horizonY(frame.height);
  const k = projScale(frame.width, hy);
  const q = project(alt * RAD, wrap180(az - SKY.facing) * RAD, k);
  if (!q) return null;
  const x = frame.width / 2 + q[0] + frame.shiftX * depth;
  const y = hy - q[1] + frame.shiftY * depth;
  if (x < -margin || x > frame.width + margin || y < -margin || y > hy) return null;
  const v = vmag + extinctionMag(alt, SKY.extinction);
  if (v > limit) return null;
  return { x, y, v };
}

/** The star's radius in CSS px from its magnitude after extinction (the reference's r). */
export function starRadius(v: number): number {
  const { base, slope, min } = SKY.scene.star.radius;
  return Math.max(min, base - slope * v);
}

/** The star's opacity from its magnitude after extinction, before the shimmer (the reference's a). */
export function starAlpha(v: number): number {
  const { base, slope, min, max } = SKY.scene.star.alpha;
  return Math.max(min, Math.min(max, base - slope * v));
}

// ---------------------------------------------------------------------------------------------
// Drafting lines
// ---------------------------------------------------------------------------------------------

/** A bright star on screen, for the drafting lines: position, catalogue magnitude, IAU name or empty. */
export interface BrightStar {
  readonly x: number;
  readonly y: number;
  /** The catalogue V magnitude (the reference ranks by it, not by the dimmed one). */
  readonly v: number;
  readonly name: string;
}

/** What the drafting overlay draws: the stars it boxes, the order its line joins them, and the star it names. */
export interface DraftingSelection<T extends BrightStar = BrightStar> {
  readonly near: readonly T[];
  readonly chain: readonly T[];
  readonly named: T | null;
}

/**
 * The reference's survey traverse: the stars within SKY.drafting.near px of the pointer, nearest
 * first, at most SKY.drafting.maxStars; the line starts at the brightest of them and goes on each
 * time to the nearest one not yet joined; the brightest one with a name is named.
 */
export function selectDrafting<T extends BrightStar>(bright: readonly T[], pointer: { x: number; y: number }): DraftingSelection<T> {
  const { near: radius, maxStars } = SKY.drafting;
  const near = bright
    .map((b) => ({ b, d: Math.hypot(b.x - pointer.x, b.y - pointer.y) }))
    .filter((e) => e.d < radius)
    .sort((a, c) => a.d - c.d)
    .slice(0, maxStars)
    .map((e) => e.b);
  if (!near.length) return { near, chain: [], named: null };
  const left = near.slice().sort((a, c) => a.v - c.v);
  const chain: T[] = [left.shift() as T];
  while (left.length) {
    const at = chain[chain.length - 1];
    left.sort((a, c) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(c.x - at.x, c.y - at.y));
    chain.push(left.shift() as T);
  }
  const named = near.filter((b) => b.name).sort((a, c) => a.v - c.v)[0] ?? null;
  return { near, chain, named };
}

// ---------------------------------------------------------------------------------------------
// The meteor
// ---------------------------------------------------------------------------------------------

/** A meteor as the reference starts it: its start point (CSS px) and its direction per unit of travel. */
export interface Meteor {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

const between = (range: readonly [number, number], r: number) => range[0] + r * (range[1] - range[0]);

/** Seconds until the next meteor, at random in SKY.meteorEvery, for a random number 0 to 1. */
export function meteorGap(random: number): number {
  return between(SKY.meteorEvery, random);
}

/** A new meteor for three random numbers 0 to 1, as the reference starts one (SKY.meteor.start and .direction). */
export function spawnMeteor(width: number, height: number, random: () => number): Meteor {
  const { start, direction } = SKY.meteor;
  const hy = height * SKY.horizon;
  return {
    x: width * between(start.x, random()),
    y: hy * between(start.y, random()),
    dx: between(direction.x, random()),
    dy: direction.y,
  };
}

/** The streak at progress k (0 to 1): its head, its tail, and its head's opacity, as the reference draws it. */
export function meteorStreak(m: Meteor, k: number): { head: [number, number]; tail: [number, number]; alpha: number } {
  const { travel, tail, headAlpha } = SKY.meteor;
  const hx = m.x + m.dx * travel * k;
  const hy = m.y + m.dy * travel * k;
  return { head: [hx, hy], tail: [hx - m.dx * tail, hy - m.dy * tail], alpha: headAlpha * (1 - k) };
}

// ---------------------------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------------------------

/** An RGBA color: red, green and blue from 0 to 255, alpha from 0 to 1. */
export type Rgba = [number, number, number, number];

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^rgba?\(\s*([^)]*)\)$/i;

function channel(token: string): number | null {
  const t = token.trim();
  if (!t) return null;
  if (t.endsWith('%')) {
    const n = Number(t.slice(0, -1));
    return Number.isFinite(n) ? Math.max(0, Math.min(255, (n / 100) * 255)) : null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : null;
}

function alphaOf(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const t = token.trim();
  if (t.endsWith('%')) {
    const n = Number(t.slice(0, -1));
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

/**
 * Parses the color forms the token file writes and a browser returns for a custom property: hex
 * (three, four, six or eight digits) and rgb() or rgba(), with commas or spaces and an optional
 * slash before alpha. Null for anything else (the caller then asks the browser to normalize it).
 */
export function parseCssColor(value: string): Rgba | null {
  const s = value.trim();
  const hex = HEX.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const fn = FUNC.exec(s);
  if (fn) {
    const body = fn[1].trim();
    let parts: string[];
    let alpha: string | undefined;
    if (body.includes(',')) {
      parts = body.split(',');
      if (parts.length === 4) alpha = parts.pop();
    } else {
      const [rgb, a] = body.split('/');
      parts = rgb.trim().split(/\s+/);
      alpha = a;
    }
    if (parts.length !== 3) return null;
    const rgb = parts.map(channel);
    const a = alphaOf(alpha);
    if (rgb.some((c) => c === null) || a === null) return null;
    return [rgb[0] as number, rgb[1] as number, rgb[2] as number, a];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------------------------

/** A number as a GLSL float literal: always with a decimal point or an exponent. */
export function glslFloat(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`glslFloat: ${n} is not a finite number`);
  const s = String(n);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}
