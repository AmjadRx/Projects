/**
 * GET /api/status: the connection-status panel (ARCHITECTURE.md 7.6 and 11; docs/V3_PLAN.md
 * D-31, D-32). Session required.
 *
 * Names and states only, never a value: whether each variable is set, the GitHub token's kind
 * from its prefix, whether the repository and both branches answer, whether the token can write
 * (only where GitHub's answer shows it), the draft head and its unpublished commits, storage, the
 * content check's setup, and the latest deployment of the draft and the live heads, or why it
 * cannot be read, with the draft's preview address. A problem anywhere is reported in a plain
 * sentence; this route does not fail for it.
 */
import type { StatusResponse } from '@/lib/admin/contract';
import { blocklistState, publicRules } from '@/lib/admin/server/content-check';
import { DEPLOY_MESSAGES, lookupDeploys, resolvePreview, type DeployReport } from '@/lib/admin/server/deploy';
import { ADMIN_VARIABLES, blobStoreHost, githubSettings, isReadOnlyServer, vercelEnv, type Env } from '@/lib/admin/server/env';
import { adminRoute, ApiFailure, json } from '@/lib/admin/server/guard';
import { loginLimitBackend } from '@/lib/admin/server/ratelimit';
import {
  createGitHubClient,
  isValidBranchName,
  normalizeBranchName,
  type GitHubClient,
} from '@/lib/admin/server/repo';
import { storageStatus } from '@/lib/storage';
import { checkDraftBranch } from '@/lib/storage/github';
import { envValue } from '@/lib/storage/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MESSAGES = {
  notConfiguredLocal: 'No GitHub settings: local development reads and writes content/ and public/media/ on this disk.',
  notConfiguredServer:
    'No GitHub settings, and this server cannot write its disk: set GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, and GITHUB_DRAFT_BRANCH.',
  unauthorized: 'GitHub refused the token (401): it is wrong or has expired. Make a new fine-grained token and set GITHUB_TOKEN.',
  notFound: (repo: string) =>
    `GitHub cannot see the repository "${repo}" with this token (404). Check GITHUB_REPO and the token's repository access.`,
  forbidden: 'GitHub refused the request (403): the token lacks a permission, or the rate limit was reached.',
  failed: (status: number) => `GitHub answered ${status} for the repository.`,
  unreachable: 'GitHub could not be reached.',
  noWrite:
    'The account (or app) behind the token cannot push to this repository, so the token cannot write to it either. Give ' +
    'that account write access, or use a token of an account that has it, with Contents: Read and write.',
  archived: 'The repository is archived, so GitHub refuses every write to it. Unarchive it in its settings on GitHub.',
  writeFineGrained:
    'A fine-grained token\'s own permissions cannot be read from GitHub: the permissions it reports for the repository are ' +
    'those of the account that made the token. The first save shows them: if the token may not write, the save is refused, ' +
    'and the message names the permission GitHub asked for. The token needs Contents: Read and write.',
  writeUnknown:
    'Whether this token can write is not known here: the permissions GitHub reports for the repository are those of the ' +
    'account (or app) behind the token, and this check does not read the token\'s own scopes. The first save shows it: if ' +
    'the token may not write, the save is refused, and the message names the call GitHub refused.',
  noLiveBranch: 'GITHUB_BRANCH is not set: there is no default branch.',
  badLiveBranch: 'GITHUB_BRANCH is not a valid branch name.',
  liveMissing: (branch: string) => `The branch "${branch}" named by GITHUB_BRANCH does not exist.`,
  connected: (repo: string, live: string, draft: string, draftExists: boolean) =>
    `Connected to ${repo}: Publish moves "${live}", saves go to "${draft}"${draftExists ? '' : ' (the first save creates it)'}.`,
  // In place of DEPLOY_MESSAGES.previewMissing ("the draft head has no deployment") when the lookup did not find that.
  previewUnread:
    'No preview address yet: the deployment of the draft head could not be read, this deployment has no branch alias ' +
    '(VERCEL_BRANCH_URL), and DRAFT_PREVIEW_URL is not set.',
  previewNoAddress:
    'No preview address yet: the deployment of the draft head has none so far, this deployment has no branch alias ' +
    '(VERCEL_BRANCH_URL), and DRAFT_PREVIEW_URL is not set.',
} as const;

/** A commit id as GitHub writes it: SHA-1, or SHA-256 in a repository that uses it. */
const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The kind of a GitHub token, from its prefix alone. */
function tokenKindOf(token: string): StatusResponse['github']['tokenKind'] {
  if (token.startsWith('github_pat_')) return 'fine-grained';
  if (token.startsWith('ghp_')) return 'classic';
  if (token.startsWith('ghs_') || token.startsWith('ghu_')) return 'app';
  return 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * What GitHub's answer for the repository shows about writing with this token, and the problem it
 * shows, if any. GitHub refuses every write to an archived repository. The `permissions` belong to
 * the account (or app) behind the token, never to the token itself: an account that cannot push
 * leaves every token of it read-only, so "no" is known; "yes" is known only for a classic token on
 * a private repository, which it can see only with the repo scope, and that scope writes. A
 * fine-grained token's own permissions cannot be read from GitHub at all; a save it may not make
 * is refused with the permission GitHub asked for (`expect` in repo.ts).
 */
function writeAccessOf(
  kind: StatusResponse['github']['tokenKind'],
  repository: unknown,
): Pick<StatusResponse['github'], 'writeAccess' | 'writeDetail'> & { problem: string | null } {
  if (isRecord(repository) && repository.archived === true) return { writeAccess: false, writeDetail: null, problem: MESSAGES.archived };
  const permissions = isRecord(repository) && isRecord(repository.permissions) ? repository.permissions : null;
  if (permissions?.push === false) return { writeAccess: false, writeDetail: null, problem: MESSAGES.noWrite };
  if (permissions?.push === true && kind === 'classic' && isRecord(repository) && repository.private === true) {
    return { writeAccess: true, writeDetail: null, problem: null };
  }
  return {
    writeAccess: null,
    writeDetail: kind === 'fine-grained' ? MESSAGES.writeFineGrained : MESSAGES.writeUnknown,
    problem: null,
  };
}

async function headOf(gh: GitHubClient, branch: string): Promise<string | null> {
  const reply = await gh.request('GET', `/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`);
  if (reply.status !== 200 || !isRecord(reply.data) || !isRecord(reply.data.object)) return null;
  const sha = reply.data.object.sha;
  return typeof sha === 'string' && COMMIT_ID.test(sha) ? sha : null;
}

/** The commit ids a compare lists, oldest first; null when the answer has no list. */
function commitsOf(compared: Record<string, unknown>): string[] | null {
  if (!Array.isArray(compared.commits)) return null;
  return compared.commits.flatMap((commit: unknown) =>
    isRecord(commit) && typeof commit.sha === 'string' && COMMIT_ID.test(commit.sha) ? [commit.sha] : [],
  );
}

interface GitHubCheck {
  status: StatusResponse['github'];
  heads: { live: string | null; draft: string | null };
  /** The draft branch when its name is usable. */
  draftBranch: string | null;
}

async function checkGitHub(env: Env): Promise<GitHubCheck> {
  const liveName = normalizeBranchName(envValue(env, 'GITHUB_BRANCH'));
  const draftName = normalizeBranchName(envValue(env, 'GITHUB_DRAFT_BRANCH'));
  const status: StatusResponse['github'] = {
    configured: false,
    ok: false,
    detail: '',
    tokenKind: null,
    repo: null,
    liveBranch: liveName || null,
    draftBranch: draftName || null,
    liveExists: false,
    draftExists: false,
    draftHead: null,
    draftCommits: null,
    writeAccess: null,
    writeDetail: null,
    ahead: null,
    behind: null,
  };
  const heads: GitHubCheck['heads'] = { live: null, draft: null };

  let settings;
  try {
    settings = githubSettings(env);
  } catch (error) {
    status.detail = error instanceof Error ? error.message : MESSAGES.unreachable;
    return { status, heads, draftBranch: null };
  }
  if (!settings) {
    status.detail = isReadOnlyServer(env) ? MESSAGES.notConfiguredServer : MESSAGES.notConfiguredLocal;
    return { status, heads, draftBranch: null };
  }
  status.configured = true;
  status.tokenKind = tokenKindOf(settings.token);
  status.repo = settings.repo;

  // Problems with the branch settings, found without asking GitHub.
  const problems: string[] = [];
  let draftBranch: string | null = null;
  try {
    draftBranch = checkDraftBranch(settings);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : MESSAGES.unreachable);
  }
  const liveUsable = liveName !== '' && isValidBranchName(liveName);
  if (liveName === '') problems.push(MESSAGES.noLiveBranch);
  else if (!liveUsable) problems.push(MESSAGES.badLiveBranch);

  const gh = createGitHubClient(settings, undefined, { timeoutMs: 8_000 });
  let writeProblem: string | null = null;
  try {
    const repoReply = await gh.request('GET', '');
    if (repoReply.status !== 200) {
      status.detail =
        repoReply.status === 401
          ? MESSAGES.unauthorized
          : repoReply.status === 404
            ? MESSAGES.notFound(settings.repo)
            : repoReply.status === 403
              ? MESSAGES.forbidden
              : MESSAGES.failed(repoReply.status);
      return { status, heads, draftBranch };
    }
    const write = writeAccessOf(status.tokenKind, repoReply.data);
    status.writeAccess = write.writeAccess;
    status.writeDetail = write.writeDetail;
    writeProblem = write.problem;

    const [live, draft] = await Promise.all([
      liveUsable ? headOf(gh, liveName) : Promise.resolve(null),
      draftBranch ? headOf(gh, draftBranch) : Promise.resolve(null),
    ]);
    heads.live = live;
    heads.draft = draft;
    status.liveExists = live !== null;
    status.draftExists = draft !== null;
    status.draftHead = draft;
    if (live && draft) {
      if (live === draft) {
        status.ahead = 0;
        status.behind = 0;
        status.draftCommits = [];
      } else {
        const compared = await gh.request('GET', `/compare/${live}...${draft}`);
        if (compared.status === 200 && isRecord(compared.data)) {
          const { ahead_by: ahead, behind_by: behind } = compared.data;
          status.ahead = typeof ahead === 'number' ? ahead : null;
          status.behind = typeof behind === 'number' ? behind : null;
          status.draftCommits = commitsOf(compared.data);
        }
      }
    }
  } catch (error) {
    // Only the guard's own failures carry a sentence written for the owner.
    status.detail = error instanceof ApiFailure ? error.message : MESSAGES.unreachable;
    return { status, heads, draftBranch };
  }

  if (writeProblem) problems.push(writeProblem);
  if (liveUsable && !status.liveExists) problems.push(MESSAGES.liveMissing(liveName));
  status.ok = problems.length === 0;
  status.detail =
    problems.length > 0 ? problems.join(' ') : MESSAGES.connected(settings.repo, liveName, draftBranch ?? draftName, status.draftExists);
  return { status, heads, draftBranch };
}

/**
 * Why the live head's build state could not be read; null when the deploy lookup answered for it,
 * and when there is no live head. Vercel's list answers for both heads at once. GitHub's lookup
 * reads both heads together, and when it fails, its detail ends with why instead of where deploy
 * state comes from.
 */
function liveUnknownOf(deploys: DeployReport, liveHead: string | null): string | null {
  if (!liveHead || deploys.source === 'vercel') return null;
  if (deploys.source === 'github' && deploys.detail.endsWith(DEPLOY_MESSAGES.fromGitHub)) return null;
  return deploys.detail;
}

/** Why the draft has no preview address: the head "has no deployment" only when the lookup found none. */
function previewReason(reason: string | null, deploys: DeployReport, draftHead: string | null): string | null {
  if (reason !== DEPLOY_MESSAGES.previewMissing) return reason;
  if (deploys.draftUnknown) return MESSAGES.previewUnread;
  return draftHead && deploys.draft?.sha === draftHead ? MESSAGES.previewNoAddress : reason;
}

export const GET = adminRoute({}, async ({ env, session }) => {
  const github = await checkGitHub(env);
  const storage = storageStatus(env);
  const blocklist = blocklistState(env);

  const deploys = await lookupDeploys({
    env,
    heads: github.heads,
    liveBranch: github.status.liveExists ? github.status.liveBranch : null,
    draftBranch: github.draftBranch,
  });
  const preview = github.draftBranch
    ? github.heads.draft
      ? resolvePreview({ env, draftBranch: github.draftBranch, draftHead: github.heads.draft, draftDeploy: deploys.draft })
      : { preview: { branch: github.draftBranch, url: null }, reason: null }
    : { preview: null, reason: null };
  // The detail says why the draft head cannot be read when that is not already its own sentence.
  const detail = [
    deploys.detail,
    deploys.draftUnknown && deploys.draftUnknown !== deploys.detail ? deploys.draftUnknown : null,
    previewReason(preview.reason, deploys, github.heads.draft),
  ].filter(Boolean);

  const body: StatusResponse = {
    ok: true,
    runtime: {
      vercelEnv: vercelEnv(env),
      branch: envValue(env, 'VERCEL_GIT_COMMIT_REF') || null,
      commit: envValue(env, 'VERCEL_GIT_COMMIT_SHA') || null,
      node: process.version,
    },
    env: ADMIN_VARIABLES.map((variable) => ({
      name: variable.name,
      present: envValue(env, variable.name) !== '',
      required: variable.required,
      note: variable.note,
    })),
    github: github.status,
    storage: {
      repo: { target: storage.repo.target, problem: storage.repo.problem },
      blob: { configured: storage.blob.configured, host: blobStoreHost(env) },
      limits: storage.limits,
    },
    contentCheck: { publicRules: publicRules().length, blocklistSet: blocklist.set, failClosed: blocklist.failClosed },
    deploy: {
      source: deploys.source,
      detail: detail.join(' '),
      draft: deploys.draft,
      live: deploys.live,
      draftUnknown: deploys.draftUnknown,
      liveUnknown: liveUnknownOf(deploys, github.heads.live),
    },
    preview: preview.preview,
    session: { expiresAt: session!.expiresAt },
    security: securityStatus(env),
  };
  return json(body);
});

/**
 * Where the login lockout counts attempts on this request, and which address it counts: the
 * owner asked for the store to be named, so a per-instance fallback is never silent.
 */
function securityStatus(env: Env): NonNullable<StatusResponse['security']> {
  const store = loginLimitBackend();
  const onVercel = envValue(env, 'VERCEL') !== '';
  const region = envValue(env, 'VERCEL_REGION');
  const where = region ? ` in region ${region}` : '';
  return {
    loginLimit: store,
    address: onVercel ? 'x-real-ip' : 'local',
    detail:
      store === 'runtime-cache'
        ? `Login attempts are counted in Vercel Runtime Cache${where}, shared by every instance of this function there; the address is x-real-ip, which Vercel sets.`
        : onVercel
          ? 'Login attempts are counted in this instance\'s memory only: Vercel did not provide Runtime Cache to this request, so another instance starts its own count. The firewall rule on POST /api/auth still limits sign-ins.'
          : 'Login attempts are counted in this server\'s memory (local development); every request shares one local count.',
  };
}
