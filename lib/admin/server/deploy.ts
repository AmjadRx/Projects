/**
 * Deploy state of the draft and live heads, and the draft branch's preview address
 * (ARCHITECTURE.md 7.1 and 7.6; docs/V3_PLAN.md D-20, D-31, Q-31). Server only. Nothing is cached
 * between requests, and a failed lookup never fails the request that asked: it only says why the
 * state is unknown.
 *
 * Where deploy state comes from:
 * - Vercel's REST API when VERCEL_TOKEN and VERCEL_PROJECT_ID are set (VERCEL_TEAM_ID on a team
 *   account): the newest ten deployments, matched to a head by `meta.githubCommitSha`, or by
 *   `meta.githubCommitRef` when no deployment of the head exists yet;
 * - otherwise the deployment records Vercel writes to GitHub for every push, read with the
 *   GitHub token, which needs Deployments read. Without it the status panel says so plainly.
 *
 * The draft's preview address is the first of: the address of the draft head's own deployment;
 * the alias Vercel gives every branch, worked out from this deployment's alias
 * (VERCEL_BRANCH_URL, VERCEL_GIT_COMMIT_REF); the non-secret DRAFT_PREVIEW_URL variable.
 *
 * Publish waits for the draft head's own deployment (`deployBlocksPublish`): while it is queued or
 * building, and when it failed, was canceled, or has not started although the lookup answered.
 * Only when the head's state cannot be read (`DeployReport.draftUnknown`) does Publish go ahead
 * without it, and the plan says so.
 */
import 'server-only';
import type { DeployState, PreviewInfo } from '../contract';
import { envValue } from '@/lib/storage/shared';
import { githubSettings, vercelSettings, type Env } from './env';
import { createGitHubClient, type GitHubClient } from './repo';

export const DEPLOY_MESSAGES = {
  fromVercel: 'Deploy state from Vercel (VERCEL_TOKEN).',
  fromGitHub: 'Deploy state from the deployment records Vercel writes to GitHub.',
  githubCannotRead: 'The GitHub token cannot read deployments: add Deployments read, or set VERCEL_TOKEN.',
  githubFailed: 'GitHub did not answer the deployment request, so deploy state is unknown for now.',
  vercelRefused: (status: number) => `Vercel refused the deployment request (${status}), so deploy state comes from GitHub instead.`,
  vercelUnreachable: 'Vercel could not be reached, so deploy state comes from GitHub instead.',
  noSource:
    'Deploy state needs the GitHub settings (a token with Deployments read) or VERCEL_TOKEN with VERCEL_PROJECT_ID.',
  previewMissing:
    'No preview address yet: the draft head has no deployment, this deployment has no branch alias (VERCEL_BRANCH_URL), ' +
    'and DRAFT_PREVIEW_URL is not set.',
  stillBuilding: 'The draft preview is still building. Publish when it is ready.',
  buildFailed: 'The draft preview failed to build. Fix the draft before publishing.',
  buildCanceled:
    'The build of the draft preview was canceled, so this commit has no preview. Redeploy it on Vercel or save again, check the preview, then publish.',
  notStarted: 'The preview of this commit has not started yet. Wait for it, check it, then publish.',
  beyondVercelList: 'The draft head is not among the deployments Vercel listed, so its build state is not known.',
  /** The publish plan's sentence when the draft head's build state cannot be read. */
  unread: (why: string) => `${why} Publish does not wait for the build, so open the preview and check it before publishing.`,
} as const;

/** A deploy lookup that waits longer than this is given up; the state is then unknown. */
const LOOKUP_TIMEOUT_MS = 8_000;
/** How many of the project's newest deployments the Vercel lookup reads. */
const VERCEL_LIST_LIMIT = 10;

export interface VercelSettings {
  token: string;
  projectId: string;
  teamId: string | null;
}

export interface DeployReport {
  source: 'vercel' | 'github' | 'none';
  /** A plain sentence: where deploy state comes from, or why it is not available. */
  detail: string;
  draft: DeployState | null;
  live: DeployState | null;
  /**
   * Null when the lookup answered for the draft head, so a `draft` that is null (or a deployment
   * of another commit) means that commit has no deployment yet; and when no draft head was asked
   * for. Otherwise a plain sentence: why the draft head's build state cannot be read.
   */
  draftUnknown: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isVercelSettings(value: unknown): value is VercelSettings {
  return (
    isRecord(value) &&
    typeof value.token === 'string' &&
    value.token !== '' &&
    typeof value.projectId === 'string' &&
    value.projectId !== '' &&
    (value.teamId === null || typeof value.teamId === 'string')
  );
}

/**
 * VERCEL_TOKEN, VERCEL_PROJECT_ID, and VERCEL_TEAM_ID, read through env.ts like every secret.
 * Null unless the token and the project are both set; deploy state then comes from GitHub's
 * deployment records, the default (Q-31).
 */
export function vercelSettingsOf(env: Env = process.env): VercelSettings | null {
  const value: unknown = vercelSettings(env);
  return isVercelSettings(value) ? value : null;
}

/** A plain https address, or null. */
function httpsAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

function isoTime(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

// ---------------------------------------------------------------------------------------------
// Vercel
// ---------------------------------------------------------------------------------------------

const VERCEL_STATES: Readonly<Record<string, DeployState['state']>> = {
  QUEUED: 'queued',
  INITIALIZING: 'queued',
  BUILDING: 'building',
  READY: 'ready',
  ERROR: 'error',
  CANCELED: 'canceled',
};

/** One Vercel deployment, as much of it as deploy state needs. */
export interface VercelDeployment {
  sha: string | null;
  ref: string | null;
  production: boolean;
  state: DeployState['state'];
  url: string | null;
  created: number;
}

class Unavailable extends Error {}

/** The project's newest ten deployments, newest first. The token travels only in the Authorization header. */
export async function vercelDeployments(settings: VercelSettings, fetchImpl?: typeof fetch): Promise<VercelDeployment[]> {
  const send: typeof fetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const params = new URLSearchParams({ projectId: settings.projectId, limit: String(VERCEL_LIST_LIMIT) });
  if (settings.teamId) params.set('teamId', settings.teamId);
  let response: Response;
  try {
    // v7 is the documented version of "List deployments" (vercel.com/docs/rest-api, read 2026-11-18).
    response = await send(`https://api.vercel.com/v7/deployments?${params.toString()}`, {
      headers: { Authorization: `Bearer ${settings.token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    throw new Unavailable(DEPLOY_MESSAGES.vercelUnreachable);
  }
  if (!response.ok) throw new Unavailable(DEPLOY_MESSAGES.vercelRefused(response.status));
  const data: unknown = await response.json().catch(() => null);
  const list = isRecord(data) && Array.isArray(data.deployments) ? data.deployments : [];
  const out: VercelDeployment[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const meta = isRecord(item.meta) ? item.meta : {};
    const host = typeof item.url === 'string' && /^[a-z0-9.-]+$/i.test(item.url) ? item.url.toLowerCase() : null;
    const ready = String(item.readyState ?? item.state ?? '').toUpperCase();
    const created = typeof item.created === 'number' ? item.created : typeof item.createdAt === 'number' ? item.createdAt : 0;
    out.push({
      sha: typeof meta.githubCommitSha === 'string' ? meta.githubCommitSha : null,
      ref: typeof meta.githubCommitRef === 'string' ? meta.githubCommitRef : null,
      production: item.target === 'production',
      state: VERCEL_STATES[ready] ?? 'unknown',
      url: host ? `https://${host}` : null,
      created,
    });
  }
  return out.sort((a, b) => b.created - a.created);
}

/** The deployment of `sha` (production or preview as asked), else the newest of `branch`, else null. */
export function matchVercel(
  list: readonly VercelDeployment[],
  sha: string,
  branch: string | null,
  production: boolean,
): DeployState | null {
  const ofSha = list.filter((deployment) => deployment.sha === sha);
  const chosen =
    ofSha.find((deployment) => deployment.production === production) ??
    ofSha[0] ??
    (branch ? list.find((deployment) => deployment.ref === branch) : undefined);
  if (!chosen) return null;
  return { state: chosen.state, url: chosen.url, sha: chosen.sha, createdAt: isoTime(chosen.created || null) };
}

// ---------------------------------------------------------------------------------------------
// GitHub deployment records
// ---------------------------------------------------------------------------------------------

const GITHUB_STATES: Readonly<Record<string, DeployState['state']>> = {
  success: 'ready',
  // GitHub marks an older successful deployment inactive once a newer one replaces it.
  inactive: 'ready',
  pending: 'queued',
  queued: 'queued',
  in_progress: 'building',
  error: 'error',
  failure: 'error',
};

function isProductionRecord(deployment: Record<string, unknown>): boolean {
  if (deployment.production_environment === true) return true;
  return typeof deployment.environment === 'string' && /^production$/i.test(deployment.environment.trim());
}

/** The newest deployment record of `sha` (production or not, as asked) with its newest status. */
export async function githubDeployment(gh: GitHubClient, sha: string, production: boolean): Promise<DeployState | null> {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha)) return null;
  const listed = await gh.request('GET', `/deployments?sha=${sha}&per_page=5`);
  if (listed.status === 403 || listed.status === 404) throw new Unavailable(DEPLOY_MESSAGES.githubCannotRead);
  if (listed.status !== 200 || !Array.isArray(listed.data)) throw new Unavailable(DEPLOY_MESSAGES.githubFailed);
  const records = listed.data
    .filter(isRecord)
    .filter((record) => typeof record.id === 'number')
    .sort((a, b) => (Date.parse(String(b.created_at ?? '')) || 0) - (Date.parse(String(a.created_at ?? '')) || 0));
  const chosen = records.find((record) => isProductionRecord(record) === production) ?? records[0];
  if (!chosen) return null;

  const statuses = await gh.request('GET', `/deployments/${chosen.id as number}/statuses?per_page=100`);
  if (statuses.status === 403 || statuses.status === 404) throw new Unavailable(DEPLOY_MESSAGES.githubCannotRead);
  if (statuses.status !== 200 || !Array.isArray(statuses.data)) throw new Unavailable(DEPLOY_MESSAGES.githubFailed);
  // GitHub does not document the order of statuses, so the newest is found by its time (then its id).
  const latest = statuses.data.filter(isRecord).reduce<Record<string, unknown> | null>((best, item) => {
    if (!best) return item;
    const time = Date.parse(String(item.created_at ?? '')) || 0;
    const bestTime = Date.parse(String(best.created_at ?? '')) || 0;
    if (time !== bestTime) return time > bestTime ? item : best;
    return Number(item.id ?? 0) > Number(best.id ?? 0) ? item : best;
  }, null);
  return {
    state: latest && typeof latest.state === 'string' ? (GITHUB_STATES[latest.state] ?? 'unknown') : 'queued',
    url: latest ? httpsAddress(latest.environment_url) : null,
    sha,
    createdAt: isoTime(latest?.created_at) ?? isoTime(chosen.created_at),
  };
}

// ---------------------------------------------------------------------------------------------
// Both, for the routes
// ---------------------------------------------------------------------------------------------

export interface DeployLookup {
  env?: Env;
  heads: { live: string | null; draft: string | null };
  liveBranch: string | null;
  draftBranch: string | null;
  /** Look up one branch only. Both by default. */
  only?: 'draft' | 'live';
  /** For tests. Defaults to the server's own fetch. */
  fetch?: typeof fetch;
  /** For tests: Vercel settings instead of the environment's. */
  vercel?: VercelSettings | null;
}

/** The latest deployment of the draft head and of the live head, from Vercel or GitHub. Never throws. */
export async function lookupDeploys(input: DeployLookup): Promise<DeployReport> {
  const env = input.env ?? process.env;
  const draftSha = input.only === 'live' ? null : input.heads.draft;
  const liveSha = input.only === 'draft' ? null : input.heads.live;
  let vercelProblem: string | null = null;

  const vercel = input.vercel !== undefined ? input.vercel : vercelSettingsOf(env);
  if (vercel) {
    try {
      const list = await vercelDeployments(vercel, input.fetch);
      // The list is the project's newest deployments. A head missing from a full list may only be
      // older than all of them, so its state is not known; missing from a shorter one, it has none.
      const listed = draftSha === null || list.length < VERCEL_LIST_LIMIT || list.some((deployment) => deployment.sha === draftSha);
      return {
        source: 'vercel',
        detail: DEPLOY_MESSAGES.fromVercel,
        draft: draftSha ? matchVercel(list, draftSha, input.draftBranch, false) : null,
        live: liveSha ? matchVercel(list, liveSha, input.liveBranch, true) : null,
        draftUnknown: listed ? null : DEPLOY_MESSAGES.beyondVercelList,
      };
    } catch (error) {
      vercelProblem = error instanceof Unavailable ? error.message : DEPLOY_MESSAGES.vercelUnreachable;
    }
  }

  let gh: GitHubClient | null = null;
  try {
    const settings = githubSettings(env);
    gh = settings ? createGitHubClient(settings, input.fetch, { timeoutMs: LOOKUP_TIMEOUT_MS }) : null;
  } catch {
    gh = null;
  }
  if (!gh) {
    const detail = vercelProblem ?? DEPLOY_MESSAGES.noSource;
    return { source: 'none', detail, draft: null, live: null, draftUnknown: draftSha ? detail : null };
  }
  const client = gh;

  try {
    const [draft, live] = await Promise.all([
      draftSha ? githubDeployment(client, draftSha, false) : Promise.resolve(null),
      liveSha ? githubDeployment(client, liveSha, true) : Promise.resolve(null),
    ]);
    return { source: 'github', detail: joinDetail(vercelProblem, DEPLOY_MESSAGES.fromGitHub), draft, live, draftUnknown: null };
  } catch (error) {
    const reason = error instanceof Unavailable ? error.message : DEPLOY_MESSAGES.githubFailed;
    const detail = joinDetail(vercelProblem, reason);
    return { source: 'github', detail, draft: null, live: null, draftUnknown: draftSha ? detail : null };
  }
}

function joinDetail(first: string | null, second: string): string {
  return first ? `${first} ${second}` : second;
}

// ---------------------------------------------------------------------------------------------
// The preview address
// ---------------------------------------------------------------------------------------------

/** Vercel's branch slug: lower case, every run of other characters one hyphen, none at the ends. */
export function branchSlug(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The alias Vercel gives `branch` (<project>-git-<branch slug>-<scope>.vercel.app), worked out from
 * this deployment's own branch alias by swapping the branch slug. Null when this deployment has no
 * alias, or when the result would be longer than a host label may be (Vercel then shortens it).
 */
export function branchAlias(env: Env, branch: string): string | null {
  const host = envValue(env, 'VERCEL_BRANCH_URL')
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  const current = branchSlug(envValue(env, 'VERCEL_GIT_COMMIT_REF'));
  const target = branchSlug(branch);
  if (!host || !current || !target) return null;
  const [label, ...rest] = host.split('.');
  const marker = `-git-${current}-`;
  const at = label.indexOf(marker);
  if (at <= 0 || rest.length === 0) return null;
  const next = `${label.slice(0, at)}-git-${target}-${label.slice(at + marker.length)}`;
  if (next.length > 63 || !/^[a-z0-9-]+$/.test(next)) return null;
  return `https://${[next, ...rest].join('.')}`;
}

/** DRAFT_PREVIEW_URL, a non-secret address the owner may set by hand. */
function configuredPreview(env: Env): string | null {
  const raw = envValue(env, 'DRAFT_PREVIEW_URL');
  if (!raw) return null;
  return httpsAddress(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
}

export interface PreviewResult {
  preview: PreviewInfo | null;
  /** Why there is no address, when there is none. */
  reason: string | null;
}

/**
 * Where the draft branch can be seen: its head's own deployment, else the branch alias, else
 * DRAFT_PREVIEW_URL. Null without a draft branch (on disk).
 */
export function resolvePreview(input: {
  env?: Env;
  draftBranch: string | null;
  draftHead?: string | null;
  draftDeploy?: DeployState | null;
}): PreviewResult {
  if (!input.draftBranch) return { preview: null, reason: null };
  const env = input.env ?? process.env;
  const deploy = input.draftDeploy;
  const own = deploy && deploy.url && input.draftHead && deploy.sha === input.draftHead ? deploy.url : null;
  const url = own ?? branchAlias(env, input.draftBranch) ?? configuredPreview(env);
  return { preview: { branch: input.draftBranch, url }, reason: url ? null : DEPLOY_MESSAGES.previewMissing };
}

/**
 * Why the draft's deployment stops a publish, or null (D-20, D-31). Only a deployment of the draft
 * head itself counts: one that is queued, building, failed, or canceled stops it. When the lookup
 * answered for the head (`headLookedUp`) and found no deployment of it, its preview has not
 * started yet, which stops it too. Only when deploy state cannot be read does nothing stop it.
 */
export function deployBlocksPublish(deploy: DeployState | null, draftHead: string | null, headLookedUp = false): string | null {
  if (!draftHead) return null;
  if (!deploy || deploy.sha !== draftHead) return headLookedUp ? DEPLOY_MESSAGES.notStarted : null;
  if (deploy.state === 'queued' || deploy.state === 'building') return DEPLOY_MESSAGES.stillBuilding;
  if (deploy.state === 'error') return DEPLOY_MESSAGES.buildFailed;
  if (deploy.state === 'canceled') return DEPLOY_MESSAGES.buildCanceled;
  return null;
}
