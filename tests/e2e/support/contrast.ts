/**
 * Contrast of text over the sky, measured from screenshots (ARCHITECTURE.md 6A and 15, items 3 and
 * 6a; docs/V3_PLAN.md D-80 and R-06). axe leaves color-contrast undecided wherever text sits on the
 * sky or on glass over it, because the background is a picture, so the suite measures it: the page
 * is photographed with every piece of text painted transparent, and the pixels under each piece of
 * text give its background.
 *
 * - The text: every visible text node not hidden from assistive technology (aria-hidden, inert),
 *   with its own color (`color`; an SVG text's fill), its opacity down the tree, its size and
 *   weight. Text cut away by a box that clips it (a screen reader's own label, a strip's next card)
 *   and text under another layer (the sticky nav) are left out where they cannot be seen. A disabled
 *   control's words are exempt (WCAG 1.4.3, inactive components).
 * - Read afresh at every look (readText), in the same task as it is placed: the page changes as it
 *   scrolls. The tools ticker and the phone's featured carousel take the place of the server's
 *   markup near the view and give it back beyond it, and a readout's count ends by setting its value
 *   as plain text again, so the text read at the top is not all the text further down. A piece of
 *   text is known across looks by its key (TextItem.key), and the run keeps every look's verdict on
 *   it (Tally); text that showed somewhere but was never judged anywhere is reported too.
 * - The background: the pixels inside each line box of the text, in a screenshot taken with the
 *   text's own paint transparent (TRANSPARENT_TEXT), read at the scale of the text: a hairline two
 *   pixels thin or less (a grid line, the horizon line, a table's rule) or a single star core is not
 *   the ground a word is read against, while a band, a glow, the dawn or a photo under glass is
 *   (backgroundAt). The statistic is conservative: for light text on a dark ground the 95th
 *   percentile of that luminance, for dark text on a light ground the 5th, so anything that covers
 *   more than a twentieth of the text decides it. Where the window's edge or a layer in front (the
 *   sticky nav) hides part of a line in passing, the twentieth is still of the whole line: a star
 *   behind the strip that shows does not decide a line it would not decide whole, while a glow or a
 *   photo under all of that strip still does.
 * - The ratio: the text's color (composited over that background where it is translucent) against
 *   the background, at least 4.5 to 1, or 3 to 1 for large text (24 px, or 18.66 px and bold).
 *
 * The page functions here run in the browser (page.evaluate) and keep the last look in
 * `window.__e2eContrast`; the rest runs in Node.
 */
import type { Page } from '@playwright/test';
import { isLargeText, linear, luminance, over, parseColor, ratio, requiredRatio, type Rgb } from './color';
import { decodePng, type Raster } from './png';

/**
 * The text's own paint, made transparent: the glyphs' fill and stroke, shadows, decorations,
 * emphasis marks, the caret, and SVG text. Layout does not change, and `color` keeps its value, so
 * readText reads the color each piece of text is painted in while the style is on (ownTextFill
 * checks that no text takes a fill color of its own). What else the page paints in its text's
 * color (an icon, a border) stays in the picture, as it stays behind the words for a visitor.
 */
export const TRANSPARENT_TEXT = `
*, *::before, *::after, *::marker, *::placeholder, *::first-line, *::first-letter {
  -webkit-text-fill-color: transparent !important;
  -webkit-text-stroke-color: transparent !important;
  text-shadow: none !important;
  text-decoration-color: transparent !important;
  text-emphasis-color: transparent !important;
  caret-color: transparent !important;
}
svg text, svg tspan, svg textPath { fill-opacity: 0 !important; stroke-opacity: 0 !important; }
`;

/** One piece of text: a text node, as the page knows it at one look. */
export interface TextItem {
  /** Its place in this look's list. */
  i: number;
  /**
   * The same piece of text across looks: its element's tag, its words, and its place among the
   * pieces with that tag and those words in the page's order (`span "CATIA" #1`). Not its classes,
   * which a page may change as it scrolls.
   */
  key: string;
  /** The color its glyphs are painted in, as computed. */
  color: string;
  /** Its opacity, multiplied down from the root. */
  opacity: number;
  fontSize: number;
  fontWeight: number;
  /** The element and the words, for messages: `p.st-hon__desc "Built an AI model..."`. */
  describe: string;
  /** Why it is exempt from 1.4.3, or null. */
  exempt: string | null;
}

/** A box on the screen, in CSS px: left, top, right, bottom. */
export type Segment = [number, number, number, number];

export interface Placement {
  i: number;
  /** The boxes where it shows now. */
  segments: Segment[];
  /**
   * The area of its lines that show at all, whole: cut by the boxes that clip them and by the
   * window's sides, but not by the window's top or bottom edge or a layer in front, which only pass
   * over a line. What a twentieth of the text is measured against.
   */
  whole: number;
}

/**
 * In the page: every piece of text to check as the page is now, and where each one shows, as boxes
 * on the screen: its line boxes, cut by the window and by every box that clips it, and left out where
 * another layer lies over it (each line is tested in pieces about 40 px wide). Read and placed in one
 * task, so nothing the page does can come between the two. `only` limits the placing to some keys.
 * The nodes are kept in window.__e2eContrast for stillThere().
 */
export function readText(only: string[] | null): { items: TextItem[]; placements: Placement[] } {
  const SKIP = 'script, style, noscript, template, title, [aria-hidden="true"], [inert]';
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (e: Element) => {
    let s = styles.get(e);
    if (!s) styles.set(e, (s = getComputedStyle(e)));
    return s;
  };
  const opacities = new Map<Element, number>();
  const opacityOf = (e: Element | null): number => {
    if (!e) return 1;
    let o = opacities.get(e);
    if (o === undefined) opacities.set(e, (o = Number(styleOf(e).opacity) * opacityOf(e.parentElement)));
    return o;
  };
  // The boxes that clip an element, nearest first: the element itself and its ancestors up to the
  // body that cut what overflows them.
  const clipping = new Map<Element, Element[]>();
  const clipsOf = (e: Element | null): Element[] => {
    if (!e || e === document.documentElement || e === document.body) return [];
    let c = clipping.get(e);
    if (!c) {
      const s = styleOf(e);
      const cuts =
        s.display !== 'contents' &&
        (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.clipPath !== 'none' || (s.clip !== '' && s.clip !== 'auto') || /\b(paint|strict|content)\b/.test(s.contain));
      const above = clipsOf(e.parentElement);
      c = cuts ? [e, ...above] : above;
      clipping.set(e, c);
    }
    return c;
  };

  const state = { nodes: [] as Text[], els: [] as Element[], clips: [] as Element[][], placed: [] as number[] };
  const items: TextItem[] = [];
  const seenBefore = new Map<string, number>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const words = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
    if (!words) continue;
    const el = node.parentElement;
    if (!el || el.closest(SKIP)) continue;
    const style = styleOf(el);
    if (style.visibility !== 'visible') continue;
    const opacity = opacityOf(el);
    if (opacity < 0.01) continue;
    const tag = el.tagName.toLowerCase();
    const id = `${tag} "${words}"`;
    const n = (seenBefore.get(id) ?? 0) + 1;
    seenBefore.set(id, n);
    const disabled = el.closest(':disabled, [aria-disabled="true"]');
    const classes = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
    state.nodes.push(node);
    state.els.push(el);
    state.clips.push(clipsOf(el));
    items.push({
      i: items.length,
      key: `${id} #${n}`,
      color: el instanceof SVGElement ? style.fill : style.color,
      opacity,
      fontSize: Number.parseFloat(style.fontSize) || 16,
      fontWeight: Number(style.fontWeight) || 400,
      describe: `${tag}${classes.map((c) => `.${c}`).join('')} "${words.slice(0, 48)}${words.length > 48 ? '...' : ''}"`,
      exempt: disabled ? 'a disabled control (inactive components are exempt from 1.4.3)' : null,
    });
  }
  (window as unknown as { __e2eContrast: typeof state }).__e2eContrast = state;

  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  const range = document.createRange();
  const seeThrough = (e: Element) => {
    if (/^(img|video|canvas|iframe|svg|object|embed|picture|input|textarea|select)$/i.test(e.tagName)) return false;
    const s = styleOf(e);
    const bg = s.backgroundColor;
    const clear = bg === 'transparent' || /rgba?\([^)]*[,/]\s*0\)$/.test(bg.replace(/\s+/g, ' '));
    return clear && s.backgroundImage === 'none' && (!s.backdropFilter || s.backdropFilter === 'none');
  };
  /** Nothing that paints lies over the text's element at this point. */
  const seen = (x: number, y: number, el: Element) => {
    // The topmost element first (one hit test); the whole stack only under one that paints nothing.
    const first = document.elementFromPoint(x, y);
    if (!first) return false;
    if (first === el || el.contains(first) || first.contains(el)) return true;
    if (!seeThrough(first)) return false;
    for (const top of document.elementsFromPoint(x, y)) {
      if (top === el || el.contains(top) || top.contains(el)) return true;
      if (!seeThrough(top)) return false;
    }
    return false;
  };
  const wanted = only ? new Set(only) : null;
  const indices = items.filter((item) => !wanted || wanted.has(item.key)).map((item) => item.i);
  // The layers over the page: every fixed or sticky element in front of the content (the sticky
  // nav with the heat rule along its foot, the sheet frame's bands), as the boxes of its parts
  // that paint. The sky behind everything is not one. Found again at every look, as the text is.
  const layers: { owner: Element; box: DOMRect }[] = [];
  const owners = Array.from(document.body.querySelectorAll('*')).filter((el) => {
    const s = styleOf(el);
    return (s.position === 'fixed' || s.position === 'sticky') && !el.closest('.ar-sky') && !(Number(s.zIndex) < 0);
  });
  const holders = new Set<Element>();
  for (const el of state.els) for (let e: Element | null = el; e && !holders.has(e); e = e.parentElement) holders.add(e);
  // A layer's parts that paint nothing and hold no text (the sheet frame's border box over the
  // whole window) let the hit tests through, as they let the eye through.
  const clear: Element[] = [];
  for (const el of owners) {
    if (layers.some((layer) => layer.owner.contains(el))) continue;
    for (const part of [el, ...Array.from(el.querySelectorAll('*'))]) {
      if (part.getClientRects().length === 0 || styleOf(part).visibility === 'hidden') continue;
      if (!seeThrough(part)) layers.push({ owner: el, box: part.getBoundingClientRect() });
      else if (!holders.has(part)) clear.push(part);
    }
  }
  /** A box less another: what is left of it, in up to four boxes. */
  const subtract = (a: Segment, b: DOMRect): Segment[] => {
    const [l, t, r, btm] = a;
    if (b.right <= l || b.left >= r || b.bottom <= t || b.top >= btm) return [a];
    const rest: Segment[] = [];
    if (b.top > t) rest.push([l, t, r, b.top]);
    if (b.bottom < btm) rest.push([l, b.bottom, r, btm]);
    const top = Math.max(t, b.top);
    const bottom = Math.min(btm, b.bottom);
    if (b.left > l) rest.push([l, top, b.left, bottom]);
    if (b.right < r) rest.push([b.right, top, r, bottom]);
    return rest;
  };
  // While measuring, every element answers to the hit tests, so a layer that paints over the text
  // but ignores the pointer counts as a layer over it; the clear parts of the layers do not. The
  // rule stays for the rest of the visit, so the page's style is worked out again only once: it
  // changes nothing that paints, and nothing here moves a pointer over the page.
  if (!document.querySelector('style[data-e2e-hit]')) {
    const hit = document.createElement('style');
    hit.setAttribute('data-e2e-hit', '');
    hit.textContent = [
      '*, *::before, *::after { pointer-events: auto !important; }',
      '[data-e2e-clear], [data-e2e-clear]::before, [data-e2e-clear]::after { pointer-events: none !important; }',
    ].join('\n');
    document.head.append(hit);
  }
  for (const part of clear) part.setAttribute('data-e2e-clear', '');
  const placements: Placement[] = [];
  try {
    for (const i of indices) placements.push(...place(i));
  } finally {
    for (const part of clear) part.removeAttribute('data-e2e-clear');
  }
  state.placed = placements.map((placement) => placement.i);
  return { items, placements };

  /** Where one piece of text shows: no entry, or one with its boxes. */
  function place(i: number): Placement[] {
    const el = state.els[i];
    const box = el.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= height || box.right <= 0 || box.left >= width) return [];
    const clips = state.clips[i].map((e) => e.getBoundingClientRect());
    range.selectNodeContents(state.nodes[i]);
    const segments: Segment[] = [];
    let whole = 0;
    for (const r of Array.from(range.getClientRects())) {
      // The line as laid out: cut by the boxes that clip it and by the window's sides.
      let x0 = Math.max(r.left, 0);
      let y0 = r.top;
      let x1 = Math.min(r.right, width);
      let y1 = r.bottom;
      for (const c of clips) {
        x0 = Math.max(x0, c.left);
        y0 = Math.max(y0, c.top);
        x1 = Math.min(x1, c.right);
        y1 = Math.min(y1, c.bottom);
      }
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      // What shows of it now: inside the window, less the layers in front of the page (not one the
      // text itself belongs to), where nothing else lies over it.
      if (Math.min(y1, height) - Math.max(y0, 0) < 2) continue;
      let parts: Segment[] = [[x0, Math.max(y0, 0), x1, Math.min(y1, height)]];
      for (const layer of layers) if (!layer.owner.contains(el)) parts = parts.flatMap((part) => subtract(part, layer.box));
      const shown = parts.flatMap((part) => unhidden(part, el));
      if (shown.length === 0) continue;
      segments.push(...shown);
      // In whole pixels, as unhidden() gives the boxes, so a line that shows whole is all of it.
      whole += (Math.round(x1) - Math.round(x0)) * (Math.floor(y1) - Math.ceil(y0));
    }
    return segments.length > 0 ? [{ i, segments, whole }] : [];
  }

  /**
   * The parts of a box where nothing else lies over the text's element: first the rows that show
   * down its middle (a row is an eighth of the line), then pieces about 40 px wide along the
   * middle of those rows.
   */
  function unhidden([bx0, by0, bx1, by1]: Segment, el: Element): Segment[] {
    if (bx1 - bx0 < 2 || by1 - by0 < 2) return [];
    const rows = 8;
    const tall = by1 - by0;
    const shown: boolean[] = [];
    for (let j = 0; j < rows; j += 1) shown.push(seen((bx0 + bx1) / 2, by0 + ((j + 0.5) * tall) / rows, el));
    const first = shown.indexOf(true);
    if (first < 0) return [];
    const last = shown.lastIndexOf(true);
    const y0 = Math.ceil(by0 + (first * tall) / rows);
    const y1 = Math.floor(by0 + ((last + 1) * tall) / rows);
    if (y1 - y0 < 2) return [];
    const cy = (y0 + y1) / 2;
    const pieces = Math.min(16, Math.max(1, Math.ceil((bx1 - bx0) / 40)));
    const step = (bx1 - bx0) / pieces;
    const out: Segment[] = [];
    let open: number | null = null;
    for (let k = 0; k <= pieces; k += 1) {
      const visible = k < pieces && seen(bx0 + (k + 0.5) * step, cy, el);
      if (visible && open === null) open = bx0 + k * step;
      if (!visible && open !== null) {
        out.push([Math.round(open), y0, Math.round(bx0 + k * step), y1]);
        open = null;
      }
    }
    return out;
  }
}

/** In the page: every piece of text the last look placed (readText) is still in the page. */
export function stillThere(): boolean {
  const state = (window as unknown as { __e2eContrast?: { nodes: Text[]; placed: number[] } }).__e2eContrast;
  return Boolean(state) && state!.placed.every((i) => state!.nodes[i].isConnected);
}

/**
 * In the page, before TRANSPARENT_TEXT: the pieces of text painted in a fill color of their own
 * (-webkit-text-fill-color) rather than in their `color`, described. readText reads `color`, so the
 * check is right only while this is empty; SVG text, read by its fill, is left out.
 */
export function ownTextFill(): string[] {
  const out = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || el instanceof SVGElement || !(node.nodeValue ?? '').trim()) continue;
    const style = getComputedStyle(el);
    const fill = style.webkitTextFillColor.replace(/\s+/g, '');
    if (fill && fill !== style.color.replace(/\s+/g, '')) out.add(`${el.tagName.toLowerCase()} "${(node.nodeValue ?? '').trim().slice(0, 40)}": fill ${fill}, color ${style.color}`);
  }
  return [...out];
}

/** The statistic of the pixels under a piece of text. */
export interface Background {
  /** Pixels read. */
  pixels: number;
  /**
   * The percentile of the pixels read that decides: 95 for light text and 5 for dark text where
   * the whole text shows; where part of a line is hidden in passing, the one a twentieth of the
   * whole line meets (the 90th where half of it shows).
   */
  percentile: number;
  /** How much of the text shows, of its whole lines: 1 where nothing hides any of it. */
  shown: number;
  /** The color at that percentile (the mean of the pixels of that luminance), and its luminance. */
  rgb: Rgb;
  luminance: number;
}

/** A screenshot ready to read: its pixels, and each pixel's relative luminance. */
export interface Shot {
  raster: Raster;
  luminance: Float32Array;
}

/** Each channel value's linear light, for luminance without a power a pixel. */
const LINEAR = Float64Array.from({ length: 256 }, (_, c) => linear(c));

export function prepareShot(raster: Raster): Shot {
  const { data } = raster;
  const out = new Float32Array(raster.width * raster.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) out[i] = 0.2126 * LINEAR[data[p]] + 0.7152 * LINEAR[data[p + 1]] + 0.0722 * LINEAR[data[p + 2]];
  return { raster, luminance: out };
}

/** The middle of five values (`v` is reordered). */
function median5(v: Float64Array): number {
  for (let i = 1; i < 5; i += 1) {
    const x = v[i];
    let j = i - 1;
    while (j >= 0 && v[j] > x) {
      v[j + 1] = v[j];
      j -= 1;
    }
    v[j + 1] = x;
  }
  return v[2];
}

const column = new Float64Array(5);
const across = new Float64Array(5);

/**
 * The background's luminance at a pixel at the scale of the text, not of a hairline: the median of
 * the five vertical medians of five pixels around it (a separable 5 by 5 median). A line two pixels
 * thin or less (a grid line, the horizon line, a table's rule, the frame's line) and a single star
 * core fall away; a band, a glow, the dawn, a photo under glass stay.
 */
function backgroundAt(shot: Shot, x: number, y: number): number {
  const { width, height } = shot.raster;
  for (let k = -2; k <= 2; k += 1) {
    const xx = Math.min(width - 1, Math.max(0, x + k));
    for (let j = -2; j <= 2; j += 1) column[j + 2] = shot.luminance[Math.min(height - 1, Math.max(0, y + j)) * width + xx];
    across[k + 2] = median5(column);
  }
  return median5(across);
}

const BINS = 2048;

/** The area of some boxes. */
function areaOf(segments: Segment[]): number {
  let area = 0;
  for (const [x0, y0, x1, y1] of segments) area += Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return area;
}

/**
 * The background under the boxes, from a screenshot with the text transparent, read at the scale
 * of the text (backgroundAt): light text (lighter than the background's median) takes the 95th
 * percentile of its luminance, dark text the 5th, so a twentieth of the text decides. `whole` is
 * the area of the text's whole lines (Placement): where less than that shows, the twentieth is of
 * the whole, a larger share of what shows, and where less than a twentieth shows nothing is read
 * (null). At most about 6,000 pixels a piece of text, spread evenly over its boxes.
 */
export function sampleBackground(shot: Shot, segments: Segment[], textLuminance: number, whole = 0): Background | null {
  const { raster } = shot;
  const area = areaOf(segments);
  if (area === 0) return null;
  // The share of what shows that a twentieth of the whole text is.
  const shown = Math.min(1, area / Math.max(area, whole));
  const share = 0.05 / shown;
  if (share >= 1) return null;
  const stride = Math.max(1, Math.round(Math.sqrt(area / 6_000)));
  const counts = new Uint32Array(BINS);
  const sums = new Float64Array(BINS * 3);
  const lums = new Float64Array(BINS);
  let pixels = 0;
  for (const [x0, y0, x1, y1] of segments) {
    for (let y = Math.max(0, y0); y < Math.min(raster.height, y1); y += stride) {
      for (let x = Math.max(0, x0); x < Math.min(raster.width, x1); x += stride) {
        const l = backgroundAt(shot, x, y);
        const bin = Math.min(BINS - 1, Math.floor(l * BINS));
        const at = (y * raster.width + x) * 4;
        counts[bin] += 1;
        sums[bin * 3] += raster.data[at];
        sums[bin * 3 + 1] += raster.data[at + 1];
        sums[bin * 3 + 2] += raster.data[at + 2];
        lums[bin] += l;
        pixels += 1;
      }
    }
  }
  if (pixels === 0) return null;
  const binAt = (share: number) => {
    const wanted = Math.min(pixels - 1, Math.floor(share * (pixels - 1)));
    let seen = 0;
    for (let bin = 0; bin < BINS; bin += 1) {
      seen += counts[bin];
      if (seen > wanted) return bin;
    }
    return BINS - 1;
  };
  const median = binAt(0.5);
  const light = textLuminance >= lums[median] / counts[median];
  const at = light ? 1 - share : share;
  const bin = binAt(at);
  const n = counts[bin];
  return {
    pixels,
    percentile: Math.round(at * 1000) / 10,
    shown,
    rgb: [sums[bin * 3] / n, sums[bin * 3 + 1] / n, sums[bin * 3 + 2] / n],
    luminance: lums[bin] / n,
  };
}

export interface Verdict {
  ratio: number;
  required: number;
  large: boolean;
  /** The text's color as it shows over the background (its opacity applied). */
  text: Rgb;
  background: Background;
}

/**
 * A piece of text against the background under the boxes where it shows (`whole`: the area of its
 * whole lines, Placement). Null when its color cannot be read, or too little of it shows.
 */
export function judge(item: TextItem, shot: Shot, segments: Segment[], whole = 0): Verdict | null {
  const color = parseColor(item.color);
  if (!color) return null;
  const alpha = color.alpha * item.opacity;
  if (alpha < 0.01) return null;
  const background = sampleBackground(shot, segments, luminance(color.rgb), whole);
  if (!background) return null;
  const text = alpha >= 0.999 ? color.rgb : over(color.rgb, alpha, background.rgb);
  return {
    ratio: ratio(luminance(text), background.luminance),
    required: requiredRatio(item.fontSize, item.fontWeight),
    large: isLargeText(item.fontSize, item.fontWeight),
    text,
    background,
  };
}

/** Why a piece of text that showed got no verdict there (judge gave null), for messages. */
export function unjudgedBecause(item: TextItem, placement: Placement): string {
  const color = parseColor(item.color);
  if (!color) return `its color, ${item.color}, cannot be read`;
  if (color.alpha * item.opacity < 0.01) return `it is transparent (${item.color}, opacity ${item.opacity.toFixed(2)})`;
  const area = areaOf(placement.segments);
  return `${Math.round((100 * area) / Math.max(area, placement.whole))} percent of its lines showed, under a twentieth`;
}

// ---------------------------------------------------------------------------------------------
// Looking at a page: one look, every look down the page, and what they found
// ---------------------------------------------------------------------------------------------

/** Takes a screenshot of the window. */
export type Shoot = () => Promise<Raster>;

/**
 * The DevTools protocol's own screenshot, PNG encoded for speed, decoded: the window as it is, with
 * none of the waits page.screenshot() adds, for the many screenshots of one page.
 */
export async function shooter(page: Page): Promise<Shoot> {
  const cdp = await page.context().newCDPSession(page);
  return async () => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    return decodePng(Buffer.from(data, 'base64'));
  };
}

/** One look at the window: the text on the page, where each piece shows, and the pixels under it. */
export interface Look {
  items: TextItem[];
  placements: Placement[];
  shot: Shot;
}

/** How many times a look is taken again when the page replaces text it placed before the screenshot. */
const LOOK_TRIES = 3;

/**
 * Reads the text and where it shows (readText), then photographs the window (the text transparent).
 * Where the page replaced a piece of text it had placed in the moment between the two (a strip
 * trading places with its moving form as it nears the view), it looks again, up to three times.
 * `only` limits the placing to some keys.
 */
export async function look(page: Page, shoot: Shoot, only: string[] | null = null): Promise<Look> {
  for (let tries = 1; ; tries += 1) {
    const { items, placements } = await page.evaluate(readText, only);
    const shot = prepareShot(await shoot());
    if (await page.evaluate(stillThere)) return { items, placements, shot };
    if (tries >= LOOK_TRIES) throw new Error(`the page replaced text it showed while the window was photographed, ${LOOK_TRIES} times running`);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
}

/** Where the window stood for a look: the scroll position, the distance to the next one, and the dawn's strength. */
export interface Position {
  y: number;
  next: number;
  dawn: number | null;
}

/** A verdict, and the position it was given at. */
export interface Judged {
  position: Position;
  verdict: Verdict;
}

/** One piece of text across every look at a page. */
export interface Track {
  key: string;
  /** As the last look found it: its element and words, its color, size and opacity. */
  item: TextItem;
  /** Each position where it showed, and why it got no verdict there when it got none. */
  shown: { position: Position; unjudged: string | null }[];
  /** Its verdict at each position where it got one. */
  judged: Judged[];
}

/** What every look at a page found, by piece of text (TextItem.key). */
export class Tally {
  readonly tracks = new Map<string, Track>();

  /** Notes one look: the text that showed, and its verdicts (judge, by the piece's place in the look). */
  add(position: Position, found: Pick<Look, 'items' | 'placements'>, verdicts: Map<number, Verdict>): void {
    for (const placement of found.placements) {
      const item = found.items[placement.i];
      let track = this.tracks.get(item.key);
      if (!track) this.tracks.set(item.key, (track = { key: item.key, item, shown: [], judged: [] }));
      track.item = item;
      const verdict = verdicts.get(placement.i);
      track.shown.push({ position, unjudged: verdict ? null : unjudgedBecause(item, placement) });
      if (verdict) track.judged.push({ position, verdict });
    }
  }

  /** The text that is not exempt and got a verdict somewhere. */
  checked(): Track[] {
    return [...this.tracks.values()].filter((track) => !track.item.exempt && track.judged.length > 0);
  }

  /** The text that showed somewhere but got no verdict anywhere, exempt text apart. */
  unjudged(): Track[] {
    return [...this.tracks.values()].filter((track) => !track.item.exempt && track.judged.length === 0);
  }
}

/** A track's lowest verdict. */
export function worstOf(track: Track): Judged | null {
  return track.judged.reduce<Judged | null>((worst, judged) => (!worst || judged.verdict.ratio < worst.verdict.ratio ? judged : worst), null);
}

/** Every position where a track failed, lowest ratio first. */
export function failuresOf(track: Track): Judged[] {
  return track.judged.filter((judged) => judged.verdict.ratio < judged.verdict.required).sort((a, b) => a.verdict.ratio - b.verdict.ratio);
}

/** The pieces of text that failed over the brightest sky, as the real hours left them (confirmOverHours). */
export interface HourCheck {
  /** Each piece that fails over a real hour: the position and the verdict, and the first such hour found. */
  confirmed: Map<string, { judged: Judged; hour: number }>;
  /** Each piece that could not be judged at some hour where it was checked: those hours, and where. */
  unread: Map<string, string[]>;
}

/**
 * Checks each piece of text that failed over the brightest sky against each of `hours` real stills,
 * at every position where it failed, until it fails over one: `judgeAt` judges the given keys at a
 * position over one hour's still. Each piece is checked first where it was worst (its lowest
 * ratio), then everywhere else it failed; the pieces at one position are checked together, hour by
 * hour, and a piece found failing is not checked again. A piece in neither map of the result passed
 * over every hour at every position where it failed: it failed only over their combination.
 */
export async function confirmOverHours(
  failing: Track[],
  hours: number,
  judgeAt: (position: Position, hour: number, keys: string[]) => Promise<Map<string, Verdict>>,
): Promise<HourCheck> {
  const confirmed = new Map<string, { judged: Judged; hour: number }>();
  const unread = new Map<string, string[]>();
  for (const round of [(failed: Judged[]) => failed.slice(0, 1), (failed: Judged[]) => failed.slice(1)]) {
    const byPosition = new Map<number, { position: Position; keys: string[] }>();
    for (const track of failing) {
      for (const { position } of round(failuresOf(track))) {
        const at = byPosition.get(position.y) ?? { position, keys: [] };
        at.keys.push(track.key);
        byPosition.set(position.y, at);
      }
    }
    for (const { position, keys } of [...byPosition.values()].sort((a, b) => a.position.y - b.position.y)) {
      let open = keys.filter((key) => !confirmed.has(key));
      for (let hour = 0; hour < hours && open.length > 0; hour += 1) {
        const verdicts = await judgeAt(position, hour, open);
        for (const key of open) {
          const verdict = verdicts.get(key);
          if (!verdict) unread.set(key, [...(unread.get(key) ?? []), `hour ${String(hour).padStart(2, '0')} at ${position.y} px`]);
          else if (verdict.ratio < verdict.required) confirmed.set(key, { judged: { position, verdict }, hour });
        }
        open = open.filter((key) => !confirmed.has(key));
      }
    }
  }
  return { confirmed, unread };
}

/** Every verdict of one look, by the piece's place in it. */
export function judgeLook({ items, placements, shot }: Look): Map<number, Verdict> {
  const out = new Map<number, Verdict>();
  for (const placement of placements) {
    const verdict = judge(items[placement.i], shot, placement.segments, placement.whole);
    if (verdict) out.set(placement.i, verdict);
  }
  return out;
}

/**
 * Looks at the whole page: the top, then `step` px at a time down to its end (scrollPositions), the
 * dawn at each position set as placeAt says, the text read afresh at each (look). Call it with
 * TRANSPARENT_TEXT on. Returns what each piece of text showed and how it was judged, and the
 * positions.
 */
export async function scanPage(page: Page, shoot: Shoot, { step, dawn }: { step: number; dawn: Dawn | null }): Promise<{ tally: Tally; positions: number[] }> {
  const { scrollable } = await pageLength(page);
  const positions = scrollPositions(scrollable, step);
  const tally = new Tally();
  for (const [k, wanted] of positions.entries()) {
    const next = k + 1 < positions.length ? positions[k + 1] - wanted : 0;
    const placed = await page.evaluate(placeAt, { y: wanted, next, dawn });
    const found = await look(page, shoot);
    tally.add({ y: placed.y, next, dawn: placed.dawn }, found, judgeLook(found));
  }
  return { tally, positions };
}

/**
 * Waits until no readout is counting. A value that counts (components/sheet/ReadoutValue.tsx,
 * data-roll) shows no digits of its own while AnimateNumber, hidden from assistive technology, draws
 * them over it, and is its plain text again once the count is over; the count runs once a visit,
 * when its row first comes into view (components/sheet/readoutCount.ts). After visitWholePage every
 * row has been in view, so each count has run, or will give up and set its value, within a couple
 * of seconds; a value still counting after that fails, named.
 */
export async function waitForCounts(page: Page): Promise<void> {
  const done = await page
    .waitForFunction(() => !document.querySelector('[data-roll]'), undefined, { polling: 100, timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (done) return;
  const counting = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-roll]')).map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim()}" (${el.getAttribute('data-roll')})`),
  );
  throw new Error(`readouts still counting 10 s after the whole page was in view: ${counting.join(', ')}`);
}

/**
 * Where to look: the top, then a step at a time down to the end of the page (always the last
 * position, where the dawn is at its strongest).
 */
export function scrollPositions(scrollable: number, step: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < scrollable; y += step) out.push(Math.round(y));
  out.push(Math.max(0, Math.round(scrollable)));
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------
// The sky, held still and at its brightest
// ---------------------------------------------------------------------------------------------

/** The dawn's strength at the top and at the end of the page (holdDawn), Blueprint only. */
export interface Dawn {
  min: number;
  max: number;
}

/**
 * In the page, before its scripts: no WebGL2, so the sky's host chooses the Still tier
 * (lib/sky/tier.ts) and its live scene never loads; the page shows the pre-rendered still image of
 * the same scene, with the dawn following scroll, as a visitor without WebGL2 sees it.
 */
export function withoutWebGL(): void {
  Object.defineProperty(window, 'WebGL2RenderingContext', { value: undefined, configurable: true, writable: true });
}

/** In the page: the still's width class in use now (phone, tablet or desktop), from its image. */
export function stillClassNow(): string | null {
  const still = document.querySelector('.ar-sky__still');
  if (!still) return null;
  const value = getComputedStyle(still).getPropertyValue('--sky-still');
  return /-(phone|tablet|desktop)(-\d+)?\.(webp|png)/.exec(value)?.[1] ?? null;
}

/**
 * In the page: the per-pixel maximum of the given images (the 24 hourly stills of one class), as a
 * PNG in base64. Every pixel is at least as bright as in any of them.
 */
export async function brightestOf(urls: string[]): Promise<string> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`could not load ${src}`));
      image.src = src;
    });
  const images = await Promise.all(urls.map(load));
  const width = images[0].naturalWidth;
  const height = images[0].naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2D canvas');
  const max = new Uint8ClampedArray(width * height * 4);
  for (const image of images) {
    if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error('stills of different sizes');
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, width, height).data;
    for (let k = 0; k < data.length; k += 1) if (data[k] > max[k]) max[k] = data[k];
  }
  context.putImageData(new ImageData(max, width, height), 0, 0);
  return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}

/** In the page: shows `url` as the still of a width class, once it is decoded and painted. */
export async function showStill({ widthClass, url }: { widthClass: string; url: string }): Promise<string> {
  const image = new Image();
  image.src = url;
  await image.decode();
  document.documentElement.style.setProperty(`--sky-still-${widthClass}`, `url("${url}")`);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const still = document.querySelector('.ar-sky__still');
  return still ? getComputedStyle(still).getPropertyValue('--sky-still') : '';
}

/**
 * In the page: takes the dawn off its scroll timeline so each position can set it, and adds the
 * layer that carries its brightest row down over the ground (see placeAt): a copy of the still and
 * the dawn, cut to one row just above the horizon and stretched downward. Blueprint only;
 * Whiteprint has no dawn.
 */
export function holdDawn(): Dawn | null {
  const sky = document.querySelector<HTMLElement>('.ar-sky');
  const still = sky?.querySelector<HTMLElement>('.ar-sky__still');
  const dawn = sky?.querySelector<HTMLElement>('.ar-sky__dawn');
  if (!sky || !still || !dawn || getComputedStyle(dawn).display === 'none') return null;
  const read = (name: string) => Number.parseFloat(getComputedStyle(sky).getPropertyValue(name));
  const min = read('--sky-dawn-min');
  const max = read('--sky-dawn-max');
  dawn.style.animation = 'none';
  const carry = document.createElement('div');
  carry.className = 'e2e-dawn-carry';
  carry.setAttribute('aria-hidden', 'true');
  // The row 3 px above the horizon, clear of the horizon line the still draws there.
  const row = 3;
  carry.style.cssText = [
    'position:absolute',
    'inset:0',
    'pointer-events:none',
    'display:none',
    `clip-path:inset(calc(var(--horizon) - ${row}px) 0 calc(100% - var(--horizon) + ${row - 1}px) 0)`,
    `transform-origin:50% calc(var(--horizon) - ${row}px)`,
  ].join(';');
  const dawnCopy = dawn.cloneNode(false) as HTMLElement;
  dawnCopy.style.animation = 'none';
  // The still's row is blurred along itself first: stretched down, a star on it would become a
  // streak that no visitor ever sees, while the sky's glow and the Milky Way keep their level.
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const filter = document.createElementNS(SVG, 'filter');
  for (const [name, value] of [['id', 'e2e-row-blur'], ['x', '-5%'], ['y', '0'], ['width', '110%'], ['height', '100%']]) filter.setAttribute(name, value);
  const blur = document.createElementNS(SVG, 'feGaussianBlur');
  blur.setAttribute('stdDeviation', '8 0');
  filter.append(blur);
  svg.append(filter);
  const stillCopy = still.cloneNode(false) as HTMLElement;
  stillCopy.style.filter = 'url(#e2e-row-blur)';
  carry.append(svg, stillCopy, dawnCopy);
  dawn.after(carry);
  return { min, max };
}

/**
 * In the page: scrolls to `y` and sets the dawn for the stretch of scrolling up to the next
 * position, `next` px further, at its worst for every piece of text on screen:
 * - its strength is the one it reaches at the end of the stretch (it grows with scroll);
 * - the text moves up `next` px over the stretch, so text up to `next` px below the horizon
 *   crosses it, where the dawn is brightest: the sky's row just above the horizon (the still and
 *   the dawn's amber bottom stop, at the dawn's strength) is carried down over those `next` px.
 *   Above the horizon the dawn only dims upward, so the text's worst there is where it is now.
 * Then waits for two frames. Returns the scroll position reached and the dawn's strength.
 */
export async function placeAt({ y, next, dawn }: { y: number; next: number; dawn: Dawn | null }): Promise<{ y: number; dawn: number | null }> {
  window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  let strength: number | null = null;
  if (dawn) {
    const scroller = document.scrollingElement ?? document.documentElement;
    const scrollable = scroller.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, (window.scrollY + next) / scrollable)) : 0;
    strength = dawn.min + (dawn.max - dawn.min) * progress;
    for (const layer of Array.from(document.querySelectorAll<HTMLElement>('.ar-sky__dawn'))) layer.style.opacity = String(strength);
    const carry = document.querySelector<HTMLElement>('.e2e-dawn-carry');
    if (carry) {
      const span = Math.max(0, Math.round(next));
      carry.style.display = span > 0 ? 'block' : 'none';
      carry.style.transform = `scaleY(${span + 3})`;
    }
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return { y: window.scrollY, dawn: strength };
}

/** The page's scrollable length and the window's height. */
export function pageLength(page: Page): Promise<{ scrollable: number; height: number }> {
  return page.evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    return { scrollable: Math.max(0, scroller.scrollHeight - window.innerHeight), height: window.innerHeight };
  });
}
