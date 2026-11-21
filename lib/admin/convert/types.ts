/**
 * The contract between the admin's media library (components/admin/media/) and the in-browser
 * preparation of uploads (lib/admin/convert/): ARCHITECTURE.md 13A, docs/V3_PLAN.md D-23 to D-30,
 * D-81, Q-18 to Q-24.
 *
 * `prepareUploads(files)` takes what the owner dropped, groups companion files (a glTF with its
 * .bin and textures, an OBJ with its .mtl), detects each group's type from its bytes, converts it
 * in the browser, and returns one `PreparedUpload` per group: the file to store, its poster, and
 * what the library and the content check need to know. Nothing here talks to the server; the
 * library runs the text check (/api/check) and the upload.
 *
 * Every heavy library (mediabunny, libheif-js, @jsquash/webp, pdf.js, three.js loaders,
 * @gltf-transform, meshoptimizer, occt-import-js) is loaded with a dynamic import or inside a
 * worker, only when a file needs it, so none of it reaches any page's first load.
 */
import type { MediaRef } from '@/lib/types';

/** What a prepared file is, which decides its blocks and its viewer. */
export type UploadKind =
  | 'image' //   photo: stored as WebP, at most 2560 px, metadata dropped
  | 'drawing' // SVG: stored as uploaded, sanitized on the server, repository only
  | 'video' //   MP4 or WebM; MOV re-wrapped to MP4
  | 'document' // PDF or DOCX
  | 'office' //  other office formats: a `file` download
  | 'model' //   one compressed GLB
  | 'audio' //   MP3 or M4A; WAV converted to AAC (.m4a)
  | 'captions' // WebVTT
  | 'file'; //   anything else that is allowed: a `file` download

export interface PreparedPart {
  role: 'main' | 'poster';
  /** The name to store, with the extension that matches `contentType`. The server cleans it again. */
  name: string;
  blob: Blob;
  contentType: string;
}

export interface PreparedUpload {
  kind: UploadKind;
  /** The `MediaRef.kind` this file fills, or null for captions, office files, and other downloads. */
  mediaKind: MediaRef['kind'] | null;
  /** The file as the owner dropped it (the main file of a group). */
  original: { name: string; size: number; type: string };
  /** The main file first, then the poster when there is one. */
  parts: PreparedPart[];
  meta: {
    /** Pixel size of the image, or of the poster for video, models, and documents. */
    width?: number;
    height?: number;
    durationSec?: number;
    /** Models: triangles after conversion. */
    triangles?: number;
    /** Models: every name the stored GLB holds (nodes, meshes, materials, animations, scenes, textures, extras), each once, with no cap; the content check reads them all (D-24). */
    partNames?: string[];
    /** Audio: peak levels from 0 to 1 for `MediaRef.waveform` (at most 4096). */
    waveform?: number[];
    /** Documents and captions: the text the content check reads, document properties included. */
    text?: string;
    /** Video: the codec found ("avc1", "hvc1", "vp09", ...). */
    codec?: string;
    /** Documents: page count, when known. */
    pages?: number;
  };
  /**
   * Plain sentences the library shows before the upload. A warning with `confirm: true` must be
   * accepted by the owner before the file is stored (HEVC video, metadata that could not be
   * removed, a file whose text could not be read for the content check).
   */
  warnings: { code: string; message: string; confirm: boolean }[];
}

export interface PrepareProgress {
  /** Which group, by the main file's name. */
  file: string;
  /** "detect", "decode", "convert", "compress", "poster", "text", "done". */
  stage: string;
  /** 0 to 1 within the stage, when known. */
  fraction?: number;
}

export interface PrepareOptions {
  onProgress?: (progress: PrepareProgress) => void;
  signal?: AbortSignal;
}

/** A file that cannot be prepared, with a plain message for the owner ("This STEP file is too complex to convert..."). */
export class PrepareError extends Error {
  readonly code: string;
  readonly file: string;
  constructor(code: string, file: string, message: string) {
    super(message);
    this.name = 'PrepareError';
    this.code = code;
    this.file = file;
  }
}

/** One group of dropped files: a main file and its companions. */
export interface FileGroup {
  main: File;
  companions: File[];
}

/** The signature `lib/admin/convert/index.ts` exports. */
export type PrepareUploads = (
  files: readonly File[],
  options?: PrepareOptions,
) => Promise<{ prepared: PreparedUpload[]; failed: PrepareError[] }>;
