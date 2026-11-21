/**
 * Server-only media resolution: turns a MediaRef from content into the `ResolvedMedia` a viewer
 * needs, reading intrinsic image sizes and file sizes from public/ at build time.
 */
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import {
  downloadHrefOf,
  extensionOf,
  fileNameOf,
  hasMedia,
  isBlobUrl,
  isSafeMediaSrc,
  parseEmbed,
  typeLabelOf,
  type ResolvedFile,
  type ResolvedImage,
  type ResolvedMedia,
} from './media';
import type { MediaRef } from './types';

const PUBLIC_DIR = path.join(process.cwd(), 'public');

/** The file under public/ that a site path names, or null (remote files, or a path outside public/). */
export function publicFilePath(src: string): string | null {
  if (!src.startsWith('/') || src.startsWith('//')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(src.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const full = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return null;
  return full;
}

interface ImageInfo {
  width: number;
  height: number;
  /** The format the bytes are in ("png", "jpg", "webp"), whatever the extension says. */
  type?: string;
}

const infoCache = new Map<string, ImageInfo | null>();

/** Size and real format of a local image, with EXIF rotation applied. Undefined when unknown. */
function readImageInfo(src: string): ImageInfo | undefined {
  const file = publicFilePath(src);
  if (!file) return undefined;
  if (!infoCache.has(file)) {
    let result: ImageInfo | null = null;
    try {
      const info = imageSize(fs.readFileSync(file));
      if (info.width && info.height) {
        const rotated = info.orientation !== undefined && info.orientation >= 5 && info.orientation <= 8;
        result = rotated ? { width: info.height, height: info.width } : { width: info.width, height: info.height };
        if (info.type) result.type = info.type;
      }
    } catch {
      result = null;
    }
    infoCache.set(file, result);
  }
  return infoCache.get(file) ?? undefined;
}

/** Intrinsic size of a local image, with EXIF rotation applied. Undefined when unknown. */
export function readImageSize(src: string): { width: number; height: number } | undefined {
  const info = readImageInfo(src);
  return info ? { width: info.width, height: info.height } : undefined;
}

/** Image extensions whose bytes are checked, and the format name image-size gives each. */
const IMAGE_FORMATS: Record<string, string> = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };

/**
 * False when a local image's bytes are another format than its extension names (the seed has
 * three such files, docs/V3_PLAN.md R-16 and Q-26). Next's image optimizer reads the bytes, so
 * the resized copies are right; only a raw download would be mislabelled.
 */
export function bytesMatchExtension(src: string): boolean {
  const expected = IMAGE_FORMATS[extensionOf(src)];
  if (!expected) return true;
  const actual = readImageInfo(src)?.type;
  return !actual || actual === expected;
}

/** Size in bytes of a local file. Undefined for remote files or missing files. */
export function readFileSize(src: string): number | undefined {
  const file = publicFilePath(src);
  if (!file) return undefined;
  try {
    return fs.statSync(file).size;
  } catch {
    return undefined;
  }
}

/** A still image (a poster). A local file that does not exist is left out, never drawn broken. */
export function resolveImage(src: string | undefined): ResolvedImage | undefined {
  if (!src || src.trim() === '') return undefined;
  const clean = src.trim();
  if (!isSafeMediaSrc(clean)) return undefined;
  const local = publicFilePath(clean);
  if (local && !fs.existsSync(local)) return undefined;
  const size = readImageSize(clean);
  return { src: clean, ...(size ?? {}) };
}

/**
 * The file behind a reference. Callers check `isSafeMediaSrc` first; `resolveMedia` does.
 * A file whose bytes do not match its extension gets no download address (R-16).
 */
export function resolveFile(src: string): ResolvedFile {
  const sizeBytes = readFileSize(src);
  return {
    src,
    name: fileNameOf(src),
    ext: extensionOf(src),
    typeLabel: typeLabelOf(src),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    downloadHref: bytesMatchExtension(src) ? downloadHrefOf(src) : '',
  };
}

/**
 * Resolves a MediaRef for a viewer. Returns null for an empty `src`, for an address that is
 * neither a site path nor https (docs/V3_PLAN.md D-29), and for an embed that is not a YouTube
 * or Vimeo video (D-45): the caller renders the placeholder or nothing, and nothing of the
 * reference reaches the page.
 */
export function resolveMedia(ref: MediaRef | undefined | null): ResolvedMedia | null {
  if (!hasMedia(ref)) return null;
  const src = ref.src.trim();
  if (!isSafeMediaSrc(src)) return null;
  const embed = ref.kind === 'embed' ? parseEmbed(src) : null;
  if (ref.kind === 'embed' && !embed) return null;
  const store = ref.store ?? (isBlobUrl(src) ? 'blob' : 'repo');
  const out: ResolvedMedia = {
    kind: ref.kind,
    file: resolveFile(src),
    alt: ref.alt ?? '',
    store,
  };
  if (ref.caption && ref.caption.trim() !== '') out.caption = ref.caption;
  if (ref.focal) out.focal = { x: ref.focal.x, y: ref.focal.y };

  if (ref.kind === 'image') {
    const size = readImageSize(src);
    if (size) {
      out.width = size.width;
      out.height = size.height;
    }
    out.poster = { src, ...(size ?? {}) };
  } else {
    const poster = resolveImage(ref.poster);
    if (poster) {
      out.poster = poster;
      if (poster.width && poster.height) {
        out.width = poster.width;
        out.height = poster.height;
      }
    }
  }
  if (ref.kind === 'video' && ref.captions && isSafeMediaSrc(ref.captions)) out.captionsSrc = ref.captions.trim();
  if (embed) out.embed = embed;
  if (ref.kind === 'audio' && ref.waveform && ref.waveform.length > 0) out.waveform = [...ref.waveform];
  return out;
}
