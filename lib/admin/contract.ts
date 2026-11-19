/**
 * The admin's API contract (ARCHITECTURE.md sections 7 and 11; docs/V3_PLAN.md D-16 to D-33):
 * every route path, request body schema, and response shape, shared by the route handlers and
 * the admin in the browser. Nothing here reads the environment or holds a secret, so the browser
 * may import it.
 *
 * Request bodies are zod schemas: every mutating route parses its body with the schema named here
 * and answers 400 with the issues when it does not parse. Responses are plain types.
 *
 * Error answers share one shape, `ApiError`, with a `code` the admin can act on:
 *
 * | status | code | meaning |
 * |---|---|---|
 * | 503 | not-configured | ADMIN_PASSWORD or SESSION_SECRET missing (no fallback), or a required service variable missing |
 * | 401 | unauthorized | no valid session, or a wrong password at login |
 * | 429 | locked | five failed logins in ten minutes from this address; `retryAfter` in seconds |
 * | 403 | forbidden-origin | a mutating request without an Origin header naming this site |
 * | 403 | not-allowed | refused by policy (publishing into main outside production, a failed draft build) |
 * | 415 | unsupported-media-type | a JSON route called without `content-type: application/json` |
 * | 413 | too-large | a body or a file over its limit |
 * | 400 | bad-request | a body that does not parse, or a path outside its folder (`findings` name it) |
 * | 422 | content-check | the content check failed (`findings` name the rule, the file, and the field) |
 * | 422 | invalid-file | a file whose bytes do not match its type, or that cannot be made safe |
 * | 409 | conflict | a file the request writes changed on the draft since the admin loaded it, the draft moved while a publish or discard was confirmed, or a merge of main into draft conflicts |
 * | 409 | diverged | publish refused: main has commits the draft does not have |
 * | 409 | referenced | a media file still used by content (`references` lists where) |
 * | 409 | exists | a media name already taken, and Replace was not chosen |
 * | 502 | github / storage | GitHub or Blob failed; `error` says what, without any secret |
 */
import { z } from 'zod';

/**
 * zod 4 probes `new Function` once to decide whether it may compile fast object parsers. The site's
 * policy has no 'unsafe-eval', so the probe fails harmlessly, but the browser still reports it as a
 * policy violation. `jitless` skips the probe (and the compiled parsers, which these small bodies
 * do not need), so the admin runs without a single violation report.
 */
z.config({ jitless: true });

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export const API = {
  /** GET: session state. POST: log in. DELETE: log out. */
  auth: '/api/auth',
  /** GET: content from the draft branch (or the live branch while there is no draft). */
  content: '/api/content',
  /** POST: validate, run the content check, and commit changed files to the draft branch. */
  save: '/api/save',
  /** GET: what a publish would do. POST: fast-forward the live branch to the draft. */
  publish: '/api/publish',
  /** POST: reset the draft branch to the live branch. */
  discard: '/api/discard',
  /** GET: environment, GitHub, storage, content-check, and deploy diagnostics (names only, never values). */
  status: '/api/status',
  /** POST: run the content check over text taken from a file (PDF and Word text, model part names). */
  check: '/api/check',
  /** GET: list a media folder. POST (multipart): upload small files to the repository. DELETE: remove a file. */
  media: '/api/upload',
  /** POST: a single-use browser upload ticket for Vercel Blob. */
  mediaToken: '/api/upload/token',
  /** POST: confirm a browser upload to Blob (checks the bytes, deletes a bad file). */
  mediaConfirm: '/api/upload/confirm',
  /** GET ?src=: stream a repository media file from the draft branch to the admin. */
  mediaFile: '/api/upload/file',
  /** POST: rename a media file and rewrite the draft's references in the same commit. */
  mediaRename: '/api/upload/rename',
  /** GET ?src=: where draft and live content refer to a media file. */
  mediaReferences: '/api/upload/references',
} as const;

/** The session cookie's lifetime: eight hours (ARCHITECTURE.md 11). */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
/** Login attempts allowed per address in `LOGIN_WINDOW_SECONDS`; the next one is refused (ARCHITECTURE.md 11). */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_SECONDS = 10 * 60;

/** Limits for JSON bodies. Content files are small; a save carries at most every content file. */
export const MAX_SAVE_BODY_BYTES = 2_000_000;
export const MAX_JSON_BODY_BYTES = 200_000;
/** The text check: text pulled from one file (a long PDF), and how many labelled items. */
export const MAX_CHECK_TEXT_BYTES = 2_000_000;
export const MAX_CHECK_ITEMS = 2_000;
/** One repository upload request: the files plus the form fields stay under Vercel's 4.5 MB body cap. */
export const MAX_REPO_UPLOAD_BODY_BYTES = 4_400_000;

// ---------------------------------------------------------------------------------------------
// Content files
// ---------------------------------------------------------------------------------------------

export const SITE_FILE = 'content/site.json';
export const PROJECTS_DIR = 'content/projects';
const PROJECT_FILE = /^content\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;

/** True for the only files /api/save may write: content/site.json and content/projects/<slug>.json. */
export function isContentPath(path: string): boolean {
  return path === SITE_FILE || PROJECT_FILE.test(path);
}

/** The project slug a content path names, or null. */
export function slugOfProjectFile(path: string): string | null {
  return PROJECT_FILE.exec(path)?.[1] ?? null;
}

export function projectFileOf(slug: string): string {
  return `${PROJECTS_DIR}/${slug}.json`;
}

/**
 * How every content file is stored: two-space JSON with no trailing newline, the format the seed
 * uses. Serializing an unedited file gives its stored bytes back, so it never shows as changed.
 */
export function serializeContent(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * The SHA-256 of a content file's text in UTF-8, in lowercase hex: how `SaveBody.expected` names
 * the version of a file the editor holds. The same plain code runs in the browser and on the
 * server, so both always agree; it is synchronous (all the content is about 50 kB, a millisecond
 * of work), so a save starts at once, and it needs no Web Crypto, which a page served over plain
 * http on a local network address does not have.
 */
export function textDigest(text: string): string {
  return hexOf(sha256(new TextEncoder().encode(text)));
}

function hexOf(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** SHA-256's round constants (FIPS 180-4, 4.2.2). */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 in plain code (FIPS 180-4, 6.2), for pages without Web Crypto. */
function sha256(message: Uint8Array): Uint8Array {
  // The message, a 1 bit, zeros, and the length in bits as a 64-bit big-endian number, to a multiple of 64 bytes.
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = message.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bits >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, h[i]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------------------------

/** One result of the content check. The same shape as `Finding` in lib/lint.ts. */
export interface Finding {
  /** The file, such as "content/site.json", or the media file a text check came from. */
  file: string;
  /** The field path ("stats[2].proof"), "(path)" for a refused path, or a label from a text check. */
  path: string;
  /** A public rule id, or BLOCKLIST, SCHEMA, SLUG, PATH, PROOF, MEDIA, INTERNAL-LINK, GPA-COPY, PHONE-COPY, OWN-REPOSITORY. */
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

export type ErrorCode =
  | 'not-configured'
  | 'unauthorized'
  | 'locked'
  | 'forbidden-origin'
  | 'not-allowed'
  | 'unsupported-media-type'
  | 'too-large'
  | 'bad-request'
  | 'content-check'
  | 'invalid-file'
  | 'conflict'
  | 'diverged'
  | 'referenced'
  | 'exists'
  | 'github'
  | 'storage'
  | 'server';

export interface ApiError {
  ok: false;
  code: ErrorCode;
  /** A plain sentence for the owner. Never holds a secret or a CONTENT_BLOCKLIST term. */
  error: string;
  findings?: Finding[];
  /** 429: seconds until the next login attempt is allowed. */
  retryAfter?: number;
  /** 503 not-configured: the missing variable names. */
  missing?: string[];
  /** 409 conflict: files changed on the branch since the admin loaded it. */
  files?: string[];
  /** 409 referenced: where content still uses a media file. */
  references?: { draft: Reference[]; live: Reference[] };
}

export type ApiResult<T> = T | ApiError;

export function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
}

/** A place in content that refers to a media file. */
export interface Reference {
  file: string;
  path: string;
}

/** The latest deployment of a branch, from Vercel (VERCEL_TOKEN) or from GitHub's deployment records. */
export interface DeployState {
  state: 'queued' | 'building' | 'ready' | 'error' | 'canceled' | 'unknown';
  /** The deployment's own address, or the branch's preview address. */
  url: string | null;
  /** The commit it built. */
  sha: string | null;
  createdAt: string | null;
}

/** Where the draft branch can be seen. */
export interface PreviewInfo {
  branch: string;
  /** The branch's Vercel preview address, or null when it cannot be worked out (the status panel says why). */
  url: string | null;
}

// ---------------------------------------------------------------------------------------------
// /api/auth
// ---------------------------------------------------------------------------------------------

export const LoginBody = z.strictObject({ password: z.string().min(1).max(512) });
export type LoginBody = z.infer<typeof LoginBody>;

export interface SessionState {
  ok: true;
  /** Unix time in milliseconds when the session ends. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------------------------
// /api/content
// ---------------------------------------------------------------------------------------------

/** GET /api/content: every content file as stored (raw JSON, so key order and empty strings survive). */
export interface ContentResponse {
  ok: true;
  /** "github" on a deployment and whenever the GitHub variables are set; "disk" in local development without them. */
  source: 'github' | 'disk';
  /** The branch read: the draft, or the live branch while there is no draft. Null on disk. */
  ref: 'draft' | 'live' | null;
  /** The commit read; send it back as `base` when saving. Null on disk. */
  head: string | null;
  liveHead: string | null;
  draftExists: boolean;
  /** Commits on the draft that the live branch does not have. */
  draftAhead: number;
  liveBranch: string | null;
  draftBranch: string | null;
  site: { file: string; data: unknown };
  projects: { file: string; data: unknown }[];
  /** Files that fail schema version 3 (should not happen; the admin shows them and will not save them). */
  findings: Finding[];
  preview: PreviewInfo | null;
}

/** GET /api/content?ref=live&path=<content path>: one file as published, for "Revert this file to published". */
export interface PublishedFileResponse {
  ok: true;
  file: string;
  /** Null when the file does not exist on the live branch (a project created since the last publish). */
  data: unknown | null;
}

// ---------------------------------------------------------------------------------------------
// /api/save
// ---------------------------------------------------------------------------------------------

/** A `textDigest`: 64 lowercase hex characters. */
const TEXT_DIGEST = z.string().regex(/^[0-9a-f]{64}$/);

/** At most this many entries in `SaveBody.expected`: every file the editor holds, plus new files. */
export const MAX_EXPECTED_FILES = 400;

export const SaveBody = z.strictObject({
  /**
   * The draft head the editor loaded or last saved on (ContentResponse.head, then
   * SaveResponse.head); null in local development on disk. Kept for the record: conflicts are
   * decided file by file through `expected`, so no answer depends on it.
   */
  base: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
  /** Each changed or new file, whole. Paths are checked on the server (`isContentPath`). */
  files: z.array(z.strictObject({ path: z.string().max(200), data: z.unknown() })).max(200),
  /** Project files to remove (a deleted project, or the old name of a renamed one). */
  deletes: z.array(z.string().max(200)).max(200),
  /**
   * Which version of each content file the editor holds: by path, the `textDigest` of the text it
   * holds (`serializeContent` of the data as loaded or last saved), for every file it holds, and
   * null for a file this save writes that it holds none of (a new project). Every path in `files`
   * and `deletes` must be here. The server refuses with 409 conflict, naming the files, when a file
   * this save writes or removes is not that version on the draft (a save from another window, a
   * discard, a rename's rewrite, the published branch merged in), and lists the other files that
   * differ in `SaveResponse.moved`.
   */
  expected: z
    .record(z.string().max(200), TEXT_DIGEST.nullable())
    .refine((entries) => Object.keys(entries).length <= MAX_EXPECTED_FILES, { message: `At most ${MAX_EXPECTED_FILES} entries.` }),
});
export type SaveBody = z.infer<typeof SaveBody>;

export interface SaveResponse {
  ok: true;
  mode: 'github' | 'disk';
  /** The new draft commit, or null when nothing changed (no commit, no preview build) or on disk. */
  commit: string | null;
  /** The draft head after the save: the next save's `base`. */
  head: string | null;
  /** Paths written or removed by this save. */
  changed: string[];
  /**
   * Content files this save did not write whose text on the draft differs from the editor's copy
   * (by `expected`): another window's save, a discard, a rename's rewrite, or the published branch
   * merged in. The editor's copies of them are out of date until it loads the content again, and a
   * save that writes one of them is refused (409) until then.
   */
  moved: string[];
  /** True when the published branch was merged into the draft before this save (D-20); `moved` names what it changed. */
  merged: boolean;
  /** Guard-rail warnings over the saved content. They never block a save. */
  warnings: Finding[];
  preview: PreviewInfo | null;
}

// ---------------------------------------------------------------------------------------------
// /api/publish and /api/discard
// ---------------------------------------------------------------------------------------------

export interface PublishPlan {
  ok: true;
  liveBranch: string;
  draftBranch: string;
  liveHead: string | null;
  draftHead: string | null;
  /** Draft commits the live branch lacks. */
  ahead: number;
  /** Live commits the draft lacks. Publish is a fast-forward, so this must be 0. */
  behind: number;
  diverged: boolean;
  files: { path: string; status: 'added' | 'modified' | 'removed' | 'renamed'; previous?: string }[];
  /** Blob addresses the draft content refers to and live does not, and the reverse. */
  blob: { added: string[]; removed: string[] };
  /** The draft branch's latest deployment, when known. */
  deploy: DeployState | null;
  /**
   * Null when the build state of the draft head was read. Otherwise a plain sentence that says why
   * it cannot be read: Publish then does not wait for the build, so the owner checks the preview.
   */
  deployDetail: string | null;
  allowed: boolean;
  /** Why Publish is disabled, in plain sentences. Empty when allowed. */
  reasons: string[];
}

/** POST /api/publish: the draft head the owner saw in the confirmation, so a later save cannot slip in. */
export const PublishBody = z.strictObject({ draftHead: z.string().regex(/^[0-9a-f]{40}$/) });
export type PublishBody = z.infer<typeof PublishBody>;

export interface PublishResponse {
  ok: true;
  liveHead: string;
}

/**
 * POST /api/discard: the draft head the owner saw in the confirmation (null when there was no
 * draft branch), so a save made after the dialog opened is never discarded unseen.
 */
export const DiscardBody = z.strictObject({
  confirm: z.literal(true),
  draftHead: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
});
export type DiscardBody = z.infer<typeof DiscardBody>;

export interface DiscardResponse {
  ok: true;
  /** The draft head after the reset (equal to the live head). */
  head: string;
}

// ---------------------------------------------------------------------------------------------
// /api/status
// ---------------------------------------------------------------------------------------------

export interface StatusResponse {
  ok: true;
  runtime: { vercelEnv: string | null; branch: string | null; commit: string | null; node: string };
  /** Every variable the admin reads, by name, with whether it is set. Never a value. */
  env: { name: string; present: boolean; required: boolean; note: string }[];
  github: {
    configured: boolean;
    ok: boolean;
    detail: string;
    tokenKind: 'fine-grained' | 'classic' | 'app' | 'unknown' | null;
    repo: string | null;
    liveBranch: string | null;
    draftBranch: string | null;
    liveExists: boolean;
    draftExists: boolean;
    /**
     * The newest commit on the draft branch as this answer read it; null without a draft branch or
     * when GitHub did not answer. The preview watch after a save follows it.
     */
    draftHead: string | null;
    /**
     * The commits on the draft that the published branch lacks, oldest first, as GitHub's compare
     * of the two branches lists them (up to 250); empty when the draft is the published branch, and
     * null when they were not read. The preview watch follows a newer draft head only when the
     * commit it follows is among them.
     */
    draftCommits: string[] | null;
    /**
     * Whether the token can write to the repository, only where GitHub's answer shows it: false
     * when the repository is archived or the account (or app) behind the token cannot push, true
     * for a classic token on a private repository, and null otherwise, with `writeDetail` saying why.
     */
    writeAccess: boolean | null;
    /** A plain sentence when write access is not known from GitHub's answer; null otherwise. */
    writeDetail: string | null;
    ahead: number | null;
    behind: number | null;
  };
  storage: {
    repo: { target: 'github' | 'disk' | 'none'; problem: string | null };
    /**
     * `host`: where the store serves its files if it is public (BLOB_STORE_HOST, or worked out from
     * the token). The token does not say whether the store is public, so neither does this.
     */
    blob: { configured: boolean; host: string | null };
    limits: { repoMaxBytes: number; blobMaxBytes: number };
  };
  contentCheck: { publicRules: number; blocklistSet: boolean; failClosed: boolean };
  deploy: {
    source: 'vercel' | 'github' | 'none';
    /** Plain sentences: where deploy state comes from, or why it is not available. */
    detail: string;
    draft: DeployState | null;
    live: DeployState | null;
    /**
     * Null when the deploy lookup answered for the draft head, so a `draft` that is null (or a
     * deployment of another commit) means the head has no deployment yet; and when there is no
     * draft head. Otherwise a plain sentence: why the head's build state cannot be read.
     */
    draftUnknown: string | null;
    /** The same for the live head and `live`. */
    liveUnknown: string | null;
  };
  preview: PreviewInfo | null;
  session: { expiresAt: number };
  /**
   * Where the login lockout counts attempts for this request: Vercel Runtime Cache (shared by the
   * function's instances in a region) or this instance's memory, and which address it counts.
   */
  security: {
    loginLimit: 'runtime-cache' | 'memory';
    address: 'x-real-ip' | 'local';
    detail: string;
  };
}

// ---------------------------------------------------------------------------------------------
// /api/check
// ---------------------------------------------------------------------------------------------

/** Text taken from a file in the browser before it is uploaded (D-24): its name, its words, its part names. */
export const CheckBody = z.strictObject({
  /** The file the text came from, as the owner named it. Echoed back as `Finding.file`. */
  source: z.string().min(1).max(300),
  items: z
    .array(z.strictObject({ label: z.string().max(300), text: z.string() }))
    .max(MAX_CHECK_ITEMS),
});
export type CheckBody = z.infer<typeof CheckBody>;

export interface CheckResponse {
  ok: true;
  /** Errors only: every hit of a public rule or a private term, by label. Empty when the text is clean. */
  findings: Finding[];
}

// ---------------------------------------------------------------------------------------------
// Media: /api/upload and friends
// ---------------------------------------------------------------------------------------------

/** A file in the media library. */
export interface MediaItem {
  store: 'repo' | 'blob';
  /** "site" or a project slug. */
  folder: string;
  name: string;
  /** What content stores in `MediaRef.src`: `/media/<folder>/<name>`, or the Blob address. */
  src: string;
  /** What the admin shows: the session route for repository files (they may exist only on the draft), the Blob address otherwise. */
  previewSrc: string;
  /** Plain download address (Blob's download address for Blob files). */
  downloadHref: string;
  size?: number;
  contentType?: string;
  uploadedAt?: string;
  /** With `?refs=1`: how many fields refer to it in the draft and on the live branch. */
  refs?: { draft: number; live: number };
}

export interface MediaListResponse {
  ok: true;
  folder: string;
  files: MediaItem[];
}

/**
 * GET /api/upload?folders=1: every media folder that exists, in the repository on the draft (or
 * the live branch while there is no draft) and in Blob, with the saved project that names it.
 * A folder whose project was renamed or deleted keeps its files; this list lets the site's media
 * view reach them (rename, replace, delete, "Not used anywhere"). Folder names are checked like
 * every media folder (lowercase letters, digits, hyphens).
 */
export interface MediaFoldersResponse {
  ok: true;
  folders: {
    folder: string;
    /** The slug of the saved project whose slug is this folder, "site" for the site's folder, or null. */
    owner: string | null;
    /** Files in the folder across both stores. */
    files: number;
  }[];
}

/**
 * POST /api/upload is multipart/form-data with these fields (each file at most REPO_MAX_BYTES,
 * the whole body at most MAX_REPO_UPLOAD_BODY_BYTES):
 *
 * - `folder`: "site" or a project slug that exists on the draft branch.
 * - `replace`: "1" to overwrite a file of the same name (the owner chose Replace).
 * - `file`: one or more files. Their names are cleaned on the server; the stored extension comes
 *   from the type detected in the bytes.
 *
 * All files of one request become one commit on the draft branch.
 */
export const UploadFields = z.strictObject({
  folder: z.string().min(1).max(64),
  replace: z.enum(['0', '1']).default('0'),
});

export interface UploadResponse {
  ok: true;
  files: MediaItem[];
  commit: string | null;
}

/** POST /api/upload/token: ask for a single-use browser upload to Blob. */
export const BlobTokenBody = z.strictObject({
  folder: z.string().min(1).max(64),
  /** The name to store, as the owner named it (cleaned on the server). */
  name: z.string().min(1).max(200),
  /** Exact size in bytes; the token allows no more. */
  size: z.int().positive(),
  /** The type the browser detected from the bytes; the server checks it against the extension. */
  contentType: z.string().min(1).max(100),
});
export type BlobTokenBody = z.infer<typeof BlobTokenBody>;

export interface BlobTokenResponse {
  ok: true;
  /** The pathname to upload to; fixed, never overwritten. */
  pathname: string;
  /** The Blob client token, valid for this pathname, type, and size only, for a short time. */
  clientToken: string;
  /** A signed ticket the confirm route checks. Opaque to the browser. */
  ticket: string;
  /** Use a multipart upload (large files). */
  multipart: boolean;
}

/** POST /api/upload/confirm, after `put` from @vercel/blob/client succeeded. */
export const BlobConfirmBody = z.strictObject({
  pathname: z.string().min(1).max(400),
  url: z.url(),
  ticket: z.string().min(1).max(2000),
});
export type BlobConfirmBody = z.infer<typeof BlobConfirmBody>;

export interface BlobConfirmResponse {
  ok: true;
  file: MediaItem;
}

/** DELETE /api/upload. A file still referenced by the draft (or, for Blob, by live) is refused with 409 referenced. */
export const MediaDeleteBody = z.strictObject({ src: z.string().min(1).max(600) });
export type MediaDeleteBody = z.infer<typeof MediaDeleteBody>;

export interface MediaDeleteResponse {
  ok: true;
  commit: string | null;
}

export const MediaRenameBody = z.strictObject({
  src: z.string().min(1).max(600),
  /** The new name, with or without the extension; the extension never changes. */
  name: z.string().min(1).max(200),
});
export type MediaRenameBody = z.infer<typeof MediaRenameBody>;

export interface MediaRenameResponse {
  ok: true;
  file: MediaItem;
  /** Content files whose references were rewritten in the same commit. */
  rewrote: string[];
  commit: string | null;
}

export interface MediaReferencesResponse {
  ok: true;
  src: string;
  draft: Reference[];
  live: Reference[];
}
