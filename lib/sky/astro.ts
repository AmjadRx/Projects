/**
 * The sky's astronomy, as the design bundle's reference renderer (the Sky component) computes it:
 * time to sidereal time, equatorial to horizontal coordinates and back, the stereographic
 * projection of the view, airmass and extinction, the galactic rotation, star color from B-V, and
 * depth from parallax. The WebGL scene, the still renderer, the catalogue build script and the
 * tests share this one implementation; the shaders repeat its per-star and per-pixel parts in GLSL.
 *
 * Pure TypeScript: no DOM, no three.js and no imports, so a Node script can load this file
 * directly. Design numbers (the extinction per airmass, the depth scale) come in as arguments,
 * from SKY in lib/motion.ts. Angles are in degrees unless a name says radians. Positions are J2000,
 * the catalogue's epoch, and the sky is drawn without precession, as the reference draws it.
 * tests/sky-astro.test.ts checks this file against values from outside it.
 */

const RAD = Math.PI / 180;

/** Milliseconds in a day. */
export const DAY_MS = 86_400_000;
/** 2000 January 1, 12:00 UTC (J2000.0, Julian date 2451545.0), in Unix milliseconds. */
export const J2000_MS = 946_728_000_000;
/** The Julian date of the Unix epoch, 1970 January 1, 00:00 UTC. */
export const UNIX_EPOCH_JD = 2_440_587.5;
/** Greenwich mean sidereal time at J2000.0, in degrees (Meeus, Astronomical Algorithms, 12.4). */
export const GMST_J2000_DEG = 280.46061837;
/** The mean sidereal rate: degrees of sidereal time per day of universal time (Meeus 12.4). */
export const SIDEREAL_DEG_PER_DAY = 360.98564736629;

/** An angle in degrees, into [0, 360). */
export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** An angle in degrees, into [-180, 180). */
export function wrap180(deg: number): number {
  return wrap360(deg + 180) - 180;
}

/** The Julian date of a moment given in Unix milliseconds. */
export function julianDate(ms: number): number {
  return ms / DAY_MS + UNIX_EPOCH_JD;
}

/**
 * Greenwich mean sidereal time in degrees, in [0, 360), for a moment in Unix milliseconds. This is
 * Meeus 12.4 without its quadratic and cubic terms (under 2 arcseconds this century), as the
 * reference computes it, with the days counted from J2000.0 directly for precision.
 */
export function gmstDeg(ms: number): number {
  return wrap360(GMST_J2000_DEG + SIDEREAL_DEG_PER_DAY * ((ms - J2000_MS) / DAY_MS));
}

/** Local mean sidereal time in degrees, in [0, 360), at a longitude in degrees east (west is negative). */
export function lstDeg(ms: number, lonDeg: number): number {
  return wrap360(gmstDeg(ms) + lonDeg);
}

/**
 * Equatorial to horizontal coordinates, as the reference: [altitude, azimuth] in degrees, the
 * azimuth from north through east in [0, 360), for right ascension and declination seen at a local
 * sidereal time and a latitude.
 */
export function toHorizontal(raDeg: number, decDeg: number, lst: number, latDeg: number): [number, number] {
  const H = (lst - raDeg) * RAD;
  const d = decDeg * RAD;
  const p = latDeg * RAD;
  const sinAlt = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(p) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(H));
  return [alt / RAD, wrap360(az / RAD)];
}

/**
 * Horizontal to equatorial coordinates, the inverse of `toHorizontal` (the reference uses it to map
 * the Milky Way): [right ascension in [0, 360), declination], in degrees.
 */
export function toEquatorial(altDeg: number, azDeg: number, lst: number, latDeg: number): [number, number] {
  const a = altDeg * RAD;
  const A = azDeg * RAD;
  const p = latDeg * RAD;
  const sinD = Math.sin(a) * Math.sin(p) + Math.cos(a) * Math.cos(p) * Math.cos(A);
  const d = Math.asin(Math.max(-1, Math.min(1, sinD)));
  const H = Math.atan2(-Math.sin(A) * Math.cos(a), Math.sin(a) * Math.cos(p) - Math.cos(a) * Math.sin(p) * Math.cos(A));
  return [wrap360(lst - H / RAD), d / RAD];
}

/**
 * The three bounds of `projScale`, as px of scale per px of the view: `top` per px of the
 * horizon's height (60 degrees of sky above the horizon at the top edge, SKY.altitudeTop, hence 30
 * degrees here), `wide` per px of width (45 degrees of azimuth on each side of the centre), and
 * `cap` per px of the horizon's height (never more than 85 degrees of altitude). The page's CSS
 * repeats projScale with these numbers to place the still image (components/sky/Sky.tsx).
 */
export const PROJECTION = {
  top: 1 / (2 * Math.tan(30 * RAD)),
  wide: 1 / (4 * Math.tan(22.5 * RAD)),
  cap: 1 / (2 * Math.tan(42.5 * RAD)),
} as const;

/**
 * The scale `k` of the stereographic projection, in px, exactly as the reference: wide screens show
 * 60 degrees of sky above the horizon (SKY.altitudeTop, hence the 30 degrees here); narrower ones
 * keep 45 degrees of azimuth on each side of the centre, but never show more than 85 degrees of
 * altitude. `width` is the viewport's width and `horizonY` the horizon's distance from the top.
 */
export function projScale(width: number, horizonY: number): number {
  const top60 = horizonY / (2 * Math.tan(30 * RAD));
  const wide = width / (4 * Math.tan(22.5 * RAD));
  const top85 = horizonY / (2 * Math.tan(42.5 * RAD));
  return Math.min(top60, Math.max(wide, top85));
}

/**
 * The stereographic projection centred on the horizon at the view's azimuth, exactly as the
 * reference: altitude and azimuth from the centre (both in radians) to [x, y] in px from the
 * horizon's centre point, x to the right and y up. Null for points too far behind the viewer.
 */
export function project(alt: number, dAz: number, k: number): [number, number] | null {
  const cosc = Math.cos(alt) * Math.cos(dAz);
  if (cosc <= 0.02) return null;
  const s = (2 * k) / (1 + cosc);
  return [s * Math.cos(alt) * Math.sin(dAz), s * Math.sin(alt)];
}

/**
 * The inverse of `project`, as the reference maps each Milky Way pixel: [x, y] in px from the
 * horizon's centre point (y up) to [altitude, azimuth from the centre], both in radians.
 */
export function unproject(x: number, y: number, k: number): [number, number] {
  const rho = Math.hypot(x, y);
  const c = 2 * Math.atan(rho / (2 * k));
  const alt = rho ? Math.asin(Math.max(-1, Math.min(1, (y * Math.sin(c)) / rho))) : 0;
  return [alt, Math.atan2(x * Math.sin(c), rho * Math.cos(c))];
}

/** Airmass at an altitude in degrees (Kasten and Young, 1989), as the reference; the horizon below 0. */
export function airmass(altDeg: number): number {
  const h = Math.max(0, altDeg);
  return 1 / (Math.sin(h * RAD) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/**
 * Dimming in magnitudes at an altitude, relative to the zenith, for `perAirmass` magnitudes of
 * extinction per airmass (SKY.extinction), as the reference.
 */
export function extinctionMag(altDeg: number, perAirmass: number): number {
  return perAirmass * (airmass(altDeg) - 1);
}

/**
 * The rotation from J2000 equatorial to galactic coordinates, as rows (the reference's `GAL`):
 * galactic = GAL x equatorial, for unit vectors. Its inverse is its transpose. A GLSL mat3 is
 * filled column by column, so a shader takes the transpose of these rows to apply GAL.
 */
export const GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
] as const;

/** Equatorial (J2000) to galactic coordinates: [longitude l in [0, 360), latitude b], in degrees. */
export function equatorialToGalactic(raDeg: number, decDeg: number): [number, number] {
  const ra = raDeg * RAD;
  const d = decDeg * RAD;
  const x = Math.cos(d) * Math.cos(ra);
  const y = Math.cos(d) * Math.sin(ra);
  const z = Math.sin(d);
  const xg = GAL[0][0] * x + GAL[0][1] * y + GAL[0][2] * z;
  const yg = GAL[1][0] * x + GAL[1][1] * y + GAL[1][2] * z;
  const zg = GAL[2][0] * x + GAL[2][1] * y + GAL[2][2] * z;
  return [wrap360(Math.atan2(yg, xg) / RAD), Math.asin(Math.max(-1, Math.min(1, zg))) / RAD];
}

/** Galactic to equatorial (J2000) coordinates, through the transpose of GAL: [ra in [0, 360), dec], in degrees. */
export function galacticToEquatorial(lDeg: number, bDeg: number): [number, number] {
  const l = lDeg * RAD;
  const b = bDeg * RAD;
  const xg = Math.cos(b) * Math.cos(l);
  const yg = Math.cos(b) * Math.sin(l);
  const zg = Math.sin(b);
  const x = GAL[0][0] * xg + GAL[1][0] * yg + GAL[2][0] * zg;
  const y = GAL[0][1] * xg + GAL[1][1] * yg + GAL[2][1] * zg;
  const z = GAL[0][2] * xg + GAL[1][2] * yg + GAL[2][2] * zg;
  return [wrap360(Math.atan2(y, x) / RAD), Math.asin(Math.max(-1, Math.min(1, z))) / RAD];
}

/**
 * Where a galactic direction falls on the all-sky panorama, as the reference reads the ESO
 * photograph: [u, v] from the top left, each in [0, 1], with the galactic centre in the middle and
 * longitude growing to the left.
 */
export function galacticToPanorama(lDeg: number, bDeg: number): [number, number] {
  const u = 0.5 - lDeg / 360;
  return [u - Math.floor(u), 0.5 - bDeg / 180];
}

/** B-V below this is bluer than any catalogue star, and the temperature formula breaks near -0.67. */
const BV_BLUEST = -0.4;

/**
 * A star's temperature in kelvin from its B-V color index (Ballesteros, 2012, EPL 97, 34008):
 * T = 4600 (1 / (0.92 BV + 1.7) + 1 / (0.92 BV + 0.62)). B-V under -0.4 is read as -0.4. NaN when
 * the index is unknown, which `starRGB` shows as a neutral white.
 */
export function bvToKelvin(bv: number): number {
  const c = Math.max(BV_BLUEST, bv);
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
}

/** How far the reference mixes each star's color toward white, so the colors stay subtle. */
export const STAR_WHITE_MIX = 0.45;

/** The temperature `starRGB` uses when a star's is unknown: a neutral white. */
const NEUTRAL_KELVIN = 6500;

/**
 * A star's color from its temperature, exactly as the reference's `starRGB`: the blackbody fit
 * by Tanner Helland (1,000 K to 40,000 K), mixed 45% toward white, as [r, g, b] integers from 0
 * to 255. Star colors are data, not tokens.
 */
export function starRGB(kelvin: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, Number.isFinite(kelvin) ? kelvin : NEUTRAL_KELVIN)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const mix = (v: number) => Math.round(Math.max(0, Math.min(255, v)) * (1 - STAR_WHITE_MIX) + 255 * STAR_WHITE_MIX);
  return [mix(r), mix(g), mix(b)];
}

/** How parallax maps to depth (SKY.parallax.depth in lib/motion.ts). */
export type DepthScale = {
  /** A parallax at or above this, in milliarcseconds, is depth 1: the nearest stars. */
  readonly nearMas: number;
  /** No star is shallower than this depth. */
  readonly min: number;
};

/**
 * A star's parallax depth from its trigonometric parallax in milliarcseconds, as the reference:
 * near stars 1, far ones down to `scale.min`. An unknown, zero or negative parallax is the far
 * end, `scale.min`.
 */
export function depthFromParallax(parallaxMas: number, scale: DepthScale): number {
  if (!(parallaxMas > 0)) return scale.min;
  return Math.max(scale.min, Math.min(1, parallaxMas / scale.nearMas));
}
