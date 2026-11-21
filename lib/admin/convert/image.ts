/**
 * Photos (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-24, D-30, Q-21): JPEG, PNG, WebP, AVIF, GIF, and
 * HEIC are decoded with their orientation applied, resized to at most 2560 px on the long side,
 * and encoded as WebP. The original is never kept, and since only the pixels are encoded again,
 * no metadata (camera, place, time) survives. HEIC goes through libheif-js only in a browser that
 * cannot decode it itself. A PNG that looks like a drawing (transparency, few colors, or a few main
 * colors covering almost every pixel) is encoded losslessly, through @jsquash/webp, and at quality
 * 0.92 by the browser when that encoder cannot run.
 */
import type { Detected } from './detect';
import { CONVERT_MESSAGES as M } from './messages';
import { PrepareError, type PreparedUpload } from './types';
import {
  DRAWING_MAX_COLORS,
  DRAWING_QUALITY,
  fitWithin,
  originalOf,
  outputName,
  PHOTO_MAX_SIDE,
  PHOTO_QUALITY,
  readBytes,
  throwIfAborted,
  yieldToBrowser,
  type PrepareContext,
} from './util';
import { drawScaled, encodeWebP, looksLikeDrawing, pixelsOf, releaseRaster } from './webp';

interface Decoded {
  image: ImageBitmap;
  width: number;
  height: number;
}

/** Decodes a HEIC photo with libheif-js (LGPL-3.0, loaded only here, Q-21). */
async function decodeHeic(file: File, context: PrepareContext): Promise<Decoded> {
  const bytes = await readBytes(file);
  throwIfAborted(context.signal);
  const { default: libheif } = await import('libheif-js/libheif-wasm/libheif-bundle.mjs');
  await yieldToBrowser();
  const library = libheif();
  const decoder = new library.HeifDecoder();
  try {
    const images = decoder.decode(bytes);
    const image = images.find((candidate) => candidate.is_primary()) ?? images[0];
    if (!image) throw new Error('no image');
    const width = image.get_width();
    const height = image.get_height();
    const pixels = new ImageData(width, height);
    await new Promise<void>((resolve, reject) => {
      image.display(pixels, (result) => (result ? resolve() : reject(new Error('decoding failed'))));
    });
    for (const each of images) each.free();
    const bitmap = await createImageBitmap(pixels);
    return { image: bitmap, width: bitmap.width, height: bitmap.height };
  } finally {
    if (decoder.decoder) library.heif_context_free(decoder.decoder);
  }
}

/**
 * Decodes with the orientation the file records applied. A browser that does not know the
 * 'from-image' value refuses the options object, and its default applies the orientation too.
 */
async function bitmapOf(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file);
  }
}

async function decodePhoto(file: File, detected: Detected, context: PrepareContext): Promise<Decoded> {
  try {
    const bitmap = await bitmapOf(file);
    return { image: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    if (detected.format !== 'heic') throw new PrepareError('image-unreadable', file.name, M.imageUnreadable);
  }
  try {
    return await decodeHeic(file, context);
  } catch (error) {
    if (error instanceof PrepareError || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new PrepareError('heic-unreadable', file.name, M.heicUnreadable);
  }
}

/** Prepares one photo: a WebP of at most 2560 px, and its size. */
export async function prepareImage(file: File, detected: Detected, context: PrepareContext): Promise<PreparedUpload> {
  context.progress('decode');
  const decoded = await decodePhoto(file, detected, context);
  try {
    throwIfAborted(context.signal);
    if (detected.animated) context.warn('animation-dropped', M.animationDropped);
    const size = fitWithin(decoded.width, decoded.height, PHOTO_MAX_SIDE);
    context.progress('convert');
    const raster = drawScaled(decoded.image, size.width, size.height);
    try {
      const drawing =
        detected.format === 'png' &&
        looksLikeDrawing(pixelsOf(raster).data, DRAWING_MAX_COLORS);
      await yieldToBrowser();
      throwIfAborted(context.signal);
      context.progress('compress');
      let blob: Blob;
      try {
        blob = await encodeWebP(raster, drawing ? { quality: DRAWING_QUALITY, lossless: true } : { quality: PHOTO_QUALITY });
      } catch {
        throw new PrepareError('webp-failed', file.name, M.webpFailed);
      }
      throwIfAborted(context.signal);
      return {
        kind: 'image',
        mediaKind: 'image',
        original: originalOf(file),
        parts: [{ role: 'main', name: outputName(file.name, 'webp'), blob, contentType: 'image/webp' }],
        meta: { width: size.width, height: size.height },
        warnings: context.warnings,
      };
    } finally {
      releaseRaster(raster);
    }
  } finally {
    decoded.image.close();
  }
}
