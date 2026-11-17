/**
 * The media storage adapter (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-17, D-23 to D-27, 5.7): one
 * interface (`put`, `delete`, `list`, `url`) over two backends, recorded in `MediaRef.store`.
 *
 * - `repo`: files under `public/media/` in the repository, committed through the GitHub API to the
 *   draft branch only (lib/storage/github.ts), or written to the local disk in development when no
 *   GitHub variables are set (lib/storage/disk.ts). Up to 4,000,000 bytes.
 * - `blob`: Vercel Blob (lib/storage/blob.ts), active when BLOB_READ_WRITE_TOKEN is set. Above
 *   4,000,000 bytes, up to 500 MB.
 *
 * Server only: it reads GITHUB_TOKEN and BLOB_READ_WRITE_TOKEN. The rules (limits, the type
 * allow-list, folder and name checks, the choice of store) are pure and live in
 * lib/storage/rules.ts, which the admin may import in the browser.
 *
 * Left for the Phase 6 upload route: the type check from the file's bytes, SVG sanitizing, and
 * photo re-encoding run through the `inspect` hook of `put` (see `Inspector`); the content check
 * of file and folder names runs before `put` (D-19); a delete first lists the references in
 * `draft` and `main` (D-25, D-27); browser uploads to Blob use a token route and a confirm route
 * (D-26) with `blobPathnameOf` and `BLOB_WRITE_OPTIONS`.
 */
import 'server-only';
import { createBlobStorage } from './storage/blob';
import { createDiskStorage } from './storage/disk';
import { checkDraftBranch, createGitHubStorage, readGitHubSettings } from './storage/github';
import { STORAGE_MESSAGES as M } from './storage/labels';
import { BLOB_MAX_BYTES, REPO_MAX_BYTES, StorageError, storeForSize, type StoreName } from './storage/rules';
import { envValue, type Env } from './storage/shared';
import type { MediaStorage, StorageOptions } from './storage/types';

export * from './storage/rules';
export { STORAGE_MESSAGES, COMMIT_MESSAGES } from './storage/labels';
export type {
  DeleteOptions,
  InspectInput,
  Inspector,
  MediaStorage,
  PutInput,
  PutOptions,
  StorageOptions,
  StoredFile,
  StoredFileRef,
} from './storage/types';
export type { Env } from './storage/shared';
export type { GitHubSettings, GitHubStorageOptions } from './storage/github';
export type { DiskStorageOptions } from './storage/disk';
export type { BlobStorageOptions } from './storage/blob';
export { checkDraftBranch, createBlobStorage, createDiskStorage, createGitHubStorage, readGitHubSettings };

export interface StorageFactoryOptions extends StorageOptions {
  /** Defaults to `process.env`. */
  env?: Env;
  /** The repository root for the disk backend. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** For GitHub requests. Defaults to the server's own `fetch`. */
  fetch?: typeof fetch;
  /** The Blob path prefix. Defaults to "media". */
  blobPrefix?: string;
}

/** A server whose disk is read-only: production builds and every Vercel deployment. */
function isReadOnlyServer(env: Env): boolean {
  return envValue(env, 'NODE_ENV') === 'production' || envValue(env, 'VERCEL') !== '';
}

export function isBlobConfigured(env: Env = process.env): boolean {
  return envValue(env, 'BLOB_READ_WRITE_TOKEN') !== '';
}

/**
 * The repository store: GitHub when GITHUB_TOKEN and GITHUB_REPO are set (writes then go to
 * GITHUB_DRAFT_BRANCH only), the local disk in development when neither is set, and a refusal on
 * a read-only server without them.
 */
export function getRepoStorage(options: StorageFactoryOptions = {}): MediaStorage {
  const env = options.env ?? process.env;
  const settings = readGitHubSettings(env);
  if (settings) {
    return createGitHubStorage({
      settings,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.knownFolders ? { knownFolders: options.knownFolders } : {}),
    });
  }
  if (isReadOnlyServer(env)) throw new StorageError('repo-not-configured', M.repoNotConfigured, 503);
  return createDiskStorage({
    rootDir: options.rootDir ?? process.cwd(),
    ...(options.knownFolders ? { knownFolders: options.knownFolders } : {}),
  });
}

/** The Blob store. Refused, with a message that says how to set it up, while BLOB_READ_WRITE_TOKEN is not set. */
export function getBlobStorage(options: StorageFactoryOptions = {}): MediaStorage {
  const env = options.env ?? process.env;
  return createBlobStorage({
    token: envValue(env, 'BLOB_READ_WRITE_TOKEN'),
    ...(options.blobPrefix ? { prefix: options.blobPrefix } : {}),
    ...(options.knownFolders ? { knownFolders: options.knownFolders } : {}),
  });
}

export function getStorage(store: StoreName, options: StorageFactoryOptions = {}): MediaStorage {
  return store === 'blob' ? getBlobStorage(options) : getRepoStorage(options);
}

/** The store for a file of `bytes` bytes, given this environment (D-23). See `storeForSize`. */
export function chooseStore(bytes: number, ext?: string, env: Env = process.env): StoreName {
  return storeForSize(bytes, { blobConfigured: isBlobConfigured(env), ...(ext !== undefined ? { ext } : {}) });
}

/** The store that takes a file of `bytes` bytes, ready to use. */
export function getStorageForSize(bytes: number, ext?: string, options: StorageFactoryOptions = {}): MediaStorage {
  return getStorage(chooseStore(bytes, ext, options.env ?? process.env), options);
}

/** What the admin's connection-status panel shows about storage (D-32). It holds no secret. */
export interface StorageStatus {
  repo: {
    target: 'github' | 'disk' | 'none';
    writable: boolean;
    draftBranch: string | null;
    problem: string | null;
  };
  blob: { configured: boolean };
  limits: { repoMaxBytes: number; blobMaxBytes: number };
}

export function storageStatus(env: Env = process.env): StorageStatus {
  const limits = { repoMaxBytes: REPO_MAX_BYTES, blobMaxBytes: BLOB_MAX_BYTES };
  const blob = { configured: isBlobConfigured(env) };
  let repo: StorageStatus['repo'];
  try {
    const settings = readGitHubSettings(env);
    if (settings) {
      try {
        repo = { target: 'github', writable: true, draftBranch: checkDraftBranch(settings), problem: null };
      } catch (error) {
        repo = { target: 'github', writable: false, draftBranch: null, problem: (error as StorageError).message };
      }
    } else if (isReadOnlyServer(env)) {
      repo = { target: 'none', writable: false, draftBranch: null, problem: M.repoNotConfigured };
    } else {
      repo = { target: 'disk', writable: true, draftBranch: null, problem: null };
    }
  } catch (error) {
    repo = {
      target: 'none',
      writable: false,
      draftBranch: null,
      problem: error instanceof StorageError ? error.message : M.githubUnexpected,
    };
  }
  return { repo, blob, limits };
}
