/**
 * The Open Graph images' type (lib/og/font/): the repository's WOFF2 files decoded to OpenType,
 * Archivo made static at the weights and widths the pages use, the measured line breaking, and the
 * icon's outlines. The instancing is checked against Google Chrome's own: the advance widths and
 * ink boxes below were measured in Chrome 2026-11-20 from app/fonts/Archivo-Variable.woff2 at each
 * position (font-variation-settings, kerning off), and the static instance must reproduce them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Reader } from '../lib/og/font/binary';
import { encodeGlyph, parseGlyph, splitGlyf } from '../lib/og/font/glyf';
import { instantiate, normalize, readAxes, tupleScalar } from '../lib/og/font/instance';
import { fontMetrics, lineWidth } from '../lib/og/font/metrics';
import { pathData, textOutline } from '../lib/og/font/outline';
import { readSfnt, writeSfnt, type Font } from '../lib/og/font/sfnt';
import { decodeWoff2 } from '../lib/og/font/woff2';
import { breakLines, fitText, wordsFit } from '../lib/og/text';

const fontFile = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'app', 'fonts', name)));
const archivo = decodeWoff2(fontFile('Archivo-Variable.woff2'));
const mono = decodeWoff2(fontFile('B612Mono-Regular.woff2'));
const monoBold = decodeWoff2(fontFile('B612Mono-Bold.woff2'));

function numGlyphs(font: Font): number {
  return new Reader(font.tables.get('maxp')!, 4).u16();
}

function glyphs(font: Font) {
  const longLoca = new Reader(font.tables.get('head')!, 50).i16() === 1;
  return splitGlyf(font.tables.get('glyf')!, font.tables.get('loca')!, numGlyphs(font), longLoca).map(parseGlyph);
}

/** Advance widths in font units (1000 per em), measured in Chrome. */
const CHROME_ADVANCES: Record<string, Record<string, number>> = {
  '700/125': { '0': 769, A: 918, H: 975, R: 925, g: 744, s: 684, ' ': 313, '&': 955 },
  '700/118': { '0': 720, A: 864, H: 913, R: 870, g: 706, s: 648, ' ': 280, '&': 902 },
  '500/100': { '0': 574, A: 695, H: 734, R: 722, g: 573, s: 524, ' ': 205, '&': 710 },
  '100/62': { '0': 368, A: 398, H: 477, R: 465, g: 339, s: 298, ' ': 135, '&': 426 },
  '900/125': { '0': 811, A: 954, H: 1009, R: 943, g: 798, s: 747, ' ': 290, '&': 1065 },
  '350/80': { '0': 473, A: 544, H: 604, R: 595, g: 447, s: 406, ' ': 169, '&': 564 },
};

/** Ink boxes in font units (the rendered pixels at 500 px, doubled): left side, width, height. */
const CHROME_INK: Record<string, { left: number; width: number; height: number }> = {
  '700/125/g': { left: 14, width: 734, height: 820 },
  '700/125/s': { left: 38, width: 604, height: 550 },
  '700/125/&': { left: 60, width: 886, height: 710 },
  '700/125/R': { left: 92, width: 788, height: 686 },
  '500/100/g': { left: 18, width: 542, height: 794 },
  '500/100/s': { left: 38, width: 448, height: 548 },
  '500/100/&': { left: 52, width: 618, height: 710 },
  '500/100/R': { left: 82, width: 600, height: 686 },
  '900/62/g': { left: -6, width: 428, height: 836 },
  '900/62/s': { left: 22, width: 358, height: 552 },
  '900/62/&': { left: 16, width: 550, height: 712 },
  '900/62/R': { left: 40, width: 466, height: 688 },
};

function at(key: string): Font {
  const [wght, wdth] = key.split('/').map(Number);
  return instantiate(archivo, { wght, wdth });
}

describe('WOFF2 decoding', () => {
  it('decodes every repository font to TrueType tables, with glyf and loca rebuilt', () => {
    for (const font of [archivo, mono, monoBold]) {
      expect(font.flavor).toBe(0x00010000);
      for (const tag of ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'glyf', 'loca', 'name', 'post']) expect(font.tables.has(tag), tag).toBe(true);
      // The rebuilt loca has long offsets, one more than the glyphs, rising.
      expect(new Reader(font.tables.get('head')!, 50).i16()).toBe(1);
      expect(font.tables.get('loca')!.byteLength).toBe((numGlyphs(font) + 1) * 4);
    }
    expect(numGlyphs(archivo)).toBe(834);
    expect(numGlyphs(mono)).toBe(590);
  });

  it('rebuilds outlines that parse and re-encode to the same bytes', () => {
    for (const font of [archivo, mono]) {
      const longLoca = new Reader(font.tables.get('head')!, 50).i16() === 1;
      const raw = splitGlyf(font.tables.get('glyf')!, font.tables.get('loca')!, numGlyphs(font), longLoca);
      let simple = 0;
      for (const bytes of raw) {
        const glyph = parseGlyph(bytes);
        if (glyph.kind !== 'simple') continue;
        simple += 1;
        // A glyph's own box is the box of its points.
        const again = parseGlyph(encodeGlyph(glyph));
        expect(again).toEqual(glyph);
      }
      expect(simple).toBeGreaterThan(300);
    }
  });

  it('refuses what is not a WOFF2 file', () => {
    expect(() => decodeWoff2(new Uint8Array(64))).toThrow(/not a WOFF2 file/);
  });

  it('writes an sfnt whose directory reads back and whose whole-font checksum is the magic number', () => {
    const bytes = writeSfnt(mono);
    const back = readSfnt(bytes);
    expect([...back.tables.keys()].sort()).toEqual([...mono.tables.keys()].sort());
    expect(back.tables.get('glyf')).toEqual(mono.tables.get('glyf'));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let sum = 0;
    for (let i = 0; i < bytes.byteLength; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });
});

describe('variable font instancing (Archivo)', () => {
  it('reads the axes: weight 100 to 900 (600 by default), width 62 to 125 (100 by default)', () => {
    expect(readAxes(archivo)).toEqual([
      { tag: 'wght', min: 100, def: 600, max: 900 },
      { tag: 'wdth', min: 62, def: 100, max: 125 },
    ]);
    expect(normalize(readAxes(archivo), { wght: 900, wdth: 62 }, null)).toEqual([1, -1]);
    expect(normalize(readAxes(archivo), { wght: 2000 }, null)).toEqual([1, 0]);
  });

  it('applies tuples by the specification scalar', () => {
    expect(tupleScalar([0.5], [1], null, null)).toBe(0.5);
    expect(tupleScalar([-0.5], [1], null, null)).toBe(0);
    expect(tupleScalar([0], [1], null, null)).toBe(0);
    expect(tupleScalar([0.25], [0.5], [0], [1])).toBe(0.5);
    expect(tupleScalar([0.75], [0.5], [0], [1])).toBe(0.5);
    expect(tupleScalar([0.3, 0.7], [0, 1], null, null)).toBeCloseTo(0.7);
  });

  it('leaves every outline and advance as it is at the default position', () => {
    const same = instantiate(archivo, { wght: 600, wdth: 100 });
    expect(glyphs(same)).toEqual(glyphs(archivo).map((g) => (g.kind === 'simple' ? { ...g, instructions: new Uint8Array(0) } : g.kind === 'composite' ? { ...g, instructions: new Uint8Array(0) } : g)));
    const a = fontMetrics(archivo);
    const b = fontMetrics(same);
    for (let gid = 0; gid < numGlyphs(archivo); gid += 1) expect(b.advanceOf(gid)).toBe(a.advanceOf(gid));
  });

  it("gives Chrome's advance widths at every position measured", () => {
    for (const [key, advances] of Object.entries(CHROME_ADVANCES)) {
      const metrics = fontMetrics(at(key));
      for (const [ch, advance] of Object.entries(advances)) expect(metrics.advanceOf(metrics.glyphOf(ch.codePointAt(0)!)), `${key} ${ch}`).toBe(advance);
    }
  });

  it("draws outlines whose ink matches Chrome's within a rendered pixel", () => {
    for (const [key, ink] of Object.entries(CHROME_INK)) {
      const [wght, wdth, ch] = key.split('/');
      const font = at(`${wght}/${wdth}`);
      const glyph = glyphs(font)[fontMetrics(font).glyphOf(ch.codePointAt(0)!)];
      expect(glyph.kind, key).toBe('simple');
      if (glyph.kind !== 'simple') continue;
      const [x0, y0, x1, y1] = glyph.bbox;
      expect(Math.abs(x0 - ink.left), `${key} left`).toBeLessThanOrEqual(2);
      expect(Math.abs(x1 - x0 - ink.width), `${key} width`).toBeLessThanOrEqual(2);
      expect(Math.abs(y1 - y0 - ink.height), `${key} height`).toBeLessThanOrEqual(2);
    }
  });

  it('leaves no variation table in the instance, which still writes and reads back', () => {
    const font = at('700/125');
    for (const tag of ['fvar', 'gvar', 'avar', 'HVAR', 'STAT']) expect(font.tables.has(tag), tag).toBe(false);
    expect(readSfnt(writeSfnt(font)).tables.has('glyf')).toBe(true);
    expect(new Reader(font.tables.get('hhea')!, 34).u16()).toBe(numGlyphs(font));
  });

  it('returns a static font as it is', () => {
    expect(instantiate(mono, { wght: 700 })).toBe(mono);
  });
});

describe('measuring and breaking lines', () => {
  const metrics = fontMetrics(mono);
  // B612 Mono: every glyph is 1300 units wide on a 2000 unit em, so a character is 0.65 em.
  const CH = 0.65;
  const measure = (size: number) => (text: string) => lineWidth(metrics, text, size);
  const chars = (n: number, size = 10) => n * CH * size;

  it('measures a monospaced line exactly, letter spacing included', () => {
    expect(lineWidth(metrics, 'ABCD', 20)).toBeCloseTo(52);
    expect(lineWidth(metrics, 'ABCD', 20, 1)).toBeCloseTo(56);
  });

  it('breaks at spaces and after hyphens, never inside a word that fits', () => {
    expect(breakLines('Design-Build-Vertical Flight', measure(10), chars(14))).toEqual(['Design-Build-', 'Vertical', 'Flight']);
    expect(breakLines('one two three', measure(10), chars(7))).toEqual(['one two', 'three']);
  });

  it('cuts a word only when it cannot fit a line', () => {
    expect(breakLines('abcdefghij', measure(10), chars(4))).toEqual(['abcd', 'efgh', 'ij']);
    expect(wordsFit('abcdefghij', measure(10), chars(4))).toBe(false);
  });

  it('picks the largest size that keeps every word whole within the line limit', () => {
    const fitted = fitText('STMicroelectronics', measure, chars(18, 30), { max: 40, min: 10, maxLines: 3 });
    expect(fitted.lines).toEqual(['STMicroelectronics']);
    expect(fitted.size).toBe(30);
    // With no size that fits the limit, the fewest lines with whole words.
    expect(fitText('aa bb cc dd', measure, chars(3), { max: 10, min: 10, maxLines: 1 }).lines).toEqual(['aa', 'bb', 'cc', 'dd']);
  });
});

describe('outlines for the icon', () => {
  it('draws text as closed quadratic contours inside its box', () => {
    const font = at('700/118');
    const outline = textOutline(font, 'AR');
    const [x0, y0, x1, y1] = outline.box;
    expect(x1 - x0).toBeGreaterThan(1);
    // Capitals stand on the baseline (y grows downward here): the box ends at 0.
    expect(y1).toBeCloseTo(0, 2);
    expect(y0).toBeLessThan(-0.6);
    const d = pathData(outline, 100, 0, 0);
    expect(d.startsWith('M')).toBe(true);
    expect(d.match(/Z/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
