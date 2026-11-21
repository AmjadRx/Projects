/**
 * The sky's colors and type, read at run time from the CSS variables of app/tokens.css as the
 * reference renderer reads them (its cssVar and rgbOf), so no color is written in code. Read when
 * the scene is created and again whenever the theme changes.
 */
import { parseCssColor, type Rgba } from './math';

/** Red, green and blue from 0 to 1. */
export type Rgb = [number, number, number];

export interface SkyColors {
  zenith: Rgb;
  mid: Rgb;
  low: Rgb;
  /** The ground below the horizon: --ground in Blueprint, the sheet in Whiteprint. */
  ground: Rgb;
  /** Blueprint's sheet; Whiteprint's ground. */
  sheet: Rgb;
  line: Rgb;
  ink: Rgb;
  /** The data face (--font-mono), for the star names. */
  mono: string;
}

let probe: CanvasRenderingContext2D | null | undefined;

/** Lets the browser normalize any other color syntax, as the reference's rgbOf does. */
function browserColor(value: string): Rgba | null {
  if (probe === undefined) probe = document.createElement('canvas').getContext('2d');
  if (!probe) return null;
  probe.fillStyle = 'transparent';
  probe.fillStyle = value;
  return parseCssColor(String(probe.fillStyle));
}

function rgbOf(style: CSSStyleDeclaration, name: string): Rgb {
  const raw = style.getPropertyValue(name).trim();
  const c = (raw && (parseCssColor(raw) ?? browserColor(raw))) || null;
  return c ? [c[0] / 255, c[1] / 255, c[2] / 255] : [0, 0, 0];
}

/** Reads the sky's colors from an element inside the page (the scene's container). */
export function readSkyColors(el: Element): SkyColors {
  const style = getComputedStyle(el);
  return {
    zenith: rgbOf(style, '--sky-zenith'),
    mid: rgbOf(style, '--sky-mid'),
    low: rgbOf(style, '--sky-low'),
    ground: rgbOf(style, '--ground'),
    sheet: rgbOf(style, '--sheet'),
    line: rgbOf(style, '--line'),
    ink: rgbOf(style, '--ink'),
    mono: style.getPropertyValue('--font-mono').trim() || 'monospace',
  };
}

/** A color for a 2D canvas: rgba() from 0 to 1 channels. */
export function cssRgba(c: Rgb, alpha: number): string {
  const ch = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${ch(c[0])}, ${ch(c[1])}, ${ch(c[2])}, ${alpha})`;
}
