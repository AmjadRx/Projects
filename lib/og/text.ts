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

/**
 * The largest size, from `max` down to `min` in steps of `step`, at which every word fits whole
 * and the text takes at most `maxLines` lines. Failing that, the smallest size at which every word
 * fits whole (the fewest lines); failing that, `min`, with long words cut.
 */
export function fitText(
  text: string,
  measureAt: (size: number) => Measure,
  width: number,
  { max, min, step = 2, maxLines }: { max: number; min: number; step?: number; maxLines: number },
): Fitted {
  let whole: Fitted | null = null;
  for (let size = max; size >= min; size -= step) {
    const measure = measureAt(size);
    if (!wordsFit(text, measure, width)) continue;
    const lines = breakLines(text, measure, width);
    if (lines.length <= maxLines) return { size, lines };
    // Too many lines even with whole words: keep the smallest such size, which takes the fewest.
    whole = { size, lines };
  }
  return whole ?? { size: min, lines: breakLines(text, measureAt(min), width) };
}
