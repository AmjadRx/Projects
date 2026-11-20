/**
 * Contrast of text over the sky, measured from screenshots (ARCHITECTURE.md 6A and 15, items 3 and
 * 6a; docs/V3_PLAN.md D-80 and R-06). axe leaves color-contrast undecided wherever text sits on the
 * sky or on glass over it, because the background is a picture, so the suite measures it: the page
 * is photographed with every piece of text painted transparent, and the pixels under each piece of
 * text give its background.
 *
 * - The text: every visible text node not hidden from assistive technology (aria-hidden, inert),
 *   with its own color (the text fill, else `color`; an SVG text's fill), its opacity down the
 *   tree, its size and weight. Text cut away by a box that clips it (a screen reader's own label,
 *   a strip's next card) and text under another layer (the sticky nav) are left out where they
 *   cannot be seen. A disabled control's words are exempt (WCAG 1.4.3, inactive components).
 * - The background: the pixels inside each line box of the text, in a screenshot taken with all
 *   text transparent (color, text fill, text stroke, text shadow, decorations, SVG text fill), read
 *   at the scale of the text: a hairline two pixels thin or less (a grid line, the horizon line, a
 *   table's rule) or a single star core is not the ground a word is read against, while a band, a
 *   glow, the dawn or a photo under glass is (backgroundAt). The statistic is conservative: for
 *   light text on a dark ground the 95th percentile of that luminance, for dark text on a light
 *   ground the 5th, so anything that covers more than a twentieth of the text decides it. Where the
 *   window's edge or a layer in front (the sticky nav) hides part of a line in passing, the
 *   twentieth is still of the whole line: a star behind the strip that shows does not decide a line
 *   it would not decide whole, while a glow or a photo under all of that strip still does.
 * - The ratio: the text's color (composited over that background where it is translucent) against
 *   the background, at least 4.5 to 1, or 3 to 1 for large text (24 px, or 18.66 px and bold).
 *
 * The page functions here run in the browser (page.evaluate) and keep what they learn in
 * `window.__e2eContrast` between calls; the rest runs in Node.
 */
import type { Page } from '@playwright/test';
import { isLargeText, linear, luminance, over, parseColor, ratio, requiredRatio, type Rgb } from './color';
import type { Raster } from './png';

/** Everything the page paints as text, made transparent (layout does not change). */
export const TRANSPARENT_TEXT = `
*, *::before, *::after, *::marker, *::placeholder, *::first-line, *::first-letter {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  -webkit-text-stroke-color: transparent !important;
  text-shadow: none !important;
  text-decoration-color: transparent !important;
  text-emphasis-color: transparent !important;
  caret-color: transparent !important;
}
svg text, svg tspan, svg textPath { fill: transparent !important; stroke: transparent !important; }
`;

/** One piece of text: a text node, as the page knows it. */
export interface TextItem {
  /** Its place in the page's list. */
  i: number;
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
 * In the page: finds every piece of text to check, keeps the nodes in window.__e2eContrast, and
 * returns what Node needs to know about each. Call before the text is made transparent.
 */
export function collectText(): TextItem[] {
  const SKIP = 'script, style, noscript, template, title, [aria-hidden="true"], [inert]';
  const state = { nodes: [] as Text[], els: [] as Element[], clips: [] as Element[][] };
  const items: TextItem[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const words = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
    if (!words) continue;
    const el = node.parentElement;
    if (!el || el.closest(SKIP)) continue;
    const style = getComputedStyle(el);
    if (style.visibility !== 'visible') continue;
    const svg = el instanceof SVGElement;
    const color = svg ? style.fill : style.webkitTextFillColor || style.color;
    let opacity = 1;
    for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    if (opacity < 0.01) continue;
    const clips: Element[] = [];
    for (let e: Element | null = el; e && e !== document.documentElement && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'contents') continue;
      const clipped =
        s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.clipPath !== 'none' || (s.clip !== '' && s.clip !== 'auto') || /\b(paint|strict|content)\b/.test(s.contain);
      if (clipped) clips.push(e);
    }
    const disabled = el.closest(':disabled, [aria-disabled="true"]');
    const classes = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
    state.nodes.push(node);
    state.els.push(el);
    state.clips.push(clips);
    items.push({
      i: items.length,
      color,
      opacity,
      fontSize: Number.parseFloat(style.fontSize) || 16,
      fontWeight: Number(style.fontWeight) || 400,
      describe: `${el.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join('')} "${words.slice(0, 48)}${words.length > 48 ? '...' : ''}"`,
      exempt: disabled ? 'a disabled control (inactive components are exempt from 1.4.3)' : null,
    });
  }
  (window as unknown as { __e2eContrast: typeof state }).__e2eContrast = state;
  return items;
}

/**
 * In the page: where each piece of text shows now, as boxes on the screen: its line boxes, cut by
 * the window and by every box that clips it, and left out where another layer lies over it (each
 * line is tested in pieces about 40 px wide). `only` limits it to some pieces.
 */
export function measureText(only: number[] | null): Placement[] {
  const state = (window as unknown as { __e2eContrast: { nodes: Text[]; els: Element[]; clips: Element[][] } }).__e2eContrast;
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  const range = document.createRange();
  const seeThrough = (e: Element) => {
    if (/^(img|video|canvas|iframe|svg|object|embed|picture|input|textarea|select)$/i.test(e.tagName)) return false;
    const s = getComputedStyle(e);
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
  const out: Placement[] = [];
  const indices = only ?? state.nodes.map((_, i) => i);
  // The layers over the page: every fixed or sticky element in front of the content (the sticky
  // nav with the heat rule along its foot, the sheet frame's bands), as the boxes of its parts
  // that paint. The sky behind everything is not one.
  const layers: { owner: Element; box: DOMRect }[] = [];
  // Which elements are fixed or sticky does not change as the page scrolls, nor which elements
  // hold the text: found once a page.
  const holder = state as unknown as { owners?: Element[]; holders?: Set<Element> };
  holder.owners ??= Array.from(document.body.querySelectorAll('*')).filter((el) => {
    const s = getComputedStyle(el);
    return (s.position === 'fixed' || s.position === 'sticky') && !el.closest('.ar-sky') && !(Number(s.zIndex) < 0);
  });
  if (!holder.holders) {
    holder.holders = new Set<Element>();
    for (const el of state.els) for (let e: Element | null = el; e && !holder.holders.has(e); e = e.parentElement) holder.holders.add(e);
  }
  // A layer's parts that paint nothing and hold no text (the sheet frame's border box over the
  // whole window) let the hit tests through, as they let the eye through.
  const clear: Element[] = [];
  for (const el of holder.owners) {
    if (layers.some((layer) => layer.owner.contains(el))) continue;
    for (const part of [el, ...Array.from(el.querySelectorAll('*'))]) {
      if (part.getClientRects().length === 0 || getComputedStyle(part).visibility === 'hidden') continue;
      if (!seeThrough(part)) layers.push({ owner: el, box: part.getBoundingClientRect() });
      else if (!holder.holders.has(part)) clear.push(part);
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
  try {
    for (const i of indices) out.push(...place(i));
  } finally {
    for (const part of clear) part.removeAttribute('data-e2e-clear');
  }
  return out;

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
  let area = 0;
  for (const [x0, y0, x1, y1] of segments) area += Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
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
export function holdDawn(): { min: number; max: number } | null {
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
export async function placeAt({ y, next, dawn }: { y: number; next: number; dawn: { min: number; max: number } | null }): Promise<{ y: number; dawn: number | null }> {
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
