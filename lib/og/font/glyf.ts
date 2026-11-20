/**
 * TrueType glyph outlines (the `glyf` table): parsed into points or components, and written back.
 * The written form drops hinting instructions only where a caller asks (the Open Graph images are
 * drawn from outlines, never hinted), and always writes each coordinate in full rather than with
 * repeated flags, which every reader accepts.
 */
import { Reader, Writer } from './binary';

/** Simple-glyph flag bits. */
export const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;
export const OVERLAP_SIMPLE = 0x40;

/** Composite-glyph flag bits. */
export const ARG_1_AND_2_ARE_WORDS = 0x0001;
export const ARGS_ARE_XY_VALUES = 0x0002;
export const WE_HAVE_A_SCALE = 0x0008;
export const MORE_COMPONENTS = 0x0020;
export const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
export const WE_HAVE_A_TWO_BY_TWO = 0x0080;
export const WE_HAVE_INSTRUCTIONS = 0x0100;

export type BBox = [xMin: number, yMin: number, xMax: number, yMax: number];

export interface EmptyGlyph {
  kind: 'empty';
}

export interface SimpleGlyph {
  kind: 'simple';
  /** The index of the last point of each contour. */
  endPts: number[];
  xs: number[];
  ys: number[];
  onCurve: boolean[];
  /** The OVERLAP_SIMPLE flag of the first point, kept as given. */
  overlap: boolean;
  instructions: Uint8Array;
  bbox: BBox;
}

export interface Component {
  /** The flags as stored, with MORE_COMPONENTS and WE_HAVE_INSTRUCTIONS left for the writer to set. */
  flags: number;
  glyphIndex: number;
  /** An x and y offset when ARGS_ARE_XY_VALUES is set, else two point numbers. */
  arg1: number;
  arg2: number;
  /** The scale or 2 by 2 matrix in 2.14 numbers: 1, 2, or 4 values, or none. */
  transform: number[];
}

export interface CompositeGlyph {
  kind: 'composite';
  components: Component[];
  instructions: Uint8Array;
  bbox: BBox;
}

export type Glyph = EmptyGlyph | SimpleGlyph | CompositeGlyph;

function transformSize(flags: number): number {
  if (flags & WE_HAVE_A_SCALE) return 1;
  if (flags & WE_HAVE_AN_X_AND_Y_SCALE) return 2;
  if (flags & WE_HAVE_A_TWO_BY_TWO) return 4;
  return 0;
}

/** Reads the composite records at the reader's position; returns them and whether instructions follow. */
export function readComponents(r: Reader): { components: Component[]; hasInstructions: boolean } {
  const components: Component[] = [];
  let hasInstructions = false;
  let flags: number;
  do {
    flags = r.u16();
    const glyphIndex = r.u16();
    let arg1: number;
    let arg2: number;
    const xy = (flags & ARGS_ARE_XY_VALUES) !== 0;
    if (flags & ARG_1_AND_2_ARE_WORDS) {
      arg1 = xy ? r.i16() : r.u16();
      arg2 = xy ? r.i16() : r.u16();
    } else {
      arg1 = xy ? r.i8() : r.u8();
      arg2 = xy ? r.i8() : r.u8();
    }
    const transform: number[] = [];
    for (let i = 0; i < transformSize(flags); i += 1) transform.push(r.f2dot14());
    if (flags & WE_HAVE_INSTRUCTIONS) hasInstructions = true;
    components.push({ flags: flags & ~(MORE_COMPONENTS | WE_HAVE_INSTRUCTIONS), glyphIndex, arg1, arg2, transform });
  } while (flags & MORE_COMPONENTS);
  return { components, hasInstructions };
}

export function parseGlyph(data: Uint8Array): Glyph {
  if (data.byteLength === 0) return { kind: 'empty' };
  const r = new Reader(data);
  const contours = r.i16();
  const bbox: BBox = [r.i16(), r.i16(), r.i16(), r.i16()];
  if (contours < 0) {
    const { components, hasInstructions } = readComponents(r);
    const instructions = hasInstructions ? r.bytes(r.u16()) : new Uint8Array(0);
    return { kind: 'composite', components, instructions, bbox };
  }
  const endPts: number[] = [];
  for (let i = 0; i < contours; i += 1) endPts.push(r.u16());
  const instructions = r.bytes(r.u16());
  const count = contours === 0 ? 0 : endPts[contours - 1] + 1;
  const flags: number[] = [];
  while (flags.length < count) {
    const flag = r.u8();
    flags.push(flag);
    if (flag & REPEAT) {
      const repeat = r.u8();
      for (let i = 0; i < repeat; i += 1) flags.push(flag);
    }
  }
  const xs: number[] = [];
  let x = 0;
  for (const flag of flags) {
    if (flag & X_SHORT) x += flag & X_SAME_OR_POSITIVE ? r.u8() : -r.u8();
    else if (!(flag & X_SAME_OR_POSITIVE)) x += r.i16();
    xs.push(x);
  }
  const ys: number[] = [];
  let y = 0;
  for (const flag of flags) {
    if (flag & Y_SHORT) y += flag & Y_SAME_OR_POSITIVE ? r.u8() : -r.u8();
    else if (!(flag & Y_SAME_OR_POSITIVE)) y += r.i16();
    ys.push(y);
  }
  return {
    kind: 'simple',
    endPts,
    xs,
    ys,
    onCurve: flags.map((f) => (f & ON_CURVE) !== 0),
    overlap: flags.length > 0 && (flags[0] & OVERLAP_SIMPLE) !== 0,
    instructions,
    bbox,
  };
}

/** The bounding box of points, or zeros for none. */
export function pointsBBox(xs: readonly number[], ys: readonly number[]): BBox {
  if (xs.length === 0) return [0, 0, 0, 0];
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    if (xs[i] < xMin) xMin = xs[i];
    if (xs[i] > xMax) xMax = xs[i];
    if (ys[i] < yMin) yMin = ys[i];
    if (ys[i] > yMax) yMax = ys[i];
  }
  return [xMin, yMin, xMax, yMax];
}

function writeSimple(w: Writer, glyph: SimpleGlyph, bbox: BBox, keepInstructions: boolean): void {
  w.i16(glyph.endPts.length);
  for (const v of bbox) w.i16(v);
  for (const end of glyph.endPts) w.u16(end);
  const instructions = keepInstructions ? glyph.instructions : new Uint8Array(0);
  w.u16(instructions.byteLength).bytes(instructions);
  const flags: number[] = [];
  const xBytes = new Writer();
  const yBytes = new Writer();
  let px = 0;
  let py = 0;
  for (let i = 0; i < glyph.xs.length; i += 1) {
    let flag = glyph.onCurve[i] ? ON_CURVE : 0;
    if (i === 0 && glyph.overlap) flag |= OVERLAP_SIMPLE;
    const dx = glyph.xs[i] - px;
    const dy = glyph.ys[i] - py;
    px = glyph.xs[i];
    py = glyph.ys[i];
    if (dx === 0) flag |= X_SAME_OR_POSITIVE;
    else if (dx >= -255 && dx <= 255) {
      flag |= X_SHORT | (dx > 0 ? X_SAME_OR_POSITIVE : 0);
      xBytes.u8(Math.abs(dx));
    } else xBytes.i16(dx);
    if (dy === 0) flag |= Y_SAME_OR_POSITIVE;
    else if (dy >= -255 && dy <= 255) {
      flag |= Y_SHORT | (dy > 0 ? Y_SAME_OR_POSITIVE : 0);
      yBytes.u8(Math.abs(dy));
    } else yBytes.i16(dy);
    flags.push(flag);
  }
  for (const flag of flags) w.u8(flag);
  w.bytes(xBytes.toBytes()).bytes(yBytes.toBytes());
}

function writeComposite(w: Writer, glyph: CompositeGlyph, keepInstructions: boolean): void {
  const instructions = keepInstructions ? glyph.instructions : new Uint8Array(0);
  w.i16(-1);
  for (const v of glyph.bbox) w.i16(v);
  glyph.components.forEach((c, i) => {
    let flags = c.flags | ARG_1_AND_2_ARE_WORDS;
    if (i < glyph.components.length - 1) flags |= MORE_COMPONENTS;
    if (i === glyph.components.length - 1 && instructions.byteLength > 0) flags |= WE_HAVE_INSTRUCTIONS;
    w.u16(flags).u16(c.glyphIndex);
    if (flags & ARGS_ARE_XY_VALUES) w.i16(c.arg1).i16(c.arg2);
    else w.u16(c.arg1).u16(c.arg2);
    for (const value of c.transform) w.i16(Math.round(value * 16384));
  });
  if (instructions.byteLength > 0) w.u16(instructions.byteLength).bytes(instructions);
}

/**
 * Writes one glyph in the `glyf` format. A simple glyph's box is computed from its points; a
 * composite keeps the box it carries.
 */
export function encodeGlyph(glyph: Glyph, keepInstructions = true): Uint8Array {
  if (glyph.kind === 'empty') return new Uint8Array(0);
  const w = new Writer();
  if (glyph.kind === 'simple') writeSimple(w, glyph, pointsBBox(glyph.xs, glyph.ys), keepInstructions);
  else writeComposite(w, glyph, keepInstructions);
  return w.toBytes();
}

/** Every glyph's bytes from `glyf` and `loca` (short or long offsets, per head.indexToLocFormat). */
export function splitGlyf(glyf: Uint8Array, loca: Uint8Array, numGlyphs: number, longOffsets: boolean): Uint8Array[] {
  const r = new Reader(loca);
  const offsets: number[] = [];
  for (let i = 0; i <= numGlyphs; i += 1) offsets.push(longOffsets ? r.u32() : r.u16() * 2);
  const glyphs: Uint8Array[] = [];
  for (let i = 0; i < numGlyphs; i += 1) {
    const start = offsets[i];
    const end = offsets[i + 1];
    if (end < start || end > glyf.byteLength) throw new Error(`Glyph ${i} lies outside the glyf table`);
    glyphs.push(glyf.subarray(start, end));
  }
  return glyphs;
}

/** Joins glyphs into a `glyf` table with long `loca` offsets, each glyph padded to four bytes. */
export function joinGlyf(glyphs: readonly Uint8Array[]): { glyf: Uint8Array; loca: Uint8Array } {
  const glyf = new Writer();
  const loca = new Writer();
  for (const glyph of glyphs) {
    loca.u32(glyf.length);
    glyf.bytes(glyph).pad(4);
  }
  loca.u32(glyf.length);
  return { glyf: glyf.toBytes(), loca: loca.toBytes() };
}
