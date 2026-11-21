/**
 * The sky's star catalogue (ARCHITECTURE.md 6A): the format of public/sky/stars.bin, its encoder
 * (used by scripts/build-sky.mjs) and its decoder (used by the sky in a page or a worker, and by
 * the tests). Plain TypeScript with no imports: no three.js, no DOM, nothing but ArrayBuffer and
 * DataView, so the same file runs in a browser, a worker, Vitest, and Node's type stripping.
 *
 * The data are the Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren 1991,
 * CDS VizieR catalogue V/50): the 9,096 entries that are stars with positions (the other 14 are
 * novae, star clusters and one galaxy, kept only for their numbers). Records are sorted brightest
 * first (V ascending, then HR), so a tier takes a prefix: countBrighterThan(catalog, limit) stars.
 * One star, the recurrent nova T CrB, carries its usual brightness from the catalogue's remarks
 * rather than its 1946 outburst, so it sorts last. Sources, licences and changes:
 * public/sky/CREDITS.md.
 *
 * Layout, little-endian throughout.
 *
 *   Header, 12 bytes:
 *     bytes 0 to 3    magic, the ASCII letters "STAR"
 *     bytes 4 to 5    uint16, format version (STARS_VERSION)
 *     bytes 6 to 7    uint16, record size in bytes (STAR_RECORD_SIZE, 12)
 *     bytes 8 to 11   uint32, number of records
 *
 *   Records from byte 12, 12 bytes each, three uint32 words:
 *     word 0, bits 0 to 21    right ascension J2000, code * 360 / 2^22 degrees (step 0.31 arcsec)
 *     word 0, bits 22 to 31   parallax in milliarcseconds, 0 when unknown (catalogue step: 1 mas)
 *     word 1, bits 0 to 20    declination J2000, code * 180 / (2^21 - 1) - 90 degrees (step 0.31 arcsec)
 *     word 1, bits 21 to 30   B-V color index, code / 100 - 0.5 magnitudes (catalogue step: 0.01)
 *     word 1, bit 31          1 when B-V is an estimate because the catalogue gives none
 *     word 2, bits 0 to 10    V magnitude, code / 100 - 1.5 (catalogue step: 0.01)
 *     word 2, bits 11 to 24   HR number, the catalogue's own number (Harvard Revised)
 *     word 2, bit 25          1 when the parallax is dynamical rather than trigonometric
 *     word 2, bits 26 to 31   reserved, 0
 *
 * Rounding to the nearest code moves no star by more than 0.22 arcsec, and decoding to 32-bit
 * floats by at most 0.06 arcsec more (the catalogue itself gives positions to about 1 arcsec);
 * V, B-V and parallax stay exact.
 */

/** Format version written in the header. A reader refuses any other. */
export const STARS_VERSION = 1;
/** Bytes in the header. */
export const STARS_HEADER_SIZE = 12;
/** Bytes in one record. */
export const STAR_RECORD_SIZE = 12;
/** The four magic bytes, the ASCII letters S, T, A, R. */
const MAGIC = [0x53, 0x54, 0x41, 0x52] as const;

/** Where the sky's data are served (files in public/sky/). */
export const STARS_PATH = '/sky/stars.bin';
export const STAR_NAMES_PATH = '/sky/names.json';

/** Bit in StarCatalog.flags: B-V is an estimate (see scripts/build-sky.mjs). */
export const STAR_FLAG_BV_ESTIMATED = 1;
/** Bit in StarCatalog.flags: the parallax is dynamical (catalogue flag D), not trigonometric. */
export const STAR_FLAG_PARALLAX_DYNAMICAL = 2;

const RA_BITS = 22;
const DEC_BITS = 21;
const VMAG_BITS = 11;
const RA_CODES = 2 ** RA_BITS;
const DEC_MAX_CODE = 2 ** DEC_BITS - 1;
const TEN_BITS = 0x3ff;
const VMAG_MAX_CODE = 2 ** VMAG_BITS - 1;
const HR_MAX = 0x3fff;
const VMAG_OFFSET = 1.5;
const BV_OFFSET = 0.5;

/** One star as the encoder takes it. */
export interface StarRecord {
  /** Right ascension, J2000, degrees, 0 to under 360. */
  ra: number;
  /** Declination, J2000, degrees, -90 to 90. */
  dec: number;
  /** V magnitude, -1.5 to 18.97. */
  vmag: number;
  /** B-V color index in magnitudes, -0.5 to 9.73. */
  bv: number;
  /** True when bv is an estimate because the catalogue gives none. */
  bvEstimated: boolean;
  /** Parallax in milliarcseconds, 0 to 1023; 0 when unknown. */
  parallax: number;
  /** True when the parallax is dynamical rather than trigonometric. */
  parallaxDynamical: boolean;
  /** HR number, 1 to 16383. */
  hr: number;
}

/** The decoded catalogue: one typed array per field, index i is the i-th brightest star. */
export interface StarCatalog {
  readonly count: number;
  /** Right ascension, J2000, degrees. */
  readonly ra: Float32Array;
  /** Declination, J2000, degrees. */
  readonly dec: Float32Array;
  /** V magnitude. */
  readonly vmag: Float32Array;
  /** B-V color index, magnitudes. */
  readonly bv: Float32Array;
  /** Parallax in milliarcseconds; 0 when unknown. */
  readonly parallax: Float32Array;
  /** HR number. */
  readonly hr: Uint16Array;
  /** STAR_FLAG_BV_ESTIMATED and STAR_FLAG_PARALLAX_DYNAMICAL. */
  readonly flags: Uint8Array;
}

function fail(message: string): never {
  throw new Error(`stars.bin: ${message}`);
}

function code(value: number, scale: number, offset: number, max: number, what: string, hr: number): number {
  const c = Math.round((value + offset) * scale);
  if (!Number.isFinite(value) || c < 0 || c > max) fail(`HR ${hr}: ${what} ${value} is outside the format's range`);
  return c;
}

/**
 * Encodes stars into the binary format above. The stars must already be sorted by V magnitude,
 * brightest first; HR numbers must be unique.
 */
export function encodeStars(stars: readonly StarRecord[]): Uint8Array {
  const bytes = new Uint8Array(STARS_HEADER_SIZE + stars.length * STAR_RECORD_SIZE);
  const view = new DataView(bytes.buffer);
  MAGIC.forEach((b, i) => view.setUint8(i, b));
  view.setUint16(4, STARS_VERSION, true);
  view.setUint16(6, STAR_RECORD_SIZE, true);
  view.setUint32(8, stars.length, true);
  const seen = new Set<number>();
  let previous = -Infinity;
  stars.forEach((s, i) => {
    if (!Number.isInteger(s.hr) || s.hr < 1 || s.hr > HR_MAX || seen.has(s.hr)) fail(`record ${i}: HR ${s.hr} is missing, out of range, or repeated`);
    seen.add(s.hr);
    if (!(s.vmag >= previous)) fail(`record ${i}: HR ${s.hr} is not sorted by V magnitude`);
    previous = s.vmag;
    if (!(s.ra >= 0 && s.ra < 360)) fail(`HR ${s.hr}: right ascension ${s.ra} is outside 0 to 360`);
    const ra = Math.round((s.ra / 360) * RA_CODES) % RA_CODES;
    const dec = code(s.dec, DEC_MAX_CODE / 180, 90, DEC_MAX_CODE, 'declination', s.hr);
    const plx = code(s.parallax, 1, 0, TEN_BITS, 'parallax', s.hr);
    const bv = code(s.bv, 100, BV_OFFSET, TEN_BITS, 'B-V', s.hr);
    const vmag = code(s.vmag, 100, VMAG_OFFSET, VMAG_MAX_CODE, 'V magnitude', s.hr);
    const at = STARS_HEADER_SIZE + i * STAR_RECORD_SIZE;
    view.setUint32(at, (ra | (plx << RA_BITS)) >>> 0, true);
    view.setUint32(at + 4, (dec | (bv << DEC_BITS) | ((s.bvEstimated ? 1 : 0) << 31)) >>> 0, true);
    view.setUint32(at + 8, (vmag | (s.hr << VMAG_BITS) | ((s.parallaxDynamical ? 1 : 0) << 25)) >>> 0, true);
  });
  return bytes;
}

/** Decodes public/sky/stars.bin. Throws on a file that is not exactly this format. */
export function decodeStars(data: ArrayBuffer | ArrayBufferView): StarCatalog {
  const view = ArrayBuffer.isView(data) ? new DataView(data.buffer, data.byteOffset, data.byteLength) : new DataView(data);
  if (view.byteLength < STARS_HEADER_SIZE) fail('shorter than its header');
  if (MAGIC.some((b, i) => view.getUint8(i) !== b)) fail('not a star file (wrong magic bytes)');
  const version = view.getUint16(4, true);
  if (version !== STARS_VERSION) fail(`format version ${version}, expected ${STARS_VERSION}`);
  const recordSize = view.getUint16(6, true);
  if (recordSize !== STAR_RECORD_SIZE) fail(`record size ${recordSize}, expected ${STAR_RECORD_SIZE}`);
  const count = view.getUint32(8, true);
  if (view.byteLength !== STARS_HEADER_SIZE + count * STAR_RECORD_SIZE) fail(`${view.byteLength} bytes do not hold ${count} records`);

  const catalog: StarCatalog = {
    count,
    ra: new Float32Array(count),
    dec: new Float32Array(count),
    vmag: new Float32Array(count),
    bv: new Float32Array(count),
    parallax: new Float32Array(count),
    hr: new Uint16Array(count),
    flags: new Uint8Array(count),
  };
  for (let i = 0; i < count; i += 1) {
    const at = STARS_HEADER_SIZE + i * STAR_RECORD_SIZE;
    const w0 = view.getUint32(at, true);
    const w1 = view.getUint32(at + 4, true);
    const w2 = view.getUint32(at + 8, true);
    catalog.ra[i] = ((w0 & (RA_CODES - 1)) * 360) / RA_CODES;
    catalog.parallax[i] = w0 >>> RA_BITS;
    catalog.dec[i] = ((w1 & DEC_MAX_CODE) * 180) / DEC_MAX_CODE - 90;
    catalog.bv[i] = ((w1 >>> DEC_BITS) & TEN_BITS) / 100 - BV_OFFSET;
    catalog.vmag[i] = (w2 & VMAG_MAX_CODE) / 100 - VMAG_OFFSET;
    catalog.hr[i] = (w2 >>> VMAG_BITS) & HR_MAX;
    catalog.flags[i] = (w1 >>> 31 ? STAR_FLAG_BV_ESTIMATED : 0) | ((w2 >>> 25) & 1 ? STAR_FLAG_PARALLAX_DYNAMICAL : 0);
  }
  return catalog;
}

/**
 * How many stars have V magnitude `limit` or brighter: the length of the prefix a tier draws
 * (the Light tier's limit lives in lib/motion.ts). The catalogue is sorted, so this is a binary
 * search.
 */
export function countBrighterThan(catalog: Pick<StarCatalog, 'count' | 'vmag'>, limit: number): number {
  const bound = Math.fround(limit);
  let lo = 0;
  let hi = catalog.count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (catalog.vmag[mid] <= bound) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Effective temperature in kelvin from the B-V color index, by the black-body fit of
 * Ballesteros (2012, EPL 97, 34008): T = 4600 (1 / (0.92 B-V + 1.7) + 1 / (0.92 B-V + 0.62)).
 * The result feeds the temperature-to-color formula of the sky renderer (starRGB in the design
 * bundle's reference). B-V is held at -0.4 or more, where the formula stays finite.
 */
export function bvToKelvin(bv: number): number {
  const b = Math.max(-0.4, bv);
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

/**
 * Reads public/sky/names.json: an object whose keys are indexes into the catalogue and whose
 * values are IAU star names. Only named stars have keys. Throws on anything else.
 */
export function parseStarNames(value: unknown, count: number): Map<number, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('names.json: not an object');
  const names = new Map<number, string>();
  for (const [key, name] of Object.entries(value)) {
    const index = /^(0|[1-9]\d*)$/.test(key) ? Number(key) : -1;
    if (index < 0 || index >= count) throw new Error(`names.json: key ${key} is not a star index`);
    if (typeof name !== 'string' || !name.trim() || name.length > 40) throw new Error(`names.json: the name of star ${key} is not a short string`);
    names.set(index, name);
  }
  return names;
}
