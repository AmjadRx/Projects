/**
 * The media library on the server (ARCHITECTURE.md 11 "Uploads" and "Paths", 13A; docs/V3_PLAN.md
 * D-17, D-19, D-23 to D-27, D-29, D-30). Server only.
 *
 * The routes in app/api/upload/ wrap these functions in `adminRoute` (session, origin check,
 * no-store) and pass the repository from `getContentRepo`, so tests can pass their own.
 *
 * - A folder is "site", a project saved on the draft, or a folder that already holds files in
 *   either store, so the files of a renamed or deleted project stay within reach of the library
 *   (?folders=1 lists every folder with its owner). No path ever leaves public/media/ or the Blob
 *   media prefix.
 * - Files up to REPO_MAX_BYTES arrive in one multipart request. Each one is checked from its bytes
 *   (sniff.ts), cleaned (WebP and PNG metadata removed and the removal confirmed, SVG sanitized),
 *   and run through the content check (its folder, its name, and the words of a text file, a
 *   drawing, or a model). All files of a request become one commit on the draft branch.
 * - Larger files go from the browser straight to Vercel Blob. /token issues a client token for one
 *   fixed pathname with no overwrite, one type, and one size, with a signed ticket; /confirm checks
 *   the stored bytes, the name, and a GLB model's names. The client token can write its pathname
 *   only while nothing is stored there, so a file that fails, or a Blob file deleted while its
 *   token may still be valid, becomes a small placeholder instead of being removed: the token can
 *   never write that pathname again. Lists hide placeholders and remove them once the token has
 *   expired (D-26).
 * - A delete refuses a file the draft still uses, and a Blob file the published site still uses
 *   (a Blob delete reaches the live site at once, D-27). A rename rewrites every draft reference
 *   in the same commit; a Blob rename copies the file and keeps the old object until a publish
 *   leaves nothing that refers to it. References follow lib/admin/references.ts: every string
 *   field, and absolute addresses on this site's own host.
 * - Every refusal comes before `prepareDraft`, so a refused upload, delete, or rename never
 *   creates, moves, or merges the draft branch (`checkThenPrepare`).
 * - The preview route streams a repository file from the draft with headers that let it run
 *   nothing, and answers one byte range, as Safari needs for video and audio.
 *
 * Nothing here logs, and no error carries a token or a CONTENT_BLOCKLIST term.
 */
import 'server-only';
import { randomBytes } from 'node:crypto';
import {
  BlobNotFoundError,
  copy as blobCopy,
  del as blobDel,
  head as blobHead,
  list as blobList,
  put as blobPut,
  type HeadBlobResult,
  type ListBlobResult,
  type ListBlobResultBlob,
} from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import rulesFile from '@/content-rules.public.json';
import { checkText, compileRules, parseBlocklist, stringValues, type CompiledRule } from '@/lib/lint';
import { downloadHrefOf, isBlobUrl } from '@/lib/media';
import { getBlobStorage } from '@/lib/storage';
import { COMMIT_MESSAGES, STORAGE_MESSAGES as M } from '@/lib/storage/labels';
import {
  BLOB_MAX_BYTES,
  BLOB_WRITE_OPTIONS,
  checkFolder,
  checkType,
  DEFAULT_BLOB_PREFIX,
  fileTypeOf,
  isStoredName,
  parseSitePath,
  REFUSED_EXTENSIONS,
  REPO_MAX_BYTES,
  REPO_MEDIA_DIR,
  repoPathOf,
  sanitizeFileName,
  SITE_FOLDER,
  sitePathOf,
  StorageError,
  type CleanName,
  type FileType,
} from '@/lib/storage/rules';
import { envValue } from '@/lib/storage/shared';
import type { StoredFile } from '@/lib/storage/types';
import {
  API,
  slugOfProjectFile,
  UploadFields,
  type BlobConfirmBody,
  type BlobConfirmResponse,
  type BlobTokenBody,
  type BlobTokenResponse,
  type Finding,
  type MediaDeleteBody,
  type MediaDeleteResponse,
  type MediaFoldersResponse,
  type MediaItem,
  type MediaListResponse,
  type MediaReferencesResponse,
  type MediaRenameBody,
  type MediaRenameResponse,
  type Reference,
  type UploadResponse,
} from '../contract';
import { signTicket, verifyTicket } from './blob-ticket';
import { blobConfigured, blobStoreHost, blocklistFailsClosed, blocklistRaw, type Env } from './env';
import { ApiFailure } from './guard';
import { countReferences, findReferences, rewriteReferences, siteHostsFor, UnreadableContentError, type ContentFile } from './references';
import type { ContentRepo, FileChange } from './repo';
import {
  bufferSource,
  decodeText,
  detectType,
  PHOTO_MESSAGE,
  refuseByName,
  scanImageMetadata,
  sniffFile,
  streamSource,
  stripImageMetadata,
  zipNamesFromCentralDirectory,
  type Sniffed,
} from './sniff';
import { sanitizeSvg } from './svg';

/** What every media function works with: the repository, the environment, and a clock. */
export interface MediaContext {
  repo: ContentRepo;
  env: Env;
  /** Unix time in milliseconds. Defaults to Date.now. */
  now?: () => number;
}

/** At most this many files in one repository upload (the body is capped at 4.4 MB anyway). */
export const MAX_FILES_PER_UPLOAD = 100;
/** How long a Blob client token may be used to start and finish an upload (D-26: short validity). */
export const BLOB_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
/** The confirm request may come a little after the last upload request the token allowed. */
const CONFIRM_GRACE_MS = 10 * 60 * 1000;
/**
 * How long a Blob pathname stays held by a placeholder after a refusal or a delete: past this, the
 * client token that allowed the upload has surely expired (its life, plus a margin for clocks), so
 * the placeholder can go and the pathname can be free again.
 */
export const PLACEHOLDER_KEEP_MS = BLOB_TOKEN_LIFETIME_MS + CONFIRM_GRACE_MS;
/** What a placeholder holds: a few bytes of plain text, far below REPO_MAX_BYTES. */
const PLACEHOLDER_BODY = 'This file was removed.\n';
const PLACEHOLDER_TYPE = 'text/plain; charset=utf-8';
/** The shortest cache time Blob allows, so caches let go of a placeholder soon. */
const PLACEHOLDER_CACHE_SECONDS = 60;
/** Above this size the browser uploads in parts, as the Blob SDK advises. */
const MULTIPART_FROM = 100_000_000;
/** The confirm route reads this much of a Blob upload to check its type. */
const SNIFF_PREFIX_BYTES = 64 * 1024;
/** The largest GLB scene description (its JSON chunk) the confirm route reads to check a model's names. */
const GLB_JSON_MAX_BYTES = 64 * 1024 * 1024;
const RANGE_TIMEOUT_MS = 30_000;
const SCAN_TIMEOUT_MS = 240_000;
/** Blob lists come in pages; a store this large is far beyond a portfolio's media. */
const BLOB_LIST_PAGE = 1000;
const BLOB_LIST_MAX_PAGES = 100;
/** Blob deletes go in batches of at most this many addresses. */
const BLOB_DELETE_BATCH = 100;

/** The response headers of the preview route: never cached, never sniffed, and unable to run anything. */
export const MEDIA_FILE_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

const MSG = {
  noFile: 'The upload holds no file.',
  notAFile: 'Each "file" part of the upload must be a file.',
  tooManyFiles: `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`,
  formShape: 'The upload form does not have the expected fields.',
  unsavedFolder: (folder: string) => `${M.unknownFolder(folder)} Save a new project before adding its media.`,
  contentCheck: 'The content check refused this upload. Each finding names the file, the field, and the rule.',
  blocklistMissing:
    'The content check cannot run: CONTENT_BLOCKLIST is not set on this deployment. Set it in the Vercel environment variables and redeploy.',
  metadataLeft: 'The metadata could not be removed from this image, so it cannot be stored. Export it again without metadata.',
  blobMetadata: (found: string) =>
    `This image still carries metadata (${found}). Upload it through the media library, which removes it.`,
  tooBigAfterCleaning: 'This file is larger than 4 MB after cleaning, so it cannot go to the repository.',
  smallForBlob: `Files of ${REPO_MAX_BYTES.toLocaleString('en-US')} bytes or less go to the repository: upload them with the regular upload.`,
  contentType: (ext: string) => `The type sent for this file does not match .${ext}. Upload it again through the media library.`,
  storedType: (ext: string) =>
    `The stored file is not the type its name ends in (.${ext}). Save it under the extension of its real type and upload it again.`,
  folderInName: 'A file name may not contain a folder path. Use the name of the file alone.',
  tokenFailed: 'Vercel Blob could not issue an upload token. Check the Blob row in the status panel.',
  ticketInvalid: 'This upload ticket is not valid. Upload the file again.',
  ticketExpired: 'This upload ticket has expired. Upload the file again.',
  ticketMismatch: 'This upload ticket was issued for another file. Upload the file again.',
  notUploaded: 'The uploaded file is not in Vercel Blob. Upload it again.',
  oversize: 'The stored file is larger than the size this upload was allowed.',
  modelUnreadable:
    "This model's scene description cannot be read, so its part names cannot be checked. Export it again as a GLB file and upload it again.",
  modelTooLarge: "This model's scene description is too large for its part names to be checked. Export it with fewer parts.",
  blobUnreadable: 'Vercel Blob did not return the uploaded file, so it could not be checked. Try again.',
  storeHostUnknown: 'The Blob store address cannot be read from BLOB_READ_WRITE_TOKEN. Set BLOB_STORE_HOST to the store host and redeploy.',
  blobFailed: 'Vercel Blob refused the request. Try again in a moment.',
  notFound: 'This file is not in the media library.',
  referencedDraft: 'This file is still used in the draft. Remove it from these fields first.',
  referencedLive:
    'This file is still used by the published site, and deleting a Blob file changes the site at once. Remove it from these fields, publish, and then delete it.',
  renameExtension: (ext: string) => `A rename keeps the file's type: end the new name in .${ext}, or leave the extension out.`,
  unreadableContent: (file: string) => `${file} could not be read as JSON, so its references cannot be rewritten. Fix that file first.`,
} as const;

/** A value from a request, made safe to quote: printable characters only, at most 80 of them. */
function shown(value: string): string {
  const clean = value.replace(/[^\x20-\x7e]/g, '?');
  return `"${clean.length > 80 ? `${clean.slice(0, 77)}...` : clean}"`;
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

function pathFinding(value: string, message: string): Finding {
  return { file: value.slice(0, 200), path: '(path)', rule: 'PATH', message, severity: 'error' };
}

function badPath(value: string, message: string): ApiFailure {
  return new ApiFailure(400, 'bad-request', message, { findings: [pathFinding(value, message)] });
}

/** A StorageError from lib/storage as the ApiFailure the admin expects. */
function fromStorage(error: StorageError, value = ''): ApiFailure {
  switch (error.code) {
    case 'bad-folder':
    case 'unknown-folder':
    case 'bad-path':
      return badPath(value, error.message);
    case 'too-large':
    case 'too-large-for-repo':
    case 'repo-only-too-large':
      return new ApiFailure(413, 'too-large', error.message);
    case 'blob-not-configured':
      return new ApiFailure(503, 'not-configured', error.message, { missing: ['BLOB_READ_WRITE_TOKEN'] });
    case 'repo-not-configured':
    case 'github-incomplete':
    case 'bad-repo':
    case 'no-draft-branch':
    case 'protected-branch':
    case 'bad-branch':
    case 'draft-missing':
      return new ApiFailure(503, 'not-configured', error.message);
    case 'exists':
      return new ApiFailure(409, 'exists', error.message);
    case 'conflict':
      return new ApiFailure(409, 'conflict', error.message);
    case 'github-failed':
    case 'github-unreachable':
      return new ApiFailure(502, 'github', error.message);
    case 'blob-failed':
    case 'disk-failed':
      return new ApiFailure(502, 'storage', error.message);
    default:
      return new ApiFailure(422, 'invalid-file', error.message);
  }
}

/** Runs a storage rule and turns its StorageError into the matching ApiFailure. */
function rule<T>(work: () => T, value = ''): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof StorageError) throw fromStorage(error, value);
    throw error;
  }
}

/** Puts the file's label ("file 2", or its checked name) in front of a refusal about one file of a batch. */
function aboutFile(label: string, error: unknown): unknown {
  if (error instanceof StorageError) return aboutFile(label, fromStorage(error));
  if (!(error instanceof ApiFailure) || error.code === 'content-check' || error.status >= 500) return error;
  return new ApiFailure(error.status, error.code, `${label}: ${error.message}`, error.extra, error.headers);
}

function blobFailure(error: unknown): ApiFailure {
  if (error instanceof ApiFailure) return error;
  if (error instanceof BlobNotFoundError) return new ApiFailure(404, 'bad-request', MSG.notFound);
  return new ApiFailure(502, 'storage', MSG.blobFailed);
}

// ---------------------------------------------------------------------------------------------
// The content check over names and words (D-19, D-24)
// ---------------------------------------------------------------------------------------------

let publicRules: CompiledRule[] | undefined;

interface ContentCheck {
  /** Findings for one value, labelled with its file and field. */
  value(file: string, path: string, text: string): Finding[];
  /** Findings for a text, by line ("line 12"); a match across lines is reported for the field "text". */
  lines(file: string, text: string): Finding[];
}

/**
 * The public rules, then the private terms. A CONTENT_BLOCKLIST that is missing or holds no term
 * fails closed on Vercel and in CI (503), as the save's content check does (D-76).
 */
function contentCheck(env: Env): ContentCheck {
  const blocklist = parseBlocklist(blocklistRaw(env));
  if (blocklist.length === 0 && blocklistFailsClosed(env)) {
    throw new ApiFailure(503, 'not-configured', MSG.blocklistMissing, { missing: ['CONTENT_BLOCKLIST'] });
  }
  publicRules ??= compileRules(rulesFile);
  const rules = publicRules;
  const finding = (file: string, path: string, hit: { rule: string; message: string }): Finding => ({
    file,
    path,
    rule: hit.rule,
    message: hit.message,
    severity: 'error',
  });
  return {
    value(file, path, text) {
      return checkText(text, rules, blocklist).map((hit) => finding(file, path, hit));
    },
    lines(file, text) {
      const whole = checkText(text, rules, blocklist);
      if (whole.length === 0) return [];
      const hitRules = rules.filter((r) => whole.some((hit) => hit.rule === r.id));
      const hitTerms = whole.some((hit) => hit.rule === 'BLOCKLIST') ? blocklist : [];
      const out: Finding[] = [];
      const placed = new Set<string>();
      text.split(/\r?\n/).forEach((line, i) => {
        for (const hit of checkText(line, hitRules, hitTerms)) {
          out.push(finding(file, `line ${i + 1}`, hit));
          placed.add(hit.rule);
        }
      });
      for (const hit of whole) if (!placed.has(hit.rule)) out.push(finding(file, 'text', hit));
      return out;
    },
  };
}

function unique(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}\u0000${f.path}\u0000${f.rule}\u0000${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A name checked by the content check, and the label that may stand for the file in an answer. */
interface CheckedName {
  findings: Finding[];
  /**
   * The name itself, or `fallback` when the name holds a private term: an answer never repeats
   * a CONTENT_BLOCKLIST term (D-76), not even inside the name the owner typed.
   */
  label: string;
}

/**
 * The folder and the cleaned file name, as stored and read as words ("a-b.webp" as "a b webp"),
 * since many rules match words separated by spaces.
 */
function checkName(check: ContentCheck, folder: string, name: string, fallback: string): CheckedName {
  const findings = [
    ...check.value(name, 'folder', folder),
    ...check.value(name, 'name', name),
    ...check.value(name, 'name', name.replace(/[-_.]+/g, ' ')),
  ];
  const label = findings.some((finding) => finding.rule === 'BLOCKLIST') ? fallback : name;
  return { findings: unique(findings.map((finding) => ({ ...finding, file: label }))), label };
}

/** Model text fields that hold data rather than words. */
const DATA_FIELD = /(?:^|\.)(?:uri|mimeType)$/;

/**
 * Every string of a parsed glTF description (the names of nodes, meshes, materials, textures,
 * images, animations, and scenes, extras, copyright), without embedded data.
 */
function gltfDataFindings(check: ContentCheck, name: string, data: unknown): Finding[] {
  return stringValues(data)
    .filter(({ path, text }) => !DATA_FIELD.test(path) && !text.startsWith('data:'))
    .flatMap(({ path, text }) => check.value(name, path, text));
}

/** glTF JSON strings (names, extras, copyright), without embedded data. */
function gltfFindings(check: ContentCheck, name: string, json: string): Finding[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  return gltfDataFindings(check, name, data);
}

/** The chunk type of a GLB's scene description: "JSON" read as a little-endian number. */
const GLB_JSON_CHUNK = 0x4e4f534a;

/** The JSON chunk of a GLB file. */
function glbJson(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  const type = view.getUint32(16, true);
  if (type !== GLB_JSON_CHUNK || 20 + length > bytes.byteLength) return null;
  return decodeText(bytes.subarray(20, 20 + length));
}

/**
 * The words inside a stored file that the server can read itself: a drawing's text, the lines of
 * text, CSV, and captions files, model names (glTF and GLB strings, OBJ names and comments, PLY
 * comments, the STL solid name). PDF and Word text and the part names of converted models are
 * checked in the browser before upload (/api/check).
 */
function wordFindings(check: ContentCheck, name: string, ext: string, bytes: Uint8Array, drawingText: string | null): Finding[] {
  if (ext === 'svg') return drawingText ? check.value(name, 'text', drawingText) : [];
  if (ext === 'glb') {
    const json = glbJson(bytes);
    return json ? gltfFindings(check, name, json) : [];
  }
  const text = ['txt', 'csv', 'vtt', 'gltf', 'obj', 'ply', 'stl'].includes(ext) ? decodeText(bytes) : null;
  if (text === null) return [];
  if (ext === 'gltf') return gltfFindings(check, name, text);
  if (ext === 'obj') {
    return check.lines(name, text.split(/\r?\n/).map((line) => (/^\s*(?:v|vt|vn|vp|f|l|p|s)\s/.test(line) ? '' : line)).join('\n'));
  }
  if (ext === 'ply') {
    const header = text.slice(0, Math.max(0, text.indexOf('end_header')));
    return check.lines(name, header.split(/\r?\n/).map((line) => (/^\s*(?:comment|obj_info)\s/.test(line) ? line : '')).join('\n'));
  }
  if (ext === 'stl') {
    return check.lines(name, text.split(/\r?\n/).map((line) => (/^\s*(?:solid|endsolid)\b/.test(line) ? line : '')).join('\n'));
  }
  return check.lines(name, text);
}

function contentCheckFailure(findings: Finding[]): ApiFailure {
  return new ApiFailure(422, 'content-check', MSG.contentCheck, { findings });
}

// ---------------------------------------------------------------------------------------------
// Folders, names, and addresses
// ---------------------------------------------------------------------------------------------

async function savedProjects(repo: ContentRepo): Promise<Set<string>> {
  const snapshot = await repo.readContent();
  const slugs = new Set<string>();
  for (const file of snapshot.files) {
    const slug = slugOfProjectFile(file.path);
    if (slug) slugs.add(slug);
  }
  return slugs;
}

/**
 * A media folder that may be listed and written:
 * - "site";
 * - the slug of a project saved on the draft (D-24: a new project is saved before its media);
 * - a folder that already holds files, in the repository (on the draft, or on the published
 *   branch while there is no draft) or in Blob. A project's files stay in the folder of the slug
 *   they were uploaded under, so after a slug rename or a delete this keeps them within reach of
 *   the library (rename, replace, delete, "Not used anywhere") and lets the project add more.
 * The name itself is always checked by `checkFolder`, so no folder leaves public/media/ or the
 * Blob media prefix.
 */
async function checkedFolder(ctx: MediaContext, value: unknown): Promise<string> {
  const folder = rule(() => checkFolder(value), String(value));
  if (folder === SITE_FOLDER) return folder;
  if ((await savedProjects(ctx.repo)).has(folder)) return folder;
  if ((await ctx.repo.listFiles('draft', `${REPO_MEDIA_DIR}/${folder}`)).length > 0) return folder;
  if (blobConfigured(ctx.env) && (await blobFolder(ctx, folder)).files.length > 0) return folder;
  throw badPath(folder, MSG.unsavedFolder(folder));
}

/** A folder name as `checkFolder` accepts it, or null. */
function folderNameOrNull(value: string): string | null {
  try {
    return checkFolder(value);
  } catch {
    return null;
  }
}

/** True for a name the library lists: directly in its folder, a stored name, and not .gitkeep. */
function isListedName(name: string): boolean {
  return !name.includes('/') && name !== '.gitkeep' && isStoredName(name);
}

/**
 * A file name as the owner gave it, cleaned (sanitizeFileName). A name that carries a folder path
 * ("../x.png", "a\\b.png") is refused rather than cut to its last part: a browser never sends one,
 * so it can only be an attempt to write outside the folder. `label` stands for the name in the
 * refusal, which never repeats the raw name.
 */
function cleanName(raw: string, label: string): CleanName {
  if (/[\\/]/.test(raw) || /^\s*\.{1,2}\s*$/.test(raw)) throw badPath(label, MSG.folderInName);
  return rule(() => sanitizeFileName(raw));
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The files directly inside a repository media folder, by name. */
async function folderFiles(repo: ContentRepo, folder: string): Promise<{ name: string; size: number }[]> {
  const dir = `${REPO_MEDIA_DIR}/${folder}`;
  const out: { name: string; size: number }[] = [];
  for (const entry of await repo.listFiles('draft', dir)) {
    if (!entry.path.startsWith(`${dir}/`)) continue;
    const name = entry.path.slice(dir.length + 1);
    if (!isListedName(name)) continue;
    out.push({ name, size: entry.size });
  }
  return out;
}

function repoItem(folder: string, name: string, size?: number): MediaItem {
  const src = sitePathOf(folder, name);
  const contentType = fileTypeOf(name)?.contentType;
  return {
    store: 'repo',
    folder,
    name,
    src,
    previewSrc: `${API.mediaFile}?src=${encodeURIComponent(src)}`,
    downloadHref: downloadHrefOf(src),
    ...(size !== undefined ? { size } : {}),
    ...(contentType ? { contentType } : {}),
  };
}

function blobItem(file: { folder: string; name: string; src: string; size?: number; contentType?: string; uploadedAt?: string }): MediaItem {
  return {
    store: 'blob',
    folder: file.folder,
    name: file.name,
    src: file.src,
    previewSrc: file.src,
    downloadHref: downloadHrefOf(file.src),
    ...(file.size !== undefined ? { size: file.size } : {}),
    ...(file.contentType ? { contentType: file.contentType } : {}),
    ...(file.uploadedAt ? { uploadedAt: file.uploadedAt } : {}),
  };
}

/**
 * BLOB_READ_WRITE_TOKEN, read the way env.ts reads every variable. It is passed to each Blob call
 * so the SDK never falls back to other credentials, and it is never returned, logged, or put in
 * an error.
 */
function blobToken(env: Env): string {
  return envValue(env, 'BLOB_READ_WRITE_TOKEN');
}

function requireBlob(env: Env): { token: string; host: string } {
  const token = blobToken(env);
  if (!blobConfigured(env) || token === '') {
    throw new ApiFailure(503, 'not-configured', M.blobNotConfigured(REPO_MAX_BYTES), { missing: ['BLOB_READ_WRITE_TOKEN'] });
  }
  const host = blobStoreHost(env);
  if (!host) throw new ApiFailure(503, 'not-configured', MSG.storeHostUnknown, { missing: ['BLOB_STORE_HOST'] });
  return { token, host };
}

const BLOB_PATHNAME = new RegExp(`^${DEFAULT_BLOB_PREFIX}/([^/]+)/([^/]+)$`);

/** A Blob pathname of this library, `media/<folder>/<name>`, read into its folder and name. */
function blobPathParts(pathname: string): { folder: string; name: string } {
  const match = BLOB_PATHNAME.exec(pathname);
  if (!match || !isStoredName(match[2])) throw badPath(pathname, M.blobBadAddress(pathname));
  return { folder: rule(() => checkFolder(match[1]), pathname), name: match[2] };
}

/** A Blob address of this store, made canonical: https, the store's host, no port, query, or fragment. */
function blobAddress(value: string, host: string): { url: string; pathname: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badPath(value, M.blobBadAddress(value));
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== host ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw badPath(value, M.blobBadAddress(value));
  }
  const pathname = url.pathname.slice(1);
  return { url: `https://${host}/${pathname}`, pathname };
}

// ---------------------------------------------------------------------------------------------
// Blob lists and placeholders (D-26)
// ---------------------------------------------------------------------------------------------

/**
 * True for a Blob object that holds a pathname for a refused or deleted upload. Every real Blob
 * upload is larger than REPO_MAX_BYTES (smaller files go to the repository, and /confirm refuses a
 * smaller one), so anything at or below that size is a placeholder, never shown or counted.
 */
function isPlaceholder(object: { size?: number }): boolean {
  return object.size !== undefined && object.size <= REPO_MAX_BYTES;
}

/** A Blob object's upload time in milliseconds, or NaN when Blob did not say. */
function uploadTime(value: Date | string | undefined): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

interface BlobFolder {
  /** The files the library shows. */
  files: StoredFile[];
  /** Placeholders, hidden from every list. */
  placeholders: StoredFile[];
}

/** One folder of this store's media prefix, its files apart from its placeholders. */
async function blobFolder(ctx: MediaContext, folder: string): Promise<BlobFolder> {
  let stored: StoredFile[];
  try {
    stored = await getBlobStorage({ env: ctx.env }).list(folder);
  } catch (error) {
    throw error instanceof StorageError ? fromStorage(error, folder) : blobFailure(error);
  }
  return { files: stored.filter((file) => !isPlaceholder(file)), placeholders: stored.filter(isPlaceholder) };
}

/** Every object under a prefix of this store, page by page. */
async function blobObjects(token: string, prefix: string): Promise<ListBlobResultBlob[]> {
  const out: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < BLOB_LIST_MAX_PAGES; page += 1) {
    let result: ListBlobResult;
    try {
      result = await blobList({ prefix, limit: BLOB_LIST_PAGE, token, ...(cursor ? { cursor } : {}) });
    } catch (error) {
      throw blobFailure(error);
    }
    out.push(...result.blobs);
    if (!result.hasMore || !result.cursor) break;
    cursor = result.cursor;
  }
  return out;
}

/**
 * Holds a Blob pathname with a placeholder, written through the read-write token over whatever is
 * stored there. A browser upload's client token never allows an overwrite, so it can write its
 * pathname only while nothing is stored there: deleting a refused upload would free the pathname
 * for the rest of the token's hour, and the same token could store a file there again (D-26: one
 * file, once). Lists hide the placeholder and remove it once the token has expired. When the
 * overwrite fails, the object is deleted instead, so refused bytes never stay public; a failure of
 * that delete is thrown.
 */
async function occupy(target: { url: string; pathname: string }, token: string): Promise<void> {
  try {
    await blobPut(target.pathname, PLACEHOLDER_BODY, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: PLACEHOLDER_TYPE,
      cacheControlMaxAge: PLACEHOLDER_CACHE_SECONDS,
      token,
    });
  } catch {
    await blobDel(target.url, { token });
  }
}

/**
 * Removes the placeholders that have held their pathname past PLACEHOLDER_KEEP_MS, when the token
 * that could write there has surely expired. Best effort: a failure leaves them for the next list.
 */
async function removeExpiredPlaceholders(ctx: MediaContext, placeholders: readonly { url: string; uploadedAt: number }[]): Promise<void> {
  const now = (ctx.now ?? Date.now)();
  const expired = placeholders.filter((object) => Number.isFinite(object.uploadedAt) && now - object.uploadedAt > PLACEHOLDER_KEEP_MS);
  const token = blobToken(ctx.env);
  for (let at = 0; at < expired.length; at += BLOB_DELETE_BATCH) {
    const batch = expired.slice(at, at + BLOB_DELETE_BATCH).map((object) => object.url);
    await blobDel(batch, { token }).catch(() => undefined);
  }
}

type Target =
  | { store: 'repo'; folder: string; name: string; src: string; path: string }
  | { store: 'blob'; folder: string; name: string; src: string; pathname: string; token: string; host: string };

/** A media address from a request: `/media/<folder>/<name>`, or a file in this Blob store. */
function parseSrc(value: string, env: Env): Target {
  if (value.startsWith('/')) {
    const { folder, name } = rule(() => parseSitePath(value), value);
    return { store: 'repo', folder, name, src: sitePathOf(folder, name), path: repoPathOf(folder, name) };
  }
  if (isBlobUrl(value)) {
    const { token, host } = requireBlob(env);
    const { url, pathname } = blobAddress(value, host);
    const { folder, name } = blobPathParts(pathname);
    return { store: 'blob', folder, name, src: url, pathname, token, host };
  }
  throw badPath(value, M.badPath(value));
}

async function bothSides(repo: ContentRepo): Promise<{ draft: ContentFile[]; live: ContentFile[] }> {
  const [draft, live] = await Promise.all([repo.readContent(), repo.readContent('live')]);
  return { draft: draft.files, live: live.files };
}

/**
 * Runs `check` on the draft as it stands, then makes the draft ready for a write (prepareDraft),
 * so a refusal creates, moves, or merges no branch (and starts no preview build). When preparing
 * moved the draft (live merged in, or the branch brought up to live), `check` runs again on the
 * state the commit will build on.
 */
async function checkThenPrepare<T>(repo: ContentRepo, check: () => Promise<T>): Promise<{ head: string | null; result: T }> {
  const before = await repo.heads();
  let result = await check();
  const head = await repo.prepareDraft();
  if (head !== (before.draft ?? before.live)) result = await check();
  return { head, result };
}

// ---------------------------------------------------------------------------------------------
// GET /api/upload: the list
// ---------------------------------------------------------------------------------------------

function byName(a: MediaItem, b: MediaItem): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.store < b.store ? -1 : a.store > b.store ? 1 : 0;
}

export async function listMedia(ctx: MediaContext, params: URLSearchParams): Promise<MediaListResponse> {
  const folder = await checkedFolder(ctx, params.get('folder') ?? '');
  const files = (await folderFiles(ctx.repo, folder)).map((file) => repoItem(folder, file.name, file.size));
  if (blobConfigured(ctx.env)) {
    const { files: stored, placeholders } = await blobFolder(ctx, folder);
    files.push(...stored.map((file) => blobItem(file)));
    await removeExpiredPlaceholders(
      ctx,
      placeholders.map((file) => ({ url: file.src, uploadedAt: uploadTime(file.uploadedAt) })),
    );
  }
  files.sort(byName);
  if (params.get('refs') === '1') {
    const { draft, live } = await bothSides(ctx.repo);
    const hosts = siteHostsFor(ctx.env);
    const srcs = files.map((file) => file.src);
    const inDraft = countReferences(draft, srcs, hosts);
    const inLive = countReferences(live, srcs, hosts);
    for (const file of files) file.refs = { draft: inDraft.get(file.src) ?? 0, live: inLive.get(file.src) ?? 0 };
  }
  return { ok: true, folder, files };
}

function byFolder(a: { folder: string }, b: { folder: string }): number {
  return a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0;
}

/**
 * GET /api/upload?folders=1: every media folder that exists, in the repository (on the draft, or
 * on the published branch while there is no draft) and in Blob, with the project or "site" that
 * owns it and its number of files across both stores. A folder no saved project names (a renamed or
 * deleted project's) has the owner null, so the site's media view can reach its files. Only
 * public/media/ and the Blob media prefix are read, and only folder names `checkFolder` accepts
 * are listed.
 */
export async function listFolders(ctx: MediaContext): Promise<MediaFoldersResponse> {
  const counts = new Map<string, number>();
  const add = (folder: string, files: number) => counts.set(folder, (counts.get(folder) ?? 0) + files);

  const base = `${REPO_MEDIA_DIR}/`;
  for (const entry of await ctx.repo.listFiles('draft', REPO_MEDIA_DIR)) {
    if (!entry.path.startsWith(base)) continue;
    const rest = entry.path.slice(base.length);
    const slash = rest.indexOf('/');
    const folder = slash > 0 ? folderNameOrNull(rest.slice(0, slash)) : null;
    // A folder holding only .gitkeep exists, with no file to list.
    if (folder !== null) add(folder, isListedName(rest.slice(slash + 1)) ? 1 : 0);
  }

  if (blobConfigured(ctx.env)) {
    const placeholders: { url: string; uploadedAt: number }[] = [];
    for (const object of await blobObjects(blobToken(ctx.env), `${DEFAULT_BLOB_PREFIX}/`)) {
      const match = BLOB_PATHNAME.exec(object.pathname);
      const folder = match ? folderNameOrNull(match[1]) : null;
      if (!match || folder === null || !isStoredName(match[2])) continue;
      if (isPlaceholder(object)) placeholders.push({ url: object.url, uploadedAt: uploadTime(object.uploadedAt) });
      else add(folder, 1);
    }
    await removeExpiredPlaceholders(ctx, placeholders);
  }

  const saved = await savedProjects(ctx.repo);
  const folders = [...counts]
    .map(([folder, files]) => ({ folder, owner: folder === SITE_FOLDER || saved.has(folder) ? folder : null, files }))
    .sort(byFolder);
  return { ok: true, folders };
}

// ---------------------------------------------------------------------------------------------
// POST /api/upload: files to the repository
// ---------------------------------------------------------------------------------------------

interface PreparedRepoFile {
  name: string;
  bytes: Uint8Array;
  findings: Finding[];
}

/** WebP and PNG metadata removed, then confirmed gone (D-24); an SVG drawing sanitized. */
async function cleanBytes(sniffed: Sniffed, bytes: Uint8Array): Promise<{ bytes: Uint8Array; drawingText: string | null }> {
  if (sniffed.ext === 'webp' || sniffed.ext === 'png') {
    const stripped = stripImageMetadata(sniffed.ext, bytes);
    const scan = await scanImageMetadata(sniffed.ext, bufferSource(stripped));
    if (scan.damaged || scan.metadata.length > 0) throw new ApiFailure(422, 'invalid-file', MSG.metadataLeft);
    return { bytes: stripped, drawingText: null };
  }
  if (sniffed.ext === 'svg') {
    const drawing = await sanitizeSvg(bytes);
    return { bytes: drawing.bytes, drawingText: drawing.text };
  }
  return { bytes, drawingText: null };
}

/**
 * One file of a repository upload, checked and cleaned. A refusal names the file by its cleaned
 * name once that has passed the content check, and as "file N" before (the raw name is never
 * repeated).
 */
async function prepareRepoFile(file: File, index: number, folder: string, check: ContentCheck): Promise<PreparedRepoFile> {
  const fallback = `file ${index + 1}`;
  let label = fallback;
  try {
    if (file.size === 0) throw new ApiFailure(422, 'invalid-file', M.emptyFile);
    if (file.size > REPO_MAX_BYTES) throw new ApiFailure(413, 'too-large', M.tooLargeForRepo(REPO_MAX_BYTES));
    const clean = cleanName(file.name, fallback);
    const given = checkName(check, folder, clean.name, fallback);
    label = given.label === fallback ? fallback : shown(given.label);
    // The type is decided from the bytes (sniffFile), which also refuses the name's extension when it must.
    const raw = new Uint8Array(await file.arrayBuffer());
    if (raw.byteLength === 0) throw new ApiFailure(422, 'invalid-file', M.emptyFile);
    if (raw.byteLength > REPO_MAX_BYTES) throw new ApiFailure(413, 'too-large', M.tooLargeForRepo(REPO_MAX_BYTES));
    const sniffed = await sniffFile(raw, clean.ext);
    rule(() => checkType(sniffed.ext, 'repo'));
    const name = `${clean.base}.${sniffed.ext}`;
    const named = name === clean.name ? given : checkName(check, folder, name, fallback);
    const { bytes, drawingText } = await cleanBytes(sniffed, raw);
    if (bytes.byteLength > REPO_MAX_BYTES) throw new ApiFailure(413, 'too-large', MSG.tooBigAfterCleaning);
    const findings = unique([...named.findings, ...wordFindings(check, named.label, sniffed.ext, bytes, drawingText)]);
    return { name, bytes, findings };
  } catch (error) {
    throw aboutFile(label, error);
  }
}

/** The form's text fields, parsed with UploadFields, and its files. Anything else is refused. */
function readUploadForm(form: FormData): { folder: string; replace: boolean; files: File[] } {
  const fields: Record<string, string> = {};
  const files: File[] = [];
  for (const [key, value] of form.entries()) {
    if (key === 'file') {
      if (typeof value === 'string') throw new ApiFailure(400, 'bad-request', MSG.notAFile);
      files.push(value);
    } else if (typeof value !== 'string' || Object.hasOwn(fields, key)) {
      throw new ApiFailure(400, 'bad-request', MSG.formShape, {
        findings: [{ file: '(request)', path: key.slice(0, 64), rule: 'REQUEST', message: MSG.formShape, severity: 'error' }],
      });
    } else {
      fields[key] = value;
    }
  }
  const parsed = UploadFields.safeParse(fields);
  if (!parsed.success) {
    throw new ApiFailure(400, 'bad-request', MSG.formShape, {
      findings: parsed.error.issues.slice(0, 20).map((issue) => ({
        file: '(request)',
        path: issue.path.map(String).join('.') || '(root)',
        rule: 'REQUEST',
        message: issue.message,
        severity: 'error' as const,
      })),
    });
  }
  if (files.length === 0) throw new ApiFailure(400, 'bad-request', MSG.noFile);
  if (files.length > MAX_FILES_PER_UPLOAD) throw new ApiFailure(413, 'too-large', MSG.tooManyFiles);
  return { folder: parsed.data.folder, replace: parsed.data.replace === '1', files };
}

export async function uploadMedia(ctx: MediaContext, form: FormData): Promise<UploadResponse> {
  const { folder: requested, replace, files } = readUploadForm(form);
  const check = contentCheck(ctx.env);
  const folder = await checkedFolder(ctx, requested);

  const prepared: PreparedRepoFile[] = [];
  for (const [index, file] of files.entries()) prepared.push(await prepareRepoFile(file, index, folder, check));
  const findings = prepared.flatMap((file) => file.findings);
  if (findings.length > 0) throw contentCheckFailure(findings);

  const names = new Map<string, string>();
  for (const file of prepared) {
    const key = file.name.toLowerCase();
    if (names.has(key)) throw new ApiFailure(409, 'exists', M.duplicateInBatch(file.name));
    names.set(key, file.name);
  }

  // A name already in the folder is refused unless Replace was chosen; one that differs only in
  // letter case always is, since a case-insensitive disk would put both in one file.
  const { head, result: replaced } = await checkThenPrepare(ctx.repo, async () => {
    const existing = new Map((await folderFiles(ctx.repo, folder)).map((file) => [file.name.toLowerCase(), file.name]));
    let count = 0;
    for (const file of prepared) {
      const other = existing.get(file.name.toLowerCase());
      if (other === undefined) continue;
      if (other !== file.name) throw new ApiFailure(409, 'exists', M.existsOtherCase(file.name, other));
      if (!replace) throw new ApiFailure(409, 'exists', M.exists(file.name));
      count += 1;
    }
    return count;
  });

  const changes: FileChange[] = prepared.map((file) => ({ path: repoPathOf(folder, file.name), bytes: file.bytes }));
  const message = COMMIT_MESSAGES.save(
    prepared.map((file) => `${folder}/${file.name}`),
    replaced,
  );
  const commit = await ctx.repo.commit(head, changes, message);
  return { ok: true, files: prepared.map((file) => repoItem(folder, file.name, file.bytes.byteLength)), commit };
}

// ---------------------------------------------------------------------------------------------
// POST /api/upload/token and /api/upload/confirm: files to Vercel Blob
// ---------------------------------------------------------------------------------------------

const MIME_ALIASES: Readonly<Record<string, string>> = {
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/mp3': 'audio/mpeg',
  'application/x-zip-compressed': 'application/zip',
};
const MIME_SHAPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;\s*charset=utf-8)?$/i;

function mimeEssence(value: string): string {
  const base = value.split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[base] ?? base;
}

/**
 * The type of a file that may go to Blob: on the allow-list, never SVG (D-26), never a photo or a
 * STEP file the browser converts first (refuseByName), so of the images only WebP and PNG.
 */
function blobType(ext: string): FileType {
  refuseByName(ext);
  const type = rule(() => checkType(ext, 'blob'));
  if (type.group === 'image' && ext !== 'webp' && ext !== 'png') throw new ApiFailure(422, 'invalid-file', PHOTO_MESSAGE);
  return type;
}

export async function issueBlobToken(ctx: MediaContext, body: BlobTokenBody): Promise<BlobTokenResponse> {
  const { token } = requireBlob(ctx.env);
  if (body.size <= REPO_MAX_BYTES) throw new ApiFailure(400, 'bad-request', MSG.smallForBlob);
  if (body.size > BLOB_MAX_BYTES) throw new ApiFailure(413, 'too-large', M.tooLarge(BLOB_MAX_BYTES));
  const check = contentCheck(ctx.env);
  const folder = await checkedFolder(ctx, body.folder);
  const clean = cleanName(body.name, '(file)');
  const type = blobType(clean.ext);
  if (!MIME_SHAPE.test(body.contentType) || mimeEssence(body.contentType) !== mimeEssence(type.contentType)) {
    throw new ApiFailure(422, 'invalid-file', MSG.contentType(type.ext));
  }
  const { findings } = checkName(check, folder, `${clean.base}.${type.ext}`, '(file)');
  if (findings.length > 0) throw contentCheckFailure(findings);

  // A fixed, random pathname that the token may not overwrite: it can write there only while nothing
  // is stored there. A refusal at /confirm, or a delete while the token may still be valid, leaves a
  // placeholder rather than an empty pathname (`occupy`), so the token stores one file, once (D-26).
  const pathname = `${DEFAULT_BLOB_PREFIX}/${folder}/${clean.base}-${randomBytes(6).toString('hex')}.${type.ext}`;
  const now = (ctx.now ?? Date.now)();
  const validUntil = now + BLOB_TOKEN_LIFETIME_MS;
  let clientToken: string;
  try {
    clientToken = await generateClientTokenFromReadWriteToken({
      token,
      pathname,
      allowedContentTypes: [body.contentType],
      maximumSizeInBytes: body.size,
      validUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch {
    throw new ApiFailure(502, 'storage', MSG.tokenFailed);
  }
  const ticket = signTicket(
    { pathname, size: body.size, contentType: body.contentType, exp: validUntil + CONFIRM_GRACE_MS },
    ctx.env,
  );
  return { ok: true, pathname, clientToken, ticket, multipart: body.size > MULTIPART_FROM };
}

/** At most `max` bytes of a response body; the rest is never downloaded. */
async function readAtMost(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { value, done } = await reader.read();
      if (done) break;
      const part = value.subarray(0, Math.min(value.byteLength, max - total));
      chunks.push(part);
      total += part.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Bytes `start` to `end` (inclusive) of a public Blob file, through an HTTP range request. */
async function readRange(url: string, start: number, end: number): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(RANGE_TIMEOUT_MS),
    });
  } catch {
    throw new ApiFailure(502, 'storage', MSG.blobUnreadable);
  }
  const wanted = end - start + 1;
  if (response.status === 206) return readAtMost(response.body, wanted);
  // A server that ignores the range sends the file from its first byte: use that only for the start.
  if (response.status === 200 && start === 0) return readAtMost(response.body, wanted);
  await response.body?.cancel().catch(() => undefined);
  throw new ApiFailure(502, 'storage', MSG.blobUnreadable);
}

/** Streams a whole Blob image through the metadata scan without holding it in memory. */
async function scanBlobImage(url: string, ext: 'webp' | 'png'): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(SCAN_TIMEOUT_MS) });
  } catch {
    throw new ApiFailure(502, 'storage', MSG.blobUnreadable);
  }
  if (!response.ok || !response.body) throw new ApiFailure(502, 'storage', MSG.blobUnreadable);
  const source = streamSource(response.body);
  try {
    const scan = await scanImageMetadata(ext, source);
    if (scan.damaged) throw new ApiFailure(422, 'invalid-file', MSG.metadataLeft);
    if (scan.metadata.length > 0) throw new ApiFailure(422, 'invalid-file', MSG.blobMetadata(scan.metadata.join(', ')));
  } finally {
    await source.cancel();
  }
}

/**
 * A refusal removes the uploaded file from view (D-26): its bytes are replaced by a placeholder
 * that holds the pathname until the upload's token has expired (`occupy`). A server or network
 * failure leaves the file for a retry.
 */
async function occupyOnRefusal<T>(target: { url: string; pathname: string }, token: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failure = error instanceof StorageError ? fromStorage(error) : error;
    if (failure instanceof ApiFailure && failure.status < 500) {
      await occupy(target, token).catch(() => undefined);
    }
    throw failure;
  }
}

/**
 * The parsed scene description (JSON chunk) of a GLB in Blob: the 20-byte header gives the chunk's
 * length and type, and the chunk comes from the bytes already read when it fits, or from one range
 * request. A GLB whose first chunk is not a readable JSON description is refused, since its names
 * could not be checked.
 */
async function blobGlbData(url: string, size: number, start: Uint8Array): Promise<unknown> {
  const header = start.byteLength >= 20 ? start.subarray(0, 20) : await readRange(url, 0, 19);
  if (header.byteLength < 20) throw new ApiFailure(422, 'invalid-file', MSG.modelUnreadable);
  const view = new DataView(header.buffer, header.byteOffset, 20);
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== GLB_JSON_CHUNK || length === 0 || 20 + length > size) {
    throw new ApiFailure(422, 'invalid-file', MSG.modelUnreadable);
  }
  if (length > GLB_JSON_MAX_BYTES) throw new ApiFailure(422, 'invalid-file', MSG.modelTooLarge);
  const chunk = 20 + length <= start.byteLength ? start.subarray(20, 20 + length) : await readRange(url, 20, 20 + length - 1);
  if (chunk.byteLength !== length) throw new ApiFailure(502, 'storage', MSG.blobUnreadable);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunk));
  } catch {
    throw new ApiFailure(422, 'invalid-file', MSG.modelUnreadable);
  }
}

/** The name as the owner gave it, without the random part the token route added. */
function givenName(stored: string): string {
  return stored.replace(/-[0-9a-f]{12}(\.[a-z0-9]+)$/, '$1');
}

export async function confirmBlobUpload(ctx: MediaContext, body: BlobConfirmBody): Promise<BlobConfirmResponse> {
  const { token, host } = requireBlob(ctx.env);
  const checked = verifyTicket(body.ticket, ctx.env, (ctx.now ?? Date.now)());
  if (!checked.ok) throw new ApiFailure(400, 'bad-request', checked.reason === 'expired' ? MSG.ticketExpired : MSG.ticketInvalid);
  const { ticket } = checked;
  if (ticket.pathname !== body.pathname) throw new ApiFailure(400, 'bad-request', MSG.ticketMismatch);
  const { url, pathname } = blobAddress(body.url, host);
  if (pathname !== ticket.pathname) throw new ApiFailure(400, 'bad-request', MSG.ticketMismatch);
  const { folder, name } = blobPathParts(pathname);

  let info: HeadBlobResult;
  try {
    info = await blobHead(url, { token });
  } catch (error) {
    if (error instanceof BlobNotFoundError) throw new ApiFailure(400, 'bad-request', MSG.notUploaded);
    throw blobFailure(error);
  }

  // From here on the file exists only because this server allowed it, so a refusal replaces it
  // with a placeholder that the upload's token can never overwrite.
  return occupyOnRefusal({ url, pathname }, token, async () => {
    if (info.pathname !== pathname || info.size > ticket.size) {
      throw new ApiFailure(422, 'invalid-file', MSG.oversize);
    }
    // A real Blob upload is larger than REPO_MAX_BYTES, so lists can tell a placeholder by its size.
    if (info.size <= REPO_MAX_BYTES) throw new ApiFailure(422, 'invalid-file', MSG.smallForBlob);
    const ext = extensionOf(name);
    if (mimeEssence(info.contentType ?? '') !== mimeEssence(ticket.contentType)) {
      throw new ApiFailure(422, 'invalid-file', MSG.contentType(ext));
    }
    const prefix = await readRange(url, 0, Math.min(info.size, SNIFF_PREFIX_BYTES) - 1);
    const sniffed = await sniffFile(prefix, ext, {
      partial: prefix.byteLength < info.size,
      totalSize: info.size,
      zipNames: () => zipNamesFromCentralDirectory(info.size, (start, end) => readRange(url, start, end)),
    });
    if (sniffed.ext !== ext) throw new ApiFailure(422, 'invalid-file', MSG.storedType(ext));
    blobType(sniffed.ext);
    if (sniffed.ext === 'webp' || sniffed.ext === 'png') await scanBlobImage(url, sniffed.ext);
    const check = contentCheck(ctx.env);
    await checkedFolder(ctx, folder);
    const named = checkName(check, folder, givenName(name), '(file)');
    if (named.findings.length > 0) throw contentCheckFailure(named.findings);
    // A model's names reach the site's parts list: the same check as a GLB in the repository.
    if (sniffed.ext === 'glb') {
      const findings = unique(gltfDataFindings(check, named.label, await blobGlbData(url, info.size, prefix)));
      if (findings.length > 0) throw contentCheckFailure(findings);
    }
    return {
      ok: true as const,
      file: blobItem({
        folder,
        name,
        src: url,
        size: info.size,
        contentType: info.contentType,
        uploadedAt: info.uploadedAt instanceof Date ? info.uploadedAt.toISOString() : undefined,
      }),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// DELETE /api/upload
// ---------------------------------------------------------------------------------------------

function referenced(references: { draft: Reference[]; live: Reference[] }): ApiFailure {
  const message = references.draft.length > 0 ? MSG.referencedDraft : MSG.referencedLive;
  return new ApiFailure(409, 'referenced', message, { references });
}

export async function deleteMedia(ctx: MediaContext, body: MediaDeleteBody): Promise<MediaDeleteResponse> {
  const target = parseSrc(body.src, ctx.env);
  const hosts = siteHostsFor(ctx.env);
  const referencesTo = async (src: string) => {
    const { draft, live } = await bothSides(ctx.repo);
    return { draft: findReferences(draft, src, hosts), live: findReferences(live, src, hosts) };
  };
  if (target.store === 'repo') {
    // The published site keeps its own copy until a publish, so only the draft's references block.
    const { head } = await checkThenPrepare(ctx.repo, async () => {
      const references = await referencesTo(target.src);
      if (references.draft.length > 0) throw referenced(references);
      if (!(await folderFiles(ctx.repo, target.folder)).some((file) => file.name === target.name)) {
        throw new ApiFailure(404, 'bad-request', MSG.notFound);
      }
    });
    const commit = await ctx.repo.commit(head, [{ path: target.path, bytes: null }], COMMIT_MESSAGES.remove([`${target.folder}/${target.name}`]));
    return { ok: true, commit };
  }
  // A Blob file is public at its address: deleting it reaches the published site at once (D-27).
  const references = await referencesTo(target.src);
  if (references.draft.length > 0 || references.live.length > 0) throw referenced(references);
  try {
    const info = await blobHead(target.src, { token: target.token });
    // While the token of the upload may still be valid, an empty pathname would let it store a file
    // there again: a placeholder holds the pathname until the token has expired (D-26).
    const age = (ctx.now ?? Date.now)() - uploadTime(info.uploadedAt);
    if (Number.isFinite(age) && age > PLACEHOLDER_KEEP_MS) await blobDel(target.src, { token: target.token });
    else await occupy({ url: target.src, pathname: target.pathname }, target.token);
  } catch (error) {
    throw blobFailure(error);
  }
  return { ok: true, commit: null };
}

// ---------------------------------------------------------------------------------------------
// POST /api/upload/rename
// ---------------------------------------------------------------------------------------------

/** The new cleaned name, with the old extension: the type never changes. */
function renamedName(raw: string, ext: string): string {
  const trimmed = raw.trim();
  if (/[\\/]/.test(trimmed)) throw badPath('(new name)', MSG.folderInName);
  const dot = trimmed.lastIndexOf('.');
  let base = trimmed;
  if (dot > 0) {
    const given = trimmed.slice(dot + 1).toLowerCase();
    if (given === ext) base = trimmed.slice(0, dot);
    else if (fileTypeOf(given) || REFUSED_EXTENSIONS.has(given)) throw new ApiFailure(400, 'bad-request', MSG.renameExtension(ext));
  }
  return cleanName(`${base}.${ext}`, '(new name)').name;
}

function rewrite(files: readonly ContentFile[], from: string, to: string, hosts: readonly string[]): ContentFile[] {
  try {
    return rewriteReferences(files, from, to, hosts);
  } catch (error) {
    if (error instanceof UnreadableContentError) throw new ApiFailure(409, 'conflict', MSG.unreadableContent(error.file));
    throw error;
  }
}

function encoded(files: readonly ContentFile[]): FileChange[] {
  return files.map((file) => ({ path: file.path, bytes: new TextEncoder().encode(file.text) }));
}

export async function renameMedia(ctx: MediaContext, body: MediaRenameBody): Promise<MediaRenameResponse> {
  const target = parseSrc(body.src, ctx.env);
  const ext = extensionOf(target.name);
  const newName = renamedName(body.name, ext);
  const check = contentCheck(ctx.env);
  const { findings } = checkName(check, target.folder, newName, '(new name)');
  if (findings.length > 0) throw contentCheckFailure(findings);
  const hosts = siteHostsFor(ctx.env);

  if (target.store === 'repo') {
    const findCurrent = async () => {
      const files = await folderFiles(ctx.repo, target.folder);
      const current = files.find((file) => file.name === target.name);
      if (!current) throw new ApiFailure(404, 'bad-request', MSG.notFound);
      return { files, current };
    };
    if (newName === target.name) {
      const { current } = await findCurrent();
      return { ok: true, file: repoItem(target.folder, newName, current.size), rewrote: [], commit: null };
    }
    const { head } = await checkThenPrepare(ctx.repo, async () => {
      const { files } = await findCurrent();
      const clash = files.find((file) => file.name !== target.name && file.name.toLowerCase() === newName.toLowerCase());
      if (clash) throw new ApiFailure(409, 'exists', clash.name === newName ? M.exists(newName) : M.existsOtherCase(newName, clash.name));
    });
    const bytes = await ctx.repo.readFile('draft', target.path);
    if (!bytes) throw new ApiFailure(404, 'bad-request', MSG.notFound);
    const newSrc = sitePathOf(target.folder, newName);
    const rewritten = rewrite((await ctx.repo.readContent()).files, target.src, newSrc, hosts);
    const move: FileChange[] = [
      { path: repoPathOf(target.folder, newName), bytes },
      { path: target.path, bytes: null },
    ];
    // A rename that changes only the letter case removes the old name first: on a case-insensitive
    // disk (local development) the removal would otherwise delete the file just written.
    if (newName.toLowerCase() === target.name.toLowerCase()) move.reverse();
    const commit = await ctx.repo.commit(
      head,
      [...move, ...encoded(rewritten)],
      `media: rename ${target.folder}/${target.name} to ${target.folder}/${newName}`,
    );
    return { ok: true, file: repoItem(target.folder, newName, bytes.byteLength), rewrote: rewritten.map((file) => file.path), commit };
  }

  // Blob: a copy under the new name; the old object stays until a publish leaves nothing that uses it.
  let info: HeadBlobResult;
  let copied: { url: string; pathname: string };
  try {
    info = await blobHead(target.src, { token: target.token });
    copied = await blobCopy(target.src, `${DEFAULT_BLOB_PREFIX}/${target.folder}/${newName}`, {
      ...BLOB_WRITE_OPTIONS,
      contentType: fileTypeOf(ext)?.contentType ?? info.contentType,
      token: target.token,
    });
  } catch (error) {
    throw blobFailure(error);
  }
  const { url: newUrl, pathname } = blobAddress(copied.url, target.host);
  const { name: storedName } = blobPathParts(pathname);
  const file = blobItem({ folder: target.folder, name: storedName, src: newUrl, size: info.size, contentType: info.contentType });
  if (findReferences((await ctx.repo.readContent()).files, target.src, hosts).length === 0) {
    return { ok: true, file, rewrote: [], commit: null };
  }
  const head = await ctx.repo.prepareDraft();
  const rewritten = rewrite((await ctx.repo.readContent()).files, target.src, newUrl, hosts);
  const commit =
    rewritten.length > 0
      ? await ctx.repo.commit(head, encoded(rewritten), `media: rename ${target.folder}/${target.name} to ${target.folder}/${storedName}`)
      : null;
  return { ok: true, file, rewrote: rewritten.map((entry) => entry.path), commit };
}

// ---------------------------------------------------------------------------------------------
// GET /api/upload/references and /api/upload/file
// ---------------------------------------------------------------------------------------------

export async function mediaReferences(ctx: MediaContext, src: string | null): Promise<MediaReferencesResponse> {
  const target = parseSrc(src ?? '', ctx.env);
  const { draft, live } = await bothSides(ctx.repo);
  const hosts = siteHostsFor(ctx.env);
  return { ok: true, src: target.src, draft: findReferences(draft, target.src, hosts), live: findReferences(live, target.src, hosts) };
}

/**
 * One byte range from a Range header ("bytes=0-499", "bytes=500-", "bytes=-500"), null to send the
 * whole file (no header, another unit, several ranges, or a malformed range, which a server may
 * ignore), or 'unsatisfiable' for a range that starts past the end.
 */
function byteRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    return suffix === 0 || size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  if (match[2] !== '' && Number(match[2]) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1) };
}

/**
 * A repository media file from the draft branch (or the live branch while there is no draft), for
 * the admin's previews (D-17). The type comes from the bytes; the answer is never cached, never
 * sniffed, and sandboxed, so an SVG drawing opened on its own can run nothing. One byte range is
 * honoured, since Safari plays video and audio only from a server that answers range requests.
 */
export async function mediaFileResponse(ctx: MediaContext, src: string | null, rangeHeader: string | null = null): Promise<Response> {
  const value = src ?? '';
  const { folder, name } = rule(() => parseSitePath(value), value);
  const path = repoPathOf(folder, name);
  // One request per thumbnail where possible: the GitHub repository reads live by itself while
  // there is no draft branch; the heads are asked only when the file is missing.
  let bytes = await ctx.repo.readFile('draft', path);
  if (!bytes && !(await ctx.repo.heads()).draft) bytes = await ctx.repo.readFile('live', path);
  if (!bytes) throw new ApiFailure(404, 'bad-request', MSG.notFound);
  const ext = extensionOf(name);
  const detected = await detectType(bytes, { hint: ext });
  const safe = detected !== null && !detected.refused && !detected.damaged && detected.group !== null;
  const stored = fileTypeOf(ext);
  const contentType = !safe
    ? 'application/octet-stream'
    : detected.ext === 'txt' && stored?.group === 'data'
      ? stored.contentType
      : detected.mime;
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Disposition': `${safe ? 'inline' : 'attachment'}; filename="${name}"`,
    'Content-Security-Policy': MEDIA_FILE_POLICY,
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  const size = bytes.byteLength;
  const range = byteRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } });
  }
  if (range) {
    const part = bytes.subarray(range.start, range.end + 1);
    return new Response(part as unknown as BodyInit, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': String(part.byteLength) },
    });
  }
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
}
