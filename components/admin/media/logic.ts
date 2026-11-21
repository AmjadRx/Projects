/**
 * The media library's pure rules (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-07, D-23 to D-27, D-30):
 *
 * - which store each prepared part goes to (`planStorage`): the repository up to 4,000,000 bytes,
 *   Vercel Blob above that up to 500 MB, and a refusal that says how to connect Blob when it is
 *   not configured;
 * - the message for a browser upload Vercel Blob refused, with its likely cause (`blobRefusal`),
 *   and the refusal that means an earlier try stored the file (`isBlobAlreadyStored`);
 * - the MediaRef an upload or a library file becomes (`mediaRefFromUpload`, `mediaRefFromItem`);
 * - the names a "keep both" upload takes (`freeNames`);
 * - where the working copy refers to a file, and rewriting those references (Replace, Rename),
 *   by the server's own rules (lib/admin/references.ts);
 * - the "not used anywhere" filter (D-27: Blob files left after a discard);
 * - the folder a project's files live in, which a slug rename does not move (`projectMediaFolder`);
 * - the content-check requests for a file's name, words, and part names (D-24);
 * - the question a file named like a resume asks before it is stored (D-22).
 *
 * No React and no network: the upload queue (./manager.ts) and the components use these, and
 * tests/admin-media-ui.test.ts checks them in Node.
 */
import {
  MAX_CHECK_ITEMS,
  MAX_CHECK_TEXT_BYTES,
  MAX_REPO_UPLOAD_BODY_BYTES,
  SITE_FILE,
  type CheckBody,
  type ErrorCode,
  type Finding,
  type MediaItem,
  type Reference,
} from '@/lib/admin/contract';
import type { PreparedPart, PreparedUpload, UploadKind } from '@/lib/admin/convert/types';
import { addressOf, countReferencePaths, referencePaths, rewriteData, siteHosts } from '@/lib/admin/references';
import { stringValues } from '@/lib/lint';
import { isBlobUrl } from '@/lib/media';
import { MEDIA_KINDS } from '@/lib/schema';
import { STORAGE_MESSAGES } from '@/lib/storage/labels';
import { BLOB_MAX_BYTES, checkFolder, fileTypeOf, NAME_BASE_MAX_LENGTH, REPO_MAX_BYTES, sanitizeFileName, SITE_FOLDER } from '@/lib/storage/rules';
import type { MediaRef } from '@/lib/types';
import { uploadBodySize } from '../state/api';
import { pathOfEntry, textOf, type Doc } from '../state/store';
import { looksLikeResume } from '../state/warnings';

export type MediaKind = MediaRef['kind'];

// ---------------------------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------------------------

/** What a stored file is, for the library and the pickers: a MediaRef kind, captions, or a plain file. */
export type LibraryKind = MediaKind | 'captions' | 'file';

export const KIND_WORDS: Readonly<Record<LibraryKind, string>> = {
  image: 'Image',
  video: 'Video',
  embed: 'Embedded video',
  model: '3D model',
  document: 'Document',
  audio: 'Audio',
  captions: 'Captions',
  file: 'File',
};

/** "an image", "a 3D model": a kind inside a sentence. */
const KIND_WITH_ARTICLE: Readonly<Record<LibraryKind, string>> = {
  image: 'an image',
  video: 'a video',
  embed: 'an embedded video',
  model: 'a 3D model',
  document: 'a document',
  audio: 'an audio file',
  captions: 'a captions file',
  file: 'a plain file',
};

const KIND_PLURALS: Readonly<Record<LibraryKind, string>> = {
  image: 'images',
  video: 'videos',
  embed: 'YouTube or Vimeo links',
  model: '3D models',
  document: 'documents',
  audio: 'audio files',
  captions: 'captions files',
  file: 'files',
};

const MEDIA_KIND_SET: ReadonlySet<string> = new Set(MEDIA_KINDS);

export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && MEDIA_KIND_SET.has(value);
}

/** The kind of a stored file, from its name. An SVG drawing is an image. */
export function kindOfName(name: string): LibraryKind {
  const type = fileTypeOf(name);
  if (!type) return 'file';
  switch (type.group) {
    case 'image':
    case 'drawing':
      return 'image';
    case 'video':
    case 'document':
    case 'model':
    case 'audio':
    case 'captions':
      return type.group;
    default:
      return 'file';
  }
}

/** The kind a prepared upload fills: its MediaRef kind, captions, or a plain file. */
export function kindOfUpload(prepared: Pick<PreparedUpload, 'kind' | 'mediaKind'>): LibraryKind {
  if (prepared.mediaKind) return prepared.mediaKind;
  return prepared.kind === 'captions' ? 'captions' : 'file';
}

/** "an image", "a 3D model". */
export function kindWithArticle(kind: LibraryKind): string {
  return KIND_WITH_ARTICLE[kind];
}

/** "images, videos, and 3D models". */
export function describeKinds(kinds: readonly LibraryKind[]): string {
  const words = kinds.map((kind) => KIND_PLURALS[kind]);
  if (words.length <= 1) return words[0] ?? 'files';
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`;
}

/** The file chooser's `accept` list for each kind. Model companions (.bin, .mtl, textures) are included. */
const ACCEPT_EXTENSIONS: Readonly<Record<LibraryKind, readonly string[]>> = {
  image: ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.heic', '.heif', '.svg'],
  video: ['.mp4', '.m4v', '.webm', '.mov'],
  embed: [],
  model: ['.glb', '.gltf', '.bin', '.stl', '.obj', '.mtl', '.3mf', '.ply', '.step', '.stp', '.png', '.jpg', '.jpeg', '.webp'],
  document: ['.pdf', '.docx'],
  audio: ['.mp3', '.m4a', '.wav'],
  captions: ['.vtt'],
  file: [],
};

/** The `accept` attribute for a file input that takes these kinds; empty (anything) when a plain file is allowed. */
export function acceptAttribute(kinds: readonly LibraryKind[]): string {
  if (kinds.includes('file')) return '';
  const out = new Set<string>();
  for (const kind of kinds) for (const ext of ACCEPT_EXTENSIONS[kind]) out.add(ext);
  return [...out].join(',');
}

/** What an upload target takes: some MediaRef kinds (a field), captions (a video's captions), or anything (the library). */
export type Accept = { type: 'media'; kinds: readonly MediaKind[] } | { type: 'captions' } | { type: 'any' };

export const ACCEPT_ANY: Accept = { type: 'any' };
export const ACCEPT_CAPTIONS: Accept = { type: 'captions' };

/** Why a prepared upload cannot go where it was dropped, or null when it can. Checked before anything is stored. */
export function acceptRefusal(accept: Accept, prepared: Pick<PreparedUpload, 'kind' | 'mediaKind'>): string | null {
  const kind = kindOfUpload(prepared);
  if (accept.type === 'any') return null;
  if (accept.type === 'captions') {
    return kind === 'captions' ? null : `Captions must be a WebVTT file (.vtt), and this file is ${KIND_WITH_ARTICLE[kind]}.`;
  }
  if (prepared.mediaKind && accept.kinds.includes(prepared.mediaKind)) return null;
  return `This field takes ${describeKinds(accept.kinds)}, and this file is ${KIND_WITH_ARTICLE[kind]}. Add it in the media library instead.`;
}

/** Why a file cannot replace `old`, or null: a replacement is the same kind of file. */
export function replaceRefusal(old: Pick<MediaItem, 'name'>, prepared: Pick<PreparedUpload, 'kind' | 'mediaKind'>): string | null {
  const before = kindOfName(old.name);
  const after = kindOfUpload(prepared);
  if (before === after) return null;
  return `A replacement must be the same kind of file: ${old.name} is ${KIND_WITH_ARTICLE[before]}, and the new file is ${KIND_WITH_ARTICLE[after]}.`;
}

// ---------------------------------------------------------------------------------------------
// Which store each part goes to (D-23, Option A)
// ---------------------------------------------------------------------------------------------

/** The refusal for a file over 4 MB while Vercel Blob is not configured (ARCHITECTURE.md 13A, D-23). */
export const BLOB_NOT_CONFIGURED =
  'Files over 4 MB need Vercel Blob. Connect a Blob store to this environment in Vercel (Storage), which sets BLOB_READ_WRITE_TOKEN.';

export interface StoragePlan {
  /** The main file, when it goes from the browser straight to Vercel Blob. */
  blob: PreparedPart | null;
  /** Repository requests, in order. Each is one request and one commit on the draft branch. */
  repo: PreparedPart[][];
}

export type StorageDecision = { ok: true; plan: StoragePlan } | { ok: false; message: string };

/**
 * Where the parts of one prepared upload are stored.
 *
 * - A main file of at most REPO_MAX_BYTES goes to the repository, with its poster in the same
 *   request (one commit) when both fit one request body (MAX_REPO_UPLOAD_BODY_BYTES), otherwise
 *   in a second request.
 * - A larger main file goes to Vercel Blob, up to BLOB_MAX_BYTES, and its poster to the
 *   repository. A repository-only type (SVG) over the line is refused, and so is any larger file
 *   while Blob is not configured (`blobConfigured` false). When the status is not known (null),
 *   the server decides.
 */
export function planStorage(parts: readonly PreparedPart[], options: { blobConfigured: boolean | null }): StorageDecision {
  const main = parts.find((part) => part.role === 'main');
  if (!main) return { ok: false, message: 'This upload holds no file to store.' };
  const poster = parts.find((part) => part.role === 'poster') ?? null;
  const size = main.blob.size;
  if (size === 0) return { ok: false, message: STORAGE_MESSAGES.emptyFile };
  if (size > BLOB_MAX_BYTES) return { ok: false, message: STORAGE_MESSAGES.tooLarge(BLOB_MAX_BYTES) };
  if (poster && poster.blob.size > REPO_MAX_BYTES) {
    return { ok: false, message: 'The poster drawn for this file is larger than 4 MB, so it cannot be stored. Export the file again at a smaller size.' };
  }
  if (size <= REPO_MAX_BYTES) {
    if (!poster) return { ok: true, plan: { blob: null, repo: [[main]] } };
    const together = uploadBodySize([main, poster]) <= MAX_REPO_UPLOAD_BODY_BYTES;
    return { ok: true, plan: { blob: null, repo: together ? [[main, poster]] : [[main], [poster]] } };
  }
  const type = fileTypeOf(main.name);
  if (type && !type.stores.includes('blob')) {
    return { ok: false, message: STORAGE_MESSAGES.repoOnlyTooLarge(type.ext, REPO_MAX_BYTES) };
  }
  if (options.blobConfigured === false) return { ok: false, message: BLOB_NOT_CONFIGURED };
  return { ok: true, plan: { blob: main, repo: poster ? [[poster]] : [] } };
}

// ---------------------------------------------------------------------------------------------
// A browser upload that Vercel Blob refuses
// ---------------------------------------------------------------------------------------------

/**
 * The likely cause of a refusal about the store's access: this site's uploads ask for public
 * access (BLOB_WRITE_OPTIONS in lib/storage/rules.ts), and a store created as private refuses them
 * (it answered 503 on the preview).
 */
const BLOB_PRIVATE_STORE =
  'This site stores Blob files as public, and a store created as private refuses them. Check the Blob store connected to this environment.';

/**
 * Refusals @vercel/blob 2.9.0 names in its error message, with their likely cause. A store that
 * refuses this site's public files answers 503 (the library's "currently not available", as on the
 * preview), or with an answer the library calls an unknown error or access denied.
 */
const BLOB_REFUSAL_CAUSES: readonly (readonly [RegExp, string])[] = [
  [/store has been suspended/i, 'The Blob store connected to this environment is suspended. Check it in Vercel (Storage).'],
  [/store does not exist/i, 'The Blob store connected to this environment does not exist. Connect a Blob store to this environment in Vercel (Storage).'],
  [/client token has expired/i, 'The permission this site gave the browser for this upload ran out before the file was stored. Try again.'],
  [/too many requests/i, 'It is taking too many requests at the moment. Wait a minute and try again.'],
  [/currently not available|unknown error|access denied/i, BLOB_PRIVATE_STORE],
];

/** An en dash or an em dash, built from char codes so this file holds neither. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, 'g');

function messageOf(error: unknown): string {
  const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? message : '';
}

/** The HTTP status an error carries (400 to 599), or null. @vercel/blob 2.9.0 puts none on its errors. */
function refusalStatus(error: unknown): number | null {
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
}

/**
 * True when a browser upload to Vercel Blob failed on Vercel Blob's answer: an error with an HTTP
 * status, or one @vercel/blob throws for an answer (each of its messages starts "Vercel Blob:").
 * Its "request was aborted" is the request being stopped, and a TypeError is a dropped connection.
 */
export function isBlobRefusal(error: unknown): boolean {
  if (refusalStatus(error) !== null) return true;
  const text = messageOf(error);
  return text.startsWith('Vercel Blob:') && !/request was aborted/i.test(text);
}

/**
 * The message for a browser upload Vercel Blob refused: the status when the error carries one,
 * then the likely cause when the refusal names one, or is one a store's access gives (refused
 * access, or a failing service; a private store answered 503). Any other refusal keeps the
 * library's own reason, such as a file that is too large or a pathname that is taken.
 */
export function blobRefusal(error: unknown): string {
  const status = refusalStatus(error);
  const text = messageOf(error);
  const cause =
    BLOB_REFUSAL_CAUSES.find(([words]) => words.test(text))?.[1] ??
    (status !== null && (status === 401 || status === 403 || status >= 500) ? BLOB_PRIVATE_STORE : null);
  if (cause) return `Vercel Blob refused the file${status === null ? '' : ` (${status})`}. ${cause}`;
  // The library's own words, without its prefix, a closing period, or a dash (its message about
  // client tokens has one).
  const said = text
    .replace(/^Vercel Blob:/, '')
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
  const reason = said.length > 200 ? `${said.slice(0, 197)}...` : said;
  const details = [status === null ? '' : String(status), reason].filter((part) => part !== '').join(': ');
  return `Vercel Blob refused the file${details === '' ? '' : ` (${details})`}. Try again.`;
}

/**
 * True when @vercel/blob says the upload's pathname already holds a file. Each upload gets a new
 * pathname that its token may not overwrite, so the file there is this upload's own: an earlier
 * try stored it, and Vercel Blob's answer to that try was lost on the way.
 */
export function isBlobAlreadyStored(error: unknown): boolean {
  const text = messageOf(error);
  return text.startsWith('Vercel Blob:') && /already exists/i.test(text);
}

// ---------------------------------------------------------------------------------------------
// MediaRefs
// ---------------------------------------------------------------------------------------------

/** At most this many waveform peaks (the schema's limit). */
const WAVEFORM_MAX = 4096;

function cleanWaveform(peaks: readonly number[]): number[] {
  return peaks.slice(0, WAVEFORM_MAX).map((peak) => (Number.isFinite(peak) ? Math.min(1, Math.max(0, peak)) : 0));
}

/**
 * The MediaRef a stored upload becomes: its kind, the stored address and store, the poster's
 * address, the waveform for audio, and empty alt text, which the owner writes in the field.
 * Keys follow the schema's order. Null for captions, office files, and other downloads.
 */
export function mediaRefFromUpload(
  prepared: Pick<PreparedUpload, 'mediaKind' | 'meta'>,
  stored: { main: Pick<MediaItem, 'src' | 'store'>; poster?: Pick<MediaItem, 'src'> | null },
): MediaRef | null {
  if (!prepared.mediaKind) return null;
  const ref: MediaRef = { kind: prepared.mediaKind, src: stored.main.src, alt: '' };
  if (stored.poster) ref.poster = stored.poster.src;
  ref.store = stored.main.store;
  const peaks = prepared.meta.waveform;
  if (prepared.mediaKind === 'audio' && peaks && peaks.length > 0) ref.waveform = cleanWaveform(peaks);
  return ref;
}

/** What a file already used in content carries besides its address: its poster, waveform, and captions. */
export interface RefExtras {
  poster?: string;
  waveform?: number[];
  captions?: string;
}

/**
 * The MediaRef for a file chosen from the library. `extras` come from a MediaRef that already
 * uses the file (its poster, waveform, captions) or from the poster found beside it; alt text
 * starts empty, as for an upload. Null for a file that is not a MediaRef kind.
 */
export function mediaRefFromItem(item: Pick<MediaItem, 'name' | 'src' | 'store'>, extras: RefExtras = {}): MediaRef | null {
  const kind = kindOfName(item.name);
  if (!isMediaKind(kind)) return null;
  const ref: MediaRef = { kind, src: item.src, alt: '' };
  if (extras.poster && kind !== 'image') ref.poster = extras.poster;
  if (extras.captions && kind === 'video') ref.captions = extras.captions;
  ref.store = item.store;
  if (kind === 'audio' && extras.waveform && extras.waveform.length > 0) ref.waveform = cleanWaveform(extras.waveform);
  return ref;
}

/** The empty MediaRef "Clear" leaves (D-07): the kind kept, no file, the placeholder shown. */
export function clearedRef(ref: Pick<MediaRef, 'kind'>): MediaRef {
  return { kind: ref.kind, src: '', alt: '' };
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** The name the server will store for `name` (sanitizeFileName), or null when it cannot be cleaned. */
export function predictedName(name: string): string | null {
  try {
    return sanitizeFileName(name).name;
  } catch {
    return null;
  }
}

function lowerSet(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const name of names) out.add(name.toLowerCase());
  return out;
}

/** `<base>-<n>.<ext>`, with the base shortened so the cleaned name keeps the number. */
function numbered(base: string, ext: string, n: number): { base: string; name: string } {
  const suffix = `-${n}`;
  const kept = base.slice(0, Math.max(1, NAME_BASE_MAX_LENGTH - suffix.length)).replace(/-+$/, '') || 'file';
  const next = `${kept}${suffix}`;
  return { base: next, name: `${next}.${ext}` };
}

/** A free name in the folder for one file: `photo-2.webp`, `photo-3.webp`, ... */
export function freeName(name: string, taken: Iterable<string>): string {
  const used = lowerSet(taken);
  const clean = sanitizeFileName(name);
  if (!used.has(clean.name.toLowerCase())) return clean.name;
  for (let n = 2; n < 100_000; n += 1) {
    const candidate = numbered(clean.base, clean.ext, n).name;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${clean.base}-${Date.now()}.${clean.ext}`;
}

/**
 * New names for "keep both": the main file numbered (`clip-2.mp4`), and its poster named after it
 * (`clip-2-poster.webp`), both free in the folder. Names are compared without case, as the server
 * refuses names that differ only in case.
 */
export function freeNames(main: string, poster: string | null, taken: Iterable<string>): { main: string; poster: string | null } {
  const used = lowerSet(taken);
  const clean = sanitizeFileName(main);
  const posterExt = poster ? sanitizeFileName(poster).ext : null;
  for (let n = 2; n < 100_000; n += 1) {
    const next = numbered(clean.base, clean.ext, n);
    if (used.has(next.name.toLowerCase())) continue;
    if (posterExt === null) return { main: next.name, poster: null };
    const posterName = sanitizeFileName(`${next.base}-poster.${posterExt}`).name;
    if (posterName.toLowerCase() === next.name.toLowerCase() || used.has(posterName.toLowerCase())) continue;
    return { main: next.name, poster: posterName };
  }
  const stamp = Date.now();
  return { main: `${clean.base}-${stamp}.${clean.ext}`, poster: posterExt ? `${clean.base}-${stamp}-poster.${posterExt}` : null };
}

/** A stored Blob name without its random suffix: "clip-a1b2c3d4e5f6.mp4" gives "clip.mp4". */
export function givenName(stored: string): string {
  return stored.replace(/-[0-9a-f]{12}(\.[a-z0-9]+)$/, '$1');
}

function baseOfName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The name without its extension, for a rename box. */
export function nameWithoutExtension(name: string): string {
  return baseOfName(name);
}

/** The extension, lower case, without the dot. */
export function extensionOfName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** True for a poster the admin stored beside its file: `<base>-poster.webp`. */
export function isPosterName(name: string): boolean {
  return /-poster(?:-\d+)?\.webp$/i.test(name);
}

/** The poster stored beside a library file by the naming convention (`clip.mp4` and `clip-poster.webp`), or null. */
export function findPosterItem(item: Pick<MediaItem, 'name' | 'folder'>, items: readonly MediaItem[]): MediaItem | null {
  const kind = kindOfName(item.name);
  if (kind !== 'video' && kind !== 'model' && kind !== 'document') return null;
  const wanted = `${baseOfName(givenName(item.name))}-poster.webp`.toLowerCase();
  return items.find((other) => other.store === 'repo' && other.folder === item.folder && other.name.toLowerCase() === wanted) ?? null;
}

// ---------------------------------------------------------------------------------------------
// References in the working copy: the server's rules (lib/admin/references.ts), so the library,
// a delete, and a rename agree with what the server finds (the review's MEDIA-1). Every string
// field counts, a bullet's Markdown link included, and an absolute address on this site's own
// host is read as its path.
// ---------------------------------------------------------------------------------------------

/** Every content file of the working copy, with its path. */
export function docFiles(doc: Doc): { file: string; data: unknown }[] {
  return [{ file: SITE_FILE, data: doc.site }, ...doc.projects.map((entry) => ({ file: pathOfEntry(entry), data: entry.data }))];
}

/** Every field of the working copy that refers to `src`. */
export function findLocalReferences(doc: Doc, src: string, hosts: readonly string[] = siteHosts()): Reference[] {
  const out: Reference[] = [];
  for (const { file, data } of docFiles(doc)) {
    for (const path of referencePaths(data, src, hosts)) out.push({ file, path });
  }
  return out;
}

/** The last segment of an address: every form of a reference to it contains these characters. */
function lastSegment(src: string): string {
  const bare = src.replace(/[?#].*$/, '');
  return bare.slice(bare.lastIndexOf('/') + 1) || bare;
}

/**
 * How many fields of the working copy refer to each address. The library recounts while the
 * owner types, so a file's serialized text (cached for every unchanged file) is searched for each
 * address's file name first, and only the files that contain it are read field by field.
 */
export function countLocalReferences(doc: Doc, srcs: readonly string[], hosts: readonly string[] = siteHosts()): Map<string, number> {
  const counts = new Map<string, number>(srcs.map((src) => [src, 0]));
  const wanted = srcs.filter((src) => src !== '');
  if (wanted.length === 0) return counts;
  for (const { data } of docFiles(doc)) {
    const text = textOf(data);
    const present = wanted.filter((src) => text.includes(lastSegment(src)));
    if (present.length > 0) countReferencePaths(data, present, counts, hosts);
  }
  return counts;
}

/**
 * True for a file nothing uses: no field of the draft, of the published site, or of the editor's
 * unsaved working copy refers to it. Unknown counts (a list without `refs`) count as used.
 */
export function isUnused(item: Pick<MediaItem, 'refs'>, localCount = 0): boolean {
  return item.refs !== undefined && item.refs.draft === 0 && item.refs.live === 0 && localCount === 0;
}

/** The "not used anywhere" filter of the library (D-27). */
export function unusedFiles<T extends Pick<MediaItem, 'src' | 'refs'>>(items: readonly T[], local: ReadonlyMap<string, number>): T[] {
  return items.filter((item) => isUnused(item, local.get(item.src) ?? 0));
}

// ---------------------------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------------------------

/** A media address's path: "/media/<folder>/<name>". */
const MEDIA_PATH = /^\/media\/([^/?#]+)\/[^/?#]+$/;
/** A Markdown link's target, after "](". */
const MARKDOWN_TARGET = /\]\(\s*<?([^)\s>]+)/g;

function isFolderName(folder: string): boolean {
  try {
    checkFolder(folder);
    return true;
  } catch {
    return false;
  }
}

/**
 * The media folder an address points into: a site path ("/media/raven/a.webp"), the same address
 * on this site's own host, or a Blob address ("https://<store>.public.blob.vercel-storage.com/
 * media/raven/clip-0123456789ab.mp4"). Null for anything else.
 */
export function folderOfAddress(value: string, hosts: readonly string[] = siteHosts()): string | null {
  let path = addressOf(value, hosts);
  if (/^https?:\/\//i.test(path)) {
    if (!isBlobUrl(path)) return null;
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  const match = MEDIA_PATH.exec(path);
  return match && isFolderName(match[1]) ? match[1] : null;
}

/**
 * The folder a project's files live in, which the library, Choose, and Upload use: the folder
 * most of its media addresses point into (its cover, blocks, posters, captions, file blocks, and
 * Markdown links), else `savedSlug` (the slug its file was saved under). A slug rename moves the
 * project's file but not its media, so a renamed project keeps using the folder its files are in;
 * a tie goes to `savedSlug`. The site's folder is never a project's.
 */
export function projectMediaFolder(project: unknown, savedSlug: string, hosts: readonly string[] = siteHosts()): string {
  const counts = new Map<string, number>();
  const add = (address: string) => {
    const folder = folderOfAddress(address, hosts);
    if (folder !== null && folder !== SITE_FOLDER) counts.set(folder, (counts.get(folder) ?? 0) + 1);
  };
  for (const { text } of stringValues(project)) {
    add(text);
    if (text.includes('](')) for (const match of text.matchAll(MARKDOWN_TARGET)) add(match[1]);
  }
  let best = savedSlug;
  let most = counts.get(savedSlug) ?? 0;
  for (const [folder, count] of counts) {
    if (count > most) {
      best = folder;
      most = count;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// A file named like a resume (D-22: no resume file is ever served)
// ---------------------------------------------------------------------------------------------

/** The queue's question for a file whose name looks like a resume or a CV. */
export const RESUME_QUESTION = 'No resume file is ever served on this site. Upload it anyway?';

/** The confirm warning for an upload whose dropped or stored name looks like a resume, or null. */
export function resumeWarning(names: readonly string[]): { code: string; message: string; confirm: true } | null {
  return names.some((name) => looksLikeResume(name)) ? { code: 'resume-name', message: RESUME_QUESTION, confirm: true } : null;
}

/** True when a library file's name looks like a resume or a CV. */
export function isResumeName(name: string): boolean {
  return looksLikeResume(name);
}

type Path = (string | number)[];

/** A MediaRef in content: an object with a string `src` and a media kind (the seed's hero model has no kind). */
function isMediaRefNode(node: Record<string, unknown>, path: Path): boolean {
  if (typeof node.src !== 'string') return false;
  return isMediaKind(node.kind) || (node.kind === undefined && path[path.length - 1] === 'heroModel');
}

/**
 * What a file becomes in content. `poster` and `waveform`: a value sets it, null removes it (a
 * new file whose old poster would be wrong), and undefined keeps what the MediaRef has (a rename).
 */
export interface Replacement {
  src: string;
  store?: 'repo' | 'blob';
  poster?: string | null;
  waveform?: number[] | null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The pattern of a word in either case: "amjadrehawi.com" also matches "AmjadRehawi.COM". */
function anyCase(text: string): string {
  return escapeRegExp(text).replace(/[a-z]/gi, (char) => `[${char.toLowerCase()}${char.toUpperCase()}]`);
}

/**
 * One string with every reference to `from` pointing at `to`, by the shared rules (`rewriteData`).
 * When `to` is an absolute address (a file that moved to Blob) and `from` is a site path, an
 * absolute address of `from` on this site's own host loses its host first, so it becomes `to`
 * rather than the host followed by `to`.
 */
function rewriteString(value: string, from: string, to: string, hosts: readonly string[]): string {
  let text = value;
  if (from.startsWith('/') && !to.startsWith('/') && hosts.length > 0 && text.includes(from)) {
    // The host (and a port), where the whole address `from` follows it (no file-name character after it).
    const whole = `${escapeRegExp(from)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`;
    const origin = new RegExp(`${anyCase('http')}[sS]?://(?:${hosts.map(anyCase).join('|')})(?::\\d+)?(?=${whole})`, 'g');
    text = text.replace(origin, '');
  }
  const { data, count } = rewriteData(text, from, to, hosts);
  return count > 0 ? data : value;
}

function replaceMediaRef(node: Record<string, unknown>, from: string, to: Replacement, hosts: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'poster') {
      if (to.poster === undefined) out.poster = typeof value === 'string' ? rewriteString(value, from, to.src, hosts) : value;
      else if (to.poster !== null) out.poster = to.poster;
    } else if (key === 'waveform') {
      if (to.waveform === undefined) out.waveform = value;
      else if (to.waveform !== null && to.waveform.length > 0) out.waveform = cleanWaveform(to.waveform);
    } else if (key === 'store') {
      out.store = to.store ?? value;
    } else {
      // `src` keeps its query or fragment and its form (a site path, or an address on this host);
      // a caption or alt text that names the file is a reference too.
      out[key] = typeof value === 'string' ? rewriteString(value, from, to.src, hosts) : value;
    }
  }
  if (typeof to.poster === 'string' && !('poster' in out)) out.poster = to.poster;
  if (to.store === 'blob' && !('store' in out)) out.store = 'blob';
  if (to.waveform && to.waveform.length > 0 && !('waveform' in out) && node.kind === 'audio') out.waveform = cleanWaveform(to.waveform);
  return out;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function replaceValue(value: unknown, path: Path, from: string, to: Replacement, hosts: readonly string[]): unknown {
  if (typeof value === 'string') return rewriteString(value, from, to.src, hosts);
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item, i) => {
      const out = replaceValue(item, [...path, i], from, to, hosts);
      if (out !== item) changed = true;
      return out;
    });
    return changed ? next : value;
  }
  if (value !== null && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    if (isMediaRefNode(node, path) && addressOf(node.src as string, hosts) === from) {
      const replaced = replaceMediaRef(node, from, to, hosts);
      return sameJson(replaced, node) ? value : replaced;
    }
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node)) {
      const next = replaceValue(item, [...path, key], from, to, hosts);
      if (next !== item) changed = true;
      Object.defineProperty(out, key, { value: next, enumerable: true, writable: true, configurable: true });
    }
    return changed ? out : value;
  }
  return value;
}

/**
 * Points every reference to `from` at the replacement, by the server's rules
 * (lib/admin/references.ts `rewriteData`): a MediaRef whose file it was takes the new address,
 * store, poster, and waveform; any other field that names it (a `file` block, a poster, a captions
 * file, a link, a Markdown link in any text, a bullet included) takes the new address, with its
 * query or fragment kept. Objects without a reference are kept as they are, so a file without one
 * stays unchanged (and clean in the save bar).
 */
export function replaceReferences<T>(data: T, from: string, to: Replacement, hosts: readonly string[] = siteHosts()): T {
  if (from === '') return data;
  return replaceValue(data, [], from, to, hosts) as T;
}

/** `replaceReferences` over the whole working copy. Returns the same Doc when nothing refers to `from`. */
export function replaceInDoc(doc: Doc, from: string, to: Replacement, hosts: readonly string[] = siteHosts()): Doc {
  const site = replaceReferences(doc.site, from, to, hosts);
  let changed = site !== doc.site;
  const projects = doc.projects.map((entry) => {
    const data = replaceReferences(entry.data, from, to, hosts);
    if (data === entry.data) return entry;
    changed = true;
    return { ...entry, data };
  });
  return changed ? { site, projects } : doc;
}

/** The poster, waveform, and captions each file already carries somewhere in the working copy. */
export function refExtrasIndex(doc: Doc, hosts: readonly string[] = siteHosts()): Map<string, RefExtras> {
  const out = new Map<string, RefExtras>();
  const visit = (value: unknown, path: Path) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, [...path, i]));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (isMediaRefNode(node, path)) {
      const src = addressOf(node.src as string, hosts);
      if (src !== '') {
        const extras = out.get(src) ?? {};
        if (!extras.poster && typeof node.poster === 'string' && node.poster.trim() !== '') extras.poster = node.poster;
        if (!extras.captions && typeof node.captions === 'string' && node.captions.trim() !== '') extras.captions = node.captions;
        if (!extras.waveform && Array.isArray(node.waveform) && node.waveform.every((n) => typeof n === 'number')) {
          extras.waveform = node.waveform as number[];
        }
        out.set(src, extras);
      }
    }
    for (const [key, item] of Object.entries(node)) if (item !== null && typeof item === 'object') visit(item, [...path, key]);
  };
  for (const { data } of docFiles(doc)) visit(data, []);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The content check over a file's words (D-24)
// ---------------------------------------------------------------------------------------------

/** Long text goes to the check in pieces of this many characters... */
export const CHECK_CHUNK_CHARS = 200_000;
/** ...overlapping by this many, so a phrase cut by a piece boundary is still whole in one piece. */
export const CHECK_CHUNK_OVERLAP = 2_000;
/** One check request stays this far under the route's body limit. */
const CHECK_BODY_BUDGET = MAX_CHECK_TEXT_BYTES - 50_000;
/** The route's limits on `source` and `label`. */
const CHECK_SOURCE_MAX = 300;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Text cut into pieces of at most `size` characters that overlap by `overlap`, never inside a surrogate pair. */
export function chunkText(text: string, size = CHECK_CHUNK_CHARS, overlap = CHECK_CHUNK_OVERLAP): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let start = 0;
  for (;;) {
    let end = Math.min(text.length, start + size);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1)) && end - 1 > start) end -= 1;
    out.push(text.slice(start, end));
    if (end >= text.length) return out;
    let next = Math.max(start + 1, end - overlap);
    if (next - 1 > start && isLowSurrogate(text.charCodeAt(next)) && isHighSurrogate(text.charCodeAt(next - 1))) next -= 1;
    start = next;
  }
}

/**
 * The labelled items the check reads for one file: its name, the words taken from it (a PDF's or
 * a Word file's text and properties, captions, a text file), and the part names inside a model.
 * Labels never repeat the text, so a finding never prints a private term.
 */
export function checkItemsFor(name: string, prepared: Pick<PreparedUpload, 'meta'>): CheckBody['items'] {
  const items: CheckBody['items'] = [{ label: 'name', text: name }];
  const text = prepared.meta.text ?? '';
  if (text.trim() !== '') {
    const chunks = chunkText(text);
    chunks.forEach((chunk, i) => items.push({ label: chunks.length === 1 ? 'text' : `text, part ${i + 1} of ${chunks.length}`, text: chunk }));
  }
  (prepared.meta.partNames ?? []).forEach((part, i) => {
    if (part.trim() !== '') items.push({ label: `model name ${i + 1}`, text: part });
  });
  return items;
}

/** The check requests for these items: each body under the route's byte limit and item count. */
export function checkBodies(source: string, items: CheckBody['items']): CheckBody[] {
  const encoder = new TextEncoder();
  const shownSource = source.slice(0, CHECK_SOURCE_MAX) || 'file';
  const overhead = encoder.encode(JSON.stringify({ source: shownSource, items: [] })).length;
  const bodies: CheckBody[] = [];
  let current: CheckBody['items'] = [];
  let bytes = overhead;
  for (const item of items) {
    const safe = { label: item.label.slice(0, CHECK_SOURCE_MAX), text: item.text };
    const size = encoder.encode(JSON.stringify(safe)).length + 1;
    if (current.length > 0 && (bytes + size > CHECK_BODY_BUDGET || current.length >= MAX_CHECK_ITEMS)) {
      bodies.push({ source: shownSource, items: current });
      current = [];
      bytes = overhead;
    }
    current.push(safe);
    bytes += size;
  }
  if (current.length > 0) bodies.push({ source: shownSource, items: current });
  return bodies;
}

/** Findings without repeats (overlapping text pieces can report one hit twice). */
export function uniqueFindings(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.rule}|${finding.path.replace(/, part \d+ of \d+$/, '')}|${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

/** What the queue says during each preparation stage (PrepareProgress.stage). */
export const STAGE_WORDS: Readonly<Record<string, string>> = {
  detect: 'Checking the type',
  decode: 'Reading the file',
  convert: 'Converting',
  compress: 'Compressing',
  poster: 'Capturing the poster',
  text: 'Reading the text',
  done: 'Prepared',
};

/** API errors that a retry cannot fix: the file or the request is refused as it is. */
const REFUSED_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'content-check',
  'invalid-file',
  'too-large',
  'bad-request',
  'unsupported-media-type',
  'not-allowed',
  'referenced',
]);

export function isRefusalCode(code: ErrorCode): boolean {
  return REFUSED_CODES.has(code);
}

/** The words for an upload kind in the queue. */
export function uploadKindWords(kind: UploadKind): string {
  switch (kind) {
    case 'image':
      return 'Photo';
    case 'drawing':
      return 'Drawing';
    case 'video':
      return 'Video';
    case 'document':
      return 'Document';
    case 'office':
      return 'Office file';
    case 'model':
      return '3D model';
    case 'audio':
      return 'Audio';
    case 'captions':
      return 'Captions';
    default:
      return 'File';
  }
}
