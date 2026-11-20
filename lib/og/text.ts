/**
 * Line breaking for the images. Every line is measured with the face it is drawn in and broken
 * here, then drawn as its own unbroken line, so what the layout planned is what the image shows.
 * Lines break at spaces and after hyphens, as the pages' titles do. A size is chosen so that every
 * word sits whole on a line (as a project title steps down on a phone, app/styles/project.css);
 * only when no size allows that is a word cut between characters.
 */

/** Measures a line in px at the size being tried. */
export type Measure = (text: string) => number;

/** The units a line may break between: words with their following space, split after hyphens. */
function units(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  words.forEach((word, i) => {
    const parts = word.split(/(?<=-)/);
    parts.forEach((part, k) => out.push(k === parts.length - 1 && i < words.length - 1 ? `${part} ` : part));
  });
  return out;
}

/** True when every unit of the text fits on a line of `width` by itself. */
export function wordsFit(text: string, measure: Measure, width: number): boolean {
  return units(text).every((unit) => measure(unit.trimEnd()) <= width);
}

/** The first of `sizes` (largest first) at which every word fits whole, else the last of them. */
export function wholeSize(text: string, measureAt: (size: number) => Measure, width: number, sizes: readonly number[]): number {
  return sizes.find((size) => wordsFit(text, measureAt(size), width)) ?? sizes[sizes.length - 1];
}

/** Cuts one unit that is too long for a line into pieces that fit. */
function cut(unit: string, measure: Measure, width: number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of unit) {
    if (piece !== '' && measure(piece + ch) > width) {
      pieces.push(piece);
      piece = '';
    }
    piece += ch;
  }
  if (piece !== '') pieces.push(piece);
  return pieces;
}

/** Breaks `text` into lines no wider than `width`. Trailing spaces are not measured or kept. */
export function breakLines(text: string, measure: Measure, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  const fits = (candidate: string) => measure(candidate.trimEnd()) <= width;
  for (const unit of units(text)) {
    if (line !== '' && fits(line + unit)) {
      line += unit;
      continue;
    }
    if (line !== '') lines.push(line.trimEnd());
    line = '';
    if (fits(unit)) {
      line = unit;
      continue;
    }
    const pieces = cut(unit.trimEnd(), measure, width);
    lines.push(...pieces.slice(0, -1));
    line = pieces[pieces.length - 1] + (unit.endsWith(' ') ? ' ' : '');
  }
  if (line.trim() !== '') lines.push(line.trimEnd());
  return lines;
}

export interface Fitted {
  size: number;
  lines: string[];
}

export interface Fit {
  max: number;
  min: number;
  step?: number;
  maxLines: number;
  /** The height the lines may take, and a line's height at a size (by default, the size). */
  maxHeight?: number;
  lineHeight?: (size: number) => number;
}

/**
 * The largest size, from `max` down to `min` in steps of `step`, at which every word fits whole
 * and the text takes at most `maxLines` lines, within `maxHeight`. Failing that, the smallest size
 * at which every word fits whole (the fewest lines), when its lines fit `maxHeight`. Failing that,
 * null: the caller steps the type down further (lib/og/sheet.tsx), and only past its smallest step
 * cuts the text short (clampLines).
 */
export function fitText(
  text: string,
  measureAt: (size: number) => Measure,
  width: number,
  { max, min, step = 2, maxLines, maxHeight = Infinity, lineHeight = (size) => size }: Fit,
): Fitted | null {
  let whole: Fitted | null = null;
  for (let size = max; size >= min; size -= step) {
    const measure = measureAt(size);
    if (!wordsFit(text, measure, width)) continue;
    const lines = breakLines(text, measure, width);
    if (lines.length <= maxLines && lines.length * lineHeight(size) <= maxHeight) return { size, lines };
    // Too many lines even with whole words: keep the smallest such size, which takes the fewest.
    whole = { size, lines };
  }
  return whole && whole.lines.length * lineHeight(whole.size) <= maxHeight ? whole : null;
}

/** The mark that ends a line cut short. */
export const ELLIPSIS = '\u2026';

/** A line cut short: without its trailing spaces and stops, then the ellipsis. */
const cutLine = (line: string) => line.replace(/[\s.,;:]+$/u, '') + ELLIPSIS;

/**
 * The last resort, for text far longer than any real field: the text's lines, at most `maxLines`
 * of them (at least one), the last one ending in an ellipsis when the text was cut short. A line
 * gives up whole words to make room for the ellipsis, and characters only when it holds one word.
 */
export function clampLines(text: string, measure: Measure, width: number, maxLines: number): { lines: string[]; clamped: boolean } {
  const lines = breakLines(text, measure, width);
  const keep = Math.max(1, Math.floor(maxLines));
  if (lines.length <= keep) return { lines, clamped: false };
  const kept = lines.slice(0, keep);
  let last = kept[keep - 1];
  while (last !== '' && measure(cutLine(last)) > width) {
    const space = last.lastIndexOf(' ');
    last = space > 0 ? last.slice(0, space) : [...last].slice(0, -1).join('');
  }
  kept[keep - 1] = cutLine(last);
  return { lines: kept, clamped: true };
}
