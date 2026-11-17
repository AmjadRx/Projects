/**
 * Media helpers that run anywhere (server and browser). File-system work, such as reading an
 * image's size, lives in lib/media-server.ts.
 *
 * Viewers receive `ResolvedMedia`: a small, serializable object built on the server from a
 * MediaRef. It never carries fields the page does not show.
 */
import type { MediaRef } from './types';

export type MediaKind = MediaRef['kind'];

export interface ResolvedImage {
  src: string;
  /** Intrinsic size, when the server could read it. Used to reserve space (no layout shift). */
  width?: number;
  height?: number;
}

export interface ResolvedFile {
  /** The address the viewer loads. */
  src: string;
  /** The file name shown to visitors and used for downloads. */
  name: string;
  /** Lower-case extension without the dot ("pdf"). */
  ext: string;
  /** A plain description of the type ("PDF document"). */
  typeLabel: string;
  /** Size in bytes, when known (files in the repository). */
  sizeBytes?: number;
  /**
   * The address of the download link beside the viewer. Empty when the file is not offered:
   * its bytes are not the type its extension names (docs/V3_PLAN.md R-16), so a raw download
   * would hand visitors a mislabelled file. The viewer still shows it, resized.
   */
  downloadHref: string;
}

export interface EmbedInfo {
  provider: 'YouTube' | 'Vimeo';
  id: string;
  /** The player address, built from a validated id on an allow-listed host. */
  embedUrl: string;
  /** The video's page on the provider's site. */
  watchUrl: string;
}

export interface ResolvedMedia {
  kind: MediaKind;
  file: ResolvedFile;
  /** The content's alt text, exactly as stored ('' when empty). */
  alt: string;
  caption?: string;
  /** The still image to paint first: the image itself for photos, `poster` for the rest. */
  poster?: ResolvedImage;
  /** Intrinsic size of an image, or of the poster for other kinds. */
  width?: number;
  height?: number;
  /** Focal point as fractions from 0 to 1 (0.5, 0.5 is the center). */
  focal?: { x: number; y: number };
  /** A WebVTT captions file for video. */
  captionsSrc?: string;
  store: 'repo' | 'blob';
  /** Set when kind is "embed": a YouTube or Vimeo video. */
  embed?: EmbedInfo;
  /**
   * For audio: peak levels from 0 to 1, computed at upload (ARCHITECTURE.md 13A). Absent: the
   * player shows a plain progress bar and never fetches the file to draw a waveform.
   */
  waveform?: number[];
}

/**
 * The share of a box's width that a contained picture covers: 1 when the picture is at least as
 * wide for its height as the box, less when it is narrower (a portrait photo in a 4:3 cell).
 */
export function drawnFraction(natural: { width: number; height: number } | undefined, boxRatio: number): number {
  if (!natural || !(boxRatio > 0)) return 1;
  const ratio = natural.width / natural.height;
  return ratio > 0 && ratio < boxRatio ? ratio / boxRatio : 1;
}

/** Splits a `sizes` value on the commas that are not inside parentheses. */
function sizeEntries(sizes: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    const ch = sizes[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      entries.push(sizes.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(sizes.slice(start));
  return entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
}

const PLAIN_LENGTH = /^(.*?)(\d*\.?\d+)(px|vw|vh|vmin|vmax|em|rem)$/i;

/** One "[media condition] length" entry with its length multiplied by `fraction`. */
function scaleEntry(entry: string, fraction: number): string {
  const plain = PLAIN_LENGTH.exec(entry);
  if (plain) {
    const [, condition, number, unit] = plain;
    if (condition !== '' && !/\s$/.test(condition)) return entry;
    // Whole numbers, rounded up: next/image reads the vw values to choose its candidate widths.
    return `${condition}${Math.max(1, Math.ceil(Number(number) * fraction))}${unit}`;
  }
  if (!entry.endsWith(')')) return entry;
  // A function at the end, such as calc() or min(): wrap it.
  let depth = 0;
  let open = entry.length - 1;
  for (; open >= 0; open -= 1) {
    if (entry[open] === ')') depth += 1;
    else if (entry[open] === '(' && --depth === 0) break;
  }
  let name = open;
  while (name > 0 && /[a-z-]/i.test(entry[name - 1])) name -= 1;
  if (open <= 0 || name === open) return entry;
  const condition = entry.slice(0, name);
  if (condition !== '' && !/\s$/.test(condition)) return entry;
  return `${condition}calc(${entry.slice(name)} * ${Math.round(fraction * 10000) / 10000})`;
}

/**
 * A `sizes` value for a picture drawn at `fraction` (0 to 1) of the width that `sizes`
 * describes: every length is scaled, so a contained portrait photo is fetched as wide as it is
 * drawn rather than as wide as its box (ARCHITECTURE.md 9).
 */
export function scaleSizes(sizes: string, fraction: number): string {
  if (!(fraction > 0) || fraction >= 0.999) return sizes;
  return sizeEntries(sizes)
    .map((entry) => scaleEntry(entry, fraction))
    .join(', ');
}

/**
 * True when a media address may reach the page: a path on this site ("/media/...", but not a
 * protocol-relative "//host" or "/\host") or an https address. Anything else, such as
 * `javascript:`, `data:`, or plain `http:`, is treated as no file (docs/V3_PLAN.md D-29, D-45).
 */
export function isSafeMediaSrc(src: string): boolean {
  const s = src.trim();
  if (s.startsWith('/')) return !s.startsWith('//') && !s.startsWith('/\\');
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
}

/** True when the reference points at a file. An empty `src` means "no media yet". */
export function hasMedia(ref: Pick<MediaRef, 'src'> | undefined | null): ref is MediaRef {
  return !!ref && typeof ref.src === 'string' && ref.src.trim() !== '';
}

export function isBlobUrl(src: string): boolean {
  try {
    return new URL(src).hostname.endsWith('.public.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

export function isRemoteUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

export function fileNameOf(src: string): string {
  const clean = src.split(/[?#]/)[0];
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(name) || 'file';
  } catch {
    return name || 'file';
  }
}

export function extensionOf(src: string): string {
  const name = fileNameOf(src);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const TYPE_LABELS: Record<string, string> = {
  jpg: 'JPEG image',
  jpeg: 'JPEG image',
  png: 'PNG image',
  webp: 'WebP image',
  avif: 'AVIF image',
  gif: 'GIF image',
  svg: 'SVG drawing',
  mp4: 'MP4 video',
  m4v: 'MP4 video',
  webm: 'WebM video',
  mov: 'MOV video',
  pdf: 'PDF document',
  docx: 'Word document',
  doc: 'Word document',
  xlsx: 'Excel workbook',
  pptx: 'PowerPoint deck',
  csv: 'CSV data',
  txt: 'Text file',
  zip: 'ZIP archive',
  glb: 'GLB 3D model',
  gltf: 'glTF 3D model',
  stl: 'STL 3D model',
  obj: 'OBJ 3D model',
  '3mf': '3MF 3D model',
  ply: 'PLY 3D model',
  step: 'STEP CAD file',
  stp: 'STEP CAD file',
  mp3: 'MP3 audio',
  m4a: 'M4A audio',
  aac: 'AAC audio',
  wav: 'WAV audio',
  ogg: 'Ogg audio',
  vtt: 'WebVTT captions',
};

export function typeLabelOf(src: string): string {
  const ext = extensionOf(src);
  return TYPE_LABELS[ext] ?? (ext ? `${ext.toUpperCase()} file` : 'File');
}

/** "184 kB", "4.4 MB": decimal units, as file managers on phones show them. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/** The download address: Blob files use Blob's download address (docs/V3_PLAN.md D-27). */
export function downloadHrefOf(src: string): string {
  if (isBlobUrl(src)) return `${src}${src.includes('?') ? '&' : '?'}download=1`;
  return src;
}

/** Document type by extension: PDF or Word. Other office formats are plain downloads. */
export function documentTypeOf(src: string): 'pdf' | 'docx' | null {
  const ext = extensionOf(src);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  return null;
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{5,12}$/;
const VIMEO_HASH = /^[a-f0-9]{6,20}$/i;

/**
 * Parses a YouTube or Vimeo address into a player address on an exact host allow-list, built
 * from a validated id (docs/V3_PLAN.md D-45). Anything else returns null.
 */
export function parseEmbed(url: string): EmbedInfo | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split('/').filter(Boolean);

  if (YOUTUBE_HOSTS.has(host)) {
    let id: string | null = null;
    if (host === 'youtu.be') id = parts[0] ?? null;
    else if (parts[0] === 'watch') id = parsed.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1] ?? null;
    if (!id || !YOUTUBE_ID.test(id)) return null;
    return {
      provider: 'YouTube',
      id,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
      watchUrl: `https://www.youtube.com/watch?v=${id}`,
    };
  }

  if (VIMEO_HOSTS.has(host)) {
    const numeric = parts.filter((p) => VIMEO_ID.test(p));
    const id = host === 'player.vimeo.com' ? (parts[0] === 'video' ? parts[1] : null) : numeric[numeric.length - 1];
    if (!id || !VIMEO_ID.test(id)) return null;
    const index = parts.indexOf(id);
    const hashFromPath = index >= 0 ? parts[index + 1] : undefined;
    const hash = parsed.searchParams.get('h') ?? hashFromPath;
    const hashParam = hash && VIMEO_HASH.test(hash) ? `&h=${hash}` : '';
    return {
      provider: 'Vimeo',
      id,
      embedUrl: `https://player.vimeo.com/video/${id}?dnt=1&autoplay=1${hashParam}`,
      watchUrl: `https://vimeo.com/${id}`,
    };
  }
  return null;
}

/** CSS object-position from a focal point (fractions from 0 to 1). */
export function objectPosition(focal: { x: number; y: number } | undefined): string | undefined {
  if (!focal) return undefined;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return `${Math.round(clamp(focal.x) * 100)}% ${Math.round(clamp(focal.y) * 100)}%`;
}

/** Width over height, or a fallback when the size is unknown. */
export function aspectOf(media: { width?: number; height?: number } | undefined, fallback = 16 / 9): number {
  if (media?.width && media?.height && media.width > 0 && media.height > 0) return media.width / media.height;
  return fallback;
}
