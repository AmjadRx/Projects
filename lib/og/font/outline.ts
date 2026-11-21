/**
 * A line of text as one SVG path, from a TrueType font's own outlines: quadratic contours with
 * implied on-curve points, composite glyphs resolved, laid out on their advances (no kerning). The
 * site icon is drawn this way, so its letters can be centered on their ink exactly, which the
 * renderer's own text placement (centered on the font's line metrics) does not do.
 */
import { Reader } from './binary';
import { ARGS_ARE_XY_VALUES, parseGlyph, splitGlyf, type Glyph } from './glyf';
import { fontMetrics } from './metrics';
import type { Font } from './sfnt';

type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

interface Point {
  x: number;
  y: number;
  on: boolean;
}

const glyphCache = new WeakMap<Font, Glyph[]>();

function glyphsOf(font: Font): Glyph[] {
  let glyphs = glyphCache.get(font);
  if (!glyphs) {
    const numGlyphs = new Reader(font.tables.get('maxp')!, 4).u16();
    const longLoca = new Reader(font.tables.get('head')!, 50).i16() === 1;
    glyphs = splitGlyf(font.tables.get('glyf')!, font.tables.get('loca')!, numGlyphs, longLoca).map(parseGlyph);
    glyphCache.set(font, glyphs);
  }
  return glyphs;
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** The contours of a glyph in font units, components resolved and moved by `m`. */
function contours(glyphs: Glyph[], index: number, m: Matrix, depth = 0): Point[][] {
  const glyph = glyphs[index];
  if (!glyph || glyph.kind === 'empty' || depth > 8) return [];
  if (glyph.kind === 'simple') {
    const out: Point[][] = [];
    let start = 0;
    for (const end of glyph.endPts) {
      const contour: Point[] = [];
      for (let i = start; i <= end; i += 1) {
        const [x, y] = apply(m, glyph.xs[i], glyph.ys[i]);
        contour.push({ x, y, on: glyph.onCurve[i] });
      }
      out.push(contour);
      start = end + 1;
    }
    return out;
  }
  return glyph.components.flatMap((c) => {
    const t = c.transform;
    const [a, b, cc, d] = t.length === 4 ? t : t.length === 2 ? [t[0], 0, 0, t[1]] : t.length === 1 ? [t[0], 0, 0, t[0]] : [1, 0, 0, 1];
    const dx = c.flags & ARGS_ARE_XY_VALUES ? c.arg1 : 0;
    const dy = c.flags & ARGS_ARE_XY_VALUES ? c.arg2 : 0;
    // The component's own matrix, then its offset, then the parent's matrix.
    const local: Matrix = [a, b, cc, d, dx, dy];
    const combined: Matrix = [
      m[0] * local[0] + m[2] * local[1],
      m[1] * local[0] + m[3] * local[1],
      m[0] * local[2] + m[2] * local[3],
      m[1] * local[2] + m[3] * local[3],
      m[0] * local[4] + m[2] * local[5] + m[4],
      m[1] * local[4] + m[3] * local[5] + m[5],
    ];
    return contours(glyphs, c.glyphIndex, combined, depth + 1);
  });
}

export interface Outline {
  /** Path commands with y pointing down and the baseline at y = 0, in units of the em. */
  commands: (['M' | 'L', number, number] | ['Q', number, number, number, number] | ['Z'])[];
  /** The box of every outline point, in the same units: [xMin, yMin, xMax, yMax]. */
  box: [number, number, number, number];
}

/** The outline of `text`, one em tall, starting at x = 0 on the baseline. */
export function textOutline(font: Font, text: string): Outline {
  const metrics = fontMetrics(font);
  const glyphs = glyphsOf(font);
  const unit = 1 / metrics.unitsPerEm;
  const commands: Outline['commands'] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  let pen = 0;
  for (const ch of text) {
    const gid = metrics.glyphOf(ch.codePointAt(0)!);
    // Font units, y up, to ems, y down, at the pen.
    const m: Matrix = [unit, 0, 0, -unit, pen, 0];
    for (const contour of contours(glyphs, gid, m)) {
      if (contour.length === 0) continue;
      contour.forEach((p) => {
        xs.push(p.x);
        ys.push(p.y);
      });
      const n = contour.length;
      const startIndex = contour.findIndex((p) => p.on);
      const mid = (p: Point, q: Point): Point => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, on: true });
      // Start on an on-curve point, or between two off-curve points when there is none.
      const start = startIndex >= 0 ? contour[startIndex] : mid(contour[n - 1], contour[0]);
      const from = startIndex >= 0 ? startIndex : n - 1;
      commands.push(['M', start.x, start.y]);
      let control: Point | null = null;
      for (let k = 1; k <= n; k += 1) {
        const p = contour[(from + k) % n];
        if (p.on) {
          if (control) commands.push(['Q', control.x, control.y, p.x, p.y]);
          else commands.push(['L', p.x, p.y]);
          control = null;
        } else if (control) {
          const implied = mid(control, p);
          commands.push(['Q', control.x, control.y, implied.x, implied.y]);
          control = p;
        } else control = p;
      }
      if (control) commands.push(['Q', control.x, control.y, start.x, start.y]);
      commands.push(['Z']);
    }
    pen += metrics.advanceOf(gid) * unit;
  }
  const box: Outline['box'] = xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0];
  return { commands, box };
}

/** The outline's SVG path data at `scale` px per em, moved by (dx, dy) px. */
export function pathData(outline: Outline, scale: number, dx: number, dy: number): string {
  const f = (v: number) => String(Math.round(v * 100) / 100);
  const X = (x: number) => f(x * scale + dx);
  const Y = (y: number) => f(y * scale + dy);
  return outline.commands
    .map((c) => {
      if (c[0] === 'Z') return 'Z';
      if (c[0] === 'Q') return `Q${X(c[1])} ${Y(c[2])} ${X(c[3])} ${Y(c[4])}`;
      return `${c[0]}${X(c[1])} ${Y(c[2])}`;
    })
    .join('');
}
