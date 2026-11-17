/**
 * The rules of media storage (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-23 to D-27): which folder a
 * file may go in, how its name is cleaned, which types are accepted, and which store holds a file
 * of a given size.
 *
 * This file is pure: no secrets, no file system, no network. The admin can run the same checks in
 * the browser before an upload starts (D-23 asks the admin to refuse a file over 4,000,000 bytes
 * while Blob is not set up). The backends that write files are server-only: see lib/storage.ts.
 */
import { STORAGE_MESSAGES as M } from './labels';

/** Where a file lives. `MediaRef.store` records it. */
export type StoreName = 'repo' | 'blob';

/**
 * Raw bytes up to this size go through the server to the repository; anything larger goes from
 * the browser straight to Vercel Blob (D-23, Option A). A Vercel Function refuses request bodies
 * over 4.5 MB, which is why the line sits below it.
 */
export const REPO_MAX_BYTES = 4_000_000;
/** The ceiling for one file in Vercel Blob (ARCHITECTURE.md 13A: up to 500 MB per file). */
export const BLOB_MAX_BYTES = 500_000_000;

/** The repository folder that holds media. The site serves it at `SITE_MEDIA_BASE`. */
export const REPO_MEDIA_DIR = 'public/media';
export const SITE_MEDIA_BASE = '/media';
/** The site's own media folder, beside one folder per project slug. */
export const SITE_FOLDER = 'site';
/** Blob pathnames start with this prefix, then the folder: `media/raven/clip-<suffix>.mp4`. */
export const DEFAULT_BLOB_PREFIX = 'media';

export const FOLDER_MAX_LENGTH = 64;
/** The longest cleaned file name, without its extension. */
export const NAME_BASE_MAX_LENGTH = 64;

/**
 * How every Blob file is written: public, under a random suffix, and never overwritten, so a Blob
 * file is immutable and Replace makes a new object (D-26, D-27). The Phase 6 token route for
 * browser uploads uses the same options.
 */
export const BLOB_WRITE_OPTIONS = Object.freeze({
  access: 'public',
  addRandomSuffix: true,
  allowOverwrite: false,
} as const);

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export type StorageErrorCode =
  | 'invalid-size'
  | 'empty-file'
  | 'too-large'
  | 'too-large-for-repo'
  | 'repo-only-too-large'
  | 'blob-not-configured'
  | 'bad-folder'
  | 'unknown-folder'
  | 'no-extension'
  | 'refused-type'
  | 'unsupported-type'
  | 'repo-only-type'
  | 'svg-not-sanitized'
  | 'inspect-failed'
  | 'bad-path'
  | 'exists'
  | 'repo-not-configured'
  | 'github-incomplete'
  | 'bad-repo'
  | 'no-draft-branch'
  | 'protected-branch'
  | 'bad-branch'
  | 'draft-missing'
  | 'conflict'
  | 'github-failed'
  | 'github-unreachable'
  | 'disk-failed'
  | 'blob-failed';

/**
 * A refusal or failure the admin can show as it is. `message` is written for the owner and never
 * holds a secret; `status` is the HTTP status a route should answer with.
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly status: number;

  constructor(code: StorageErrorCode, message: string, status: number) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.status = status;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}

// ---------------------------------------------------------------------------------------------
// Types, by extension
// ---------------------------------------------------------------------------------------------

export type FileGroup = 'image' | 'drawing' | 'video' | 'document' | 'office' | 'model' | 'audio' | 'data' | 'captions';
/** The `MediaRef.kind` a file can fill. Office files, data, and captions have none. */
export type FileKind = 'image' | 'video' | 'document' | 'model' | 'audio';

export interface FileType {
  readonly ext: string;
  readonly group: FileGroup;
  /** The Content-Type a store serves the file with. It never comes from the client. */
  readonly contentType: string;
  readonly kind?: FileKind;
  /** The stores that may hold it. SVG is repository-only (D-24, D-26). */
  readonly stores: readonly StoreName[];
}

const BOTH: readonly StoreName[] = ['repo', 'blob'];
const REPO_ONLY: readonly StoreName[] = ['repo'];
const OOXML = 'application/vnd.openxmlformats-officedocument';

/**
 * The allow-list. The type is checked here by extension only; the Phase 6 upload route also checks
 * it from the file's bytes (see `Inspector` in ./types).
 */
export const FILE_TYPES: readonly FileType[] = [
  { ext: 'jpg', group: 'image', contentType: 'image/jpeg', kind: 'image', stores: BOTH },
  { ext: 'jpeg', group: 'image', contentType: 'image/jpeg', kind: 'image', stores: BOTH },
  { ext: 'png', group: 'image', contentType: 'image/png', kind: 'image', stores: BOTH },
  { ext: 'webp', group: 'image', contentType: 'image/webp', kind: 'image', stores: BOTH },
  { ext: 'avif', group: 'image', contentType: 'image/avif', kind: 'image', stores: BOTH },
  { ext: 'gif', group: 'image', contentType: 'image/gif', kind: 'image', stores: BOTH },
  { ext: 'svg', group: 'drawing', contentType: 'image/svg+xml', kind: 'image', stores: REPO_ONLY },
  { ext: 'mp4', group: 'video', contentType: 'video/mp4', kind: 'video', stores: BOTH },
  { ext: 'webm', group: 'video', contentType: 'video/webm', kind: 'video', stores: BOTH },
  { ext: 'mov', group: 'video', contentType: 'video/quicktime', kind: 'video', stores: BOTH },
  { ext: 'pdf', group: 'document', contentType: 'application/pdf', kind: 'document', stores: BOTH },
  { ext: 'docx', group: 'document', contentType: `${OOXML}.wordprocessingml.document`, kind: 'document', stores: BOTH },
  { ext: 'xlsx', group: 'office', contentType: `${OOXML}.spreadsheetml.sheet`, stores: BOTH },
  { ext: 'pptx', group: 'office', contentType: `${OOXML}.presentationml.presentation`, stores: BOTH },
  { ext: 'glb', group: 'model', contentType: 'model/gltf-binary', kind: 'model', stores: BOTH },
  { ext: 'gltf', group: 'model', contentType: 'model/gltf+json', kind: 'model', stores: BOTH },
  { ext: 'stl', group: 'model', contentType: 'model/stl', kind: 'model', stores: BOTH },
  { ext: 'obj', group: 'model', contentType: 'model/obj', kind: 'model', stores: BOTH },
  { ext: '3mf', group: 'model', contentType: 'model/3mf', kind: 'model', stores: BOTH },
  { ext: 'ply', group: 'model', contentType: 'application/octet-stream', kind: 'model', stores: BOTH },
  { ext: 'mp3', group: 'audio', contentType: 'audio/mpeg', kind: 'audio', stores: BOTH },
  { ext: 'm4a', group: 'audio', contentType: 'audio/mp4', kind: 'audio', stores: BOTH },
  { ext: 'wav', group: 'audio', contentType: 'audio/wav', kind: 'audio', stores: BOTH },
  { ext: 'csv', group: 'data', contentType: 'text/csv; charset=utf-8', stores: BOTH },
  { ext: 'txt', group: 'data', contentType: 'text/plain; charset=utf-8', stores: BOTH },
  { ext: 'zip', group: 'data', contentType: 'application/zip', stores: BOTH },
  { ext: 'vtt', group: 'captions', contentType: 'text/vtt; charset=utf-8', stores: BOTH },
];

export const ACCEPTED_EXTENSIONS: readonly string[] = FILE_TYPES.map((type) => type.ext);

/**
 * Refused in both stores, whatever the bytes: a page, XML, or a script could run in the site's
 * origin, whose policy allows inline scripts (D-24, R-13). Anything else off the allow-list is
 * refused too, with a plainer message.
 */
export const REFUSED_EXTENSIONS: ReadonlySet<string> = new Set([
  'html',
  'htm',
  'xhtml',
  'xht',
  'shtml',
  'mht',
  'mhtml',
  'xml',
  'xsl',
  'xslt',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'svgz',
]);

const BY_EXT: ReadonlyMap<string, FileType> = new Map(FILE_TYPES.map((type) => [type.ext, type]));

/** The type of a file name or a bare extension ("photo.JPG" or "jpg"), or null when not accepted. */
export function fileTypeOf(nameOrExt: string): FileType | null {
  const value = nameOrExt.trim().toLowerCase();
  const ext = value.includes('.') ? value.slice(value.lastIndexOf('.') + 1) : value;
  return BY_EXT.get(ext) ?? null;
}

/** The type for an extension, refused when it is not on the allow-list or not allowed in `store`. */
export function checkType(ext: string, store?: StoreName): FileType {
  const value = ext.trim().toLowerCase();
  if (REFUSED_EXTENSIONS.has(value)) throw new StorageError('refused-type', M.refusedType(value), 415);
  const type = BY_EXT.get(value);
  if (!type) throw new StorageError('unsupported-type', M.unsupportedType(value), 415);
  if (store && !type.stores.includes(store)) throw new StorageError('repo-only-type', M.repoOnlyType(value), 415);
  return type;
}

/** The part of a MediaRef that storage decides. `store` records the backend that holds the file. */
export interface StoredMediaRef {
  kind: FileKind;
  src: string;
  store: StoreName;
}

/** What a stored file fills in content: a MediaRef's kind, src, and store, or null for a plain download. */
export function mediaRefOf(file: { name: string; src: string; store: StoreName }): StoredMediaRef | null {
  const kind = fileTypeOf(file.name)?.kind;
  return kind ? { kind, src: file.src, store: file.store } : null;
}

// ---------------------------------------------------------------------------------------------
// Folders and names
// ---------------------------------------------------------------------------------------------

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A media folder: "site", or a slug-safe project folder. With `knownFolders` (the project slugs
 * that exist), the folder must also be one of them (D-24).
 */
export function checkFolder(folder: unknown, knownFolders?: Iterable<string>): string {
  if (typeof folder !== 'string' || folder.length > FOLDER_MAX_LENGTH || !SLUG.test(folder)) {
    throw new StorageError('bad-folder', M.badFolder(String(folder)), 400);
  }
  if (folder === SITE_FOLDER || !knownFolders) return folder;
  const known = knownFolders instanceof Set ? (knownFolders as ReadonlySet<string>) : new Set(knownFolders);
  if (!known.has(folder)) throw new StorageError('unknown-folder', M.unknownFolder(folder), 400);
  return folder;
}

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

export interface CleanName {
  /** `base.ext`, as the stores keep it. */
  name: string;
  base: string;
  /** Lower case, without the dot. */
  ext: string;
}

/**
 * Cleans an uploaded file's name: the last path segment only, accents folded, lower case, every
 * run of other characters made one hyphen, at most 64 characters before a lower-case extension.
 * The result has no path separator and no "..". It does not check the type: see `checkType`.
 */
export function sanitizeFileName(raw: string): CleanName {
  const segment = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  const trimmed = segment.trim().replace(/[.\s]+$/, '');
  const dot = trimmed.lastIndexOf('.');
  const ext = dot >= 0 ? trimmed.slice(dot + 1).normalize('NFKC').trim().toLowerCase() : '';
  if (!ext) throw new StorageError('no-extension', M.noExtension, 400);
  if (!/^[a-z0-9]{1,10}$/.test(ext)) throw new StorageError('unsupported-type', M.unsupportedType(ext), 415);
  let base = trimmed
    .slice(0, dot)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_BASE_MAX_LENGTH)
    .replace(/-+$/, '');
  if (!base) base = 'file';
  if (WINDOWS_RESERVED.test(base)) base = `${base}-file`;
  return { name: `${base}.${ext}`, base, ext };
}

const STORED_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}$/;

/** True for the name of a file already in a store (Blob suffixes have capitals; v2 files are kept as named). */
export function isStoredName(name: unknown): name is string {
  return typeof name === 'string' && STORED_NAME.test(name) && !name.includes('..');
}

export function checkStoredName(name: unknown): string {
  if (!isStoredName(name)) throw new StorageError('bad-path', M.badPath(String(name)), 400);
  return name;
}

/** `public/media/<folder>/<name>`: the file's path in the repository. */
export function repoPathOf(folder: string, name: string): string {
  return `${REPO_MEDIA_DIR}/${folder}/${name}`;
}

/** `/media/<folder>/<name>`: the address of a repository file on the site, as content stores it. */
export function sitePathOf(folder: string, name: string): string {
  return `${SITE_MEDIA_BASE}/${folder}/${name}`;
}

/** Reads a repository file's site address (`/media/<folder>/<name>`) back into its folder and name. */
export function parseSitePath(src: unknown, knownFolders?: Iterable<string>): { folder: string; name: string } {
  const match = typeof src === 'string' ? /^\/media\/([^/]+)\/([^/]+)$/.exec(src) : null;
  if (!match) throw new StorageError('bad-path', M.badPath(String(src)), 400);
  return { folder: checkFolder(match[1], knownFolders), name: checkStoredName(match[2]) };
}

const PREFIX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/;

/** A Blob path prefix: lower-case words joined by single slashes ("media", or "preview/media"). */
export function checkBlobPrefix(prefix: string): string {
  if (typeof prefix !== 'string' || prefix.length > 64 || !PREFIX.test(prefix)) {
    throw new StorageError('bad-path', M.badPrefix, 400);
  }
  return prefix;
}

/** The pathname a Blob upload asks for: `<prefix>/<folder>/<name>`. Blob adds the random suffix. */
export function blobPathnameOf(folder: string, name: string, prefix: string = DEFAULT_BLOB_PREFIX): string {
  return `${checkBlobPrefix(prefix)}/${checkFolder(folder)}/${checkStoredName(name)}`;
}

// ---------------------------------------------------------------------------------------------
// Sizes and the choice of store
// ---------------------------------------------------------------------------------------------

function checkByteCount(bytes: number): void {
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new StorageError('invalid-size', M.invalidSize, 400);
  }
  if (bytes === 0) throw new StorageError('empty-file', M.emptyFile, 400);
}

/**
 * The store for a file of `bytes` bytes (D-23, Option A): the repository up to 4,000,000 bytes,
 * Vercel Blob above that up to 500 MB. Throws a `StorageError` with a message for the owner when
 * no store can take the file: too large for both, a repository-only type (SVG) over the line, or
 * a large file while Blob is not set up (the message says how to set it up).
 */
export function storeForSize(bytes: number, options: { blobConfigured: boolean; ext?: string }): StoreName {
  checkByteCount(bytes);
  if (bytes > BLOB_MAX_BYTES) throw new StorageError('too-large', M.tooLarge(BLOB_MAX_BYTES), 413);
  if (bytes <= REPO_MAX_BYTES) return 'repo';
  const type = options.ext === undefined ? null : fileTypeOf(options.ext);
  if (type && !type.stores.includes('blob')) {
    throw new StorageError('repo-only-too-large', M.repoOnlyTooLarge(type.ext, REPO_MAX_BYTES), 413);
  }
  if (!options.blobConfigured) throw new StorageError('blob-not-configured', M.blobNotConfigured(REPO_MAX_BYTES), 413);
  return 'blob';
}

/** Refuses a size that `store` does not take. */
export function checkSizeForStore(bytes: number, store: StoreName): void {
  checkByteCount(bytes);
  if (store === 'repo' && bytes > REPO_MAX_BYTES) {
    throw new StorageError('too-large-for-repo', M.tooLargeForRepo(REPO_MAX_BYTES), 413);
  }
  if (bytes > BLOB_MAX_BYTES) throw new StorageError('too-large', M.tooLarge(BLOB_MAX_BYTES), 413);
}

export interface UploadPlan {
  folder: string;
  /** The cleaned name. A Blob upload adds a random suffix to it. */
  name: string;
  ext: string;
  type: FileType;
  store: StoreName;
  size: number;
}

/**
 * Every check that can run before any byte moves: folder, name, type, size, and store. The admin
 * runs it in the browser; the upload route runs it again on the server.
 */
export function planUpload(
  file: { folder: string; name: string; size: number },
  options: { blobConfigured: boolean; knownFolders?: Iterable<string> },
): UploadPlan {
  const folder = checkFolder(file.folder, options.knownFolders);
  const { name, ext } = sanitizeFileName(file.name);
  checkType(ext);
  const store = storeForSize(file.size, { blobConfigured: options.blobConfigured, ext });
  const type = checkType(ext, store);
  return { folder, name, ext, type, store, size: file.size };
}
