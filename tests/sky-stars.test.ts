import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STAR_FLAG_BV_ESTIMATED,
  STAR_FLAG_PARALLAX_DYNAMICAL,
  STAR_RECORD_SIZE,
  STARS_HEADER_SIZE,
  bvToKelvin,
  countBrighterThan,
  decodeStars,
  encodeStars,
  parseStarNames,
  type StarRecord,
} from '../lib/sky/stars';

/**
 * The sky's real data in public/sky/, written by scripts/build-sky.mjs from the Yale Bright Star
 * Catalogue (CDS VizieR V/50), the IAU Catalog of Star Names and the ESO Milky Way panorama.
 */
const SKY = path.resolve('public', 'sky');
const bytes = fs.readFileSync(path.join(SKY, 'stars.bin'));
const catalog = decodeStars(bytes);
const names = parseStarNames(JSON.parse(fs.readFileSync(path.join(SKY, 'names.json'), 'utf8')), catalog.count);
const indexOfHr = (hr: number) => catalog.hr.indexOf(hr);

/** The Light tier's magnitude limit (lib/motion.ts holds the constant the sky uses). */
const LIGHT_TIER_LIMIT = 5.35;

describe('public/sky/stars.bin', () => {
  it('holds the 9,096 stars of the catalogue, under 150 kB', () => {
    expect(catalog.count).toBe(9096);
    expect(bytes.length).toBe(STARS_HEADER_SIZE + 9096 * STAR_RECORD_SIZE);
    expect(bytes.length).toBeLessThan(150_000);
    expect(new Set(catalog.hr).size).toBe(9096);
  });

  it('is sorted brightest first', () => {
    for (let i = 1; i < catalog.count; i += 1) expect(catalog.vmag[i]).toBeGreaterThanOrEqual(catalog.vmag[i - 1]);
  });

  it('starts with Sirius, at its catalogue position and magnitude', () => {
    expect(catalog.hr[0]).toBe(2491);
    expect(catalog.ra[0]).toBeCloseTo(101.29, 2);
    expect(catalog.dec[0]).toBeCloseTo(-16.72, 2);
    expect(catalog.vmag[0]).toBeCloseTo(-1.46, 5);
    expect(catalog.bv[0]).toBeCloseTo(0.0, 5);
    expect(catalog.parallax[0]).toBe(375);
  });

  it('places Vega near RA 279.23 and Dec 38.78', () => {
    const vega = indexOfHr(7001);
    expect(vega).toBeGreaterThan(0);
    expect(catalog.ra[vega]).toBeCloseTo(279.23, 2);
    expect(catalog.dec[vega]).toBeCloseTo(38.78, 2);
    expect(catalog.vmag[vega]).toBeCloseTo(0.03, 5);
  });

  it('keeps every star on the sky and in the documented ranges', () => {
    for (let i = 0; i < catalog.count; i += 1) {
      expect(catalog.ra[i] >= 0 && catalog.ra[i] < 360).toBe(true);
      expect(Math.abs(catalog.dec[i]) <= 90).toBe(true);
      expect(catalog.bv[i] >= -0.5 && catalog.bv[i] <= 6).toBe(true);
      expect(catalog.parallax[i] >= 0 && catalog.parallax[i] < 1000).toBe(true);
    }
  });

  it('gives the Light tier about 2,500 stars at V 5.35 and brighter', () => {
    const light = countBrighterThan(catalog, LIGHT_TIER_LIMIT);
    expect(light).toBeGreaterThan(2300);
    expect(light).toBeLessThan(2700);
    expect(catalog.vmag[light - 1]).toBeLessThanOrEqual(Math.fround(LIGHT_TIER_LIMIT));
    expect(catalog.vmag[light]).toBeGreaterThan(Math.fround(LIGHT_TIER_LIMIT));
  });

  it('flags the estimated colors and the dynamical parallaxes', () => {
    let estimated = 0;
    let dynamical = 0;
    for (let i = 0; i < catalog.count; i += 1) {
      if (catalog.flags[i] & STAR_FLAG_BV_ESTIMATED) estimated += 1;
      if (catalog.flags[i] & STAR_FLAG_PARALLAX_DYNAMICAL) dynamical += 1;
    }
    // The catalogue gives no B-V for 310 stars; Sirius and Vega have measured colors.
    expect(estimated).toBe(310);
    expect(catalog.flags[0] & STAR_FLAG_BV_ESTIMATED).toBe(0);
    expect(dynamical).toBeGreaterThan(0);
  });

  it('shows T CrB at its usual brightness from the catalogue remark, not its 1946 outburst', () => {
    const tcrb = indexOfHr(5958);
    expect(catalog.vmag[tcrb]).toBeCloseTo(9.88, 5);
    expect(tcrb).toBe(catalog.count - 1);
  });

  it('refuses a file that is not this format', () => {
    expect(() => decodeStars(new Uint8Array(4))).toThrow(/shorter than its header/);
    const wrongMagic = Uint8Array.from(bytes);
    wrongMagic[0] = 0x58;
    expect(() => decodeStars(wrongMagic)).toThrow(/magic/);
    expect(() => decodeStars(bytes.subarray(0, bytes.length - 1))).toThrow(/do not hold/);
  });
});

describe('the star format', () => {
  const sample: StarRecord[] = [
    { ra: 359.99999, dec: -90, vmag: -1.5, bv: -0.5, bvEstimated: true, parallax: 0, parallaxDynamical: false, hr: 1 },
    { ra: 101.2870833, dec: -16.7161111, vmag: 2.31, bv: 1.42, bvEstimated: false, parallax: 751, parallaxDynamical: true, hr: 16383 },
    { ra: 0, dec: 90, vmag: 18.97, bv: 9.73, bvEstimated: false, parallax: 1023, parallaxDynamical: false, hr: 9110 },
  ];

  it('reads back what it writes, positions within 0.3 arcsec', () => {
    const back = decodeStars(encodeStars(sample));
    expect(back.count).toBe(3);
    sample.forEach((s, i) => {
      const dra = (((back.ra[i] - s.ra + 540) % 360) - 180) * Math.cos((s.dec * Math.PI) / 180);
      expect(Math.hypot(dra, back.dec[i] - s.dec) * 3600).toBeLessThan(0.3);
      expect(back.vmag[i]).toBeCloseTo(s.vmag, 4);
      expect(back.bv[i]).toBeCloseTo(s.bv, 4);
      expect(back.parallax[i]).toBe(s.parallax);
      expect(back.hr[i]).toBe(s.hr);
      expect(Boolean(back.flags[i] & STAR_FLAG_BV_ESTIMATED)).toBe(s.bvEstimated);
      expect(Boolean(back.flags[i] & STAR_FLAG_PARALLAX_DYNAMICAL)).toBe(s.parallaxDynamical);
    });
  });

  it('refuses unsorted stars, repeated HR numbers and values outside its fields', () => {
    expect(() => encodeStars([sample[1], sample[0]])).toThrow(/sorted/);
    expect(() => encodeStars([sample[0], { ...sample[1], hr: 1 }])).toThrow(/repeated/);
    expect(() => encodeStars([{ ...sample[0], parallax: 1024 }])).toThrow(/parallax/);
    expect(() => encodeStars([{ ...sample[0], vmag: 19 }])).toThrow(/V magnitude/);
    expect(() => encodeStars([{ ...sample[0], ra: 360 }])).toThrow(/right ascension/);
  });

  it('turns B-V into a temperature, hot for blue stars and cool for red ones', () => {
    expect(bvToKelvin(0.0)).toBeGreaterThan(9000);
    expect(bvToKelvin(0.65)).toBeCloseTo(5800, -2);
    expect(bvToKelvin(1.5)).toBeLessThan(4000);
    expect(Number.isFinite(bvToKelvin(-2))).toBe(true);
  });
});

describe('public/sky/names.json', () => {
  it('names 150 stars, Sirius first, each by its index in stars.bin', () => {
    expect(names.size).toBe(150);
    expect(names.get(0)).toBe('Sirius');
    expect(names.get(indexOfHr(7001))).toBe('Vega');
    expect(names.get(indexOfHr(5054))).toBe('Mizar');
  });

  it('keys every name by a star index, with plain and distinct names', () => {
    const indexes = [...names.keys()].sort((a, b) => a - b);
    expect(indexes[0]).toBe(0);
    for (const index of indexes) {
      expect(index).toBeLessThan(catalog.count);
      expect(names.get(index)).toMatch(/^\p{L}[\p{L}\p{M}'’ .-]*$/u);
    }
    expect(new Set(names.values()).size).toBe(150);
  });

  it('refuses keys that are not star indexes', () => {
    expect(() => parseStarNames({ x: 'Sirius' }, 10)).toThrow(/not a star index/);
    expect(() => parseStarNames({ 10: 'Sirius' }, 10)).toThrow(/not a star index/);
    expect(() => parseStarNames({ 1: '' }, 10)).toThrow(/short string/);
    expect(() => parseStarNames([], 10)).toThrow(/not an object/);
  });
});

describe('public/sky/ images and credits', () => {
  const webp = (name: string) => {
    const file = fs.readFileSync(path.join(SKY, name));
    expect(file.toString('latin1', 0, 4)).toBe('RIFF');
    expect(file.toString('latin1', 8, 12)).toBe('WEBP');
    return file;
  };

  it('has the Milky Way at 2K under 400 kB and at 4K', () => {
    expect(webp('milkyway-2k.webp').length).toBeLessThan(400_000);
    expect(webp('milkyway-4k.webp').length).toBeGreaterThan(0);
  });

  it('credits every source with its licence and the date checked, with no en or em dash', () => {
    const credits = fs.readFileSync(path.join(SKY, 'CREDITS.md'), 'utf8');
    for (const needle of ['Yale Bright Star Catalogue', 'Hoffleit', 'IAU Catalog of Star Names', 'ESO/S. Brunier', 'https://creativecommons.org/licenses/by/4.0/', '2026-11-18']) {
      expect(credits).toContain(needle);
    }
    expect(credits).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
  });
});
