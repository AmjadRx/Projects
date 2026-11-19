/**
 * The repository behind the admin: content and media on the draft and live branches through the
 * GitHub API, or the local disk in development (ARCHITECTURE.md 7.1, 11; docs/V3_PLAN.md D-17,
 * D-18, D-20, 5.7, R-07, R-19). Server only.
 *
 * INTERFACE OWNED BY THE LEAD; IMPLEMENTATION BY THE SERVER-CORE AGENT. Keep every exported name
 * and signature below; add helpers freely.
 *
 * Rules every implementation keeps:
 * - Writes go only to the draft branch (GITHUB_DRAFT_BRANCH); `checkDraftBranch` in
 *   lib/storage/github.ts refuses a missing draft branch, `main`, and the live branch. The only
 *   write to the live branch is `fastForwardLive`, a non-forced ref update that refuses `main`
 *   outside the production deployment (`mayPublishTo` in ./env.ts).
 * - There is no default branch: a missing GITHUB_BRANCH or GITHUB_DRAFT_BRANCH is a 503.
 * - One `commit` is one Git commit through the Git Data API (blobs, a tree on the expected head,
 *   a commit, then a non-forced ref update), so a save or a batch of uploads makes one preview
 *   build; a moved head is a 409, never an overwrite.
 * - The token travels only in the Authorization header and is removed from any error text
 *   (`errorDetail` in lib/storage/shared.ts). Nothing logs.
 * - Paths are checked before any request: content writes only under content/ (`isContentPath`),
 *   media writes only under public/media/<folder>/ with a stored-safe name.
 *
 * The GitHub requests, for anyone stubbing them in a test (all under /repos/{GITHUB_REPO}):
 * - heads: GET /git/ref/heads/{branch} (404 means no branch);
 * - readContent and listFiles: GET /git/commits/{head} for its tree, GET /git/trees/{sha} for each
 *   folder on the way (listFiles adds ?recursive=1 for the last one), GET /git/blobs/{sha};
 * - readFile: GET /contents/{path}?ref={head} with the object media type, then GET /git/blobs/{sha}
 *   when the file is over 1 MB (the contents answer leaves it empty);
 * - prepareDraft: POST /git/refs (create), GET /compare/{live}...{draft}, PATCH /git/refs/heads/{draft}
 *   (fast-forward), or POST /merges (then GET /git/commits/{merge} for the commit it was made on);
 * - commit: GET /git/commits/{head}, POST /git/blobs, POST /git/trees, POST /git/commits, a fresh
 *   GET of the draft ref, then PATCH /git/refs/heads/{draft} with force false;
 * - fastForwardLive: GET the live ref, GET /compare/{live}...{sha}, PATCH /git/refs/heads/{live};
 * - resetDraft: GET the draft ref (checked against the head the caller expects), PATCH
 *   /git/refs/heads/{draft} with force true.
 *
 * Git objects are immutable, so each repository object keeps the trees, commits, and blobs it has
 * read by their sha for its own lifetime (one request); refs are always read afresh.
 */
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import { isContentPath, PROJECTS_DIR, SITE_FILE, type Finding } from '../contract';
import { checkDraftBranch, type GitHubSettings } from '@/lib/storage/github';
import { STORAGE_MESSAGES } from '@/lib/storage/labels';
import { checkFolder, checkStoredName, isStorageError, REPO_MEDIA_DIR } from '@/lib/storage/rules';
import { envValue, errorDetail } from '@/lib/storage/shared';
import { githubSettings, isReadOnlyServer, mayPublishTo, type Env } from './env';
import { ApiFailure } from './guard';

export interface RepoFileEntry {
  /** Repository path, such as "public/media/raven/a.webp". */
  path: string;
  /** Git blob sha (a content hash on disk). */
  sha: string;
  size: number;
}

export interface CompareResult {
  /** Commits on `head` that `base` lacks. */
  ahead: number;
  /** Commits on `base` that `head` lacks. */
  behind: number;
  status: 'identical' | 'ahead' | 'behind' | 'diverged';
  files: { path: string; status: 'added' | 'modified' | 'removed' | 'renamed'; previous?: string }[];
}

export interface ContentSnapshot {
  source: 'github' | 'disk';
  /** Which branch was read; null on disk. */
  ref: 'draft' | 'live' | null;
  /** The commit read; null on disk. */
  head: string | null;
  /** content/site.json and every content/projects/*.json, as stored. */
  files: { path: string; text: string }[];
}

export interface FileChange {
  /** A content path or a public/media path, checked by the implementation. */
  path: string;
  /** The new bytes, or null to remove the file. */
  bytes: Uint8Array | null;
}

/** What making the draft ready did (D-20), so a save that is then refused can put it back. */
export interface DraftPreparation {
  /** The head to write on; null on disk. */
  head: string | null;
  /**
   * The draft head this preparation started from: the commit a merge was made on, or the head a
   * fast-forward moved from. Null when there was no draft branch, and on disk.
   */
  previous: string | null;
  /** Nothing; the branch created at the live head; moved up to the live head; or the live branch merged in. */
  action: 'none' | 'created' | 'fast-forward' | 'merged';
}

export interface ContentRepo {
  readonly source: 'github' | 'disk';
  readonly liveBranch: string | null;
  readonly draftBranch: string | null;

  /** Current heads; null for a branch that does not exist (or on disk). */
  heads(): Promise<{ live: string | null; draft: string | null }>;

  /**
   * Content from the draft branch (or the live branch while there is no draft) by default, or from
   * the live branch. Disk: the working tree's content/.
   */
  readContent(which?: 'draft' | 'live'): Promise<ContentSnapshot>;

  /** One file's bytes at a branch, or null when it does not exist there. */
  readFile(which: 'draft' | 'live', path: string): Promise<Uint8Array | null>;

  /** Files under a directory at a branch (recursive), such as "public/media/raven". */
  listFiles(which: 'draft' | 'live', dir: string): Promise<RepoFileEntry[]>;

  /**
   * Makes the draft branch ready for a write (D-20) and returns the head to write on:
   * - no draft branch: create it at the live head;
   * - a draft with no commits the live branch lacks: reset it to the live head;
   * - a draft with unpublished commits and a live branch that moved on: merge live into it, and
   *   throw ApiFailure 409 'conflict' when the merge conflicts.
   * Disk: returns null.
   */
  prepareDraft(): Promise<string | null>;

  /**
   * `prepareDraft`, saying what it did: a save whose checks refuse the content a merge or a
   * fast-forward produced puts the draft back (`resetDraft(previous, head)`), and tells the editor
   * when a merge brought in files it has not loaded. Both repositories here have it; it is optional
   * only so a stand-in repository in a test may leave it out.
   */
  prepareDraftReport?(): Promise<DraftPreparation>;

  /**
   * One commit on the draft branch on top of `expectedHead`. Returns the new head, or null when
   * the tree did not change (no empty commits) or on disk. Throws ApiFailure 409 'conflict' when
   * the draft moved meanwhile.
   */
  commit(expectedHead: string | null, changes: readonly FileChange[], message: string): Promise<string | null>;

  /** GitHub's compare of two commits, with the files that differ. */
  compare(base: string, head: string): Promise<CompareResult>;

  /**
   * Publish: a non-forced update of the live branch to `sha`, which must already contain the live
   * head (a fast-forward). Refuses `main` outside production with ApiFailure 403 'not-allowed'.
   */
  fastForwardLive(sha: string): Promise<void>;

  /**
   * Discard: a forced update of the draft branch to `sha` (the live head). With `expectedHead`, the
   * draft ref is read again just before the update and must still be that commit (null: no draft
   * branch), or nothing is written and the answer is ApiFailure 409 'conflict'.
   */
  resetDraft(sha: string, expectedHead?: string | null): Promise<void>;
}

/** For tests and for callers that need another root: everything else comes from the environment. */
export interface RepoOptions {
  /** For GitHub requests. Defaults to the server's own fetch, looked up at each request. */
  fetch?: typeof fetch;
  /** The repository root for the disk backend. Defaults to process.cwd(). */
  rootDir?: string;
}

/**
 * GitHub when the GitHub variables are set; the disk in development when they are not; and
 * ApiFailure 503 'not-configured' on a read-only server without them.
 */
export function getContentRepo(env: Env = process.env, options: RepoOptions = {}): ContentRepo {
  let settings: GitHubSettings | null;
  try {
    settings = githubSettings(env);
  } catch (error) {
    throw settingsFailure(error, env);
  }
  if (settings) return createGitHubRepo(settings, env, options.fetch);
  if (isReadOnlyServer(env)) {
    const missing = ['GITHUB_TOKEN', 'GITHUB_REPO', ...missingBranchVariables(env)];
    throw new ApiFailure(503, 'not-configured', REPO_MESSAGES.noGitHub, { missing });
  }
  return createDiskRepo(options.rootDir ?? process.cwd());
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

/** What the owner reads when the repository refuses or fails. No secret and no request value. */
export const REPO_MESSAGES = {
  pathRefused:
    'The admin reads and writes only content/site.json, content/projects/<slug>.json, and files in public/media/<folder>/.',
  folderRefused: 'The admin lists only content, content/projects, public/media, and public/media/<folder>.',
  duplicatePath: 'This file appears twice in one commit.',
  badSha: 'This is not a commit id.',
  noGitHub:
    'Content cannot be read or saved: the server has no GitHub settings, and its disk is read-only. ' +
    'Set GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, and GITHUB_DRAFT_BRANCH in the hosting dashboard, then redeploy.',
  branchesMissing: (names: readonly string[]) =>
    `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} not set. ` +
    'Set the published branch and the draft branch in the hosting dashboard and redeploy: there is no default branch.',
  badLiveBranch: 'GITHUB_BRANCH is not a valid branch name.',
  liveMissing: (branch: string) =>
    `The branch "${branch}" named by GITHUB_BRANCH does not exist in the repository. Check GITHUB_BRANCH.`,
  noDraftYet: 'The draft branch does not exist yet. Save a change to create it.',
  conflict: STORAGE_MESSAGES.conflict,
  draftMoved: 'The draft changed after you opened the dialog. Review it again.',
  mergeConflict: (live: string) =>
    `The changes on "${live}" conflict with the draft. Discard the draft, or resolve the conflict on GitHub, then save again.`,
  compareMissing: 'A commit to compare is no longer in the repository. Reload and try again.',
  publishOutsideProduction: 'Publishing into main happens only on the production deployment.',
  diverged:
    'The published branch has commits the draft does not have: it changed after the draft was last saved. ' +
    'Bring the draft up to date (in the Publish dialog, or with your next save), check the preview, then publish.',
  liveMoved: 'The published branch changed while publishing, so nothing was published. Open Publish again.',
  noDraftOnDisk: 'There is no draft branch on disk: local saves go straight to the files.',
  diskFailed: 'The file could not be read or written on the local disk.',
  githubTimeout: 'GitHub did not answer in time. Try again in a moment.',
  tooManyFiles: 'This folder holds more files than GitHub lists in one answer.',
  notUtf8: 'A content file is not UTF-8 text.',
} as const;

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

const MEDIA_FILE = /^public\/media\/([^/]+)\/([^/]+)$/;
const MEDIA_DIR = /^public\/media(?:\/([^/]+))?$/;

/** True for a file the repository may read or write: a content path or public/media/<folder>/<stored name>. */
export function isRepoFilePath(path: string): boolean {
  if (typeof path !== 'string') return false;
  if (isContentPath(path)) return true;
  const match = MEDIA_FILE.exec(path);
  if (!match) return false;
  try {
    checkFolder(match[1]);
    checkStoredName(match[2]);
    return true;
  } catch {
    return false;
  }
}

/** True for a folder `listFiles` may list: content, content/projects, public/media, public/media/<folder>. */
export function isRepoDirPath(dir: string): boolean {
  if (typeof dir !== 'string') return false;
  if (dir === 'content' || dir === PROJECTS_DIR) return true;
  const match = MEDIA_DIR.exec(dir);
  if (!match) return false;
  if (match[1] === undefined) return true;
  try {
    checkFolder(match[1]);
    return true;
  } catch {
    return false;
  }
}

/** The 400 answer for a refused path, naming it as sent (shortened) under rule PATH. */
export function pathFailure(path: unknown, message: string = REPO_MESSAGES.pathRefused): ApiFailure {
  const shown = String(path).slice(0, 300);
  const finding: Finding = { file: shown, path: '(path)', rule: 'PATH', message, severity: 'error' };
  return new ApiFailure(400, 'bad-request', message, { findings: [finding] });
}

function checkFilePaths(changes: readonly FileChange[]): void {
  const seen = new Set<string>();
  for (const change of changes) {
    if (!change || !isRepoFilePath(change.path)) throw pathFailure(change?.path);
    if (seen.has(change.path)) throw pathFailure(change.path, REPO_MESSAGES.duplicatePath);
    seen.add(change.path);
    if (change.bytes !== null && !(change.bytes instanceof Uint8Array)) throw pathFailure(change.path);
  }
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function checkSha(value: unknown): string {
  if (typeof value !== 'string' || !SHA.test(value)) throw new ApiFailure(400, 'bad-request', REPO_MESSAGES.badSha);
  return value;
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

/** "refs/heads/x" and "heads/x" both mean the branch "x". */
export function normalizeBranchName(name: string): string {
  return name.trim().replace(/^refs\/heads\//, '').replace(/^heads\//, '');
}

/** The branch-name rules lib/storage/github.ts applies to the draft branch. */
export function isValidBranchName(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,100}$/.test(name) &&
    !/^[-./]/.test(name) &&
    !/[/.]$/.test(name) &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.includes('/.')
  );
}

function missingBranchVariables(env: Env): string[] {
  return ['GITHUB_BRANCH', 'GITHUB_DRAFT_BRANCH'].filter((name) => normalizeBranchName(envValue(env, name)) === '');
}

/** A refusal of the GitHub variables as a 503 that names the variable to fix, never a value. */
function settingsFailure(error: unknown, env: Env): ApiFailure {
  const message = isStorageError(error) ? error.message : STORAGE_MESSAGES.githubUnexpected;
  const missing = ['GITHUB_TOKEN', 'GITHUB_REPO'].filter((name) => envValue(env, name) === '');
  return new ApiFailure(503, 'not-configured', message, { missing: missing.length > 0 ? missing : ['GITHUB_REPO'] });
}

/** The live and draft branch names, or a 503 that names the variable to fix. */
function checkBranches(settings: GitHubSettings, env: Env): { live: string; draft: string } {
  const missing = missingBranchVariables(env);
  if (missing.length > 0) throw new ApiFailure(503, 'not-configured', REPO_MESSAGES.branchesMissing(missing), { missing });
  const live = normalizeBranchName(settings.productionBranch);
  if (!isValidBranchName(live)) {
    throw new ApiFailure(503, 'not-configured', REPO_MESSAGES.badLiveBranch, { missing: ['GITHUB_BRANCH'] });
  }
  try {
    return { live, draft: checkDraftBranch(settings) };
  } catch (error) {
    const message = isStorageError(error) ? error.message : STORAGE_MESSAGES.githubUnexpected;
    throw new ApiFailure(503, 'not-configured', message, { missing: ['GITHUB_DRAFT_BRANCH'] });
  }
}

// ---------------------------------------------------------------------------------------------
// The GitHub client
// ---------------------------------------------------------------------------------------------

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
/** A GitHub request that takes longer than this is given up, so a stuck request cannot hold the function. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Blob reads run a few at a time, well under GitHub's limit on concurrent requests. */
const READ_CONCURRENCY = 6;

export interface GitHubReply {
  status: number;
  data: unknown;
}

export interface GitHubClient {
  /** "owner/name". Not secret. */
  readonly repo: string;
  /**
   * A request to https://api.github.com/repos/{repo}{path}. Answers with any HTTP status; throws
   * ApiFailure 502 'github' only when GitHub cannot be reached or does not answer in time.
   */
  request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options?: { body?: unknown; accept?: string },
  ): Promise<GitHubReply>;
  /** The reply's data when its status is one of `ok`; otherwise ApiFailure 502 'github' with GitHub's message, without the token. */
  expect(reply: GitHubReply, ...ok: number[]): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pick(data: unknown, ...keys: string[]): unknown {
  let value = data;
  for (const key of keys) value = isRecord(value) ? value[key] : undefined;
  return value;
}

/** A sha from a GitHub answer; anything else means GitHub answered in a way this code does not understand. */
function shaOf(value: unknown): string {
  if (typeof value === 'string' && SHA.test(value)) return value;
  throw new ApiFailure(502, 'github', STORAGE_MESSAGES.githubUnexpected);
}

function isTimeout(error: unknown): boolean {
  return isRecord(error) && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * The only place the admin talks to the GitHub REST API. The token stays in this closure and
 * travels only in the Authorization header; GitHub's error text is shortened and has the token
 * removed before it reaches an answer.
 */
export function createGitHubClient(
  settings: Pick<GitHubSettings, 'token' | 'repo'>,
  fetchImpl?: typeof fetch,
  options: { timeoutMs?: number } = {},
): GitHubClient {
  const { token, repo } = settings;
  const send: typeof fetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return {
    repo,

    async request(method, path, options = {}) {
      const headers: Record<string, string> = {
        Accept: options.accept ?? 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      let response: Response;
      try {
        response = await send(`${GITHUB_API}/repos/${repo}${path}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new ApiFailure(502, 'github', isTimeout(error) ? REPO_MESSAGES.githubTimeout : STORAGE_MESSAGES.githubUnreachable);
      }
      const text = await response.text().catch(() => '');
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      return { status: response.status, data };
    },

    expect(reply, ...ok) {
      if (ok.includes(reply.status)) return reply.data;
      const message = pick(reply.data, 'message');
      const detail = typeof message === 'string' ? errorDetail(message, token) : '';
      throw new ApiFailure(502, 'github', STORAGE_MESSAGES.githubFailed(reply.status, detail));
    },
  };
}

function refPath(branch: string): string {
  return `heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text.replace(/\s+/g, ''), 'base64'));
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

function utf8(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new ApiFailure(422, 'invalid-file', REPO_MESSAGES.notUtf8);
  }
}

/** Runs `fn` over `items`, at most `limit` at a time, keeping the order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** A per-object cache of promises that forgets a failed load, so a retry asks again. */
function remember<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let hit = cache.get(key);
  if (!hit) {
    hit = load();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
  }
  return hit;
}

const byPath = <T extends { path: string }>(a: T, b: T): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const COMPARE_STATUS = new Set(['identical', 'ahead', 'behind', 'diverged']);

/** GitHub's compare answer in the shape the admin uses. Copied files count as added, mode or type changes as modified. */
function compareResultOf(data: unknown): CompareResult {
  const ahead = pick(data, 'ahead_by');
  const behind = pick(data, 'behind_by');
  const status = pick(data, 'status');
  if (typeof ahead !== 'number' || typeof behind !== 'number' || typeof status !== 'string' || !COMPARE_STATUS.has(status)) {
    throw new ApiFailure(502, 'github', STORAGE_MESSAGES.githubUnexpected);
  }
  const rawFiles = pick(data, 'files');
  const files: CompareResult['files'] = [];
  for (const file of Array.isArray(rawFiles) ? rawFiles : []) {
    const path = pick(file, 'filename');
    if (typeof path !== 'string') continue;
    const raw = pick(file, 'status');
    const mapped =
      raw === 'added' || raw === 'copied'
        ? 'added'
        : raw === 'removed'
          ? 'removed'
          : raw === 'renamed'
            ? 'renamed'
            : 'modified';
    const previous = pick(file, 'previous_filename');
    files.push(mapped === 'renamed' && typeof previous === 'string' ? { path, status: mapped, previous } : { path, status: mapped });
  }
  return { ahead, behind, status: status as CompareResult['status'], files };
}

// ---------------------------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------------------------

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

interface TreeListing {
  entries: TreeEntry[];
  truncated: boolean;
}

function createGitHubRepo(settings: GitHubSettings, env: Env, fetchImpl?: typeof fetch): ContentRepo {
  const branches = checkBranches(settings, env);
  const liveBranch = branches.live;
  const draftBranch = branches.draft;
  const gh = createGitHubClient(settings, fetchImpl);

  const commitObjects = new Map<string, Promise<{ tree: string; parents: string[] }>>();
  const trees = new Map<string, Promise<TreeListing>>();
  const blobs = new Map<string, Promise<Uint8Array>>();

  function liveMissing(): ApiFailure {
    return new ApiFailure(503, 'not-configured', REPO_MESSAGES.liveMissing(liveBranch), { missing: ['GITHUB_BRANCH'] });
  }

  async function headOf(branch: string): Promise<string | null> {
    const reply = await gh.request('GET', `/git/ref/${refPath(branch)}`);
    if (reply.status === 404) return null;
    return shaOf(pick(gh.expect(reply, 200), 'object', 'sha'));
  }

  /** The commit to read: the draft head, or the live head while there is no draft (or when asked for live). */
  async function readHead(which: 'draft' | 'live'): Promise<{ ref: 'draft' | 'live'; sha: string }> {
    if (which === 'draft') {
      const draft = await headOf(draftBranch);
      if (draft) return { ref: 'draft', sha: draft };
    }
    const live = await headOf(liveBranch);
    if (!live) throw liveMissing();
    return { ref: 'live', sha: live };
  }

  /** A commit's root tree and parents (first parent first). */
  function commitOf(commit: string): Promise<{ tree: string; parents: string[] }> {
    return remember(commitObjects, commit, async () => {
      const data = gh.expect(await gh.request('GET', `/git/commits/${commit}`), 200);
      const raw = pick(data, 'parents');
      const parents = (Array.isArray(raw) ? raw : []).map((parent) => pick(parent, 'sha')).filter((sha): sha is string => typeof sha === 'string' && SHA.test(sha));
      return { tree: shaOf(pick(data, 'tree', 'sha')), parents };
    });
  }

  async function rootTreeOf(commit: string): Promise<string> {
    return (await commitOf(commit)).tree;
  }

  function treeOf(sha: string, recursive = false): Promise<TreeListing> {
    return remember(trees, `${sha}:${recursive ? 'r' : 'n'}`, async () => {
      const data = gh.expect(await gh.request('GET', `/git/trees/${sha}${recursive ? '?recursive=1' : ''}`), 200);
      const raw = pick(data, 'tree');
      if (!Array.isArray(raw)) throw new ApiFailure(502, 'github', STORAGE_MESSAGES.githubUnexpected);
      const entries: TreeEntry[] = [];
      for (const entry of raw) {
        const path = pick(entry, 'path');
        const type = pick(entry, 'type');
        const entrySha = pick(entry, 'sha');
        const size = pick(entry, 'size');
        if (typeof path !== 'string' || typeof type !== 'string' || typeof entrySha !== 'string') continue;
        entries.push({ path, type, sha: entrySha, ...(typeof size === 'number' ? { size } : {}) });
      }
      return { entries, truncated: pick(data, 'truncated') === true };
    });
  }

  function blobOf(sha: string): Promise<Uint8Array> {
    return remember(blobs, sha, async () => {
      const data = gh.expect(await gh.request('GET', `/git/blobs/${shaOf(sha)}`), 200);
      const content = pick(data, 'content');
      const encoding = pick(data, 'encoding');
      if (typeof content !== 'string') throw new ApiFailure(502, 'github', STORAGE_MESSAGES.githubUnexpected);
      if (encoding === 'utf-8') return new TextEncoder().encode(content);
      if (encoding !== 'base64') throw new ApiFailure(502, 'github', STORAGE_MESSAGES.githubUnexpected);
      return fromBase64(content);
    });
  }

  /** The entry at `path` under the tree `root` (one folder at a time), or null. */
  async function lookup(root: string, path: string, type: 'tree' | 'blob'): Promise<TreeEntry | null> {
    const segments = path.split('/');
    let current = root;
    for (let i = 0; i < segments.length; i += 1) {
      const last = i === segments.length - 1;
      const entry = (await treeOf(current)).entries.find(
        (candidate) => candidate.path === segments[i] && candidate.type === (last ? type : 'tree'),
      );
      if (!entry) return null;
      if (last) return entry;
      current = entry.sha;
    }
    return null;
  }

  async function compare(base: string, head: string): Promise<CompareResult> {
    const reply = await gh.request('GET', `/compare/${checkSha(base)}...${checkSha(head)}`);
    if (reply.status === 404) throw new ApiFailure(409, 'conflict', REPO_MESSAGES.compareMissing);
    return compareResultOf(gh.expect(reply, 200));
  }

  async function updateRef(branch: string, sha: string, force: boolean): Promise<number> {
    const reply = await gh.request('PATCH', `/git/refs/${refPath(branch)}`, { body: { sha, force } });
    if (reply.status === 404 || reply.status === 409 || reply.status === 422) return reply.status;
    gh.expect(reply, 200);
    return 200;
  }

  /** D-20: makes the draft ready for a write and says what that took. */
  async function prepare(): Promise<DraftPreparation> {
    const [live, draft] = await Promise.all([headOf(liveBranch), headOf(draftBranch)]);
    if (!live) throw liveMissing();
    if (!draft) {
      const created = await gh.request('POST', '/git/refs', { body: { ref: `refs/heads/${draftBranch}`, sha: live } });
      if (created.status === 422) {
        // Another request created it a moment ago: write on it as it stands.
        const now = await headOf(draftBranch);
        if (now) return { head: now, previous: now, action: 'none' };
      }
      gh.expect(created, 201);
      return { head: live, previous: null, action: 'created' };
    }
    if (draft === live) return { head: draft, previous: draft, action: 'none' };
    const state = await compare(live, draft);
    if (state.ahead === 0) {
      // Nothing unpublished: the draft is an ancestor of live, so moving it is a fast-forward.
      // A non-forced update keeps a save that landed meanwhile instead of overwriting it.
      if ((await updateRef(draftBranch, live, false)) !== 200) throw new ApiFailure(409, 'conflict', REPO_MESSAGES.conflict);
      return { head: live, previous: draft, action: 'fast-forward' };
    }
    if (state.behind > 0) {
      const merged = await gh.request('POST', '/merges', {
        body: { base: draftBranch, head: live, commit_message: `Merge ${liveBranch} into ${draftBranch}` },
      });
      if (merged.status === 409) throw new ApiFailure(409, 'conflict', REPO_MESSAGES.mergeConflict(liveBranch));
      if (merged.status === 204) {
        const now = (await headOf(draftBranch)) ?? draft;
        return { head: now, previous: now, action: 'none' };
      }
      const head = shaOf(pick(gh.expect(merged, 201), 'sha'));
      // GitHub merges into whatever the draft holds at that moment, so the commit the merge was
      // made on is its first parent, which a save landing meanwhile may have moved past `draft`.
      const previous = (await commitOf(head)).parents[0] ?? draft;
      return { head, previous, action: 'merged' };
    }
    return { head: draft, previous: draft, action: 'none' };
  }

  return {
    source: 'github',
    liveBranch,
    draftBranch,

    async heads() {
      const [live, draft] = await Promise.all([headOf(liveBranch), headOf(draftBranch)]);
      return { live, draft };
    },

    async readContent(which = 'draft') {
      const { ref, sha } = await readHead(which);
      const root = await rootTreeOf(sha);
      const contentDir = await lookup(root, 'content', 'tree');
      const targets: { path: string; sha: string }[] = [];
      if (contentDir) {
        const entries = (await treeOf(contentDir.sha)).entries;
        const site = entries.find((entry) => entry.path === 'site.json' && entry.type === 'blob');
        if (site) targets.push({ path: SITE_FILE, sha: site.sha });
        const projects = entries.find((entry) => entry.path === 'projects' && entry.type === 'tree');
        if (projects) {
          const files = (await treeOf(projects.sha)).entries
            .filter((entry) => entry.type === 'blob' && entry.path.endsWith('.json'))
            .map((entry) => ({ path: `${PROJECTS_DIR}/${entry.path}`, sha: entry.sha }))
            .sort(byPath);
          targets.push(...files);
        }
      }
      const files = await mapLimit(targets, READ_CONCURRENCY, async (target) => ({
        path: target.path,
        text: utf8(await blobOf(target.sha)),
      }));
      return { source: 'github', ref, head: sha, files };
    },

    async readFile(which, path) {
      if (!isRepoFilePath(path)) throw pathFailure(path);
      const { sha } = await readHead(which);
      // The object media type answers a file of any size up to 100 MB in one shape (content empty
      // over 1 MB) and a folder as { type: "dir" } instead of a list.
      const reply = await gh.request('GET', `/contents/${encodePath(path)}?ref=${sha}`, {
        accept: 'application/vnd.github.object+json',
      });
      if (reply.status === 404) return null;
      const data = gh.expect(reply, 200);
      if (pick(data, 'type') !== 'file') return null;
      const size = pick(data, 'size');
      const content = pick(data, 'content');
      if (size === 0) return new Uint8Array(0);
      // Files over 1 MB come back without their content; the blob holds them (up to 100 MB).
      if (pick(data, 'encoding') === 'base64' && typeof content === 'string' && content !== '') return fromBase64(content);
      return blobOf(shaOf(pick(data, 'sha')));
    },

    async listFiles(which, dir) {
      if (!isRepoDirPath(dir)) throw pathFailure(dir, REPO_MESSAGES.folderRefused);
      const { sha } = await readHead(which);
      const folder = await lookup(await rootTreeOf(sha), dir, 'tree');
      if (!folder) return [];
      const listing = await treeOf(folder.sha, true);
      if (listing.truncated) throw new ApiFailure(502, 'github', REPO_MESSAGES.tooManyFiles);
      return listing.entries
        .filter((entry) => entry.type === 'blob')
        .map((entry) => ({ path: `${dir}/${entry.path}`, sha: entry.sha, size: entry.size ?? 0 }))
        .sort(byPath);
    },

    async prepareDraft() {
      return (await prepare()).head;
    },

    prepareDraftReport: prepare,

    async commit(expectedHead, changes, message) {
      checkFilePaths(changes);
      if (changes.length === 0) return null;
      let head = expectedHead;
      if (head === null) {
        head = await headOf(draftBranch);
        if (!head) throw new ApiFailure(409, 'conflict', REPO_MESSAGES.noDraftYet);
      }
      checkSha(head);
      const baseTree = await rootTreeOf(head);

      const entries: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
      for (const change of changes) {
        if (change.bytes === null) {
          // Removing a path the tree does not have is not a change; GitHub would refuse the tree.
          if (await lookup(baseTree, change.path, 'blob')) entries.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
          continue;
        }
        // One request at a time: GitHub asks for content-creating requests to be serial (R-19).
        const blob = await gh.request('POST', '/git/blobs', { body: { content: toBase64(change.bytes), encoding: 'base64' } });
        entries.push({ path: change.path, mode: '100644', type: 'blob', sha: shaOf(pick(gh.expect(blob, 201, 200), 'sha')) });
      }
      if (entries.length === 0) return null;

      const tree = shaOf(pick(gh.expect(await gh.request('POST', '/git/trees', { body: { base_tree: baseTree, tree: entries } }), 201, 200), 'sha'));
      if (tree === baseTree) return null;
      const commitMessage = message.trim() || 'content: update';
      const created = shaOf(
        pick(gh.expect(await gh.request('POST', '/git/commits', { body: { message: commitMessage, tree, parents: [head] } }), 201, 200), 'sha'),
      );
      // The ref must still point at the commit this one builds on. A non-forced update alone would
      // also accept a branch that was moved back meanwhile (a discard), so the head is read again.
      if ((await headOf(draftBranch)) !== head) throw new ApiFailure(409, 'conflict', REPO_MESSAGES.conflict);
      if ((await updateRef(draftBranch, created, false)) !== 200) throw new ApiFailure(409, 'conflict', REPO_MESSAGES.conflict);
      return created;
    },

    compare,

    async fastForwardLive(sha) {
      checkSha(sha);
      if (!mayPublishTo(liveBranch, env)) throw new ApiFailure(403, 'not-allowed', REPO_MESSAGES.publishOutsideProduction);
      const live = await headOf(liveBranch);
      if (!live) throw liveMissing();
      if (live === sha) return;
      const state = await compare(live, sha);
      if (state.behind > 0) throw new ApiFailure(409, 'diverged', REPO_MESSAGES.diverged);
      if ((await updateRef(liveBranch, sha, false)) !== 200) throw new ApiFailure(409, 'diverged', REPO_MESSAGES.liveMoved);
    },

    async resetDraft(sha, expectedHead) {
      checkSha(sha);
      if (typeof expectedHead === 'string') checkSha(expectedHead);
      // Read just before the forced update, so a save that landed after the caller looked is not
      // dropped unseen. (GitHub has no compare-and-set for a forced update; this is the narrowest gap.)
      const current = await headOf(draftBranch);
      if (expectedHead !== undefined && current !== expectedHead) throw new ApiFailure(409, 'conflict', REPO_MESSAGES.draftMoved);
      if (!current || current === sha) return;
      if ((await updateRef(draftBranch, sha, true)) !== 200) throw new ApiFailure(409, 'conflict', REPO_MESSAGES.conflict);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Disk (local development without GitHub variables)
// ---------------------------------------------------------------------------------------------

/** Git's blob id of some bytes, so a file on disk carries the same sha it would have on GitHub. */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && 'code' in error ? String(error.code) : undefined;
}

function createDiskRepo(rootDir: string): ContentRepo {
  const root = nodePath.resolve(rootDir);
  const allowed = [nodePath.join(root, 'content'), nodePath.join(root, ...REPO_MEDIA_DIR.split('/'))];

  /** The absolute path of a checked repository path, proven to stay inside content/ or public/media/. */
  function inside(path: string): string {
    const target = nodePath.resolve(root, ...path.split('/'));
    const ok = allowed.some((base) => {
      const relative = nodePath.relative(base, target);
      return relative === '' || (!relative.startsWith('..') && !nodePath.isAbsolute(relative));
    });
    if (!ok) throw pathFailure(path);
    return target;
  }

  function diskFailure(): ApiFailure {
    return new ApiFailure(500, 'server', REPO_MESSAGES.diskFailed);
  }

  async function readOrNull(file: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(file));
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EISDIR') return null;
      throw diskFailure();
    }
  }

  async function walk(dir: string, prefix: string): Promise<RepoFileEntry[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return [];
      throw diskFailure();
    }
    const out: RepoFileEntry[] = [];
    for (const entry of entries) {
      const full = nodePath.join(dir, entry.name);
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) out.push(...(await walk(full, path)));
      else if (entry.isFile()) {
        const bytes = await readOrNull(full);
        if (bytes) out.push({ path, sha: gitBlobSha(bytes), size: bytes.byteLength });
      }
    }
    return out;
  }

  function noDraft(): never {
    throw new ApiFailure(409, 'not-allowed', REPO_MESSAGES.noDraftOnDisk);
  }

  return {
    source: 'disk',
    liveBranch: null,
    draftBranch: null,

    async heads() {
      return { live: null, draft: null };
    },

    async readContent() {
      const files: { path: string; text: string }[] = [];
      const site = await readOrNull(inside(SITE_FILE));
      if (site) files.push({ path: SITE_FILE, text: utf8(site) });
      let names: string[] = [];
      try {
        names = (await fs.readdir(inside(PROJECTS_DIR), { withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => entry.name)
          .sort();
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw diskFailure();
      }
      for (const name of names) {
        const path = `${PROJECTS_DIR}/${name}`;
        const bytes = await readOrNull(inside(path));
        if (bytes) files.push({ path, text: utf8(bytes) });
      }
      return { source: 'disk', ref: null, head: null, files };
    },

    async readFile(_which, path) {
      if (!isRepoFilePath(path)) throw pathFailure(path);
      return readOrNull(inside(path));
    },

    async listFiles(_which, dir) {
      if (!isRepoDirPath(dir)) throw pathFailure(dir, REPO_MESSAGES.folderRefused);
      return (await walk(inside(dir), dir)).sort(byPath);
    },

    async prepareDraft() {
      return null;
    },

    async prepareDraftReport() {
      return { head: null, previous: null, action: 'none' };
    },

    async commit(_expectedHead, changes) {
      checkFilePaths(changes);
      const targets = changes.map((change) => ({ change, file: inside(change.path) }));
      for (const { change, file } of targets) {
        try {
          if (change.bytes === null) {
            await fs.unlink(file);
            continue;
          }
          await fs.mkdir(nodePath.dirname(file), { recursive: true });
          // Write beside the file, then rename over it, so a crash never leaves half a file.
          const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
          await fs.writeFile(temporary, change.bytes);
          try {
            await fs.rename(temporary, file);
          } catch (error) {
            await fs.unlink(temporary).catch(() => undefined);
            throw error;
          }
        } catch (error) {
          if (change.bytes === null && errorCode(error) === 'ENOENT') continue;
          throw diskFailure();
        }
      }
      return null;
    },

    compare: async () => noDraft(),
    fastForwardLive: async () => noDraft(),
    resetDraft: async () => noDraft(),
  };
}
