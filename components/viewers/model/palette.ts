/**
 * The colors the 3D views draw with, read from the page's CSS at run time, so the canvas follows
 * the theme and the design tokens without a color written in code (DESIGN_DIRECTION.md 2):
 *
 * - `line`: the link color (the computed color of `.text-link`), for Blueprint edges and leaders;
 * - `panel`: the panel color (the background of `.viewer-frame`), for the Blueprint sheet;
 * - `ramp`: the seven thermal stops `--t0` to `--t6`, used only by the Thermal view (2.4, item 8).
 */

/** A color as sRGB channels from 0 to 1. */
export type Rgb = [number, number, number];

export interface ModelPalette {
  line: Rgb;
  panel: Rgb;
  ramp: Rgb[];
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

export function readPalette(host: HTMLElement): ModelPalette {
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

    probe.className = 'text-link';
    const linkComputed = getComputedStyle(probe).color;
    probe.className = '';
    const link = linkComputed !== sentinel ? toRgb(linkComputed) : null;
    const line = link?.rgb ?? resolve(['rgb(var(--accent))', 'var(--accent)', 'var(--line)']) ?? [1, 1, 1];

    // The panel color is the viewer frame's own background, read from a still copy of the class.
    probe.className = 'viewer-frame';
    const frameBackground = toRgb(getComputedStyle(probe).backgroundColor);
    probe.className = '';
    const panel =
      frameBackground && frameBackground.alpha > 0.99
        ? frameBackground.rgb
        : (resolve(['rgb(var(--surface))', 'var(--surface)', 'var(--sheet-2)']) ?? [0, 0, 0]);

    const stops = Array.from({ length: 7 }, (_, i) => resolve([`var(--t${i})`]));
    const ramp = stops.every((stop): stop is Rgb => stop !== null) ? stops : grayRamp();

    return { line, panel, ramp };
  } finally {
    outer.remove();
  }
}

export function samePalette(a: ModelPalette | null, b: ModelPalette | null): boolean {
  if (!a || !b) return a === b;
  const same = (x: Rgb, y: Rgb) => x.every((v, i) => Math.abs(v - y[i]) < 1e-4);
  return same(a.line, b.line) && same(a.panel, b.panel) && a.ramp.every((stop, i) => same(stop, b.ramp[i]));
}
