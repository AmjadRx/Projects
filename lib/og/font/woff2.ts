/**
 * WOFF2 to OpenType (W3C WOFF File Format 2.0): the table directory, the one Brotli stream, and
 * the transformed `glyf`, `loca`, and `hmtx` tables rebuilt in their plain form. The Open Graph
 * renderer (satori, inside next/og) reads TrueType, OpenType, and WOFF, but not WOFF2, which is
 * the form the site's fonts are kept in (app/fonts/), so the images decode them here, at build
 * time. Font collections are not supported; the site has none.
 */
import { brotliDecompressSync } from 'node:zlib';
import { Reader, Writer } from './binary';
import { encodeGlyph, joinGlyf, pointsBBox, readComponents, type BBox, type CompositeGlyph, type SimpleGlyph } from './glyf';
import type { Font } from './sfnt';

/** The 63 table tags a WOFF2 directory names by index (the specification's Table 3). */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
  'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

const SIGNATURE = 0x774f4632;
const COLLECTION = 0x74746366;

/** A UIntBase128 number: up to five bytes of seven bits, no leading zero byte. */
function base128(r: Reader): number {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = r.u8();
    if (i === 0 && byte === 0x80) throw new Error('WOFF2: a number starts with a zero byte');
    if (value & 0xfe000000) throw new Error('WOFF2: a number overflows 32 bits');
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return value >>> 0;
  }
  throw new Error('WOFF2: a number runs past five bytes');
}

/** A 255UInt16 number (point counts and instruction lengths in the transformed glyf). */
function uint255(r: Reader): number {
  const code = r.u8();
  if (code === 253) return r.u16();
  if (code === 255) return r.u8() + 253;
  if (code === 254) return r.u8() + 253 * 2;
  return code;
}

function withSign(flag: number, value: number): number {
  return flag & 1 ? value : -value;
}

/** Decodes `count` points of the triplet encoding (the specification's Table 4). */
function readTriplets(flags: Uint8Array, glyphs: Reader, count: number): { xs: number[]; ys: number[]; onCurve: boolean[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const onCurve: boolean[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < count; i += 1) {
    const raw = flags[i];
    const flag = raw & 0x7f;
    let dx: number;
    let dy: number;
    if (flag < 10) {
      dx = 0;
      dy = withSign(flag, ((flag & 14) << 7) + glyphs.u8());
    } else if (flag < 20) {
      dx = withSign(flag, (((flag - 10) & 14) << 7) + glyphs.u8());
      dy = 0;
    } else if (flag < 84) {
      const b0 = flag - 20;
      const b1 = glyphs.u8();
      dx = withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4));
      dy = withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
    } else if (flag < 120) {
      const b0 = flag - 84;
      dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + glyphs.u8());
      dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphs.u8());
    } else if (flag < 124) {
      const b1 = glyphs.u8();
      const b2 = glyphs.u8();
      const b3 = glyphs.u8();
      dx = withSign(flag, (b1 << 4) + (b2 >> 4));
      dy = withSign(flag >> 1, ((b2 & 0x0f) << 8) + b3);
    } else {
      const b1 = glyphs.u8();
      const b2 = glyphs.u8();
      const b3 = glyphs.u8();
      const b4 = glyphs.u8();
      dx = withSign(flag, (b1 << 8) + b2);
      dy = withSign(flag >> 1, (b3 << 8) + b4);
    }
    x += dx;
    y += dy;
    xs.push(x);
    ys.push(y);
    onCurve.push(!(raw & 0x80));
  }
  return { xs, ys, onCurve };
}

function bit(bitmap: Uint8Array, index: number): boolean {
  return (bitmap[index >> 3] & (0x80 >> (index & 7))) !== 0;
}

/** Rebuilds `glyf` and `loca` from the transformed glyf (the specification's section 5.1). */
function rebuildGlyf(data: Uint8Array): { glyf: Uint8Array; loca: Uint8Array; xMins: number[] } {
  const r = new Reader(data);
  r.u16();
  const optionFlags = r.u16();
  const numGlyphs = r.u16();
  r.u16();
  const sizes = [r.u32(), r.u32(), r.u32(), r.u32(), r.u32(), r.u32(), r.u32()];
  const [contourStream, pointStream, flagStream, glyphStream, compositeStream, bboxData, instructionStream] = sizes.map((size) =>
    r.sub(size),
  );
  const bboxBitmap = bboxData.bytes(((numGlyphs + 31) >> 5) << 2);
  const overlapBitmap = optionFlags & 1 ? r.bytes((numGlyphs + 7) >> 3) : null;

  const glyphs: Uint8Array[] = [];
  const xMins: number[] = [];
  for (let i = 0; i < numGlyphs; i += 1) {
    const contours = contourStream.i16();
    const explicitBox = bit(bboxBitmap, i);
    if (contours === 0) {
      if (explicitBox) throw new Error(`WOFF2: empty glyph ${i} has a bounding box`);
      glyphs.push(new Uint8Array(0));
      xMins.push(0);
      continue;
    }
    if (contours === -1) {
      if (!explicitBox) throw new Error(`WOFF2: composite glyph ${i} has no bounding box`);
      const { components, hasInstructions } = readComponents(compositeStream);
      const bbox: BBox = [bboxData.i16(), bboxData.i16(), bboxData.i16(), bboxData.i16()];
      const instructions = hasInstructions ? instructionStream.bytes(uint255(glyphStream)) : new Uint8Array(0);
      const glyph: CompositeGlyph = { kind: 'composite', components, instructions, bbox };
      glyphs.push(encodeGlyph(glyph));
      xMins.push(bbox[0]);
      continue;
    }
    if (contours < 0) throw new Error(`WOFF2: glyph ${i} has ${contours} contours`);
    const endPts: number[] = [];
    let total = 0;
    for (let c = 0; c < contours; c += 1) {
      total += uint255(pointStream);
      endPts.push(total - 1);
    }
    const points = readTriplets(flagStream.bytes(total), glyphStream, total);
    const instructions = instructionStream.bytes(uint255(glyphStream));
    const bbox: BBox = explicitBox ? [bboxData.i16(), bboxData.i16(), bboxData.i16(), bboxData.i16()] : pointsBBox(points.xs, points.ys);
    const glyph: SimpleGlyph = {
      kind: 'simple',
      endPts,
      ...points,
      overlap: overlapBitmap !== null && bit(overlapBitmap, i),
      instructions,
      bbox,
    };
    // An explicit box can differ from the points' own (the encoder keeps the original); keep it.
    const encoded = encodeGlyph(glyph);
    if (explicitBox) {
      const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
      bbox.forEach((v, k) => view.setInt16(2 + k * 2, v));
    }
    glyphs.push(encoded);
    xMins.push(bbox[0]);
  }
  return { ...joinGlyf(glyphs), xMins };
}

/** Rebuilds `hmtx` from its transformed form (the specification's section 5.4). */
function rebuildHmtx(data: Uint8Array, numGlyphs: number, numHMetrics: number, xMins: number[]): Uint8Array {
  const r = new Reader(data);
  const flags = r.u8();
  const advances: number[] = [];
  for (let i = 0; i < numHMetrics; i += 1) advances.push(r.u16());
  const lsbs: number[] = [];
  for (let i = 0; i < numHMetrics; i += 1) lsbs.push(flags & 1 ? xMins[i] : r.i16());
  for (let i = numHMetrics; i < numGlyphs; i += 1) lsbs.push(flags & 2 ? xMins[i] : r.i16());
  const w = new Writer();
  for (let i = 0; i < numGlyphs; i += 1) {
    if (i < numHMetrics) w.u16(advances[i]);
    w.i16(lsbs[i]);
  }
  return w.toBytes();
}

interface Entry {
  tag: string;
  transformed: boolean;
  length: number;
}

export function decodeWoff2(input: Uint8Array): Font {
  const r = new Reader(input);
  if (r.u32() !== SIGNATURE) throw new Error('WOFF2: not a WOFF2 file');
  const flavor = r.u32();
  if (flavor === COLLECTION) throw new Error('WOFF2: font collections are not supported');
  r.u32();
  const numTables = r.u16();
  r.u16();
  r.u32();
  const compressedSize = r.u32();
  r.pos = 48;
  const entries: Entry[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = r.u8();
    const tag = (flags & 0x3f) === 63 ? r.tag() : KNOWN_TAGS[flags & 0x3f];
    const version = flags >> 6;
    const original = base128(r);
    // glyf and loca are transformed at version 0 (3 means stored as is); other tables at any other version.
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const length = transformed ? base128(r) : original;
    if (tag === 'loca' && transformed && length !== 0) throw new Error('WOFF2: a transformed loca must be empty');
    entries.push({ tag, transformed, length });
  }
  const stream = new Uint8Array(brotliDecompressSync(r.bytes(compressedSize)));
  const raw = new Map<string, Uint8Array>();
  let at = 0;
  for (const entry of entries) {
    if (at + entry.length > stream.byteLength) throw new Error(`WOFF2: table ${entry.tag} runs past the data`);
    raw.set(entry.tag, stream.subarray(at, at + entry.length));
    at += entry.length;
  }

  const tables = new Map<string, Uint8Array>();
  let xMins: number[] | null = null;
  for (const entry of entries) {
    if (entry.tag === 'loca' && entry.transformed) continue;
    if (entry.tag === 'glyf' && entry.transformed) {
      const rebuilt = rebuildGlyf(raw.get('glyf')!);
      tables.set('glyf', rebuilt.glyf);
      tables.set('loca', rebuilt.loca);
      xMins = rebuilt.xMins;
      // The rebuilt loca has long offsets.
      const head = raw.get('head');
      if (head) {
        const copy = head.slice();
        new DataView(copy.buffer).setInt16(50, 1);
        raw.set('head', copy);
      }
      continue;
    }
    if (entry.tag === 'hmtx' && entry.transformed) continue;
    tables.set(entry.tag, raw.get(entry.tag)!);
  }
  tables.set('head', raw.get('head')!);
  const hmtx = entries.find((e) => e.tag === 'hmtx');
  if (hmtx?.transformed) {
    if (!xMins) throw new Error('WOFF2: a transformed hmtx needs a transformed glyf');
    const numGlyphs = new Reader(raw.get('maxp')!, 4).u16();
    const numHMetrics = new Reader(raw.get('hhea')!, 34).u16();
    tables.set('hmtx', rebuildHmtx(raw.get('hmtx')!, numGlyphs, numHMetrics, xMins));
  }
  return { flavor, tables };
}
