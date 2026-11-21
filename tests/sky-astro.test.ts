import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SKY } from '../lib/motion';
import {
  DAY_MS,
  GAL,
  J2000_MS,
  SIDEREAL_DEG_PER_DAY,
  airmass,
  bvToKelvin,
  depthFromParallax,
  equatorialToGalactic,
  extinctionMag,
  galacticToEquatorial,
  galacticToPanorama,
  gmstDeg,
  julianDate,
  lstDeg,
  projScale,
  project,
  starRGB,
  toEquatorial,
  toHorizontal,
  unproject,
  wrap180,
  wrap360,
} from '../lib/sky/astro';
import {
  PREVIEW_MS,
  STILL_FALLBACK_STEP,
  STILL_STEPS,
  STILL_STEP_DEG,
  STILL_STEP_SCRIPT,
  stepSiderealDeg,
  stepTimeNear,
  stillStepAt,
} from '../lib/sky/still-steps';

const RAD = Math.PI / 180;
const { lat, lon } = SKY.site;

/** A repeatable spread of moments from 1990 to 2060 (mulberry32), so failures can be reproduced. */
function moments(count: number): number[] {
  let state = 20261118;
  const next = () => {
    state = (state + 1831565813) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const from = Date.UTC(1990, 0, 1);
  const to = Date.UTC(2060, 0, 1);
  return Array.from({ length: count }, () => Math.floor(from + next() * (to - from)));
}

/** The angle between two directions given in degrees, wrap-aware. */
const apart = (a: number, b: number) => Math.abs(wrap180(a - b));

describe('time and sidereal time', () => {
  it('dates J2000.0 and the Unix epoch', () => {
    expect(J2000_MS).toBe(Date.UTC(2000, 0, 1, 12, 0, 0));
    expect(julianDate(J2000_MS)).toBe(2451545);
    expect(julianDate(0)).toBe(2440587.5);
  });

  it('puts Greenwich mean sidereal time at J2000.0 noon at 280.46061837 degrees', () => {
    expect(gmstDeg(J2000_MS)).toBeCloseTo(280.46061837, 9);
  });

  it("matches Meeus's worked examples 12.a and 12.b (1987 April 10) to a ten-thousandth of a degree", () => {
    // 0h UT: 13h 10m 46.3668s. 19h 21m UT: 8h 34m 57.0896s. Meeus keeps a quadratic term the
    // reference drops; it is worth about 0.00001 degrees here.
    expect(apart(gmstDeg(Date.UTC(1987, 3, 10, 0, 0, 0)), (13 + 10 / 60 + 46.3668 / 3600) * 15)).toBeLessThan(1e-4);
    expect(apart(gmstDeg(Date.UTC(1987, 3, 10, 19, 21, 0)), (8 + 34 / 60 + 57.0896 / 3600) * 15)).toBeLessThan(1e-4);
  });

  it('repeats the sky every sidereal day of 23 h 56 min 4.09 s', () => {
    const siderealDay = ((23 * 60 + 56) * 60 + 4.0905) * 1000;
    for (const t of moments(50)) expect(apart(gmstDeg(t + siderealDay), gmstDeg(t))).toBeLessThan(1e-4);
  });

  it('adds the longitude for local sidereal time, in [0, 360)', () => {
    for (const t of moments(50)) {
      const l = lstDeg(t, lon);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThan(360);
      expect(apart(l, gmstDeg(t) + lon)).toBeLessThan(1e-9);
    }
    expect(wrap360(-30)).toBe(330);
    expect(wrap180(270)).toBe(-90);
  });
});

describe('horizontal coordinates from Santa Clara', () => {
  it('keeps Polaris at about 37.35 degrees of altitude at any time', () => {
    // Polaris, J2000: 2h 31m 49.09s, +89 degrees 15 minutes 50.8 seconds, 0.74 degrees from the pole.
    const altitudes = moments(400).map((t) => toHorizontal(37.95454, 89.26411, lstDeg(t, lon), lat)[0]);
    for (const alt of altitudes) expect(Math.abs(alt - 37.354)).toBeLessThan(0.75);
    // It circles the pole: over many moments it comes close to both ends of its swing.
    expect(Math.max(...altitudes) - Math.min(...altitudes)).toBeGreaterThan(1.4);
  });

  it('puts a star on the celestial equator at the meridian 90 - 37.354 degrees up, due south', () => {
    for (const lst of [0, 100, 271.5]) {
      const [alt, az] = toHorizontal(lst, 0, lst, lat);
      expect(alt).toBeCloseTo(90 - 37.354, 9);
      expect(az).toBeCloseTo(180, 9);
    }
  });

  it('puts a star at the zenith when its declination is the latitude and it crosses the meridian', () => {
    expect(toHorizontal(55, lat, 55, lat)[0]).toBeCloseTo(90, 6);
  });

  it('measures azimuth from north through east', () => {
    // A star on the equator six hours east of the meridian is rising due east.
    const [alt, az] = toHorizontal(90, 0, 0, lat);
    expect(alt).toBeCloseTo(0, 9);
    expect(az).toBeCloseTo(90, 9);
  });

  it('turns horizontal coordinates back into equatorial ones', () => {
    for (const t of moments(200)) {
      const ra = (t / 7919) % 360;
      const dec = ((t / 104729) % 170) - 85;
      const lst = lstDeg(t, lon);
      const [alt, az] = toHorizontal(ra, dec, lst, lat);
      const [ra2, dec2] = toEquatorial(alt, az, lst, lat);
      expect(apart(ra2, ra)).toBeLessThan(1e-6);
      expect(dec2).toBeCloseTo(dec, 6);
    }
  });
});

describe('the projection of the view', () => {
  it('shows 60 degrees of sky above the horizon on wide screens (SKY.altitudeTop)', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1440, 900],
      [1024, 768],
    ]) {
      const horizonY = Math.round(h * SKY.horizon);
      const k = projScale(w, horizonY);
      expect(unproject(0, horizonY, k)[0] / RAD).toBeCloseTo(SKY.altitudeTop, 6);
    }
  });

  it('shows more sky on a phone, but never more than 85 degrees, and 45 degrees each side on a portrait tablet', () => {
    const phoneHorizon = Math.round(844 * SKY.horizon);
    const phoneTop = unproject(0, phoneHorizon, projScale(390, phoneHorizon))[0] / RAD;
    expect(phoneTop).toBeGreaterThan(SKY.altitudeTop);
    expect(phoneTop).toBeCloseTo(85, 6);
    const tabletHorizon = Math.round(1024 * SKY.horizon);
    expect(unproject(768 / 2, 0, projScale(768, tabletHorizon))[1] / RAD).toBeCloseTo(45, 6);
  });

  it('draws the horizon as a straight line through the centre', () => {
    expect(project(0, 0, 500)).toEqual([0, 0]);
    for (const dAz of [-60, -20, 10, 45, 80]) expect(project(0, dAz * RAD, 500)?.[1]).toBeCloseTo(0, 9);
  });

  it('is stereographic: a point c degrees from the centre lies 2k tan(c / 2) from it', () => {
    const k = 640;
    for (const [alt, dAz] of [
      [10, 5],
      [30, 20],
      [55, -40],
      [80, 70],
    ]) {
      const xy = project(alt * RAD, dAz * RAD, k);
      expect(xy).not.toBeNull();
      const c = Math.acos(Math.cos(alt * RAD) * Math.cos(dAz * RAD));
      expect(Math.hypot(xy![0], xy![1])).toBeCloseTo(2 * k * Math.tan(c / 2), 6);
      expect(Math.sign(xy![0])).toBe(Math.sign(dAz));
    }
  });

  it('drops points behind the viewer', () => {
    expect(project(0, Math.PI, 500)).toBeNull();
    expect(project(10 * RAD, 100 * RAD, 500)).toBeNull();
  });

  it('inverts the projection', () => {
    const k = 520;
    for (let alt = 0; alt <= 68; alt += 17) {
      for (let dAz = -64; dAz <= 64; dAz += 32) {
        const [x, y] = project(alt * RAD, dAz * RAD, k)!;
        const [alt2, dAz2] = unproject(x, y, k);
        expect(alt2 / RAD).toBeCloseTo(alt, 6);
        expect(dAz2 / RAD).toBeCloseTo(dAz, 6);
      }
    }
  });
});

describe('air', () => {
  it('gives an airmass of 1 overhead, about 2 at 30 degrees and about 38 at the horizon', () => {
    expect(airmass(90)).toBeCloseTo(1, 3);
    expect(Math.abs(airmass(30) - 1 / Math.sin(30 * RAD))).toBeLessThan(0.01);
    expect(Math.abs(airmass(0) - 38)).toBeLessThan(0.5);
    expect(airmass(-5)).toBe(airmass(0));
  });

  it('dims by SKY.extinction magnitudes per airmass beyond the first, more toward the horizon', () => {
    expect(SKY.extinction).toBe(0.25);
    expect(Math.abs(extinctionMag(90, SKY.extinction))).toBeLessThan(0.001);
    expect(extinctionMag(30, SKY.extinction)).toBeCloseTo(0.25 * (airmass(30) - 1), 12);
    const dims = [80, 60, 40, 20, 10, 5, 1].map((alt) => extinctionMag(alt, SKY.extinction));
    for (let i = 1; i < dims.length; i += 1) expect(dims[i]).toBeGreaterThan(dims[i - 1]);
  });
});

describe('galactic coordinates', () => {
  it('maps the galactic centre (266.405, -28.936) to l about 0 and b about 0', () => {
    const [l, b] = equatorialToGalactic(266.405, -28.936);
    expect(Math.abs(wrap180(l))).toBeLessThan(0.01);
    expect(Math.abs(b)).toBeLessThan(0.01);
  });

  it('maps the north galactic pole to b = 90, and Deneb and Vega to their catalogue values', () => {
    expect(equatorialToGalactic(192.85948, 27.12825)[1]).toBeCloseTo(90, 2);
    const deneb = equatorialToGalactic(310.35798, 45.28034);
    expect(deneb[0]).toBeCloseTo(84.2847, 3);
    expect(deneb[1]).toBeCloseTo(1.9975, 3);
    const vega = equatorialToGalactic(279.23473, 38.78369);
    expect(vega[0]).toBeCloseTo(67.4482, 3);
    expect(vega[1]).toBeCloseTo(19.2372, 3);
  });

  it('is a rotation, so its inverse is its transpose', () => {
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        const dot = GAL[i][0] * GAL[j][0] + GAL[i][1] * GAL[j][1] + GAL[i][2] * GAL[j][2];
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 8);
      }
    }
    for (const t of moments(100)) {
      const ra = (t / 7919) % 360;
      const dec = ((t / 104729) % 178) - 89;
      const [l, b] = equatorialToGalactic(ra, dec);
      const [ra2, dec2] = galacticToEquatorial(l, b);
      expect(apart(ra2, ra)).toBeLessThan(1e-6);
      expect(dec2).toBeCloseTo(dec, 6);
    }
    const [ra0, dec0] = galacticToEquatorial(0, 0);
    expect(ra0).toBeCloseTo(266.405, 2);
    expect(dec0).toBeCloseTo(-28.936, 2);
  });

  it('reads the panorama with the galactic centre in the middle and longitude growing to the left', () => {
    expect(galacticToPanorama(0, 0)).toEqual([0.5, 0.5]);
    expect(galacticToPanorama(90, 0)).toEqual([0.25, 0.5]);
    expect(galacticToPanorama(270, 0)).toEqual([0.75, 0.5]);
    expect(galacticToPanorama(0, 90)[1]).toBe(0);
    expect(galacticToPanorama(0, -90)[1]).toBe(1);
  });
});

describe('star color', () => {
  it('gives a Sun-like B-V of 0.65 about 5,800 K', () => {
    expect(Math.abs(bvToKelvin(0.65) - 5800)).toBeLessThan(100);
  });

  it('runs hotter for bluer stars and reads B-V under -0.4 as -0.4', () => {
    const temps = [-0.3, 0, 0.5, 1, 1.5, 2].map(bvToKelvin);
    for (let i = 1; i < temps.length; i += 1) expect(temps[i]).toBeLessThan(temps[i - 1]);
    expect(bvToKelvin(-1)).toBe(bvToKelvin(-0.4));
    expect(Number.isNaN(bvToKelvin(Number.NaN))).toBe(true);
  });

  it('colors hot stars blue-white and cool stars orange, mixed toward white as the reference', () => {
    expect(starRGB(6600)).toEqual([255, 255, 255]);
    expect(starRGB(3000)).toEqual([255, 212, 175]);
    expect(starRGB(10000)).toEqual([226, 235, 255]);
    const [r, , b] = starRGB(25000);
    expect(b).toBeGreaterThan(r);
    for (const channel of starRGB(bvToKelvin(1.6))) expect(channel).toBeGreaterThanOrEqual(0.45 * 255 - 1);
    expect(starRGB(Number.NaN).every((c) => c > 245)).toBe(true);
  });
});

describe('depth from parallax', () => {
  const scale = SKY.parallax.depth;

  it('puts stars within 10 parsecs at depth 1 and the farthest at depth 0.05, as the reference', () => {
    expect(depthFromParallax(379.21, scale)).toBe(1);
    expect(depthFromParallax(50, scale)).toBe(0.5);
    expect(depthFromParallax(2, scale)).toBe(0.05);
    for (const unknown of [0, -3, Number.NaN]) expect(depthFromParallax(unknown, scale)).toBe(0.05);
  });

  it('gives the shifts of sheet 3.3: 12, 6 and 0.6 px each way', () => {
    expect(SKY.parallax.x * depthFromParallax(100, scale)).toBe(12);
    expect(SKY.parallax.x * depthFromParallax(50, scale)).toBe(6);
    expect(SKY.parallax.x * depthFromParallax(1, scale)).toBeCloseTo(0.6, 12);
  });
});

describe('the still steps', () => {
  it('has 24 hourly steps, step 7 at 105 degrees', () => {
    expect(STILL_STEPS).toBe(24);
    expect(STILL_STEP_DEG).toBe(15);
    expect(stepSiderealDeg(7)).toBe(105);
  });

  it('picks the step nearest the local sidereal time at Santa Clara', () => {
    for (const t of moments(2000)) {
      const step = stillStepAt(t);
      expect(Number.isInteger(step)).toBe(true);
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(24);
      expect(apart(stepSiderealDeg(step), lstDeg(t, lon))).toBeLessThanOrEqual(7.5 + 1e-9);
    }
  });

  it('gives the inline script the same answer as the TypeScript, for many times and at the half-hour boundaries', () => {
    // Evaluated in a fresh context, as the browser runs it: it may use nothing but built-ins.
    const script = runInNewContext(`(${STILL_STEP_SCRIPT})`) as (t: number) => number;
    const times = moments(5000);
    // Moments a hair either side of each half-hour boundary, where a rounding difference would show.
    for (let step = 0; step < 24; step += 1) {
      const boundary = stepTimeNear(step, PREVIEW_MS) + ((STILL_STEP_DEG / 2) * DAY_MS) / SIDEREAL_DEG_PER_DAY;
      for (const offset of [-2, -1, 0, 1, 2]) times.push(Math.round(boundary) + offset);
    }
    for (const t of times) expect(script(t)).toBe(stillStepAt(t));
  });

  it('keeps the inline script small, plain, and free of what the content check refuses', () => {
    expect(STILL_STEP_SCRIPT.length).toBeLessThan(220);
    expect(STILL_STEP_SCRIPT).toMatch(/^function\(t\)\{/);
    expect(STILL_STEP_SCRIPT).not.toMatch(/\{\{|\}\}/);
    expect(STILL_STEP_SCRIPT).not.toMatch(new RegExp(`[${String.fromCharCode(8211, 8212)}]`));
    expect(STILL_STEP_SCRIPT).toContain(String(lon));
  });

  it('starts the live sky at the moment nearest now with the step sidereal time', () => {
    const halfSiderealHour = ((STILL_STEP_DEG / 2) * DAY_MS) / SIDEREAL_DEG_PER_DAY;
    for (const t of moments(500)) {
      const step = stillStepAt(t);
      const start = stepTimeNear(step, t);
      expect(apart(lstDeg(start, lon), stepSiderealDeg(step))).toBeLessThan(1e-6);
      expect(Math.abs(start - t)).toBeLessThanOrEqual(halfSiderealHour + 1);
      expect(stillStepAt(start)).toBe(step);
      // Any other step is reachable within half a sidereal day.
      const other = (step + 11) % 24;
      expect(Math.abs(stepTimeNear(other, t) - t)).toBeLessThanOrEqual(DAY_MS / 2);
    }
  });

  it('falls back to the bundle preview moment, 21:00 Pacific time on 16 November 2026', () => {
    expect(new Date(PREVIEW_MS).toISOString()).toBe('2026-11-17T05:00:00.000Z');
    expect(STILL_FALLBACK_STEP).toBe(stillStepAt(PREVIEW_MS));
    expect(STILL_FALLBACK_STEP).toBe(1);
  });
});
