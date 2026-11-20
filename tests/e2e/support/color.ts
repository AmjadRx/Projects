/**
 * Color arithmetic for the contrast checks (WCAG 2.2, 1.4.3 and 1.4.11): relative luminance, the
 * contrast ratio, compositing a color over another, and reading the CSS colors a browser computes.
 * Pure functions with no browser and no Node API, shared by the end-to-end suite
 * (tests/e2e/contrast.spec.ts) and the unit tests (tests/token-contrast.test.ts).
 */

/** An sRGB color as 0 to 255 channels (fractions allowed, from compositing). */
export type Rgb = [number, number, number];

/** A color with its alpha, 0 to 1. */
export interface Rgba {
  rgb: Rgb;
  alpha: number;
}

/** One sRGB channel, 0 to 255, as linear light. */
export function linear(channel: number): number {
  const s = Math.min(1, Math.max(0, channel / 255));
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (WCAG 2.2), 0 for black to 1 for white. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast ratio of two luminances, 1 to 21. */
export function ratio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** The contrast ratio of two opaque colors. */
export function contrast(a: Rgb, b: Rgb): number {
  return ratio(luminance(a), luminance(b));
}

/** `top` at `alpha` over `bottom`, as a browser composites (in sRGB). */
export function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return [0, 1, 2].map((i) => top[i] * alpha + bottom[i] * (1 - alpha)) as Rgb;
}

/** `color-mix(in srgb, a p%, b)` for opaque colors. */
export function mix(a: Rgb, share: number, b: Rgb): Rgb {
  return over(a, share, b);
}

/** A color as #rrggbb, for messages. */
export function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A CSS color as the browser computes it, or as a token writes it: #rgb, #rrggbb, #rrggbbaa,
 * rgb() and rgba() (comma or space syntax, alpha as a number or a percentage), and
 * color(srgb r g b / a), which Chrome gives for color-mix(). Null for anything else.
 */
export function parseColor(text: string): Rgba | null {
  const value = text.trim().toLowerCase();
  if (value === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const hexMatch = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hexMatch) {
    let digits = hexMatch[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join('');
    if (digits.length !== 6 && digits.length !== 8) return null;
    const n = (i: number) => parseInt(digits.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], alpha: digits.length === 8 ? n(6) / 255 : 1 };
  }
  const alphaOf = (part: string | undefined) => {
    if (part === undefined || part === '') return 1;
    return part.endsWith('%') ? Number.parseFloat(part) / 100 : Number(part);
  };
  const rgbMatch = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (rgbMatch) return { rgb: [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])], alpha: alphaOf(rgbMatch[4]) };
  const srgbMatch = /^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (srgbMatch) {
    const c = (s: string) => Math.min(1, Math.max(0, Number(s))) * 255;
    return { rgb: [c(srgbMatch[1]), c(srgbMatch[2]), c(srgbMatch[3])], alpha: alphaOf(srgbMatch[4]) };
  }
  return null;
}

/** WCAG 2.2 1.4.3: large text is at least 24 px, or at least 18.66 px (14 pt) and bold. */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

/** The least contrast text must have (1.4.3, AA): 4.5 to 1, or 3 to 1 for large text. */
export function requiredRatio(fontSizePx: number, fontWeight: number): number {
  return isLargeText(fontSizePx, fontWeight) ? 3 : 4.5;
}
