/**
 * Character to glyph lookup (cmap formats 4 and 12) and horizontal advances, so the images can
 * measure a line before drawing it: the layout picks a type size and the line breaks itself, and
 * the renderer then draws exactly those lines. Kerning is left out of the measure, which only
 * makes a line read slightly wider than it draws.
 */
import { Reader } from './binary';
import type { Font } from './sfnt';

export interface FontMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  glyphOf(codePoint: number): number;
  advanceOf(glyph: number): number;
}

function readCmap(cmap: Uint8Array): (codePoint: number) => number {
  const r = new Reader(cmap);
  r.u16();
  const count = r.u16();
  const subtables: { platform: number; encoding: number; offset: number }[] = [];
  for (let i = 0; i < count; i += 1) subtables.push({ platform: r.u16(), encoding: r.u16(), offset: r.u32() });
  const rank = (s: { platform: number; encoding: number }) =>
    s.platform === 3 && s.encoding === 10 ? 0 : s.platform === 0 && (s.encoding === 4 || s.encoding === 6) ? 1 : s.platform === 3 && s.encoding === 1 ? 2 : s.platform === 0 ? 3 : 9;
  for (const sub of subtables.filter((s) => rank(s) < 9).sort((a, b) => rank(a) - rank(b))) {
    const t = new Reader(cmap, sub.offset);
    const format = t.u16();
    if (format === 12) {
      t.pos += 10;
      const groups: [number, number, number][] = [];
      const n = t.u32();
      for (let i = 0; i < n; i += 1) groups.push([t.u32(), t.u32(), t.u32()]);
      return (cp) => {
        for (const [start, end, glyph] of groups) if (cp >= start && cp <= end) return glyph + cp - start;
        return 0;
      };
    }
    if (format === 4) {
      t.pos += 4;
      const segCount = t.u16() / 2;
      t.pos += 6;
      const base = t.pos;
      const ends = Array.from({ length: segCount }, (_, i) => new Reader(cmap, base + i * 2).u16());
      const startsAt = base + segCount * 2 + 2;
      const deltasAt = startsAt + segCount * 2;
      const rangesAt = deltasAt + segCount * 2;
      const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
      return (cp) => {
        if (cp > 0xffff) return 0;
        for (let i = 0; i < segCount; i += 1) {
          if (cp > ends[i]) continue;
          const start = view.getUint16(startsAt + i * 2);
          if (cp < start) return 0;
          const delta = view.getInt16(deltasAt + i * 2);
          const range = view.getUint16(rangesAt + i * 2);
          if (range === 0) return (cp + delta) & 0xffff;
          const glyph = view.getUint16(rangesAt + i * 2 + range + (cp - start) * 2);
          return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
        }
        return 0;
      };
    }
  }
  return () => 0;
}

export function fontMetrics(font: Font): FontMetrics {
  const get = (tag: string) => {
    const data = font.tables.get(tag);
    if (!data) throw new Error(`The font has no ${tag} table`);
    return data;
  };
  const unitsPerEm = new Reader(get('head'), 18).u16();
  const hhea = new Reader(get('hhea'), 4);
  const ascender = hhea.i16();
  const descender = hhea.i16();
  const numHMetrics = new Reader(get('hhea'), 34).u16();
  const hmtx = new Reader(get('hmtx'));
  const advances = Array.from({ length: numHMetrics }, (_, i) => {
    hmtx.pos = i * 4;
    return hmtx.u16();
  });
  const os2 = font.tables.get('OS/2');
  // sCapHeight is in OS/2 version 2 and later.
  const capHeight = os2 && new Reader(os2).u16() >= 2 ? new Reader(os2, 88).i16() : Math.round(ascender * 0.7);
  return {
    unitsPerEm,
    ascender,
    descender,
    capHeight,
    glyphOf: readCmap(get('cmap')),
    advanceOf: (glyph) => advances[Math.min(glyph, advances.length - 1)] ?? 0,
  };
}

/** The width of a line in px at `size`, with `letterSpacing` px after each character. */
export function lineWidth(metrics: FontMetrics, text: string, size: number, letterSpacing = 0): number {
  let units = 0;
  let count = 0;
  for (const ch of text) {
    units += metrics.advanceOf(metrics.glyphOf(ch.codePointAt(0)!));
    count += 1;
  }
  return (units / metrics.unitsPerEm) * size + count * letterSpacing;
}
