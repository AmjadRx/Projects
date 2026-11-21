/**
 * One static instance of a TrueType variable font (OpenType font variations: fvar, avar, gvar).
 * The Open Graph renderer draws only a font's default instance, and Archivo's is weight 600 at
 * width 100, while the site sets headlines at weight 700 and width 118 to 125 (app/styles/), so
 * the images draw from an instance made here, at build time.
 *
 * Each glyph's outline moves by its gvar deltas at the requested position: tuple scalars from the
 * peak and intermediate regions, packed point numbers and deltas, inferred deltas (IUP) for the
 * points a tuple leaves out, and the phantom points, which carry the advance width. The result has
 * no variation tables and no hinting instructions; its kerning is the default instance's.
 */
import { Reader, Writer } from './binary';
import {
  ARGS_ARE_XY_VALUES,
  encodeGlyph,
  joinGlyf,
  parseGlyph,
  pointsBBox,
  splitGlyf,
  type BBox,
  type Glyph,
} from './glyf';
import type { Font } from './sfnt';

export interface Axis {
  tag: string;
  min: number;
  def: number;
  max: number;
}

/** The tables an instance no longer needs: they describe the variation space. */
const VARIATION_TABLES = ['fvar', 'gvar', 'avar', 'cvar', 'HVAR', 'VVAR', 'MVAR', 'STAT'];

function table(font: Font, tag: string): Uint8Array {
  const data = font.tables.get(tag);
  if (!data) throw new Error(`The font has no ${tag} table`);
  return data;
}

export function readAxes(font: Font): Axis[] {
  const fvar = font.tables.get('fvar');
  if (!fvar) return [];
  const r = new Reader(fvar);
  r.pos = 4;
  const axesOffset = r.u16();
  r.u16();
  const axisCount = r.u16();
  const axisSize = r.u16();
  const axes: Axis[] = [];
  for (let i = 0; i < axisCount; i += 1) {
    const a = new Reader(fvar, axesOffset + i * axisSize);
    axes.push({ tag: a.tag(), min: a.fixed(), def: a.fixed(), max: a.fixed() });
  }
  return axes;
}

const toF2dot14 = (value: number) => Math.round(value * 16384) / 16384;

/** The avar segment maps, one list of [from, to] pairs per axis, or null without avar. */
function readAvar(font: Font): [number, number][][] | null {
  const avar = font.tables.get('avar');
  if (!avar) return null;
  const r = new Reader(avar);
  r.pos = 6;
  const axisCount = r.u16();
  const maps: [number, number][][] = [];
  for (let i = 0; i < axisCount; i += 1) {
    const count = r.u16();
    const pairs: [number, number][] = [];
    for (let k = 0; k < count; k += 1) pairs.push([r.f2dot14(), r.f2dot14()]);
    maps.push(pairs);
  }
  return maps;
}

function applySegmentMap(value: number, pairs: [number, number][]): number {
  if (pairs.length < 2) return value;
  if (value <= pairs[0][0]) return pairs[0][1];
  for (let k = 1; k < pairs.length; k += 1) {
    const [from, to] = pairs[k];
    if (value <= from) {
      const [prevFrom, prevTo] = pairs[k - 1];
      if (from === prevFrom) return to;
      return prevTo + ((value - prevFrom) * (to - prevTo)) / (from - prevFrom);
    }
  }
  return pairs[pairs.length - 1][1];
}

/** The normalized position (-1 to 1 on each axis, avar applied) of a user position. */
export function normalize(axes: readonly Axis[], position: Readonly<Record<string, number>>, avar: [number, number][][] | null): number[] {
  return axes.map((axis, i) => {
    const value = Math.min(axis.max, Math.max(axis.min, position[axis.tag] ?? axis.def));
    let n = 0;
    if (value < axis.def) n = (value - axis.def) / (axis.def - axis.min);
    else if (value > axis.def) n = (value - axis.def) / (axis.max - axis.def);
    n = toF2dot14(n);
    if (avar && avar[i]) n = toF2dot14(applySegmentMap(n, avar[i]));
    return n;
  });
}

interface Tuple {
  peak: number[];
  start: number[] | null;
  end: number[] | null;
  /** Point numbers, or null for every point. */
  points: number[] | null;
  dx: number[];
  dy: number[];
}

/** How much a tuple applies at a normalized position (the specification's scalar algorithm). */
export function tupleScalar(coords: readonly number[], peak: readonly number[], start: readonly number[] | null, end: readonly number[] | null): number {
  let scalar = 1;
  for (let i = 0; i < coords.length; i += 1) {
    const p = peak[i];
    if (p === 0) continue;
    const c = coords[i];
    if (c === 0) return 0;
    if (start && end) {
      const s = start[i];
      const e = end[i];
      // An invalid region is ignored on this axis, as the specification asks.
      if (s > p || p > e || (s < 0 && e > 0)) continue;
      if (c < s || c > e) return 0;
      if (c === p) continue;
      scalar *= c < p ? (c - s) / (p - s) : (e - c) / (e - p);
    } else {
      if (c < Math.min(0, p) || c > Math.max(0, p)) return 0;
      scalar *= c / p;
    }
  }
  return scalar;
}

/** Packed point numbers: null means every point. */
function readPoints(r: Reader): number[] | null {
  const first = r.u8();
  if (first === 0) return null;
  const count = first & 0x80 ? ((first & 0x7f) << 8) | r.u8() : first;
  const points: number[] = [];
  let last = 0;
  while (points.length < count) {
    const control = r.u8();
    const run = (control & 0x7f) + 1;
    for (let k = 0; k < run && points.length < count; k += 1) {
      last += control & 0x80 ? r.u16() : r.u8();
      points.push(last);
    }
  }
  return points;
}

function readDeltas(r: Reader, count: number): number[] {
  const deltas: number[] = [];
  while (deltas.length < count) {
    const control = r.u8();
    const run = (control & 0x3f) + 1;
    const kind = control & 0xc0;
    for (let k = 0; k < run; k += 1) {
      if (kind === 0x80) deltas.push(0);
      else if (kind === 0x40) deltas.push(r.i16());
      else if (kind === 0xc0) deltas.push(r.i32());
      else deltas.push(r.i8());
    }
  }
  return deltas.slice(0, count);
}

interface Gvar {
  axisCount: number;
  shared: number[][];
  glyphData(index: number): Uint8Array;
}

function readGvar(font: Font): Gvar {
  const gvar = table(font, 'gvar');
  const r = new Reader(gvar);
  r.pos = 4;
  const axisCount = r.u16();
  const sharedCount = r.u16();
  const sharedOffset = r.u32();
  const glyphCount = r.u16();
  const flags = r.u16();
  const dataOffset = r.u32();
  const offsets: number[] = [];
  for (let i = 0; i <= glyphCount; i += 1) offsets.push(flags & 1 ? r.u32() : r.u16() * 2);
  const shared: number[][] = [];
  const s = new Reader(gvar, sharedOffset);
  for (let i = 0; i < sharedCount; i += 1) {
    const tuple: number[] = [];
    for (let a = 0; a < axisCount; a += 1) tuple.push(s.f2dot14());
    shared.push(tuple);
  }
  return {
    axisCount,
    shared,
    glyphData: (index) => (index < glyphCount ? gvar.subarray(dataOffset + offsets[index], dataOffset + offsets[index + 1]) : new Uint8Array(0)),
  };
}

/** The tuples of one glyph's variation data, with their deltas, for a glyph of `pointCount` points. */
function readTuples(data: Uint8Array, gvar: Gvar, pointCount: number): Tuple[] {
  if (data.byteLength === 0) return [];
  const r = new Reader(data);
  const countWord = r.u16();
  const serialized = new Reader(data, r.u16());
  const sharedPoints = countWord & 0x8000 ? readPoints(serialized) : null;
  const headers: { size: number; peak: number[]; start: number[] | null; end: number[] | null; privatePoints: boolean }[] = [];
  for (let i = 0; i < (countWord & 0x0fff); i += 1) {
    const size = r.u16();
    const index = r.u16();
    const axes = () => Array.from({ length: gvar.axisCount }, () => r.f2dot14());
    const peak = index & 0x8000 ? axes() : gvar.shared[index & 0x0fff];
    if (!peak) throw new Error('gvar: a tuple names a shared tuple that does not exist');
    const intermediate = (index & 0x4000) !== 0;
    const start = intermediate ? axes() : null;
    const end = intermediate ? axes() : null;
    headers.push({ size, peak, start, end, privatePoints: (index & 0x2000) !== 0 });
  }
  return headers.map((h) => {
    const t = serialized.sub(h.size);
    const points = h.privatePoints ? readPoints(t) : sharedPoints;
    const count = points ? points.length : pointCount;
    const dx = readDeltas(t, count);
    const dy = readDeltas(t, count);
    return { peak: h.peak, start: h.start, end: h.end, points, dx, dy };
  });
}

/** An inferred delta for an untouched point between two touched ones (the IUP rule). */
function inferred(p: number, a: number, b: number, da: number, db: number): number {
  if (a === b) return da === db ? da : 0;
  const [lo, hi, dLo, dHi] = a < b ? [a, b, da, db] : [b, a, db, da];
  if (p <= lo) return dLo;
  if (p >= hi) return dHi;
  return dLo + ((p - lo) * (dHi - dLo)) / (hi - lo);
}

/** Fills the deltas of untouched points in each contour from the touched ones, in place. */
function inferContours(endPts: readonly number[], xs: readonly number[], ys: readonly number[], dx: number[], dy: number[], touched: boolean[]): void {
  let start = 0;
  for (const end of endPts) {
    const marked: number[] = [];
    for (let i = start; i <= end; i += 1) if (touched[i]) marked.push(i);
    if (marked.length === 1) {
      for (let i = start; i <= end; i += 1) {
        if (touched[i]) continue;
        dx[i] = dx[marked[0]];
        dy[i] = dy[marked[0]];
      }
    } else if (marked.length > 1) {
      for (let m = 0; m < marked.length; m += 1) {
        const a = marked[m];
        const b = marked[(m + 1) % marked.length];
        // The untouched points after a, walking the contour forward to b.
        for (let i = a === end ? start : a + 1; i !== b; i = i === end ? start : i + 1) {
          dx[i] = inferred(xs[i], xs[a], xs[b], dx[a], dx[b]);
          dy[i] = inferred(ys[i], ys[a], ys[b], dy[a], dy[b]);
        }
      }
    }
    start = end + 1;
  }
}

interface Metrics {
  advances: number[];
  lsbs: number[];
}

function readHmtx(font: Font, numGlyphs: number): Metrics {
  const numHMetrics = new Reader(table(font, 'hhea'), 34).u16();
  const r = new Reader(table(font, 'hmtx'));
  const advances: number[] = [];
  const lsbs: number[] = [];
  for (let i = 0; i < numGlyphs; i += 1) {
    if (i < numHMetrics) advances.push(r.u16());
    else advances.push(advances[numHMetrics - 1]);
    lsbs.push(r.i16());
  }
  return { advances, lsbs };
}

/** The glyph's moved outline, its new advance, and (for composites) its moved component offsets. */
function varyGlyph(glyph: Glyph, metrics: { advance: number; lsb: number }, tuples: Tuple[], coords: number[]): { glyph: Glyph; advance: number } {
  const xMin = glyph.kind === 'empty' ? 0 : glyph.bbox[0];
  const originX = xMin - metrics.lsb;
  const base =
    glyph.kind === 'simple'
      ? { xs: glyph.xs, ys: glyph.ys }
      : glyph.kind === 'composite'
        ? { xs: glyph.components.map((c) => c.arg1), ys: glyph.components.map((c) => c.arg2) }
        : { xs: [] as number[], ys: [] as number[] };
  const n = base.xs.length;
  // The four phantom points: the origin, the advance, and the two vertical ones (unused here).
  const xs = [...base.xs, originX, originX + metrics.advance, 0, 0];
  const ys = [...base.ys, 0, 0, 0, 0];
  const total = n + 4;
  const sumX = new Array<number>(total).fill(0);
  const sumY = new Array<number>(total).fill(0);
  for (const tuple of tuples) {
    const scalar = tupleScalar(coords, tuple.peak, tuple.start, tuple.end);
    if (scalar === 0) continue;
    if (!tuple.points) {
      for (let i = 0; i < total; i += 1) {
        sumX[i] += scalar * tuple.dx[i];
        sumY[i] += scalar * tuple.dy[i];
      }
      continue;
    }
    const dx = new Array<number>(total).fill(0);
    const dy = new Array<number>(total).fill(0);
    const touched = new Array<boolean>(total).fill(false);
    tuple.points.forEach((point, k) => {
      if (point >= total) return;
      dx[point] = tuple.dx[k];
      dy[point] = tuple.dy[k];
      touched[point] = true;
    });
    if (glyph.kind === 'simple') inferContours(glyph.endPts, xs, ys, dx, dy, touched);
    for (let i = 0; i < total; i += 1) {
      sumX[i] += scalar * dx[i];
      sumY[i] += scalar * dy[i];
    }
  }
  const newOrigin = originX + sumX[n];
  const advance = Math.max(0, Math.round(originX + metrics.advance + sumX[n + 1] - newOrigin));
  // Every point moves with the origin back to x = 0, so the left side bearing is the new xMin.
  const moveX = (i: number) => Math.round(xs[i] + sumX[i] - newOrigin);
  const moveY = (i: number) => Math.round(ys[i] + sumY[i]);
  if (glyph.kind === 'simple') {
    const nx = glyph.xs.map((_, i) => moveX(i));
    const ny = glyph.ys.map((_, i) => moveY(i));
    return { glyph: { ...glyph, xs: nx, ys: ny, bbox: pointsBBox(nx, ny) }, advance };
  }
  if (glyph.kind === 'composite') {
    const components = glyph.components.map((c, i) =>
      c.flags & ARGS_ARE_XY_VALUES ? { ...c, arg1: moveX(i), arg2: moveY(i) } : { ...c },
    );
    return { glyph: { ...glyph, components }, advance };
  }
  return { glyph, advance };
}

/** The box of a composite from its components' boxes, moved by their offsets (scales are applied to the corners). */
function compositeBBox(index: number, glyphs: Glyph[], seen = new Set<number>()): BBox {
  const glyph = glyphs[index];
  if (glyph.kind === 'empty') return [0, 0, 0, 0];
  if (glyph.kind === 'simple') return glyph.bbox;
  if (seen.has(index)) throw new Error(`Composite glyph ${index} refers to itself`);
  seen.add(index);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of glyph.components) {
    const child = glyphs[c.glyphIndex];
    if (!child || child.kind === 'empty') continue;
    const [x0, y0, x1, y1] = compositeBBox(c.glyphIndex, glyphs, seen);
    const [a, b, cc, d] =
      c.transform.length === 4 ? c.transform : c.transform.length === 2 ? [c.transform[0], 0, 0, c.transform[1]] : c.transform.length === 1 ? [c.transform[0], 0, 0, c.transform[0]] : [1, 0, 0, 1];
    const dx = c.flags & ARGS_ARE_XY_VALUES ? c.arg1 : 0;
    const dy = c.flags & ARGS_ARE_XY_VALUES ? c.arg2 : 0;
    for (const [x, y] of [
      [x0, y0],
      [x0, y1],
      [x1, y0],
      [x1, y1],
    ]) {
      xs.push(Math.round(a * x + cc * y + dx));
      ys.push(Math.round(b * x + d * y + dy));
    }
  }
  seen.delete(index);
  return pointsBBox(xs, ys);
}

/**
 * A static TrueType font at `position` (user values per axis tag, such as { wght: 700, wdth: 125 };
 * an axis left out stays at its default). A font without fvar and gvar is returned as it is.
 */
export function instantiate(font: Font, position: Readonly<Record<string, number>>): Font {
  const axes = readAxes(font);
  if (axes.length === 0 || !font.tables.has('gvar')) return font;
  const coords = normalize(axes, position, readAvar(font));
  const gvar = readGvar(font);
  const head = table(font, 'head');
  const numGlyphs = new Reader(table(font, 'maxp'), 4).u16();
  const longLoca = new Reader(head, 50).i16() === 1;
  const raw = splitGlyf(table(font, 'glyf'), table(font, 'loca'), numGlyphs, longLoca);
  const metrics = readHmtx(font, numGlyphs);

  const glyphs: Glyph[] = [];
  const advances: number[] = [];
  for (let i = 0; i < numGlyphs; i += 1) {
    const glyph = parseGlyph(raw[i]);
    const points = glyph.kind === 'simple' ? glyph.xs.length : glyph.kind === 'composite' ? glyph.components.length : 0;
    const tuples = readTuples(gvar.glyphData(i), gvar, points + 4);
    const varied = varyGlyph(glyph, { advance: metrics.advances[i], lsb: metrics.lsbs[i] }, tuples, coords);
    glyphs.push(varied.glyph);
    advances.push(varied.advance);
  }
  // Composite boxes follow their components, so they are worked out once every glyph has moved.
  const boxes = glyphs.map((g, i) => (g.kind === 'composite' ? compositeBBox(i, glyphs) : g.kind === 'simple' ? g.bbox : null));
  glyphs.forEach((g, i) => {
    if (g.kind === 'composite') g.bbox = boxes[i]!;
  });

  const { glyf, loca } = joinGlyf(glyphs.map((g) => encodeGlyph(g, false)));
  const hmtx = new Writer();
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  let minLsb = Infinity;
  let minRsb = Infinity;
  let maxExtent = -Infinity;
  for (let i = 0; i < numGlyphs; i += 1) {
    const box = boxes[i];
    const lsb = box ? box[0] : 0;
    hmtx.u16(advances[i]).i16(lsb);
    if (!box) continue;
    xMin = Math.min(xMin, box[0]);
    yMin = Math.min(yMin, box[1]);
    xMax = Math.max(xMax, box[2]);
    yMax = Math.max(yMax, box[3]);
    minLsb = Math.min(minLsb, lsb);
    minRsb = Math.min(minRsb, advances[i] - box[2]);
    maxExtent = Math.max(maxExtent, box[2]);
  }

  const newHead = head.slice();
  const h = new DataView(newHead.buffer);
  if (Number.isFinite(xMin)) [xMin, yMin, xMax, yMax].forEach((v, k) => h.setInt16(36 + k * 2, v));
  h.setInt16(50, 1);
  const newHhea = table(font, 'hhea').slice();
  const hh = new DataView(newHhea.buffer);
  hh.setUint16(10, Math.max(...advances));
  if (Number.isFinite(minLsb)) {
    hh.setInt16(12, minLsb);
    hh.setInt16(14, minRsb);
    hh.setInt16(16, maxExtent);
  }
  hh.setUint16(34, numGlyphs);

  const tables = new Map(font.tables);
  for (const tag of VARIATION_TABLES) tables.delete(tag);
  tables.set('glyf', glyf);
  tables.set('loca', loca);
  tables.set('hmtx', hmtx.toBytes());
  tables.set('head', newHead);
  tables.set('hhea', newHhea);
  return { flavor: font.flavor, tables };
}
