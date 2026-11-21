/**
 * The colors the 3D views draw with, read from the page's CSS variables at run time, so the canvas
 * follows the theme and the design tokens without a color written in code (bundle ModelViewer;
 * app/sheet.css 1 and 25):
 *
 * - `line`: for Blueprint edges and leaders. Inside a viewer's night well it is the night's line
 *   color (--night-line: the line color in Blueprint, on-night in Whiteprint, where the line color
 *   fails on night); on the page itself, as in the hero, it is the page's line color (--line);
 * - `panel`: the night well's color (--night), the ground of a viewer's Blueprint view;
 * - `ramp`: the seven thermal stops --t0 to --t6, used only by the Thermal view and the hero's
 *   lens (DESIGN_DIRECTION.md 2.4, items 8 and 1);
 * - `sky`: the hero's light (app/motion-model.css: --model-sky-top, --model-sky-side and
 *   --model-sky-low, the canvas's face colors for a solid lit by the sky); null where the page sets
 *   none, as in every viewer.
 */

/** A color as sRGB channels from 0 to 1. */
export type Rgb = [number, number, number];

/** Where the canvas sits: in a viewer's night well, or on the page (the hero, over the sky). */
export type ModelSurface = 'night' | 'page';

/** The light of the sky behind the hero model: from above, from the horizon, and from below. */
export interface SkyLight {
  top: Rgb;
  side: Rgb;
  low: Rgb;
}

export interface ModelPalette {
  line: Rgb;
  panel: Rgb;
  ramp: Rgb[];
  sky: SkyLight | null;
}

/** An unlikely color set on the probe's parent: a probe that inherits it found no value. */
const SENTINEL = 'rgb(1, 2, 3)';

function parseRgb(value: string): { rgb: Rgb; alpha: number } | null {
  const match = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (!match) return null;
  const alphaText = match[4];
  const alpha = alphaText === undefined ? 1 : alphaText.endsWith('%') ? Number.parseFloat(alphaText) / 100 : Number(alphaText);
  return { rgb: [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255], alpha };
}

let scratch: CanvasRenderingContext2D | null | undefined;

/** Any CSS color the browser computes (rgb, color(), oklch) as sRGB channels. */
function toRgb(value: string): { rgb: Rgb; alpha: number } | null {
  const parsed = parseRgb(value.trim());
  if (parsed) return parsed;
  if (scratch === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    scratch = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!scratch) return null;
  scratch.clearRect(0, 0, 1, 1);
  scratch.fillStyle = value;
  scratch.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = scratch.getImageData(0, 0, 1, 1).data;
  return { rgb: [r / 255, g / 255, b / 255], alpha: a / 255 };
}

function grayRamp(): Rgb[] {
  return Array.from({ length: 7 }, (_, i) => [i / 6, i / 6, i / 6] as Rgb);
}

export function readPalette(host: HTMLElement, surface: ModelSurface = 'night'): ModelPalette {
  // No transitions on the probes: under reduced motion the page gives every element a very short
  // transition, and a computed color read during one returns the old value.
  const still = 'transition:none !important;animation:none !important';
  const outer = document.createElement('span');
  outer.setAttribute('aria-hidden', 'true');
  outer.style.cssText = `position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;color:${SENTINEL};${still}`;
  const probe = document.createElement('span');
  probe.style.cssText = still;
  outer.appendChild(probe);
  host.appendChild(outer);
  try {
    const sentinel = getComputedStyle(outer).color;

    /** The first expression that resolves to a color on this page. */
    const resolve = (candidates: string[]): Rgb | null => {
      for (const candidate of candidates) {
        probe.style.color = '';
        probe.style.color = candidate;
        if (!probe.style.color) continue;
        const computed = getComputedStyle(probe).color;
        if (computed === sentinel) continue;
        const color = toRgb(computed);
        if (color) return color.rgb;
      }
      return null;
    };

    const line = resolve(surface === 'page' ? ['var(--line)'] : ['var(--night-line)', 'var(--line)']) ?? [1, 1, 1];
    const panel = resolve(['var(--night)']) ?? [0, 0, 0];

    const stops = Array.from({ length: 7 }, (_, i) => resolve([`var(--t${i})`]));
    const ramp = stops.every((stop): stop is Rgb => stop !== null) ? stops : grayRamp();

    const top = resolve(['var(--model-sky-top)']);
    const side = resolve(['var(--model-sky-side)']);
    const low = resolve(['var(--model-sky-low)']);
    const sky = top && side && low ? { top, side, low } : null;

    return { line, panel, ramp, sky };
  } finally {
    outer.remove();
  }
}

function sameRgb(x: Rgb, y: Rgb): boolean {
  return x.every((v, i) => Math.abs(v - y[i]) < 1e-4);
}

function sameSky(a: SkyLight | null, b: SkyLight | null): boolean {
  if (!a || !b) return a === b;
  return sameRgb(a.top, b.top) && sameRgb(a.side, b.side) && sameRgb(a.low, b.low);
}

export function samePalette(a: ModelPalette | null, b: ModelPalette | null): boolean {
  if (!a || !b) return a === b;
  return (
    sameRgb(a.line, b.line) &&
    sameRgb(a.panel, b.panel) &&
    a.ramp.every((stop, i) => sameRgb(stop, b.ramp[i])) &&
    sameSky(a.sky, b.sky)
  );
}
