/**
 * Small helpers shared by the upload preparation modules: names, content types, byte checks,
 * cancellation, progress, and the clean-up of object URLs. Nothing here loads a library or touches
 * a browser-only API at module level, so the tests import it under Node.
 */
import { fileTypeOf } from '@/lib/storage/rules';
import type { PrepareOptions, PreparedUpload } from './types';

// ---------------------------------------------------------------------------------------------
// Limits (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-30, Q-22)
// ---------------------------------------------------------------------------------------------

/** Photos are stored at most this many pixels on the long side. */
export const PHOTO_MAX_SIDE = 2560;
/** WebP quality for photos (canvas scale, 0 to 1). */
export const PHOTO_QUALITY = 0.85;
/** WebP quality for drawings when a lossless encoder is not available. */
export const DRAWING_QUALITY = 0.92;
/** A PNG with at most this many distinct colors is treated as a drawing. */
export const DRAWING_MAX_COLORS = 256;
/** Video posters are at most this many pixels on the long side. */
export const VIDEO_POSTER_MAX_SIDE = 1920;
/** Document posters: page 1 drawn about this wide. */
export const DOCUMENT_POSTER_WIDTH = 1600;
/** Model posters are drawn at this size. */
export const MODEL_POSTER_WIDTH = 1600;
export const MODEL_POSTER_HEIGHT = 1200;
/** WebP quality for posters (canvas scale, 0 to 1). */
export const POSTER_QUALITY = 0.85;
/** Model textures are at most this many pixels on the long side, stored as WebP. */
export const TEXTURE_MAX_SIDE = 2048;
export const TEXTURE_QUALITY = 0.9;
/** Models above this many triangles are simplified. */
export const MODEL_SIMPLIFY_ABOVE = 1_500_000;
/** Peaks per audio waveform (the schema allows at most 4096). */
export const WAVEFORM_BUCKETS = 1024;
/** STEP conversion limits (Q-22): bytes, in the decimal megabytes the storage rules use. */
export const STEP_MAX_BYTES = 50_000_000;
export const STEP_TIMEOUT_MS = 120_000;
/**
 * The most bytes of any other model (the main file and its companions together) and of a Word
 * file that the page reads (ARCHITECTURE.md 11): three.js's loaders and JSZip run on the page
 * itself, so a larger file is refused before a byte of it is read.
 */
export const MODEL_MAX_BYTES = 150_000_000;
export const DOCX_MAX_BYTES = 50_000_000;
/** How much of a file is read to recognize it. */
export const HEAD_BYTES = 65_536;

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** The last path segment of a name or a URI path. */
export function lastSegment(name: string): string {
  return String(name ?? '').split(/[\\/]/).pop() ?? '';
}

/** Lower-case extension without the dot ("photo.JPG" gives "jpg"), or "" when there is none. */
export function extOf(name: string): string {
  const segment = lastSegment(name);
  const dot = segment.lastIndexOf('.');
  return dot > 0 ? segment.slice(dot + 1).trim().toLowerCase() : '';
}

/** The name without folders and without its last extension; "file" when nothing is left. */
export function baseOf(name: string): string {
  const segment = lastSegment(name).trim();
  const dot = segment.lastIndexOf('.');
  const base = (dot > 0 ? segment.slice(0, dot) : segment).trim();
  return base || 'file';
}

/** The stored name for a converted file: the original base with the extension of the new type. */
export function outputName(original: string, ext: string): string {
  return `${baseOf(original)}.${ext}`;
}

/** The poster's name: `<base>-poster.webp`. */
export function posterName(original: string): string {
  return `${baseOf(original)}-poster.webp`;
}

/**
 * The key two names are matched by when a model refers to a companion file: the decoded last
 * segment, without a query or a fragment, in lower case ("textures/Wood%20Oak.png" and
 * "wood oak.PNG" match).
 */
export function matchKey(nameOrUri: string): string {
  let value = String(nameOrUri ?? '').trim();
  value = value.replace(/[?#].*$/, '');
  try {
    value = decodeURIComponent(value);
  } catch {
    // A malformed escape: keep the text as written.
  }
  return lastSegment(value).trim().toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------------------------

/** Office types that the storage rules do not list (D-28: they are stored as `file` downloads). */
const EXTRA_TYPES: Readonly<Record<string, string>> = {
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

/** The content type a stored file of this extension is served with. */
export function contentTypeFor(ext: string): string {
  return fileTypeOf(ext)?.contentType ?? EXTRA_TYPES[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------------------------

/** ASCII text of `length` bytes at `offset` (bytes outside the range read as nothing). */
export function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/** True when the bytes start like a WebP file: "RIFF", four size bytes, then "WEBP". */
export function isWebPBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

/** Bytes `start` to `end` of a file (the whole file by default). */
export async function readBytes(blob: Blob, start = 0, end = blob.size): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

// ---------------------------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------------------------

/** The error an aborted preparation rejects with. */
export function abortError(signal?: AbortSignal): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  return new DOMException('The upload preparation was cancelled.', 'AbortError');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/** True for the error an abort produces (ours, the signal's own reason, or a library's). */
export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted && error === signal.reason) return true;
  return error instanceof Error && error.name === 'AbortError';
}

/** Rejects when the signal aborts, for racing a step that cannot be cancelled itself. */
export function whenAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(abortError(signal));
    else signal.addEventListener('abort', () => reject(abortError(signal)), { once: true });
  });
}

/** Runs `task`, rejecting as soon as the signal aborts (the task itself may run on and is ignored). */
export function abortable<T>(task: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return task;
  return Promise.race([task, whenAborted(signal)]);
}

// ---------------------------------------------------------------------------------------------
// The context each preparation runs with
// ---------------------------------------------------------------------------------------------

/** Object URLs and other resources a preparation made, released when it ends (or is aborted). */
export class Cleanup {
  private readonly tasks: (() => void)[] = [];

  /** An object URL for the blob, revoked when the preparation ends. */
  url(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.tasks.push(() => URL.revokeObjectURL(url));
    return url;
  }

  add(task: () => void): void {
    this.tasks.push(task);
  }

  run(): void {
    while (this.tasks.length > 0) {
      const task = this.tasks.pop();
      try {
        task?.();
      } catch {
        // Releasing one resource never stops the others.
      }
    }
  }
}

export interface PrepareContext {
  /** The main file's name, as the progress events report it. */
  file: string;
  signal?: AbortSignal;
  cleanup: Cleanup;
  progress: (stage: string, fraction?: number) => void;
  warnings: PreparedUpload['warnings'];
  warn: (code: string, message: string, confirm?: boolean) => void;
}

export function createContext(file: string, options: PrepareOptions = {}): PrepareContext {
  const warnings: PreparedUpload['warnings'] = [];
  return {
    file,
    signal: options.signal,
    cleanup: new Cleanup(),
    progress: (stage, fraction) => {
      const clamped = fraction === undefined || !Number.isFinite(fraction) ? undefined : Math.min(1, Math.max(0, fraction));
      try {
        options.onProgress?.(clamped === undefined ? { file, stage } : { file, stage, fraction: clamped });
      } catch {
        // A failing progress callback never stops the preparation.
      }
    },
    warnings,
    warn: (code, message, confirm = false) => {
      if (!warnings.some((warning) => warning.code === code && warning.message === message)) {
        warnings.push({ code, message, confirm });
      }
    },
  };
}

/** The `original` record of a prepared upload. */
export function originalOf(file: File): PreparedUpload['original'] {
  return { name: file.name, size: file.size, type: file.type };
}

/** Width and height that fit `max` on the long side, never enlarged, at least 1 pixel. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Lets the browser paint and handle input between heavy steps. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
