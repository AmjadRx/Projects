import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SKY, ease } from '../lib/motion';
import {
  airmass,
  bvToKelvin,
  depthFromParallax,
  equatorialToGalactic,
  galacticToPanorama,
  extinctionMag,
  lstDeg,
  projScale,
  project,
  starRGB,
  toEquatorial,
  toHorizontal,
  unproject,
  wrap180,
} from '../lib/sky/astro';
import { countBrighterThan, decodeStars, parseStarNames } from '../lib/sky/stars';
import {
  SCROLL_TURN_MS,
  applyMat3,
  buildStarAttributes,
  clamp01,
  cubicBezier,
  emptyStarAttributes,
  fillStarAttributes,
  glslFloat,
  groundPhase,
  horizonY,
  localDirection,
  meteorGap,
  meteorStreak,
  parseCssColor,
  placeStar,
  rotationRows,
  scrolledSince,
  selectDrafting,
  shimmerAngle,
  simTimeMs,
  skyToGalactic,
  skyToPanorama,
  smoothingFactor,
  spawnMeteor,
  starAlpha,
  starRadius,
  type BrightStar,
} from '../components/sky/live/math';
import {
  AIRMASS_GLSL,
  FULLSCREEN_VERTEX,
  GROUND_FRAGMENT,
  KASTEN_YOUNG,
  METEOR_FRAGMENT,
  METEOR_VERTEX,
  MILKY_WAY_FRAGMENT,
  PROJECT_MIN_COS,
  SKY_FRAGMENT,
  STAR_FRAGMENT,
  STAR_VERTEX,
} from '../components/sky/live/shaders';

const RAD = Math.PI / 180;
/** An en dash or an em dash, built from their codes so this file holds neither. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const ROOT = path.resolve(__dirname, '..');
const catalog = decodeStars(new Uint8Array(fs.readFileSync(path.join(ROOT, 'public/sky/stars.bin'))));

/** A repeatable stream of numbers from 0 to 1 (mulberry32). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 1831565813) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The reference renderer's per-star loop (drawSky), written out from its source, for comparison. */
function referencePlace(ra: number, dec: number, vmag: number, plx: number, lst: number, W: number, H: number, px: number, py: number) {
  const hz = toHorizontal(ra, dec, lst, SKY.site.lat);
  if (hz[0] <= 0.3) return null;
  let dAz = hz[1] - SKY.facing;
  if (dAz > 180) dAz -= 360;
  if (dAz < -180) dAz += 360;
  const hy = Math.round(H * SKY.horizon);
  const q = project(hz[0] * RAD, dAz * RAD, projScale(W, hy));
  if (!q) return null;
  const depth = Math.max(0.05, Math.min(1, plx / 100));
  const x = W / 2 + q[0] + px * 12 * depth;
  const y = hy - q[1] + py * 8 * depth;
  if (x < -10 || x > W + 10 || y < -10 || y > hy) return null;
  const v = vmag + extinctionMag(hz[0], SKY.extinction);
  if (v > 8) return null;
  return { x, y, v };
}

describe('the view: projection and the Milky Way mapping', () => {
  it('turns a screen point into the same direction as unproject, without trigonometry', () => {
    const next = random(7);
    for (let n = 0; n < 500; n += 1) {
      const k = 200 + next() * 900;
      const x = (next() - 0.5) * 3000;
      const y = next() * 1500;
      const [alt, dAz] = unproject(x, y, k);
      const [f, r, u] = localDirection(x, y, k);
      expect(Math.hypot(f, r, u)).toBeCloseTo(1, 12);
      expect(Math.asin(u)).toBeCloseTo(alt, 10);
      expect(Math.atan2(r, f)).toBeCloseTo(dAz, 10);
    }
  });

  it('maps a screen point to the same galactic direction as the reference, step by step', () => {
    const next = random(11);
    for (let n = 0; n < 500; n += 1) {
      const W = 320 + next() * 2600;
      const H = 480 + next() * 1400;
      const hy = horizonY(H);
      const k = projScale(W, hy);
      const x = (next() - 0.5) * W;
      const y = next() * hy;
      const lst = next() * 360;
      // The reference: unproject, then toEquatorial, then GAL.
      const [alt, dAz] = unproject(x, y, k);
      const [ra, dec] = toEquatorial(alt / RAD, SKY.facing + dAz / RAD, lst, SKY.site.lat);
      const [l, b] = equatorialToGalactic(ra, dec);
      // The scene: one matrix a frame.
      const g = applyMat3(skyToGalactic(lst, SKY.site.lat, SKY.facing), localDirection(x, y, k));
      const gl = ((Math.atan2(g[1], g[0]) / RAD) % 360 + 360) % 360;
      const gb = Math.asin(Math.max(-1, Math.min(1, g[2]))) / RAD;
      expect(gb).toBeCloseTo(b, 3);
      if (Math.abs(b) < 89) expect(Math.abs(wrap180(gl - l))).toBeLessThan(1e-3);
    }
  });

  // Orthonormal; its determinant is -1, because hour angle grows westward while azimuth grows
  // eastward (the map is a rotation and a mirror), which the test above checks point by point.
  it('builds an orthonormal map in GLSL column order', () => {
    const m = skyToGalactic(123.4, SKY.site.lat, SKY.facing);
    const col = (j: number) => [m[j * 3], m[j * 3 + 1], m[j * 3 + 2]];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        const dot = col(i).reduce((s, v, k) => s + v * col(j)[k], 0);
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 6);
      }
    }
    const [a, b, c] = [col(0), col(1), col(2)];
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    expect(Math.abs(det)).toBeCloseTo(1, 6);
  });

  /**
   * Where the ESO photograph's own images of bright, isolated stars lie in public/sky/milkyway-4k.webp:
   * the brightness peaks, measured on the panorama shrunk to 1024 x 512 (a pixel is 0.35 degrees),
   * by HR number. Measured data, not design numbers.
   */
  const PHOTO_PEAKS = [
    { name: 'Sirius', hr: 2491, x: 897, y: 282 },
    { name: 'Arcturus', hr: 5340, x: 467, y: 55 },
    { name: 'Vega', hr: 7001, x: 327, y: 201 },
    { name: 'Capella', hr: 1708, x: 58, y: 248 },
    { name: 'Procyon', hr: 2943, x: 938, y: 221 },
    { name: 'Altair', hr: 7557, x: 386, y: 279 },
    { name: 'Spica', hr: 5056, x: 647, y: 105 },
    { name: 'Pollux', hr: 2990, x: 999, y: 193 },
    { name: 'Deneb', hr: 7924, x: 281, y: 252 },
    { name: 'Regulus', hr: 3982, x: 907, y: 118 },
    { name: 'Elnath', hr: 1791, x: 14, y: 271 },
    { name: 'Alioth', hr: 4905, x: 169, y: 86 },
  ];

  it("puts the photograph's bright stars on the catalogue's, through the panorama's own frame", () => {
    const unit = (l: number, b: number): [number, number, number] => [Math.cos(b * RAD) * Math.cos(l * RAD), Math.cos(b * RAD) * Math.sin(l * RAD), Math.sin(b * RAD)];
    const angle = (a: number[], c: number[]) => Math.acos(Math.min(1, a[0] * c[0] + a[1] * c[1] + a[2] * c[2])) / RAD;
    const rows = rotationRows(SKY.scene.milkyWayFrame);
    const turn = (v: number[]) => rows.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
    for (const peak of PHOTO_PEAKS) {
      const i = Array.from(catalog.hr).indexOf(peak.hr);
      expect(i, peak.name).toBeGreaterThanOrEqual(0);
      // The peak's direction in the photograph's frame, read back through galacticToPanorama.
      const photo = unit((0.5 - (peak.x + 0.5) / 1024) * 360, (0.5 - (peak.y + 0.5) / 512) * 180);
      const [l, b] = equatorialToGalactic(catalog.ra[i], catalog.dec[i]);
      const star = unit(l, b);
      expect(angle(turn(star), photo), peak.name).toBeLessThan(0.5);
      // Read on the galactic grid alone, as the reference reads it, the ghost sits 1 to 4 degrees off.
      expect(angle(star, photo), peak.name).toBeGreaterThan(1);
    }
  });

  it('maps the view to the panorama: the galactic map, then the fixed frame rotation', () => {
    const next = random(31);
    for (let n = 0; n < 200; n += 1) {
      const lst = next() * 360;
      const local = localDirection((next() - 0.5) * 2000, next() * 800, 300 + next() * 600);
      const g = applyMat3(skyToGalactic(lst, SKY.site.lat, SKY.facing), local);
      const p = applyMat3(skyToPanorama(lst, SKY.site.lat, SKY.facing), local);
      const rows = rotationRows(SKY.scene.milkyWayFrame);
      for (let i = 0; i < 3; i += 1) expect(p[i]).toBeCloseTo(rows[i][0] * g[0] + rows[i][1] * g[1] + rows[i][2] * g[2], 6);
    }
    // No rotation: the panorama is read on the galactic grid, as galacticToPanorama says.
    const flat = skyToPanorama(10, SKY.site.lat, SKY.facing, { x: 0, y: 0, z: 0 });
    expect(Array.from(flat)).toEqual(Array.from(skyToGalactic(10, SKY.site.lat, SKY.facing)));
    // A turn about galactic z alone moves longitude only: u shifts by the angle over 360.
    const v = rotationRows({ x: 0, y: 0, z: -3 });
    const g = [Math.cos(40 * RAD), Math.sin(40 * RAD), 0];
    const t = v.map((r) => r[0] * g[0] + r[1] * g[1] + r[2] * g[2]);
    const lTurned = Math.atan2(t[1], t[0]) / RAD;
    expect(galacticToPanorama(lTurned, 0)[0] - galacticToPanorama(40, 0)[0]).toBeCloseTo(3 / 360, 9);
  });

  it('puts the horizon at SKY.horizon of the height, rounded as the reference rounds it', () => {
    expect(horizonY(900)).toBe(720);
    expect(horizonY(844)).toBe(675);
    expect(horizonY(1081)).toBe(Math.round(1081 * SKY.horizon));
  });
});

describe('stars', () => {
  it('places catalogue stars exactly as the reference does, culls included', () => {
    const next = random(23);
    let shown = 0;
    for (let n = 0; n < 4000; n += 1) {
      const i = Math.floor(next() * catalog.count);
      const W = 320 + Math.round(next() * 2200);
      const H = 560 + Math.round(next() * 900);
      const lst = next() * 360;
      const px = next() * 2 - 1;
      const py = next() * 2 - 1;
      const depth = depthFromParallax(catalog.parallax[i], SKY.parallax.depth);
      const ours = placeStar(catalog.ra[i], catalog.dec[i], catalog.vmag[i], depth, {
        lst,
        width: W,
        height: H,
        shiftX: px * SKY.parallax.x,
        shiftY: py * SKY.parallax.y,
      });
      const ref = referencePlace(catalog.ra[i], catalog.dec[i], catalog.vmag[i], catalog.parallax[i], lst, W, H, px, py);
      if (!ref) {
        expect(ours).toBeNull();
        continue;
      }
      shown += 1;
      expect(ours).not.toBeNull();
      expect(ours!.x).toBeCloseTo(ref.x, 9);
      expect(ours!.y).toBeCloseTo(ref.y, 9);
      expect(ours!.v).toBeCloseTo(ref.v, 9);
    }
    expect(shown).toBeGreaterThan(400);
  });

  it('sizes and dims stars from their magnitude as the reference does', () => {
    for (const v of [-1.46, 0, 1.6, 2, 3.9, 5.35, 6.5, 8]) {
      expect(starRadius(v)).toBeCloseTo(Math.max(0.45, 2.4 - 0.36 * v), 12);
      expect(starAlpha(v)).toBeCloseTo(Math.max(0.16, Math.min(1, 1.05 - v * 0.13)), 12);
    }
  });

  it('builds the same attributes in slices as all at once (the scene prepares them in yielding steps)', () => {
    const whole = buildStarAttributes(catalog);
    const sliced = emptyStarAttributes(catalog.count);
    for (let from = 0; from < catalog.count; from += 997) fillStarAttributes(catalog, sliced, from, from + 997);
    expect(sliced).toEqual(whole);
  });

  it('builds the per-star attributes: radians, color from B-V, depth from parallax, shimmer phase', () => {
    const a = buildStarAttributes(catalog);
    expect(a.count).toBe(catalog.count);
    expect(a.raDec.length).toBe(catalog.count * 2);
    expect(a.color.length).toBe(catalog.count * 3);
    for (const i of [0, 1, 17, 100, 2446, 5000, catalog.count - 1]) {
      expect(a.raDec[i * 2]).toBeCloseTo(catalog.ra[i] * RAD, 5);
      expect(a.raDec[i * 2 + 1]).toBeCloseTo(catalog.dec[i] * RAD, 5);
      expect(a.vmag[i]).toBe(catalog.vmag[i]);
      expect(Array.from(a.color.slice(i * 3, i * 3 + 3))).toEqual(starRGB(bvToKelvin(catalog.bv[i])));
      expect(a.depth[i]).toBeCloseTo(depthFromParallax(catalog.parallax[i], SKY.parallax.depth), 6);
      expect(a.phase[i]).toBeGreaterThanOrEqual(0);
      expect(a.phase[i]).toBeLessThan(2 * Math.PI);
      expect(a.phase[i]).toBeCloseTo(i % (2 * Math.PI), 4);
    }
  });

  it('draws the catalogue to SKY.scene.star.limit on Full and to SKY.lightTierLimit on Light', () => {
    expect(countBrighterThan(catalog, SKY.scene.star.limit)).toBe(9095);
    expect(countBrighterThan(catalog, SKY.lightTierLimit)).toBe(2447);
  });
});

describe('drafting lines', () => {
  const star = (x: number, y: number, v: number, name = ''): BrightStar => ({ x, y, v, name });

  it('joins at most four stars within the radius, from the brightest, each time to the nearest', () => {
    const pointer = { x: 500, y: 300 };
    const stars = [
      star(510, 300, 1.5, 'Alpha'),
      star(560, 320, 0.4, 'Beta'),
      star(700, 300, 2.1, ''),
      star(500, 529, 1.0, 'Gamma'),
      star(500, 531, -0.5, 'Far'), // 231 px away: out
      star(450, 260, 2.5, ''),
    ];
    const sel = selectDrafting(stars, pointer);
    // Nearest first (10, 63.2, 64.0 and 200 px); Gamma at 229 px is a fifth, so it is left out.
    expect(sel.near.map((s) => s.v)).toEqual([1.5, 0.4, 2.5, 2.1]);
    expect(sel.chain[0].name).toBe('Beta');
    // From Beta, the nearest of the rest is Alpha (53.9 px), then 450,260 (72.1 px), then 700,300.
    expect(sel.chain.map((s) => s.x)).toEqual([560, 510, 450, 700]);
    expect(sel.named?.name).toBe('Beta');
  });

  it('names nothing when no near star has a name, and draws nothing with no star near', () => {
    const sel = selectDrafting([star(10, 10, 1), star(30, 10, 2)], { x: 20, y: 10 });
    expect(sel.near).toHaveLength(2);
    expect(sel.named).toBeNull();
    const none = selectDrafting([star(1000, 1000, 1, 'X')], { x: 0, y: 0 });
    expect(none.near).toHaveLength(0);
    expect(none.chain).toHaveLength(0);
    expect(none.named).toBeNull();
  });
});

describe('the meteor', () => {
  it('waits 10 to 20 s between meteors', () => {
    expect(meteorGap(0)).toBe(10);
    expect(meteorGap(1)).toBe(20);
    expect(meteorGap(0.5)).toBe(15);
  });

  it('starts where the reference starts one and streaks 260 px with a 90 px tail', () => {
    const r = [0, 0, 0];
    const m0 = spawnMeteor(1000, 800, () => r.shift() ?? 0);
    expect(m0.x).toBeCloseTo(250, 9);
    expect(m0.y).toBeCloseTo(800 * SKY.horizon * 0.08, 9);
    expect(m0.dx).toBeCloseTo(-0.75, 9);
    expect(m0.dy).toBe(0.55);
    const one = [1, 1, 1];
    const m1 = spawnMeteor(1000, 800, () => one.shift() ?? 1);
    expect(m1.x).toBeCloseTo(850, 9);
    expect(m1.y).toBeCloseTo(800 * SKY.horizon * 0.43, 9);
    expect(m1.dx).toBeCloseTo(-1, 9);

    const s = meteorStreak({ x: 600, y: 100, dx: -1, dy: 0.55 }, 0.5);
    expect(s.head[0]).toBeCloseTo(600 - 130, 9);
    expect(s.head[1]).toBeCloseTo(100 + 0.55 * 130, 9);
    expect(s.tail[0]).toBeCloseTo(s.head[0] + 90, 9);
    expect(s.tail[1]).toBeCloseTo(s.head[1] - 0.55 * 90, 9);
    expect(s.alpha).toBeCloseTo(0.85 * 0.5, 9);
  });
});

describe('time', () => {
  it('turns the sky at SKY.speed times the real rate, and SKY.scrollTurn degrees over a page', () => {
    const t0 = Date.UTC(2026, 10, 17, 5, 0, 0);
    expect(simTimeMs(t0, 0, 0)).toBe(t0);
    expect(simTimeMs(t0, 60, 0)).toBe(t0 + 60_000 * SKY.speed);
    const turned = lstDeg(simTimeMs(t0, 0, 1), SKY.site.lon) - lstDeg(t0, SKY.site.lon);
    expect(wrap180(turned)).toBeCloseTo(SKY.scrollTurn, 9);
    expect(SCROLL_TURN_MS).toBeCloseTo((4 / 360.98564736629) * 86_400_000, 6);
    expect(simTimeMs(t0, 0, 2)).toBe(simTimeMs(t0, 0, 1));
    // Scrolling back above the point the scene started from turns the sky back.
    const back = lstDeg(simTimeMs(t0, 0, -0.5), SKY.site.lon) - lstDeg(t0, SKY.site.lon);
    expect(wrap180(back)).toBeCloseTo(-SKY.scrollTurn / 2, 9);
    expect(simTimeMs(t0, 0, -2)).toBe(simTimeMs(t0, 0, -1));
  });

  it("counts scroll from the scene's first frame, so that frame is the still's sky wherever the page was", () => {
    const t0 = Date.UTC(2026, 10, 17, 5, 0, 0);
    for (const from of [0, 0.25, 0.5, 1]) {
      // The first frame: no time run, no scroll since. The still is drawn at t0 with progress 0 and phase 0.
      expect(simTimeMs(t0, 0, scrolledSince(from, from))).toBe(t0);
      expect(groundPhase(0, scrolledSince(from, from))).toBe(0);
    }
    expect(scrolledSince(0.75, 0.5)).toBeCloseTo(0.25, 12);
    expect(scrolledSince(0.1, 0.5)).toBeCloseTo(-0.4, 12);
    expect(scrolledSince(Number.NaN, 0.5)).toBe(-0.5);
    // Half a row back when scrolled back by a twelfth of the page.
    expect(groundPhase(0, -1 / (2 * SKY.scrollRows))).toBeCloseTo(SKY.scene.ground.rowStep / 2, 9);
  });

  it('moves the ground one row every SKY.rowPeriod seconds and SKY.scrollRows rows over a page', () => {
    const step = SKY.scene.ground.rowStep;
    expect(groundPhase(0, 0)).toBe(0);
    expect(groundPhase(SKY.rowPeriod / 2, 0)).toBeCloseTo(step / 2, 9);
    expect(groundPhase(SKY.rowPeriod, 0)).toBeCloseTo(0, 9);
    expect(groundPhase(0, 1 / (2 * SKY.scrollRows))).toBeCloseTo(step / 2, 9);
    expect(groundPhase(0, 1)).toBeCloseTo(0, 9);
    const p = groundPhase(123456.7, 0.37);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(step);
  });

  it('runs the shimmer on a SKY.shimmer.period cycle and smooths the pointer with its time constant', () => {
    expect(shimmerAngle(0)).toBe(0);
    expect(shimmerAngle(SKY.shimmer.period / 4)).toBeCloseTo(Math.PI / 2, 9);
    expect(shimmerAngle(SKY.shimmer.period)).toBeCloseTo(0, 9);
    expect(smoothingFactor(0, 0.12)).toBe(0);
    expect(smoothingFactor(0.12, 0.12)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(smoothingFactor(1 / 60, 0)).toBe(1);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('easing', () => {
  it('evaluates the motion sheet curves like a CSS cubic-bezier', () => {
    for (const curve of [ease.settle, ease.fade, ease.move, ease.exit]) {
      const f = cubicBezier(curve);
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      // Against a dense sampling of the curve's parameter.
      const [x1, y1, x2, y2] = curve;
      const at = (s: number, a: number, b: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
      for (let s = 0.01; s < 1; s += 0.07) {
        expect(f(at(s, x1, x2))).toBeCloseTo(at(s, y1, y2), 5);
      }
      let last = 0;
      for (let t = 0; t <= 1; t += 0.01) {
        const y = f(t);
        expect(y).toBeGreaterThanOrEqual(last - 1e-9);
        last = y;
      }
    }
    expect(cubicBezier(ease.linear)(0.3)).toBeCloseTo(0.3, 9);
  });
});

describe('colors', () => {
  /** A Blueprint token's value as app/tokens.css writes it (this file holds no color of its own). */
  const token = (name: string): string => {
    const tokens = fs.readFileSync(path.join(ROOT, 'app/tokens.css'), 'utf8');
    const value = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1];
    if (!value) throw new Error(`${name} is not in app/tokens.css`);
    return value.trim();
  };
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  it('reads the color forms the token file and the browser write', () => {
    const line = token('--line');
    const sheet = token('--sheet');
    expect(line).toMatch(/^#[0-9a-f]{6}$/i);
    expect(parseCssColor(line)).toEqual([...channels(line), 1]);
    expect(parseCssColor(` ${sheet.toUpperCase()} `)).toEqual([...channels(sheet), 1]);
    // The short and the eight-digit forms, built from the token: each short digit doubles.
    const short = `#${line[1]}${line[3]}${line[5]}`;
    expect(parseCssColor(short)).toEqual([...[1, 2, 3].map((i) => parseInt(short[i] + short[i], 16)), 1]);
    expect(parseCssColor(`${sheet}80`)?.[3]).toBeCloseTo(128 / 255, 6);
    expect(parseCssColor('rgb(4, 10, 28)')).toEqual([4, 10, 28, 1]);
    expect(parseCssColor('rgba(15, 42, 90, 0.62)')).toEqual([15, 42, 90, 0.62]);
    expect(parseCssColor('rgb(4 10 28 / 50%)')).toEqual([4, 10, 28, 0.5]);
    expect(parseCssColor('rgb(100%, 0%, 50%)')).toEqual([255, 0, 127.5, 1]);
    expect(parseCssColor('color-mix(in srgb, red, blue)')).toBeNull();
    expect(parseCssColor('var(--sheet)')).toBeNull();
    expect(parseCssColor('rgb(1, 2)')).toBeNull();
  });
});

describe('the shaders', () => {
  const sources = { FULLSCREEN_VERTEX, SKY_FRAGMENT, MILKY_WAY_FRAGMENT, STAR_VERTEX, STAR_FRAGMENT, METEOR_VERTEX, METEOR_FRAGMENT, GROUND_FRAGMENT };

  it('writes the airmass formula of lib/sky/astro.ts', () => {
    const m = /\+ ([\d.]+) \* pow\(h \+ ([\d.]+), (-[\d.]+)\)/.exec(AIRMASS_GLSL);
    expect(m).not.toBeNull();
    const [a, b, c] = [Number(m![1]), Number(m![2]), Number(m![3])];
    expect([a, b, c]).toEqual([KASTEN_YOUNG.a, KASTEN_YOUNG.b, KASTEN_YOUNG.c]);
    for (let alt = -5; alt <= 90; alt += 0.5) {
      const h = Math.max(0, alt);
      expect(1 / (Math.sin(h * RAD) + a * Math.pow(h + b, c))).toBeCloseTo(airmass(alt), 12);
    }
  });

  it("drops points behind the viewer where lib/sky/astro.ts's project does", () => {
    for (const dAz of [0.3, 1, 1.4, 1.5]) {
      const alt = Math.acos(PROJECT_MIN_COS / Math.cos(dAz));
      expect(project(alt + 1e-6, dAz, 500)).toBeNull();
      expect(project(alt - 1e-6, dAz, 500)).not.toBeNull();
    }
  });

  it('takes its design numbers from SKY', () => {
    const constant = (src: string, name: string) => Number(new RegExp(`const float ${name} = ([^;]+);`).exec(src)?.[1]);
    expect(constant(STAR_VERTEX, 'LIMIT')).toBe(SKY.scene.star.limit);
    expect(constant(STAR_VERTEX, 'MIN_ALT')).toBe(SKY.scene.star.minAltitude);
    expect(constant(STAR_VERTEX, 'R_BASE')).toBe(SKY.scene.star.radius.base);
    expect(constant(STAR_VERTEX, 'A_SLOPE')).toBe(SKY.scene.star.alpha.slope);
    expect(constant(STAR_VERTEX, 'HALO_LIMIT')).toBe(SKY.haloLimit);
    expect(constant(STAR_VERTEX, 'SHIMMER_DEPTH')).toBe(SKY.shimmer.depth);
    expect(constant(STAR_FRAGMENT, 'GLOW')).toBe(SKY.scene.star.glow.radius);
    expect(constant(STAR_FRAGMENT, 'SPIKE_W')).toBe(SKY.scene.star.spikes.width);
    expect(constant(MILKY_WAY_FRAGMENT, 'EXPOSURE')).toBe(SKY.milkyWayExposure);
    expect(constant(MILKY_WAY_FRAGMENT, 'BLACK')).toBeCloseTo(14 / 255, 12);
    expect(constant(MILKY_WAY_FRAGMENT, 'LAYER')).toBe(SKY.scene.milkyWayLayer);
    expect(constant(GROUND_FRAGMENT, 'ROW_STEP')).toBe(SKY.scene.ground.rowStep);
    expect(constant(GROUND_FRAGMENT, 'SPACING')).toBeCloseTo(1 / 9, 12);
    expect(constant(GROUND_FRAGMENT, 'RIPPLE_WIDTH')).toBe(SKY.ripple.width);
    expect(constant(GROUND_FRAGMENT, 'EDGE')).toBe(SKY.scene.ground.edge);
    expect(constant(GROUND_FRAGMENT, 'RIPPLE_MIN')).toBe(SKY.ripple.minRadius);
    expect(constant(METEOR_FRAGMENT, 'WIDTH')).toBe(SKY.meteor.width);
    expect(constant(SKY_FRAGMENT, 'MID')).toBe(SKY.scene.skyMidStop);
  });

  it('writes no design number inline in the ground shader', () => {
    // The reference's 1 px row cull, ripple clip and smallest ripple come from SKY (EDGE, RIPPLE_MIN).
    expect(GROUND_FRAGMENT).not.toMatch(/uHorizon \+ 1\.0|uHeight \+ 1\.0|max\(1\.0,/);
  });

  it('holds no color, no doubled brace and no dash', () => {
    for (const [name, src] of Object.entries(sources)) {
      expect(src, name).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(src, name).not.toMatch(/\{\{|\}\}/);
      expect(src, name).not.toMatch(DASHES);
    }
  });

  it('writes GLSL float literals', () => {
    expect(glslFloat(8)).toBe('8.0');
    expect(glslFloat(0.55)).toBe('0.55');
    expect(glslFloat(-1.6364)).toBe('-1.6364');
    expect(glslFloat(1e-7)).toBe('1e-7');
    expect(() => glslFloat(Number.NaN)).toThrow();
  });
});

describe('loadSkyData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const file = (rel: string) => fs.readFileSync(path.join(ROOT, 'public', rel));

  it('reads the catalogue and the names, and goes on without the Milky Way when it cannot load', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/sky/stars.bin') return new Response(new Uint8Array(file('sky/stars.bin')));
      if (url === '/sky/names.json') return new Response(file('sky/names.json'));
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadSkyData, MILKY_WAY_PATHS } = await import('../components/sky/live/index');
    const data = await loadSkyData('light');
    expect(data.stars.count).toBe(catalog.count);
    expect(data.names.get(0)).toBe('Sirius');
    expect(data.names).toEqual(parseStarNames(JSON.parse(file('sky/names.json').toString('utf8')), catalog.count));
    expect(data.milkyWay).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(MILKY_WAY_PATHS.light);
  });

  it('fetches no Milky Way for a Whiteprint page, which does not show it', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/sky/stars.bin') return new Response(new Uint8Array(file('sky/stars.bin')));
      if (url === '/sky/names.json') return new Response(file('sky/names.json'));
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadSkyData, MILKY_WAY_PATHS } = await import('../components/sky/live/index');
    const data = await loadSkyData('full', 'whiteprint');
    expect(data.stars.count).toBe(catalog.count);
    expect(data.milkyWay).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(MILKY_WAY_PATHS.full);
    expect(fetchMock).not.toHaveBeenCalledWith(MILKY_WAY_PATHS.light);
  });

  it('draws no names when the names cannot load, and fails only without the catalogue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url === '/sky/stars.bin' ? new Response(new Uint8Array(file('sky/stars.bin'))) : new Response('', { status: 500 }))),
    );
    const { loadSkyData } = await import('../components/sky/live/index');
    const data = await loadSkyData('full');
    expect(data.names.size).toBe(0);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(loadSkyData('full')).rejects.toThrow(/stars\.bin/);
  });
});
