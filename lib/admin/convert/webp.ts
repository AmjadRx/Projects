/**
 * Canvases and the WebP encoder every photo, poster, and model texture goes through (docs/V3_PLAN.md
 * D-30). The browser's own encoder runs first (OffscreenCanvas.convertToBlob, or canvas.toBlob);
 * its output is checked byte by byte, because Safari answers a WebP request with PNG, and when it
 * is not WebP the same pixels are encoded with @jsquash/webp, which loads only then. Drawings use
 * the lossless mode of @jsquash/webp.
 */
import { CONVERT_MESSAGES as M } from './messages';
import { isWebPBytes } from './util';

export type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface Raster {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  context: Canvas2D;
  width: number;
  height: number;
  /** The pixels, read back once when first needed (see pixelsOf). */
  pixels?: ImageData;
}

/** A 2D canvas of the given size: an OffscreenCanvas where the browser has one. */
export function createRaster(width: number, height: number, options: CanvasRenderingContext2DSettings = {}): Raster {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', options);
    if (context) return { canvas, context, width, height };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', options);
  if (!context) throw new Error('A 2D canvas is not available.');
  return { canvas, context, width, height };
}

/** Frees a canvas's memory now rather than at garbage collection. */
export function releaseRaster(raster: Raster): void {
  raster.pixels = undefined;
  raster.canvas.width = 0;
  raster.canvas.height = 0;
}

/**
 * The raster's pixels. Reading them back from the canvas is slow, so they are read once and kept:
 * the drawing test and the WebAssembly encoder share one copy. Draw first, then read.
 */
export function pixelsOf(raster: Raster): ImageData {
  raster.pixels ??= raster.context.getImageData(0, 0, raster.width, raster.height);
  return raster.pixels;
}

/** Draws a source scaled to the raster's size, with the browser's best resampling. */
export function drawInto(raster: Raster, source: CanvasImageSource): void {
  const { context, width, height } = raster;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
}

/**
 * Halves an image until it is at most twice the target size, then draws it at the target size.
 * One large reduction in a single draw skips pixels in some browsers; steps of a half do not.
 */
export function drawScaled(source: CanvasImageSource & { width: number; height: number }, width: number, height: number): Raster {
  let current: CanvasImageSource = source;
  let currentWidth = source.width;
  let currentHeight = source.height;
  let previous: Raster | null = null;
  while (currentWidth > width * 2 && currentHeight > height * 2) {
    const step = createRaster(Math.max(width, Math.round(currentWidth / 2)), Math.max(height, Math.round(currentHeight / 2)));
    drawInto(step, current);
    if (previous) releaseRaster(previous);
    previous = step;
    current = step.canvas;
    currentWidth = step.width;
    currentHeight = step.height;
  }
  const raster = createRaster(width, height);
  drawInto(raster, current);
  if (previous) releaseRaster(previous);
  return raster;
}

// ---------------------------------------------------------------------------------------------
// Drawings
// ---------------------------------------------------------------------------------------------

/** The number of distinct colors in RGBA pixels, counting up to `limit + 1` and then stopping. */
export function countColors(data: Uint8ClampedArray | Uint8Array, limit: number): number {
  const seen = new Set<number>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    seen.add(((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0);
    if (seen.size > limit) break;
  }
  return seen.size;
}

/** True when any pixel is not fully opaque. */
export function hasTransparency(data: Uint8ClampedArray | Uint8Array): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}

/** At most this many pixels, evenly spread, are read to judge whether a PNG is a drawing. */
const DRAWING_SAMPLE_PIXELS = 1_000_000;
/** Distinct colors tallied before the rest count as "other". */
const DRAWING_COLOR_TABLE = 4096;
/** A drawing's few main colors (paper, ink, fills) cover at least this share of its pixels. */
const DRAWING_MAIN_COLORS = 24;
const DRAWING_MAIN_SHARE = 0.85;

/**
 * True when a PNG looks like a drawing (a diagram, a screenshot, a logo) rather than a photo: it
 * has transparency, at most `maxColors` colors, or a few main colors covering almost every pixel,
 * which is what flat areas with smoothed edges give. A photo's colors are spread far wider.
 */
export function looksLikeDrawing(data: Uint8ClampedArray | Uint8Array, maxColors: number): boolean {
  if (hasTransparency(data)) return true;
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return false;
  const step = Math.max(1, Math.floor(pixels / DRAWING_SAMPLE_PIXELS));
  const counts = new Map<number, number>();
  let sampled = 0;
  let other = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const count = counts.get(key);
    if (count !== undefined) counts.set(key, count + 1);
    else if (counts.size < DRAWING_COLOR_TABLE) counts.set(key, 1);
    else other += 1;
    sampled += 1;
  }
  if (other === 0 && counts.size <= maxColors) return true;
  const main = [...counts.values()]
    .sort((a, b) => b - a)
    .slice(0, DRAWING_MAIN_COLORS)
    .reduce((sum, count) => sum + count, 0);
  return main / sampled >= DRAWING_MAIN_SHARE;
}

// ---------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------

async function browserEncode(raster: Raster, quality: number): Promise<Blob | null> {
  const { canvas } = raster;
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/webp', quality });
  }
  return new Promise((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, 'image/webp', quality));
}

async function squashEncode(raster: Raster, options: { quality: number; lossless: boolean }): Promise<Blob> {
  const { default: encode } = await import('@jsquash/webp/encode');
  const pixels = pixelsOf(raster);
  const buffer = await encode(
    pixels,
    options.lossless
      ? // Lossless with a middle effort: drawings come out smaller than PNG without long waits.
        { lossless: 1, quality: 50, method: 3, exact: 0 }
      : { quality: Math.round(options.quality * 100), method: 4 },
  );
  return new Blob([buffer], { type: 'image/webp' });
}

async function isWebPBlob(blob: Blob | null): Promise<boolean> {
  if (!blob || blob.size < 12) return false;
  return isWebPBytes(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
}

/**
 * Encodes the raster as WebP. `quality` is 0 to 1. With `lossless`, @jsquash/webp encodes it
 * losslessly, and if that encoder cannot load, the browser encodes it at `quality`. The result is
 * always real WebP bytes, or the call throws.
 */
export async function encodeWebP(raster: Raster, options: { quality: number; lossless?: boolean }): Promise<Blob> {
  if (options.lossless) {
    try {
      return await squashEncode(raster, { quality: options.quality, lossless: true });
    } catch {
      // The lossless encoder could not load or run; the lossy path below still gives WebP.
    }
  }
  const native = await browserEncode(raster, options.quality).catch(() => null);
  if (await isWebPBlob(native)) return new Blob([native as Blob], { type: 'image/webp' });
  try {
    const squashed = await squashEncode(raster, { quality: options.quality, lossless: false });
    if (await isWebPBlob(squashed)) return squashed;
  } catch {
    // Reported below.
  }
  throw new Error(M.webpFailed);
}
