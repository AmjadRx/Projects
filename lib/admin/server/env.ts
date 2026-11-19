/**
 * The admin's server settings, read from the environment (ARCHITECTURE.md 11). Server only.
 *
 * Secrets are read here and nowhere else in the admin: ADMIN_PASSWORD and SESSION_SECRET by
 * lib/auth.ts through `adminSecrets`, GITHUB_TOKEN through `githubSettings`, CONTENT_BLOCKLIST
 * through `blocklistRaw`. No function here returns a secret to a caller that could print it,
 * and nothing here logs.
 *
 * There are no fallback credentials and no default branch: a missing ADMIN_PASSWORD or
 * SESSION_SECRET turns every admin route into 503 with a setup notice (`adminEnv`), and a missing
 * GITHUB_BRANCH or GITHUB_DRAFT_BRANCH refuses every GitHub write (docs/V3_PLAN.md 5.7, R-07).
 */
import 'server-only';
import { envValue, type Env } from '@/lib/storage/shared';
import { readGitHubSettings, type GitHubSettings } from '@/lib/storage/github';

export type { Env };

/** SESSION_SECRET signs sessions with HMAC-SHA256; anything shorter than this is refused as unsafe. */
export const MIN_SESSION_SECRET_LENGTH = 32;

export interface AdminEnvState {
  configured: boolean;
  /** Names of the variables that are missing or unusable. Never values. */
  missing: string[];
}

/** Whether the admin can run at all: ADMIN_PASSWORD and a long enough SESSION_SECRET. */
export function adminEnv(env: Env = process.env): AdminEnvState {
  const missing: string[] = [];
  if (envValue(env, 'ADMIN_PASSWORD') === '') missing.push('ADMIN_PASSWORD');
  if (envValue(env, 'SESSION_SECRET').length < MIN_SESSION_SECRET_LENGTH) missing.push('SESSION_SECRET');
  return { configured: missing.length === 0, missing };
}

/** For lib/auth.ts only. Throws when the admin is not configured, so no caller can fall back. */
export function adminSecrets(env: Env = process.env): { password: string; sessionSecret: string } {
  const state = adminEnv(env);
  if (!state.configured) throw new Error(`Admin not configured: ${state.missing.join(', ')} missing.`);
  return { password: envValue(env, 'ADMIN_PASSWORD'), sessionSecret: envValue(env, 'SESSION_SECRET') };
}

/**
 * GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, and GITHUB_DRAFT_BRANCH, or null when neither the
 * token nor the repository is set (local development then reads and writes the disk). One without
 * the other throws a StorageError (503) that names the missing variable.
 */
export function githubSettings(env: Env = process.env): GitHubSettings | null {
  return readGitHubSettings(env);
}

/** True on Vercel and in any production build: the disk is read-only, so content needs GitHub. */
export function isReadOnlyServer(env: Env = process.env): boolean {
  return envValue(env, 'NODE_ENV') === 'production' || envValue(env, 'VERCEL') !== '';
}

/** The deployment this code runs in: "production", "preview", "development", or null off Vercel. */
export function vercelEnv(env: Env = process.env): string | null {
  return envValue(env, 'VERCEL_ENV') || null;
}

/**
 * Publishing writes the live branch. It may write `main` (or any branch named like it, in any
 * letter case) only on the production deployment, so a preview or a local run can never change
 * the live site (docs/V3_PLAN.md 5.7, R-07, Q-30).
 */
export function mayPublishTo(liveBranch: string, env: Env = process.env): boolean {
  if (liveBranch.trim() === '') return false;
  if (liveBranch.trim().toLowerCase() !== 'main') return true;
  return vercelEnv(env) === 'production';
}

/** CONTENT_BLOCKLIST, for lib/lint.ts's parseBlocklist only. Undefined when unset. */
export function blocklistRaw(env: Env = process.env): string | undefined {
  const value = env.CONTENT_BLOCKLIST;
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * A missing CONTENT_BLOCKLIST fails closed on Vercel and in CI (saves answer 503), and is allowed
 * on the owner's machine, where the public rules still run (docs/V3_PLAN.md D-76).
 */
export function blocklistFailsClosed(env: Env = process.env): boolean {
  return envValue(env, 'VERCEL') !== '' || envValue(env, 'CI') !== '';
}

/** This site's own repository ("Owner/Name"), which content never links (D-22). */
export function siteRepository(env: Env = process.env): string | undefined {
  return envValue(env, 'GITHUB_REPO') || undefined;
}

/**
 * VERCEL_TOKEN, VERCEL_PROJECT_ID, and VERCEL_TEAM_ID, for deploy state from the Vercel API
 * (ARCHITECTURE.md 7.6). Null unless both the token and the project are set; deploy state then
 * comes from GitHub's deployment records (docs/V3_PLAN.md Q-31). For lib/admin/server/deploy.ts.
 */
export function vercelSettings(env: Env = process.env): { token: string; projectId: string; teamId: string | null } | null {
  const token = envValue(env, 'VERCEL_TOKEN');
  const projectId = envValue(env, 'VERCEL_PROJECT_ID');
  if (!token || !projectId) return null;
  return { token, projectId, teamId: envValue(env, 'VERCEL_TEAM_ID') || null };
}

/** True when the Blob store is set up for large files. */
export function blobConfigured(env: Env = process.env): boolean {
  return envValue(env, 'BLOB_READ_WRITE_TOKEN') !== '';
}

/**
 * The Blob store's public host, which is not secret: the store id is the fourth part of the
 * token ("vercel_blob_rw_<storeId>_<random>") and every file's address starts with it. Null when
 * Blob is not set up or the token has another shape.
 */
export function blobStoreHost(env: Env = process.env): string | null {
  const explicit = envValue(env, 'BLOB_STORE_HOST');
  if (/^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/i.test(explicit)) return explicit.toLowerCase();
  const token = envValue(env, 'BLOB_READ_WRITE_TOKEN');
  const storeId = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token)?.[1];
  return storeId ? `${storeId.toLowerCase()}.public.blob.vercel-storage.com` : null;
}

/**
 * Every variable the admin reads, for the status panel: name, whether it is required, and what
 * it is for. The panel shows presence only, never a value.
 */
export const ADMIN_VARIABLES: readonly { name: string; required: boolean; note: string }[] = [
  { name: 'ADMIN_PASSWORD', required: true, note: 'The admin password. Without it every admin route answers 503.' },
  { name: 'SESSION_SECRET', required: true, note: 'Signs the session cookie; at least 32 characters.' },
  { name: 'GITHUB_TOKEN', required: true, note: 'Fine-grained token for this repository: Contents read and write (Deployments read for deploy state).' },
  { name: 'GITHUB_REPO', required: true, note: 'owner/name of this repository.' },
  { name: 'GITHUB_BRANCH', required: true, note: 'The published branch Publish fast-forwards (main in production).' },
  { name: 'GITHUB_DRAFT_BRANCH', required: true, note: 'The branch every save commits to (draft in production). Never main.' },
  { name: 'CONTENT_BLOCKLIST', required: true, note: 'Private terms the content check refuses. Saves answer 503 without it on Vercel.' },
  { name: 'BLOB_READ_WRITE_TOKEN', required: false, note: 'Vercel Blob, for files over 4 MB. Without it larger files are refused.' },
  { name: 'VERCEL_TOKEN', required: false, note: 'Optional: deploy state from Vercel. Without it, deploy state comes from GitHub deployment records.' },
  { name: 'VERCEL_PROJECT_ID', required: false, note: 'Optional, with VERCEL_TOKEN.' },
  { name: 'VERCEL_TEAM_ID', required: false, note: 'Optional, with VERCEL_TOKEN on a team (Pro) account.' },
  { name: 'DRAFT_PREVIEW_URL', required: false, note: 'Optional, not secret: the draft branch preview address, when it cannot be worked out.' },
];
