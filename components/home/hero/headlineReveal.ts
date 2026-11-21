/**
 * The headline's line reveal (DESIGN_DIRECTION.md 6.2, step 2, and 6.4: "Headline line reveal:
 * splitText"; motion sheet 2.3 and 2.4; `load.headline` in lib/motion.ts), once a visit, as part of
 * the load sequence (lib/intro.ts).
 *
 * Split by line, never by letter: Motion+ splitText wraps the words and groups them into the lines
 * the browser has set, and each line rises load.headline.rise em into place while its opacity goes
 * from 0 to 1, load.headline.step apart, over load.headline.duration with load.headline.ease. The
 * lines move by transform alone, through the Web Animations API, so nothing is laid out again.
 *
 * React never meets the split: the h1 hydrates as the server sent it, the split happens after
 * that, and React's own text node goes back in place of the spans (the same node, so React keeps
 * owning it) when the h1 changes width, so the text wraps again (a turned phone, a resized window);
 * before the page prints (the paper's width); at the visitor's first press, key, wheel or touch once
 * the lines have set (at once if one came during the reveal), so find in page and copying meet the
 * text as the server sent it; or when the reveal is stopped (motion turned off, the hero leaving the
 * page). Until then the lines stay as they set, still and in place: putting the text back as the
 * last line sets would paint the headline once more as new content, and browsers take such a paint
 * as the page's Largest Contentful Paint (sheet 2.4: the headline must not delay it), which no
 * longer changes once the visitor has pressed, typed or scrolled. Meanwhile the h1 is still one h1,
 * and splitText gives it the full headline as its label.
 *
 * The split must set the lines exactly as the text sets them, or they would re-break when the text
 * comes back. So the words stay whole (no letter spans: they keep their kerning), the text must be
 * plain (words parted by single spaces), every word must sit on one line, and the split's lines
 * must hold the same words as the text's. Each line is then a block on a row of its own, and the
 * split must keep the h1's rows and height, so nothing around the headline moves while it plays.
 * When any of that fails, the headline is simply shown.
 *
 * Browser only, no React: Headline.tsx runs it.
 */
import { splitText } from 'motion-plus';
import { cssEasing, load, toMs } from '@/lib/motion';

/**
 * On the h1 once its start state is over: the reveal has started, or the headline is simply
 * shown. The start state and the give-up in app/motion-drawing.css hang on its absence.
 */
export const SET_ATTR = 'data-headline-set';

/** The spans splitText makes for each line and each word. */
export const LINE_CLASS = 'hm-hero__line';
export const WORD_CLASS = 'hm-hero__word';

/** Words parted by single spaces, with nothing HTML would read as markup or a character reference. */
const PLAIN = /^[^ \t\n\r<&]+( [^ \t\n\r<&]+)*$/;

/** How far, in px, the split h1's height may differ from the text's: rounding, never a row. */
const HEIGHT_TOLERANCE = 0.5;

/**
 * Text the split rebuilds exactly. Spaces at either end or side by side would each become a
 * space between spans that no longer collapses, and splitText writes each whole word as HTML,
 * so a word must hold no markup.
 */
export function splittable(text: string): boolean {
  return PLAIN.test(text);
}

/**
 * The reveal plays while the load sequence plays on this page view (`age`, from lib/intro.ts
 * introAge, is not null) and before its give-up: once load.headline.giveUpAfter has passed since
 * the first paint, the headline is already in place (sheet 2.4).
 */
export function revealWanted(age: number | null): boolean {
  return age !== null && age < toMs(load.headline.giveUpAfter);
}

/** One line's animation, for Element.animate. */
export type LineReveal = { keyframes: Keyframe[]; options: KeyframeAnimationOptions };

/** Line `index` (from 0, top down): rises load.headline.rise em into place while its opacity goes from 0 to 1. */
export function lineReveal(index: number): LineReveal {
  return {
    keyframes: [
      { opacity: 0, transform: `translateY(${load.headline.rise}em)` },
      { opacity: 1, transform: 'none' },
    ],
    options: {
      duration: toMs(load.headline.duration),
      delay: toMs(load.headline.start) + index * toMs(load.headline.step),
      easing: cssEasing(load.headline.ease),
      // Each line holds its start state until its turn, and its end until the text comes back.
      fill: 'both',
    },
  };
}

/**
 * Each word's line, from the words' tops in reading order: a word more than `tolerance` px below
 * the first word of the line so far starts the next line.
 */
export function linesFromTops(tops: readonly number[], tolerance: number): number[] {
  const lines: number[] = [];
  let line = 0;
  let lineTop = tops[0] ?? 0;
  for (const top of tops) {
    if (top - lineTop > tolerance) {
      line += 1;
      lineTop = top;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * True when the split's lines (`groups`: the indices of the words in each line, top down) hold
 * every word, in order, on the line the text set it on (`lineOf`: each word's line).
 */
export function sameLines(lineOf: readonly number[], groups: readonly (readonly number[])[]): boolean {
  let next = 0;
  for (let line = 0; line < groups.length; line++) {
    for (const word of groups[line]) {
      if (word !== next || lineOf[word] !== line) return false;
      next += 1;
    }
  }
  return next === lineOf.length;
}

/**
 * Each word's line in the h1 as the browser has set it now, measured on its text before any split.
 * Null when the h1 is not one text node, when ranges cannot be measured, or when a word breaks
 * across two lines (the split keeps each word whole, so it could not set it the same way).
 */
export function measureLines(h1: HTMLElement): number[] | null {
  const node = h1.firstChild;
  if (h1.childNodes.length !== 1 || !node || node.nodeType !== Node.TEXT_NODE) return null;
  const range = document.createRange();
  if (typeof range.getClientRects !== 'function') return null;
  const tolerance = (parseFloat(window.getComputedStyle(h1).fontSize) || 16) / 2;
  const tops: number[] = [];
  let at = 0;
  for (const word of (node.textContent ?? '').split(' ')) {
    range.setStart(node, at);
    range.setEnd(node, at + word.length);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) return null;
    const top = rects[0].top;
    if (rects.some((rect) => Math.abs(rect.top - top) > tolerance)) return null;
    tops.push(top);
    at += word.length + 1;
  }
  return linesFromTops(tops, tolerance);
}

/**
 * True when the split h1 keeps the text's rows: every line sits below the one before it, and the h1
 * is as tall as it was before the split (`height`, its height then). The reveal then moves the
 * lines alone, by transform, and nothing below the headline shifts.
 */
export function rowsKept(h1: HTMLElement, lines: readonly HTMLElement[], height: number): boolean {
  if (Math.abs(h1.getBoundingClientRect().height - height) > HEIGHT_TOLERANCE) return false;
  return lines.every((line, index) => index === 0 || line.offsetTop > lines[index - 1].offsetTop);
}

/** A reveal under way, or its lines set and waiting (the file comment). */
export type HeadlineReveal = {
  /** Ends it at once in its final state, with React's text node back in place. */
  stop: () => void;
};

/** How far, in px, the h1's width may move before its text must wrap again: rounding, never a word. */
const WIDTH_TOLERANCE = 0.5;

/**
 * The visitor's first input of these kinds ends the page's Largest Contentful Paint in browsers
 * (a press, a key, a wheel or touch scroll), so the text can come back from then on.
 */
const FIRST_INPUTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const PASSIVE = { passive: true, capture: true } as const;

/**
 * Calls `onChange` once `el` is no longer `width` px wide (within WIDTH_TOLERANCE), through a
 * ResizeObserver, else the window's resize event. Returns the function that stops watching.
 */
export function watchWidth(el: HTMLElement, width: number, onChange: () => void): () => void {
  const check = () => {
    if (Math.abs(el.getBoundingClientRect().width - width) > WIDTH_TOLERANCE) onChange();
  };
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', check);
  return () => window.removeEventListener('resize', check);
}

/**
 * Splits the h1 by line and plays the reveal; the lines stay as they set until the h1 changes width,
 * the page prints, the visitor's first input after the reveal, or stop(), and then React's own text
 * node goes back (the file comment). Returns null, with the h1 as it was, when the reveal cannot
 * play: the text is not plain, the browser has no Web Animations, a word breaks across lines, or the
 * split would set the lines differently or change the h1's rows.
 */
export function revealHeadline(h1: HTMLElement): HeadlineReveal | null {
  if (!splittable(h1.textContent ?? '') || typeof h1.animate !== 'function') return null;
  const lineOf = measureLines(h1);
  if (!lineOf) return null;
  const { height, width } = h1.getBoundingClientRect();

  const original = Array.from(h1.childNodes);
  const restore = () => {
    h1.replaceChildren(...original);
    h1.removeAttribute('aria-label');
  };

  let lines: HTMLSpanElement[];
  try {
    // preserveHyphens leaves each word whole, in one span with no letter spans (Motion+'s option
    // for hyphenation), so the words keep their kerning and the lines set as the text does.
    lines = splitText(h1, { preserveHyphens: true, lineClass: LINE_CLASS, wordClass: WORD_CLASS }).lines;
  } catch {
    restore();
    return null;
  }
  const groups = lines.map((line) => Array.from(line.querySelectorAll<HTMLElement>(`.${WORD_CLASS}`), (word) => Number(word.dataset.index)));
  if (!sameLines(lineOf, groups)) {
    restore();
    return null;
  }
  // splitText's lines are inline-blocks with nothing between them, and each drops the space at its
  // end, so two short lines could share a row (text-wrap: balance leaves the room), and the h1
  // would lose a row until the text came back. As blocks, each line keeps a row of its own.
  for (const line of lines) line.style.display = 'block';
  if (!rowsKept(h1, lines, height)) {
    restore();
    return null;
  }

  // Each line holds its end (fill: both) once it has set, so the lines need nothing more until the
  // text comes back.
  const animations = lines.map((line, index) => {
    const { keyframes, options } = lineReveal(index);
    return line.animate(keyframes, options);
  });
  let ended = false;
  let set = false;
  let input = false;
  let unwatch = () => {};
  const stop = () => {
    if (ended) return;
    ended = true;
    unwatch();
    for (const animation of animations) animation.cancel();
    restore();
  };
  const onInput = () => {
    input = true;
    if (set) stop();
  };
  const stopWidth = watchWidth(h1, width, stop);
  window.addEventListener('beforeprint', stop);
  for (const type of FIRST_INPUTS) window.addEventListener(type, onInput, PASSIVE);
  unwatch = () => {
    stopWidth();
    window.removeEventListener('beforeprint', stop);
    for (const type of FIRST_INPUTS) window.removeEventListener(type, onInput, PASSIVE);
  };
  void Promise.all(animations.map((animation) => animation.finished)).then(
    () => {
      set = true;
      if (input) stop();
    },
    () => {
      // Cancelled: stop() has already put the text back.
    },
  );
  return { stop };
}
