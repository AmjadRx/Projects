/**
 * The type of an uploaded file, read from its bytes, and the metadata the server removes from
 * images (ARCHITECTURE.md 11 "Paths" and 13A; docs/V3_PLAN.md D-24, D-26, D-30). Server only.
 *
 * - `detectType` says what the bytes are. Binary formats come from `file-type`; text formats
 *   (SVG, WebVTT, glTF JSON, OBJ, ASCII STL, PLY, STEP, CSV and plain text) from checks here,
 *   because `file-type` reads some text as a binary format (a CSV that starts with "BM" is a
 *   bitmap to it). The name's extension is a hint for that choice only, never the answer.
 * - `sniffFile` refuses a file whose bytes are not the type its extension names (PNG bytes named
 *   .webp), a web page, XML other than SVG, a script, any refused extension, and the photo and
 *   STEP formats the media library converts in the browser, by their bytes or their name
 *   (`refuseByName`, which the Blob token route uses alone). It returns the extension to store
 *   the file under.
 * - `stripImageMetadata` removes what the server can remove from WebP and PNG files, and
 *   `scanImageMetadata` confirms that nothing of it remains (D-24: the server confirms that no
 *   EXIF remains). The scan also reads a stream, so a large file in Blob is checked without
 *   holding it in memory.
 * - `cleanEmbeddedImage` does the same for a PNG, JPEG, WebP, or GIF embedded in an SVG drawing.
 *
 * Every refusal is an ApiFailure 422 'invalid-file' with a plain sentence for the owner.
 */
import 'server-only';
import { fileTypeFromBuffer } from 'file-type';
import JSZip from 'jszip';
import { typeLabelOf } from '@/lib/media';
import { STORAGE_MESSAGES as M } from '@/lib/storage/labels';
import { fileTypeOf, REFUSED_EXTENSIONS, type FileGroup } from '@/lib/storage/rules';
import { ApiFailure } from './guard';

/** What the bytes of a file are. */
export interface Detected {
  /**
   * The canonical extension of the detected type: "webp", "png", "svg", "mp4", "docx", "txt" for
   * plain text, and for types that are never stored "html", "xml", "js", "jpg", "heic", "step"...
   */
  ext: string;
  mime: string;
  /** The FILE_TYPES group, or null for a type the stores never hold. */
  group: FileGroup | null;
  /** A web page, XML, or a script: refused in every store, whatever the name says. */
  refused: boolean;
  /** The bytes start like this type but are cut or padded (a GLB whose length is not its header's). */
  damaged?: boolean;
}

/** A file the stores may hold: the extension to store it under and the type to serve it with. */
export interface Sniffed {
  ext: string;
  mime: string;
  group: FileGroup;
}

export interface SniffOptions {
  /** The extension the file is named with. It decides between plain text and a weak binary signature. */
  hint?: string;
  /** `bytes` is only the start of the file (the Blob confirm reads the first 64 KB). */
  partial?: boolean;
  /** The whole file's size, when `partial`. A binary STL is recognized by its size. */
  totalSize?: number;
  /**
   * The entry names of a ZIP file, which tell DOCX, XLSX, PPTX, and 3MF from other ZIP files.
   * Whole files are read with JSZip; the Blob confirm passes a reader of the central directory.
   * Null when the names cannot be read.
   */
  zipNames?: () => Promise<readonly string[] | null>;
}

/** The photo formats the media library converts to WebP in the browser (D-30). */
export const PHOTO_MESSAGE = 'Upload photos through the media library, which converts them to WebP.';
/** Photo types as detected from the bytes, and the extensions a photo's name may end in. */
const PHOTO_TYPES: ReadonlySet<string> = new Set(['jpg', 'avif', 'gif', 'heic']);
const PHOTO_NAMES: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'avif', 'gif', 'heic', 'heif']);
const STEP_NAMES: ReadonlySet<string> = new Set(['step', 'stp']);
const STEP_MESSAGE = 'Upload STEP files through the media library, which converts them to one compressed GLB model.';
const UNKNOWN_MESSAGE = 'The type of this file could not be read from its contents, so it cannot be stored.';
const NOT_TEXT_MESSAGE =
  'This file is not plain UTF-8 text, so its words cannot be checked. Save it as UTF-8 text ' +
  '(for a CSV from Excel, choose CSV UTF-8) and upload it again.';
const DAMAGED_FILE =
  'This file is damaged: its contents do not match the length its header gives. Export it again and upload the new file.';
export const DAMAGED_IMAGE = 'This image file is damaged, so it cannot be checked. Export it again and upload the new file.';

function invalid(message: string): ApiFailure {
  return new ApiFailure(422, 'invalid-file', message);
}

function mismatch(detectedExt: string, nameExt: string): ApiFailure {
  return invalid(
    `This file holds ${typeLabelOf(`file.${detectedExt}`)} data, but its name ends in .${nameExt}. ` +
      'Save it under the extension of its real type and upload it again.',
  );
}

// ---------------------------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------------------------

function u16le(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32le(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function u32be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** Control characters that never appear in a text file (tab, line feed, form feed, and carriage return do). */
const CONTROL = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/;

/**
 * The bytes as UTF-8 text (a byte order mark removed), or null when they are not text: invalid
 * UTF-8, or control characters. For the start of a file, a character cut at the end is allowed.
 */
export function decodeText(bytes: Uint8Array, partial = false): string | null {
  const cuts = partial ? [0, 1, 2, 3] : [0];
  for (const cut of cuts) {
    if (cut >= bytes.byteLength) break;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.byteLength - cut));
      return CONTROL.test(text) ? null : text;
    } catch {
      // Try one byte shorter: the start of a file may end inside a character.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Text formats
// ---------------------------------------------------------------------------------------------

/** The end of a doctype, past an internal subset in brackets, or -1. */
function doctypeEnd(text: string): number {
  const close = text.indexOf('>');
  const open = text.indexOf('[');
  if (open === -1 || (close !== -1 && close < open)) return close === -1 ? -1 : close + 1;
  const subsetEnd = text.indexOf(']', open);
  if (subsetEnd === -1) return -1;
  const after = text.indexOf('>', subsetEnd);
  return after === -1 ? -1 : after + 1;
}

const HTML_START =
  /^<(?:!doctype\s+html\b|html\b|head\b|body\b|script\b|iframe\b|frame\b|frameset\b|object\b|embed\b|meta\b|link\b|base\b|style\b|title\b|div\b|span\b|p\b|a\b|img\b|form\b|table\b)/i;

/**
 * What a text that starts with markup is: "svg" when its root element is `<svg` after an optional
 * XML prolog, comments, and a doctype; "html" for a web page; "xml" for any other markup (a
 * processing instruction other than the prolog included). Null when the text is not markup.
 */
export function markupKind(text: string): 'svg' | 'html' | 'xml' | null {
  let rest = text.trimStart();
  if (!/^<[A-Za-z!?]/.test(rest)) return null;
  for (let guard = 0; guard < 100; guard += 1) {
    if (/^<\?xml[\s?]/.test(rest)) {
      const end = rest.indexOf('?>');
      if (end === -1) return 'xml';
      rest = rest.slice(end + 2).trimStart();
    } else if (rest.startsWith('<?')) {
      return 'xml';
    } else if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->', 4);
      if (end === -1) return 'xml';
      rest = rest.slice(end + 3).trimStart();
    } else if (/^<!doctype\s/i.test(rest)) {
      if (/^<!doctype\s+html\b/i.test(rest)) return 'html';
      const end = doctypeEnd(rest);
      if (end === -1) return 'xml';
      rest = rest.slice(end).trimStart();
    } else {
      break;
    }
  }
  if (/^<svg[\s>/]/.test(rest)) return 'svg';
  if (HTML_START.test(rest)) return 'html';
  return 'xml';
}

/** The start of a script: a shebang, a strict-mode line, or a module, declaration, or function. */
const SCRIPT_START =
  /^(?:#!|['"]use strict['"]|import\s*(?:[\w*{$][^;\n]*?\bfrom\s*)?['"]|export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*)|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|(?:async\s+)?function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(|\(\s*(?:async\s+)?function\b|!function\b|class\s+[A-Za-z_$][\w$]*\s*(?:extends\s+[\w$.]+\s*)?\{)/;

/** True for text that starts like a script, after any leading comments. */
export function looksLikeScript(text: string): boolean {
  let rest = text.trimStart();
  for (let guard = 0; guard < 50; guard += 1) {
    if (rest.startsWith('//')) {
      const end = rest.indexOf('\n');
      rest = end === -1 ? '' : rest.slice(end + 1).trimStart();
    } else if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      if (end === -1) return true;
      rest = rest.slice(end + 2).trimStart();
    } else {
      break;
    }
  }
  return SCRIPT_START.test(rest);
}

const OBJ_STATEMENT =
  /^(?:v|vt|vn|vp|f|l|p|o|g|s|mg|mtllib|usemtl|cstype|deg|bmat|step|curv|curv2|surf|parm|trim|hole|scrv|sp|end|con|bevel|c_interp|d_interp|lod|shadow_obj|trace_obj|ctech|stech|maplib|usemap)(?:\s|$)/;

function looksLikeObj(text: string, partial: boolean): boolean {
  const lines = text.split(/\r?\n/);
  if (partial && lines.length > 1) lines.pop();
  let statements = 0;
  let vertices = 0;
  let other = 0;
  for (const raw of lines.slice(0, 5000)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (OBJ_STATEMENT.test(line)) {
      statements += 1;
      if (/^v\s/.test(line)) vertices += 1;
    } else {
      other += 1;
    }
  }
  return vertices > 0 && other * 20 <= statements;
}

const GLTF_KEYS = /"(?:asset|scenes|nodes|meshes|accessors|bufferViews|buffers)"\s*:/;

function looksLikeGltf(text: string, partial: boolean): boolean {
  if (!/^\s*\{/.test(text)) return false;
  if (partial) return GLTF_KEYS.test(text);
  try {
    const data = JSON.parse(text) as { asset?: { version?: unknown } };
    return typeof data === 'object' && data !== null && typeof data.asset?.version === 'string';
  } catch {
    return false;
  }
}

function looksLikePlyHeader(bytes: Uint8Array): boolean {
  const head = ascii(bytes, 0, Math.min(bytes.byteLength, 4096));
  if (!/^ply\r?\n/.test(head)) return false;
  return /\r?\nformat\s+(?:ascii|binary_little_endian|binary_big_endian)\s+1\.0\s*\r?\n/.test(head);
}

/** A binary STL: an 80-byte header, a triangle count, and exactly 50 bytes per triangle. */
function looksLikeBinaryStl(bytes: Uint8Array, totalSize: number): boolean {
  if (bytes.byteLength < 84) return false;
  const triangles = u32le(bytes, 80);
  return triangles > 0 && 84 + 50 * triangles === totalSize;
}

function looksLikeAsciiStl(text: string): boolean {
  return /^\s*solid\b/.test(text) && (/\bfacet\s+normal\b/.test(text) || /\bendsolid\b/.test(text));
}

/** What a text file is, by its structure. Plain text is "txt". */
function detectText(text: string, partial: boolean): Detected {
  const markup = markupKind(text);
  if (markup === 'svg') return known('svg');
  if (markup) return refusedType(markup);
  if (/^WEBVTT(?:[ \t\r\n]|$)/.test(text)) return known('vtt');
  if (/^\s*ISO-10303-21\s*;/.test(text)) return { ext: 'step', mime: 'model/step', group: null, refused: false };
  if (/^ply\r?\n/.test(text) && /\r?\nformat\s+ascii\s+1\.0\s*\r?\n/.test(text.slice(0, 4096))) return known('ply');
  if (looksLikeAsciiStl(text)) return known('stl');
  if (looksLikeGltf(text, partial)) return known('gltf');
  if (looksLikeObj(text, partial)) return known('obj');
  if (looksLikeScript(text)) return refusedType('js');
  return { ext: 'txt', mime: 'text/plain; charset=utf-8', group: 'data', refused: false };
}

// ---------------------------------------------------------------------------------------------
// Binary formats
// ---------------------------------------------------------------------------------------------

function known(ext: string): Detected {
  const type = fileTypeOf(ext);
  if (type) return { ext, mime: type.contentType, group: type.group, refused: false };
  return { ext, mime: 'application/octet-stream', group: null, refused: false };
}

function refusedType(ext: 'html' | 'xml' | 'js'): Detected {
  const mime = ext === 'html' ? 'text/html' : ext === 'xml' ? 'application/xml' : 'text/javascript';
  return { ext, mime, group: null, refused: true };
}

/** file-type's answers that name the same thing under another extension. */
const ALIASES: Readonly<Record<string, string>> = { apng: 'png', m4v: 'mp4', m4b: 'm4a', ai: 'pdf', jpeg: 'jpg' };

/** Types file-type reads from a text prefix; the text checks here decide those. */
const TEXT_SIGNATURES: ReadonlySet<string> = new Set(['xml', 'stl', 'vtt']);

/** Containers that are ZIP archives underneath. */
const ZIP_FAMILY: ReadonlySet<string> = new Set([
  'zip', 'docx', 'xlsx', 'pptx', '3mf', 'docm', 'xlsm', 'pptm', 'dotx', 'dotm', 'potx', 'potm', 'xltx', 'xltm',
  'ppsx', 'ppsm', 'vsdx', 'epub', 'odt', 'ods', 'odp', 'odg', 'ott', 'ots', 'otp', 'otg', 'jar', 'apk', 'xpi',
  'key', 'numbers', 'pages',
]);

const OOXML_PART: Readonly<Record<string, string>> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
};

const THREE_MF_MODEL = /^3D\/[^/]+\.model$/i;

/**
 * DOCX, XLSX, PPTX, and 3MF are ZIP files with a known part: [Content_Types].xml and
 * word/document.xml for Word, 3D/3dmodel.model for 3MF. Without that part the file is a plain ZIP
 * file, so a ZIP named .docx is refused. Macro-enabled Office files keep their own type and are
 * refused as unsupported.
 */
function classifyZip(detected: string, names: readonly string[] | null): string {
  if (names === null) return detected;
  const has = new Set(names);
  const contentTypes = has.has('[Content_Types].xml');
  for (const [ext, part] of Object.entries(OOXML_PART)) {
    if ((detected === ext || detected === 'zip') && contentTypes && has.has(part)) return ext;
  }
  // OpenDocument with macros (a Basic/ or Scripts/ folder) is no document download: it falls back
  // to a plain ZIP, which a name ending .odt, .ods, or .odp does not accept.
  if ((detected === 'odt' || detected === 'ods' || detected === 'odp') && names.some((name) => /^(?:Basic|Scripts)\//i.test(name))) {
    return 'zip';
  }
  if ((detected === '3mf' || detected === 'zip') && names.some((name) => THREE_MF_MODEL.test(name))) return '3mf';
  if (detected === '3mf' || Object.hasOwn(OOXML_PART, detected)) return 'zip';
  return detected;
}

async function jszipNames(bytes: Uint8Array): Promise<string[] | null> {
  try {
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
    return Object.keys(zip.files);
  } catch {
    return null;
  }
}

async function fromFileType(found: { ext: string; mime: string }, bytes: Uint8Array, options: SniffOptions): Promise<Detected> {
  let ext = ALIASES[found.ext] ?? found.ext;
  if (ZIP_FAMILY.has(ext)) {
    const names = options.zipNames ? await options.zipNames() : options.partial ? null : await jszipNames(bytes);
    ext = classifyZip(ext, names);
  }
  if (ext === 'glb') {
    // The header's length is the whole file's: a cut or padded file is not the model it claims to be.
    const total = options.totalSize ?? bytes.byteLength;
    if (bytes.byteLength < 12 || u32le(bytes, 8) !== total) return { ...known('glb'), damaged: true };
  }
  const type = fileTypeOf(ext);
  if (type) return { ext, mime: type.contentType, group: type.group, refused: false };
  return { ext, mime: found.mime, group: null, refused: false };
}

/** The extensions whose files are text, where a text reading wins over a weak binary signature. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['svg', 'csv', 'txt', 'vtt', 'obj', 'stl', 'ply', 'gltf', 'step', 'stp']);

/**
 * What the bytes are, or null when nothing can be said. See the module comment for the order of
 * the checks.
 */
export async function detectType(bytes: Uint8Array, options: SniffOptions = {}): Promise<Detected | null> {
  if (bytes.byteLength === 0) return null;
  const partial = options.partial === true;
  const totalSize = options.totalSize ?? bytes.byteLength;
  const text = decodeText(bytes, partial);
  const hint = (options.hint ?? '').toLowerCase();

  // Markup first: file-type calls every file with an XML prolog "xml", SVG included.
  if (text !== null) {
    const markup = markupKind(text);
    if (markup === 'svg') return known('svg');
    if (markup) return refusedType(markup);
  }
  // A text file named as text is read as text, so its first letters cannot pass for a signature.
  if (text !== null && TEXT_EXTENSIONS.has(hint)) {
    const textual = detectText(text, partial);
    if (textual.ext !== 'txt' || hint === 'txt' || hint === 'csv') return textual;
  }
  // Binary STL and PLY have no signature file-type knows; their own structure decides.
  if (hint === 'stl' && looksLikeBinaryStl(bytes, totalSize)) return known('stl');
  if (hint === 'ply' && looksLikePlyHeader(bytes)) return known('ply');
  let found: { ext: string; mime: string } | undefined;
  try {
    found = await fileTypeFromBuffer(bytes);
  } catch {
    found = undefined;
  }
  if (found && !TEXT_SIGNATURES.has(found.ext)) return fromFileType(found, bytes, options);
  if (looksLikeBinaryStl(bytes, totalSize)) return known('stl');
  if (looksLikePlyHeader(bytes)) return known('ply');
  if (text !== null) return detectText(text, partial);
  if (found?.ext === 'stl') return known('stl');
  return null;
}

// ---------------------------------------------------------------------------------------------
// The check against the name
// ---------------------------------------------------------------------------------------------

/** For each extension a name may carry, the detected types that satisfy it. */
const ACCEPTS: Readonly<Record<string, readonly string[]>> = {
  jpg: ['jpg'],
  jpeg: ['jpg'],
  png: ['png'],
  webp: ['webp'],
  avif: ['avif'],
  gif: ['gif'],
  svg: ['svg'],
  mp4: ['mp4', 'mov'],
  mov: ['mov', 'mp4'],
  m4a: ['m4a', 'mp4'],
  webm: ['webm'],
  pdf: ['pdf'],
  docx: ['docx'],
  xlsx: ['xlsx'],
  pptx: ['pptx'],
  odt: ['odt'],
  ods: ['ods'],
  odp: ['odp'],
  glb: ['glb'],
  gltf: ['gltf'],
  stl: ['stl'],
  obj: ['obj'],
  '3mf': ['3mf'],
  ply: ['ply'],
  mp3: ['mp3'],
  wav: ['wav'],
  csv: ['txt'],
  txt: ['txt'],
  zip: [...ZIP_FAMILY],
  vtt: ['vtt'],
};

/**
 * The extension to store a file under: the detected type's, so an MP4 named .mov is stored as
 * .mp4. Plain text keeps its own name (.csv or .txt), an audio-only MP4 named .m4a stays audio, and
 * any ZIP container named .zip stays a ZIP download. Null when the bytes do not satisfy the name.
 */
function storedExtension(nameExt: string, detectedExt: string): string | null {
  if (!(ACCEPTS[nameExt] ?? []).includes(detectedExt)) return null;
  if (nameExt === 'csv' || nameExt === 'txt' || nameExt === 'm4a' || nameExt === 'zip') return nameExt;
  return detectedExt;
}

/**
 * Refuses, by the name's extension alone, what no store takes as it is: web pages, XML, and
 * scripts; photos, which the media library converts to WebP; and STEP files, which it converts to
 * GLB. The Blob token route has no bytes to look at yet, so this is all it can check there.
 */
export function refuseByName(nameExt: string): void {
  const ext = nameExt.trim().toLowerCase();
  if (REFUSED_EXTENSIONS.has(ext)) throw invalid(M.refusedType(ext));
  if (PHOTO_NAMES.has(ext)) throw invalid(PHOTO_MESSAGE);
  if (STEP_NAMES.has(ext)) throw invalid(STEP_MESSAGE);
}

/** Extensions of text formats, where bytes that are not UTF-8 text deserve their own message. */
const TEXT_NAMES: ReadonlySet<string> = new Set(['csv', 'txt', 'vtt', 'svg', 'gltf', 'obj']);

/**
 * Checks a file's bytes against the extension of its cleaned name and returns what to store it as.
 * Throws ApiFailure 422 'invalid-file' with a plain sentence when the file may not be stored.
 */
export async function sniffFile(bytes: Uint8Array, nameExt: string, options: Omit<SniffOptions, 'hint'> = {}): Promise<Sniffed> {
  const ext = nameExt.trim().toLowerCase();
  if (REFUSED_EXTENSIONS.has(ext)) throw invalid(M.refusedType(ext));
  const detected = await detectType(bytes, { ...options, hint: ext });
  // What the bytes are decides first, so a page named .jpg is refused as a page.
  if (detected && (detected.refused || REFUSED_EXTENSIONS.has(detected.ext))) throw invalid(M.refusedType(detected.ext));
  if (detected && PHOTO_TYPES.has(detected.ext)) throw invalid(PHOTO_MESSAGE);
  if (detected?.ext === 'step') throw invalid(STEP_MESSAGE);
  refuseByName(ext);
  if (!fileTypeOf(ext)) throw invalid(M.unsupportedType(ext));
  if (!detected) throw invalid(TEXT_NAMES.has(ext) ? NOT_TEXT_MESSAGE : UNKNOWN_MESSAGE);
  if (detected.damaged) throw invalid(DAMAGED_FILE);
  const stored = storedExtension(ext, detected.ext);
  if (!stored) throw mismatch(detected.ext, ext);
  const type = fileTypeOf(stored);
  if (!type) throw invalid(M.unsupportedType(stored));
  return { ext: stored, mime: type.contentType, group: type.group };
}

// ---------------------------------------------------------------------------------------------
// ZIP central directory
// ---------------------------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const MAX_CENTRAL_DIRECTORY_BYTES = 4_000_000;

/**
 * The entry names of a ZIP file from its central directory, through `read(start, end)` (inclusive
 * byte offsets), so a large file in Blob is classified with one or two small range requests.
 * Null when the file has no readable central directory (ZIP64, a damaged or split archive).
 */
export async function zipNamesFromCentralDirectory(
  size: number,
  read: (start: number, end: number) => Promise<Uint8Array>,
): Promise<string[] | null> {
  if (!Number.isSafeInteger(size) || size < 22) return null;
  const tailLength = Math.min(size, 22 + 0xffff);
  const tailStart = size - tailLength;
  const tail = await read(tailStart, size - 1);
  let eocd = -1;
  for (let at = tail.byteLength - 22; at >= 0; at -= 1) {
    if (u32le(tail, at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) return null;
  const entries = u16le(tail, eocd + 10);
  const cdSize = u32le(tail, eocd + 12);
  const cdOffset = u32le(tail, eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null;
  if (cdSize > MAX_CENTRAL_DIRECTORY_BYTES || cdOffset + cdSize > tailStart + eocd) return null;
  const directory =
    cdOffset >= tailStart
      ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize)
      : cdSize === 0
        ? new Uint8Array(0)
        : await read(cdOffset, cdOffset + cdSize - 1);
  if (directory.byteLength < cdSize) return null;
  const names: string[] = [];
  let at = 0;
  for (let i = 0; i < entries; i += 1) {
    if (at + 46 > directory.byteLength || u32le(directory, at) !== CENTRAL_SIGNATURE) return null;
    const utf8 = (u16le(directory, at + 8) & 0x0800) !== 0;
    const nameLength = u16le(directory, at + 28);
    const extraLength = u16le(directory, at + 30);
    const commentLength = u16le(directory, at + 32);
    const raw = directory.subarray(at + 46, at + 46 + nameLength);
    names.push(utf8 ? new TextDecoder('utf-8').decode(raw) : ascii(raw, 0, raw.byteLength));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// Image metadata
// ---------------------------------------------------------------------------------------------

/** Bytes read in order: a buffer, or a stream that is never held whole. */
export interface ByteSource {
  /** Up to `n` bytes; fewer only at the end of the data, and an empty array after it. */
  read(n: number): Promise<Uint8Array>;
  /** Skips `n` bytes; false when the data ended first. */
  skip(n: number): Promise<boolean>;
}

export function bufferSource(bytes: Uint8Array): ByteSource {
  let at = 0;
  return {
    async read(n) {
      const out = bytes.subarray(at, Math.min(bytes.byteLength, at + n));
      at += out.byteLength;
      return out;
    },
    async skip(n) {
      if (at + n > bytes.byteLength) {
        at = bytes.byteLength;
        return false;
      }
      at += n;
      return true;
    },
  };
}

export function streamSource(stream: ReadableStream<Uint8Array>): ByteSource & { cancel(): Promise<void> } {
  const reader = stream.getReader();
  let buffered: Uint8Array = new Uint8Array(0);
  let ended = false;
  async function more(): Promise<boolean> {
    if (ended) return false;
    const { value, done } = await reader.read();
    if (done) {
      ended = true;
      return false;
    }
    if (value && value.byteLength > 0) buffered = buffered.byteLength === 0 ? value : concat([buffered, value]);
    return true;
  }
  return {
    async read(n) {
      while (buffered.byteLength < n) {
        if (!(await more())) break;
      }
      const out = buffered.slice(0, n);
      buffered = buffered.subarray(out.byteLength);
      return out;
    },
    async skip(n) {
      let left = n;
      while (left > 0) {
        if (buffered.byteLength === 0 && !(await more())) return false;
        const take = Math.min(left, buffered.byteLength);
        buffered = buffered.subarray(take);
        left -= take;
      }
      return true;
    },
    async cancel() {
      await reader.cancel().catch(() => undefined);
    },
  };
}

export type ImageWithMetadata = 'webp' | 'png';

/** What a scan found: metadata chunks (by name), and whether the file is damaged. */
export interface ImageScan {
  metadata: string[];
  damaged: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG chunks that carry metadata: text, compressed text, international text (XMP), EXIF, and the time. */
const PNG_METADATA: ReadonlySet<string> = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
/** Ancillary PNG chunks that describe only the picture: colour, transparency, size, animation. */
const PNG_KEEP: ReadonlySet<string> = new Set([
  'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCv', 'cLLi', 'bKGD', 'hIST', 'pHYs', 'sPLT', 'acTL', 'fcTL', 'fdAT',
]);
const PNG_CRITICAL: ReadonlySet<string> = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

/** WebP chunks that hold the picture; EXIF, XMP, and anything unknown are dropped. */
const WEBP_KEEP: ReadonlySet<string> = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
const WEBP_METADATA: ReadonlySet<string> = new Set(['EXIF', 'XMP ']);
/** The VP8X flags that announce EXIF (0x08) and XMP (0x04) chunks. */
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8 && PNG_SIGNATURE.every((value, i) => bytes[i] === value);
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
}

/**
 * A PNG file without its metadata: text, XMP, EXIF, and time chunks and any unknown ancillary
 * chunk are dropped, and nothing after IEND is kept. An unknown critical chunk, or a chunk that
 * runs past the end, makes the file damaged (422).
 */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (!isPng(bytes)) throw invalid(DAMAGED_IMAGE);
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  let first = true;
  let ended = false;
  while (at + 12 <= bytes.byteLength) {
    const length = u32be(bytes, at);
    const type = ascii(bytes, at + 4, at + 8);
    const end = at + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || end > bytes.byteLength) throw invalid(DAMAGED_IMAGE);
    if (first && type !== 'IHDR') throw invalid(DAMAGED_IMAGE);
    first = false;
    const ancillary = type.charCodeAt(0) >= 0x61;
    if (!ancillary && !PNG_CRITICAL.has(type)) throw invalid(DAMAGED_IMAGE);
    if (!ancillary || PNG_KEEP.has(type)) kept.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) throw invalid(DAMAGED_IMAGE);
  return concat(kept);
}

/**
 * A WebP file without its metadata: EXIF, XMP, and unknown chunks are dropped, the VP8X flags
 * that announced them are cleared, the RIFF size is rebuilt, and nothing after the RIFF data is
 * kept. A chunk that runs past the end makes the file damaged (422).
 */
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  if (!isWebp(bytes)) throw invalid(DAMAGED_IMAGE);
  const riffEnd = 8 + u32le(bytes, 4);
  if (riffEnd > bytes.byteLength || riffEnd < 20) throw invalid(DAMAGED_IMAGE);
  const kept: Uint8Array[] = [];
  let at = 12;
  let first = true;
  while (at < riffEnd) {
    if (at + 8 > riffEnd) throw invalid(DAMAGED_IMAGE);
    const fourcc = ascii(bytes, at, at + 4);
    const size = u32le(bytes, at + 4);
    const end = at + 8 + size + (size & 1);
    if (end > riffEnd) throw invalid(DAMAGED_IMAGE);
    if (first && fourcc !== 'VP8X' && fourcc !== 'VP8 ' && fourcc !== 'VP8L') throw invalid(DAMAGED_IMAGE);
    first = false;
    if (WEBP_KEEP.has(fourcc)) {
      const chunk = bytes.slice(at, end);
      if (fourcc === 'VP8X') {
        if (size < 10) throw invalid(DAMAGED_IMAGE);
        chunk[8] &= ~(VP8X_EXIF | VP8X_XMP) & 0xff;
      }
      kept.push(chunk);
    }
    at = end;
  }
  const body = concat(kept);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 4), 0);
  new DataView(header.buffer).setUint32(4, 4 + body.byteLength, true);
  header.set(bytes.subarray(8, 12), 8);
  return concat([header, body]);
}

export function stripImageMetadata(ext: ImageWithMetadata, bytes: Uint8Array): Uint8Array {
  return ext === 'png' ? stripPngMetadata(bytes) : stripWebpMetadata(bytes);
}

async function scanPng(source: ByteSource): Promise<ImageScan> {
  const metadata = new Set<string>();
  const signature = await source.read(8);
  if (signature.byteLength < 8 || !isPng(signature)) return { metadata: [], damaged: true };
  for (;;) {
    const header = await source.read(8);
    if (header.byteLength < 8) return { metadata: [...metadata], damaged: true };
    const length = u32be(header, 0);
    const type = ascii(header, 4, 8);
    if (PNG_METADATA.has(type)) metadata.add(type);
    if (!(await source.skip(length + 4))) return { metadata: [...metadata], damaged: true };
    if (type === 'IEND') break;
  }
  if ((await source.read(1)).byteLength > 0) metadata.add('data after the image');
  return { metadata: [...metadata], damaged: false };
}

async function scanWebp(source: ByteSource): Promise<ImageScan> {
  const metadata = new Set<string>();
  const header = await source.read(12);
  if (header.byteLength < 12 || !isWebp(header)) return { metadata: [], damaged: true };
  let left = u32le(header, 4) - 4;
  while (left > 0) {
    const chunk = await source.read(8);
    if (chunk.byteLength < 8 || left < 8) return { metadata: [...metadata], damaged: true };
    const fourcc = ascii(chunk, 0, 4);
    const size = u32le(chunk, 4);
    const padded = size + (size & 1);
    if (8 + padded > left) return { metadata: [...metadata], damaged: true };
    if (WEBP_METADATA.has(fourcc)) metadata.add(fourcc.trim());
    if (fourcc === 'VP8X' && size >= 1) {
      const data = await source.read(padded);
      if (data.byteLength < padded) return { metadata: [...metadata], damaged: true };
      if (data[0] & VP8X_EXIF) metadata.add('EXIF flag');
      if (data[0] & VP8X_XMP) metadata.add('XMP flag');
    } else if (!(await source.skip(padded))) {
      return { metadata: [...metadata], damaged: true };
    }
    left -= 8 + padded;
  }
  if ((await source.read(1)).byteLength > 0) metadata.add('data after the image');
  return { metadata: [...metadata], damaged: false };
}

/**
 * The metadata a WebP or PNG file still carries: EXIF and XMP chunks and their VP8X flags, PNG
 * text, EXIF, and time chunks, and data after the end of the image. Empty for a clean file.
 */
export function scanImageMetadata(ext: ImageWithMetadata, source: ByteSource): Promise<ImageScan> {
  return ext === 'png' ? scanPng(source) : scanWebp(source);
}

// ---------------------------------------------------------------------------------------------
// Images embedded in a drawing
// ---------------------------------------------------------------------------------------------

/** A JPEG or GIF file split into the parts to keep and the names of the metadata dropped. */
interface Walk {
  kept: Uint8Array[];
  dropped: string[];
}

const JFIF = [0x4a, 0x46, 0x49, 0x46, 0x00];

function startsWithBytes(bytes: Uint8Array, at: number, expected: readonly number[] | string): boolean {
  const values = typeof expected === 'string' ? Array.from(expected, (c) => c.charCodeAt(0)) : expected;
  return at + values.length <= bytes.byteLength && values.every((value, i) => bytes[at + i] === value);
}

/**
 * A JPEG segment by segment. Kept: the image data and its tables, the JFIF header without its
 * thumbnail, the ICC colour profile (APP2), and Adobe's colour information (APP14). Dropped:
 * every other application segment (EXIF and XMP in APP1, IPTC in APP13, the multi-picture images
 * of APP2), comments, and anything after the end of the image.
 */
function walkJpeg(bytes: Uint8Array): Walk {
  const length = bytes.byteLength;
  if (length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw invalid(DAMAGED_IMAGE);
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  const dropped: string[] = [];
  let at = 2;
  for (;;) {
    if (at >= length || bytes[at] !== 0xff) throw invalid(DAMAGED_IMAGE);
    let next = at + 1;
    while (next < length && bytes[next] === 0xff) next += 1;
    if (next >= length) throw invalid(DAMAGED_IMAGE);
    const marker = bytes[next];
    if (marker === 0xd9) {
      kept.push(new Uint8Array([0xff, 0xd9]));
      if (next + 1 < length) dropped.push('data after the image');
      return { kept, dropped };
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(new Uint8Array([0xff, marker]));
      at = next + 1;
      continue;
    }
    if (marker === 0x00 || marker === 0xd8 || next + 3 > length) throw invalid(DAMAGED_IMAGE);
    const size = (bytes[next + 1] << 8) | bytes[next + 2];
    const end = next + 1 + size;
    if (size < 2 || end > length) throw invalid(DAMAGED_IMAGE);
    const data = next + 3;
    if (marker === 0xe0 && startsWithBytes(bytes, data, JFIF) && size >= 16) {
      // The JFIF header, rebuilt with a thumbnail size of zero: a thumbnail can show what a crop removed.
      const header = bytes.slice(next - 1, next + 17);
      header[2] = 0;
      header[3] = 16;
      header[16] = 0;
      header[17] = 0;
      kept.push(header);
      if (size > 16) dropped.push('JFIF thumbnail');
    } else if ((marker === 0xe2 && startsWithBytes(bytes, data, 'ICC_PROFILE\u0000')) || (marker === 0xee && startsWithBytes(bytes, data, 'Adobe'))) {
      kept.push(bytes.subarray(next - 1, end));
    } else if (marker === 0xfe || (marker >= 0xe0 && marker <= 0xef)) {
      dropped.push(marker === 0xfe ? 'comment' : `APP${marker - 0xe0}`);
    } else {
      kept.push(bytes.subarray(next - 1, end));
    }
    at = end;
    if (marker === 0xda) {
      // The coded image runs to the next marker: 0xFF followed by anything but a stuffed zero or a restart.
      let scan = at;
      while (scan + 1 < length && !(bytes[scan] === 0xff && bytes[scan + 1] !== 0x00 && (bytes[scan + 1] < 0xd0 || bytes[scan + 1] > 0xd7))) {
        scan += 1;
      }
      if (scan + 1 >= length) throw invalid(DAMAGED_IMAGE);
      kept.push(bytes.subarray(at, scan));
      at = scan;
    }
  }
}

/** The end of a run of GIF sub-blocks starting at `at` (just past its zero-length terminator). */
function gifSubBlocksEnd(bytes: Uint8Array, at: number): number {
  let next = at;
  for (;;) {
    if (next >= bytes.byteLength) throw invalid(DAMAGED_IMAGE);
    const size = bytes[next];
    next += 1 + size;
    if (size === 0) return next;
  }
}

/** GIF application extensions that only describe the picture: looping and the colour profile. */
const GIF_KEEP_APPLICATIONS: ReadonlySet<string> = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0', 'ICCRGBG1012']);

/**
 * A GIF block by block. Kept: the screen and colour tables, the frames, their timing, looping, and
 * the colour profile. Dropped: comments, plain-text blocks, every other application block (XMP
 * among them), and anything after the end of the image.
 */
function walkGif(bytes: Uint8Array): Walk {
  const length = bytes.byteLength;
  const signature = ascii(bytes, 0, 6);
  if ((signature !== 'GIF87a' && signature !== 'GIF89a') || length < 14) throw invalid(DAMAGED_IMAGE);
  let at = 13;
  if (bytes[10] & 0x80) at += 3 * (1 << ((bytes[10] & 0x07) + 1));
  if (at > length) throw invalid(DAMAGED_IMAGE);
  const kept: Uint8Array[] = [bytes.subarray(0, at)];
  const dropped: string[] = [];
  for (;;) {
    if (at >= length) throw invalid(DAMAGED_IMAGE);
    const block = bytes[at];
    if (block === 0x3b) {
      kept.push(bytes.subarray(at, at + 1));
      if (at + 1 < length) dropped.push('data after the image');
      return { kept, dropped };
    }
    if (block === 0x2c) {
      if (at + 11 > length) throw invalid(DAMAGED_IMAGE);
      let start = at + 10;
      if (bytes[at + 9] & 0x80) start += 3 * (1 << ((bytes[at + 9] & 0x07) + 1));
      const end = gifSubBlocksEnd(bytes, start + 1);
      kept.push(bytes.subarray(at, end));
      at = end;
      continue;
    }
    if (block !== 0x21 || at + 2 > length) throw invalid(DAMAGED_IMAGE);
    const label = bytes[at + 1];
    const end = gifSubBlocksEnd(bytes, at + 2);
    const application = label === 0xff && bytes[at + 2] === 11 ? ascii(bytes, at + 3, at + 14) : '';
    if (label === 0xf9 || GIF_KEEP_APPLICATIONS.has(application)) kept.push(bytes.subarray(at, end));
    else dropped.push(label === 0xfe ? 'comment' : label === 0x01 ? 'plain text' : 'application data');
    at = end;
  }
}

export type EmbeddedImageType = 'png' | 'jpeg' | 'webp' | 'gif';

function looksLike(type: EmbeddedImageType, bytes: Uint8Array): boolean {
  if (type === 'png') return isPng(bytes);
  if (type === 'webp') return isWebp(bytes);
  if (type === 'jpeg') return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return startsWithBytes(bytes, 0, 'GIF87a') || startsWithBytes(bytes, 0, 'GIF89a');
}

/**
 * An image embedded in a drawing (a `data:` address in an `<image>`), without the metadata the
 * server can remove, after confirming that none remains (D-24): an annotated photo placed in a
 * drawing must not carry the camera's place and time. Null when the bytes are not the type the
 * address names, or cannot be read.
 */
export async function cleanEmbeddedImage(type: EmbeddedImageType, bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!looksLike(type, bytes)) return null;
  try {
    if (type === 'png' || type === 'webp') {
      const stripped = stripImageMetadata(type, bytes);
      const scan = await scanImageMetadata(type, bufferSource(stripped));
      return scan.damaged || scan.metadata.length > 0 ? null : stripped;
    }
    const walk = type === 'jpeg' ? walkJpeg : walkGif;
    const stripped = concat(walk(bytes).kept);
    return walk(stripped).dropped.length === 0 ? stripped : null;
  } catch (error) {
    if (error instanceof ApiFailure) return null;
    throw error;
  }
}
