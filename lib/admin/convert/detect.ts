/**
 * Recognizes a dropped file from its bytes, not its name (ARCHITECTURE.md 11 and 13A; docs/V3_PLAN.md
 * D-24): magic numbers for binary formats, the central directory for zip-based formats (Word, Excel,
 * PowerPoint, OpenDocument, 3MF), the header of a binary PLY, and text sniffing for the text
 * formats (SVG, glTF, OBJ, ASCII STL, ASCII PLY, STEP, WebVTT, CSV). The name only decides between
 * formats the bytes cannot tell apart (a binary STL has no signature; CSV and plain text look alike).
 *
 * Refused whatever the bytes: the extensions in REFUSED_EXTENSIONS, web pages and XML other than
 * SVG, scripts and programs, and anything not on the storage allow-list.
 */
import { REFUSED_EXTENSIONS } from '@/lib/storage/rules';
import { CONVERT_MESSAGES as M } from './messages';
import { PrepareError } from './types';
import { ascii, extOf, HEAD_BYTES, readBytes } from './util';
import { zipEntryNamesOf } from './zip';

export type Format =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'avif'
  | 'heic'
  | 'svg'
  | 'mp4'
  | 'mov'
  | 'webm'
  | 'mp3'
  | 'wav'
  | 'pdf'
  | 'docx'
  | 'office'
  | 'glb'
  | 'gltf'
  | 'stl'
  | 'obj'
  | '3mf'
  | 'ply'
  | 'step'
  | 'vtt'
  | 'csv'
  | 'txt'
  | 'zip'
  | 'mtl';

export interface Detected {
  format: Format;
  /** The extension a file kept as it is gets (office files keep their own: xlsx, odt, doc, ...). */
  ext: string;
  /** For ISO media files: the major brand ("isom", "qt  ", "M4A "). */
  brand?: string;
  /** True when the bytes show an animation (GIF, WebP, AVIF sequence). */
  animated?: boolean;
}

export type Sniffed =
  | { kind: 'format'; detected: Detected }
  | { kind: 'zip' }
  | { kind: 'refuse'; code: string; message: string }
  | { kind: 'unknown' };

const found = (format: Format, ext: string, extra: Partial<Detected> = {}): Sniffed => ({
  kind: 'format',
  detected: { format, ext, ...extra },
});
const refuse = (code: string, message: string): Sniffed => ({ kind: 'refuse', code, message });
const unsupported = (label: string, hint: string): Sniffed =>
  refuse('unsupported-type', M.unsupportedType(label, hint));

function u32be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function u32le(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function startsWith(bytes: Uint8Array, values: readonly number[], at = 0): boolean {
  if (bytes.length < at + values.length) return false;
  for (let i = 0; i < values.length; i += 1) if (bytes[at + i] !== values[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Image details
// ---------------------------------------------------------------------------------------------

/** True when a GIF holds more than one image (an animation). Walks the block structure. */
export function gifIsAnimated(bytes: Uint8Array): boolean {
  if (bytes.length < 13) return false;
  let at = 13;
  const flags = bytes[10];
  if (flags & 0x80) at += 3 * 2 ** ((flags & 0x07) + 1);
  let images = 0;
  const skipSubBlocks = (from: number): number => {
    let p = from;
    while (p < bytes.length) {
      const size = bytes[p];
      p += 1;
      if (size === 0) return p;
      p += size;
    }
    return p;
  };
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      at = skipSubBlocks(at + 2); // extension: introducer, label, sub-blocks
    } else if (block === 0x2c) {
      images += 1;
      if (images > 1) return true;
      if (at + 10 > bytes.length) break;
      const local = bytes[at + 9];
      at += 10;
      if (local & 0x80) at += 3 * 2 ** ((local & 0x07) + 1);
      at = skipSubBlocks(at + 1); // LZW minimum code size, then the image data
    } else {
      break;
    }
  }
  return false;
}

/** True when a WebP file declares an animation (the VP8X header's animation flag). */
export function webpIsAnimated(bytes: Uint8Array): boolean {
  return bytes.length >= 21 && ascii(bytes, 12, 4) === 'VP8X' && (bytes[20] & 0x02) !== 0;
}

/** The brands of an ISO media file: the major brand and the compatible ones. */
export function isoBrands(bytes: Uint8Array): { major: string; compatible: string[] } | null {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== 'ftyp') return null;
  const size = Math.min(u32be(bytes, 0), bytes.length, 4096);
  const compatible: string[] = [];
  for (let at = 16; at + 4 <= size; at += 4) compatible.push(ascii(bytes, at, 4));
  return { major: ascii(bytes, 8, 4), compatible };
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2']);

function sniffIso(bytes: Uint8Array): Sniffed {
  const brands = isoBrands(bytes);
  if (!brands) return { kind: 'unknown' };
  const all = [brands.major, ...brands.compatible];
  if (brands.major === 'avif' || brands.major === 'avis') return found('avif', 'avif', { animated: brands.major === 'avis' });
  if (HEIF_BRANDS.has(brands.major)) {
    if (all.includes('avif') || all.includes('avis')) return found('avif', 'avif', { animated: all.includes('avis') });
    return found('heic', 'heic');
  }
  if (brands.major === 'qt  ') return found('mov', 'mov', { brand: brands.major });
  if (brands.major === 'crx ') return unsupported('Camera RAW', M.hintPhoto);
  return found('mp4', 'mp4', { brand: brands.major });
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

/**
 * The text of the file's first bytes, or null when they are binary: NUL bytes or more than one
 * control character in a hundred. UTF-16 text (with its byte order mark) is decoded too.
 */
export function textOf(head: Uint8Array): string | null {
  if (head.length === 0) return '';
  if (startsWith(head, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(head.subarray(2));
  if (startsWith(head, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(head.subarray(2));
  const sample = head.subarray(0, Math.min(head.length, 8192));
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return null;
    if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) || byte === 0x7f) control += 1;
  }
  if (control > sample.length / 100) return null;
  const text = new TextDecoder('utf-8').decode(head);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * The first element name of a markup text, after its XML declaration, comments, and doctype. Any
 * other processing instruction (an xml-stylesheet line, say) ends the walk, so the text is not
 * taken for a plain drawing, as on the server (lib/admin/server/sniff.ts).
 */
export function rootElementOf(text: string): { name: string; doctype: string } | null {
  let rest = text.trimStart();
  let doctype = '';
  for (let i = 0; i < 64; i += 1) {
    const declaration = /^<\?xml[\s?][\s\S]*?\?>/.exec(rest);
    const comment = /^<!--[\s\S]*?-->/.exec(rest);
    const type = /^<!DOCTYPE\s+([^\s>[]+)[^>[]*(\[[\s\S]*?\])?\s*>/i.exec(rest);
    const match = declaration ?? comment ?? type;
    if (!match) break;
    if (type && match === type) doctype = type[1].toLowerCase();
    rest = rest.slice(match[0].length).trimStart();
  }
  const element = /^<([A-Za-z_][\w:.-]*)/.exec(rest);
  if (!element) return doctype ? { name: '', doctype } : null;
  return { name: element[1], doctype };
}

/**
 * The start of a script, after any leading comments: a shebang, a strict-mode line, a module
 * statement, a declaration, or a function. The server refuses the same starts (looksLikeScript in
 * lib/admin/server/sniff.ts); testing them here refuses a script named .txt or .csv before any
 * byte is sent.
 */
const SCRIPT_START =
  /^(?:#!|['"]use strict['"]|import\s*(?:[\w*{$][^;\n]*?\bfrom\s*)?['"]|export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*)|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|(?:async\s+)?function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(|\(\s*(?:async\s+)?function\b|!function\b|class\s+[A-Za-z_$][\w$]*\s*(?:extends\s+[\w$.]+\s*)?\{)/;

/** True when a text starts like a script, comments skipped (an unclosed comment counts as one). */
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

/**
 * True when the bytes start like a binary PLY: "ply" on its own line, any comment lines, then
 * "format binary_little_endian" or "format binary_big_endian". ASCII PLY is text and is found by
 * the text sniff.
 */
export function isBinaryPly(head: Uint8Array): boolean {
  if (ascii(head, 0, 3) !== 'ply') return false;
  return /^ply\r?\n(?:(?:comment|obj_info)\b[^\n]*\n)*format[ \t]+binary_(?:little|big)_endian[ \t]/.test(ascii(head, 0, Math.min(head.length, 4096)));
}

function sniffText(text: string, ext: string): Sniffed {
  const start = text.trimStart();
  if (/^WEBVTT(?:[ \t\r\n]|$)/.test(text)) return found('vtt', 'vtt');
  if (/^ISO-10303-21\s*;/.test(start)) return found('step', 'step');
  if (/^ply\r?\n/.test(text)) return found('ply', 'ply');
  if (start.startsWith('#!')) return refuse('refused-program', M.refusedProgram);
  if (start.startsWith('<')) {
    // Only a plain <svg> root is a drawing; a prefixed root ("svg:svg") is refused, as on the server.
    const root = rootElementOf(start);
    if (root && root.name === 'svg' && (root.doctype === '' || root.doctype === 'svg')) return found('svg', 'svg');
    return refuse('refused-markup', M.refusedMarkup);
  }
  if (start.startsWith('{') && (ext === 'gltf' || /"asset"\s*:/.test(start))) return found('gltf', 'gltf');
  if (/^solid\b/i.test(start) && /\bfacet\s+normal\b/i.test(start)) return found('stl', 'stl');
  if (/^\s*newmtl\s/m.test(text)) return found('mtl', 'mtl');
  const vertexLines = (text.match(/^\s*v\s+-?[\d.]/gm) ?? []).length;
  if ((ext === 'obj' && (vertexLines > 0 || /^\s*(o|g|mtllib|usemtl)\s/m.test(text))) || (vertexLines >= 3 && /^\s*f\s+\d/m.test(text))) {
    return found('obj', 'obj');
  }
  if (looksLikeScript(text)) return refuse('refused-program', M.refusedProgram);
  if (ext === 'csv') return found('csv', 'csv');
  if (ext === 'txt') return found('txt', 'txt');
  if (ext === 'vtt') return refuse('vtt-invalid', M.vttInvalid);
  if (ext === '') return found('txt', 'txt');
  return refuse('unsupported-type', M.unsupportedExtension(ext));
}

// ---------------------------------------------------------------------------------------------
// The whole sniff
// ---------------------------------------------------------------------------------------------

/**
 * Old binary Office files (.doc, .xls, .ppt) can carry macros that neither the browser nor the
 * server can inspect, so they are refused with a pointer to the modern formats, which are stored
 * as downloads (DOCX also gets a reader).
 */
const LEGACY_OFFICE = new Set(['doc', 'xls', 'ppt']);

/**
 * What the first bytes of a file say it is. `head` is the start of the file (64 KB is plenty),
 * `name` its name, and `size` its full size (a binary STL is recognized by its size).
 */
export function sniff(head: Uint8Array, name: string, size: number): Sniffed {
  const ext = extOf(name);
  if (size === 0 || head.length === 0) return refuse('empty-file', M.emptyFile);

  // Programs, whatever they are called. "MZ" also starts some text files, so it counts only in binary.
  if (startsWith(head, [0x4d, 0x5a]) && textOf(head) === null) return refuse('refused-program', M.refusedProgram);
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return refuse('refused-program', M.refusedProgram); // ELF
  if (
    startsWith(head, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(head, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(head, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xca, 0xfe, 0xba, 0xbe])
  ) {
    return refuse('refused-program', M.refusedProgram); // Mach-O, or a Java class
  }
  if (startsWith(head, [0x00, 0x61, 0x73, 0x6d])) return refuse('refused-program', M.refusedProgram); // WebAssembly

  // Images
  if (startsWith(head, [0xff, 0xd8, 0xff])) return found('jpeg', 'jpg');
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return found('png', 'png');
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') {
    return found('gif', 'gif', { animated: gifIsAnimated(head) });
  }
  const riff = ascii(head, 0, 4);
  if (riff === 'RIFF' || riff === 'RF64' || riff === 'BW64') {
    const form = ascii(head, 8, 4);
    if (form === 'WEBP' && riff === 'RIFF') return found('webp', 'webp', { animated: webpIsAnimated(head) });
    if (form === 'WAVE') return found('wav', 'wav');
    if (form === 'AVI ') return unsupported('AVI', M.hintVideo);
    return { kind: 'unknown' };
  }
  if (ascii(head, 0, 2) === 'BM' && head.length > 14 && u32le(head, 2) === size) return unsupported('BMP', M.hintPhoto);
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return unsupported('TIFF', M.hintPhoto);
  }
  if (ascii(head, 0, 4) === '8BPS') return unsupported('Photoshop', M.hintPhoto);

  // ISO media (MP4, MOV, M4A, AVIF, HEIC), and QuickTime files that start without "ftyp"
  if (ascii(head, 4, 4) === 'ftyp') return sniffIso(head);
  if (['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(ascii(head, 4, 4)) && (ext === 'mov' || ext === 'qt')) {
    return found('mov', 'mov', { brand: 'qt  ' });
  }

  // Matroska and WebM
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    const docType = ascii(head, 0, Math.min(head.length, 64));
    if (docType.includes('webm')) return found('webm', 'webm');
    return unsupported('Matroska (MKV)', M.hintVideo);
  }

  // Audio
  if (ascii(head, 0, 3) === 'ID3') return found('mp3', 'mp3');
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
    const layer = (head[1] >> 1) & 0x03;
    if (layer === 0x01) return found('mp3', 'mp3'); // MPEG audio layer III
    if (layer === 0x00) return unsupported('AAC (ADTS)', M.hintAudio);
  }
  if (ascii(head, 0, 4) === 'fLaC') return unsupported('FLAC', M.hintAudio);
  if (ascii(head, 0, 4) === 'OggS') return unsupported('Ogg', M.hintAudio);
  if (ascii(head, 0, 4) === 'FORM' && (ascii(head, 8, 4) === 'AIFF' || ascii(head, 8, 4) === 'AIFC')) {
    return unsupported('AIFF', M.hintAudio);
  }

  // Documents and archives. A PDF may have a few bytes before its header; only a file named .pdf
  // is read that way, so a text that merely mentions the header stays text.
  const pdfAt = ascii(head, 0, Math.min(head.length, 1024)).indexOf('%PDF-');
  if (pdfAt === 0 || (pdfAt > 0 && ext === 'pdf')) return found('pdf', 'pdf');
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) return { kind: 'zip' };
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // Old Word, Excel, and PowerPoint files share this container with installers and others.
    if (LEGACY_OFFICE.has(ext)) return refuse('unsupported-type', M.legacyOffice(ext));
    return ext ? refuse('unsupported-type', M.unsupportedExtension(ext)) : refuse('unknown-type', M.unknownType);
  }
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return unsupported('7z', M.hintArchive);
  if (ascii(head, 0, 4) === 'Rar!') return unsupported('RAR', M.hintArchive);
  if (startsWith(head, [0x1f, 0x8b])) return unsupported('Gzip', M.hintArchive);

  // 3D
  if (ascii(head, 0, 4) === 'glTF') {
    return u32le(head, 4) === 2 ? found('glb', 'glb') : unsupported('glTF 1.0', M.hintModel);
  }
  if (ext === 'stl' && head.length >= 84 && 84 + 50 * u32le(head, 80) === size) return found('stl', 'stl');
  // A binary PLY (what scanners, MeshLab, and Open3D write) has a text header and binary data after
  // it, which the text test below would call binary.
  if (isBinaryPly(head)) return found('ply', 'ply');

  const text = textOf(head);
  if (text !== null) return sniffText(text, ext);
  return { kind: 'unknown' };
}

/** What a zip archive is, from its entry names (and the start of the file, for OpenDocument). */
export function classifyZip(entries: readonly string[], head: Uint8Array, ext: string): Sniffed {
  const names = new Set(entries.map((entry) => entry.replace(/\\/g, '/').toLowerCase()));
  if (['word/vbaproject.bin', 'xl/vbaproject.bin', 'ppt/vbaproject.bin'].some((entry) => names.has(entry))) {
    return refuse('office-macros', M.officeMacros);
  }
  if (names.has('word/document.xml')) return found('docx', 'docx');
  if (names.has('xl/workbook.xml')) return found('office', 'xlsx');
  if (names.has('ppt/presentation.xml')) return found('office', 'pptx');
  if (names.has('3d/3dmodel.model')) return found('3mf', '3mf');
  if (names.has('mimetype')) {
    // OpenDocument stores its type uncompressed as the first entry, so it is in the first bytes;
    // the next entry's header follows it directly. Templates ("text-template") are not documents.
    const type = /application\/vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)(?![-.])/.exec(
      ascii(head, 0, Math.min(head.length, 200)),
    );
    if (type) return found('office', type[1] === 'text' ? 'odt' : type[1] === 'spreadsheet' ? 'ods' : 'odp');
  }
  // Named like an office file or a 3MF model, but holding something else.
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx' || ext === '3mf') return refuse('unknown-type', M.unknownType);
  return found('zip', 'zip');
}

/**
 * Recognizes a file, reading its first bytes (and, for a zip archive, its central directory).
 * Throws a PrepareError with a plain message when the file cannot be uploaded.
 */
export async function detect(file: File): Promise<Detected> {
  const ext = extOf(file.name);
  if (REFUSED_EXTENSIONS.has(ext)) throw new PrepareError('refused-type', file.name, M.refusedExtension(ext));
  if (file.size === 0) throw new PrepareError('empty-file', file.name, M.emptyFile);
  const head = await readBytes(file, 0, Math.min(file.size, HEAD_BYTES));
  let result = sniff(head, file.name, file.size);
  if (result.kind === 'zip') {
    const entries = await zipEntryNamesOf(file);
    result = entries ? classifyZip(entries, head, ext) : refuse('unknown-type', M.unknownType);
  }
  if (result.kind === 'format') {
    if (result.detected.format === 'mtl') throw new PrepareError('companion-alone', file.name, M.companionAlone(file.name));
    return result.detected;
  }
  if (result.kind === 'refuse') throw new PrepareError(result.code, file.name, result.message);
  if (ext === 'bin' || ext === 'mtl') throw new PrepareError('companion-alone', file.name, M.companionAlone(file.name));
  throw new PrepareError('unknown-type', file.name, await unknownMessage(head));
}

/** Names an unknown binary file through file-type when it can, so the refusal says what it is. */
async function unknownMessage(head: Uint8Array): Promise<string> {
  try {
    const { fileTypeFromBuffer } = await import('file-type');
    const type = await fileTypeFromBuffer(head);
    if (type) return M.unsupportedType(type.ext.toUpperCase(), '');
  } catch {
    // Without a name, the plain refusal stands.
  }
  return M.unknownType;
}
