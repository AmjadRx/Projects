/**
 * Publish (ARCHITECTURE.md 7.1; docs/V3_PLAN.md D-18, D-20, D-27, Q-30, 5.7, R-07). Session
 * required; POST also checks the Origin and reads a `PublishBody`.
 *
 * GET: what a publish would do (`PublishPlan`): the draft's commits and files the live branch
 * lacks, the Blob addresses the draft adds or drops, the draft's latest deployment, and whether
 * Publish is allowed, with the reasons in plain sentences when it is not. The draft head's build
 * must have finished: Publish waits while it is queued or building, and stops when it failed, was
 * canceled, or has not started yet; only when deploy state cannot be read at all does Publish go
 * ahead without it, and `deployDetail` says so.
 *
 * POST: fast-forwards the live branch to the draft head the owner saw in the confirmation. It is
 * refused when the draft changed since (409 conflict), when the branches have diverged (409
 * diverged), and for every other reason in the plan (403 not-allowed), including any write to
 * main outside the production deployment. Nothing else is written.
 */
import {
  MAX_JSON_BODY_BYTES,
  PublishBody,
  type DeployState,
  type PublishPlan,
  type PublishResponse,
} from '@/lib/admin/contract';
import { DEPLOY_MESSAGES, deployBlocksPublish, lookupDeploys } from '@/lib/admin/server/deploy';
import { mayPublishTo, type Env } from '@/lib/admin/server/env';
import { adminRoute, ApiFailure, json, readJson } from '@/lib/admin/server/guard';
import { getContentRepo, REPO_MESSAGES, type ContentRepo, type ContentSnapshot } from '@/lib/admin/server/repo';
import { stringValues } from '@/lib/lint';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MESSAGES = {
  noDraft: 'There is no draft yet: save a change first.',
  nothing: 'Nothing to publish: the live site already has every change on the draft.',
  staleHead: 'The draft changed after you opened the dialog. Review it again.',
} as const;

/** A Vercel Blob address, up to the first character that cannot be part of one in text or Markdown. */
const BLOB_ADDRESS = /https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^\s"'<>()[\]]+/gi;

/** Every Blob address in the string values of the content files. */
function blobAddresses(snapshot: ContentSnapshot): Set<string> {
  const out = new Set<string>();
  for (const file of snapshot.files) {
    let data: unknown;
    try {
      data = JSON.parse(file.text);
    } catch {
      continue;
    }
    for (const { text } of stringValues(data)) {
      for (const match of text.matchAll(BLOB_ADDRESS)) out.add(match[0].replace(/[.,;:!?]+$/, ''));
    }
  }
  return out;
}

function githubOnly(repo: ContentRepo): { liveBranch: string; draftBranch: string } {
  if (repo.source !== 'github' || !repo.liveBranch || !repo.draftBranch) {
    throw new ApiFailure(409, 'not-allowed', REPO_MESSAGES.noDraftOnDisk);
  }
  return { liveBranch: repo.liveBranch, draftBranch: repo.draftBranch };
}

async function planOf(
  repo: ContentRepo,
  env: Env,
  heads: { live: string | null; draft: string | null },
  options: { blob: boolean },
): Promise<PublishPlan> {
  const { liveBranch, draftBranch } = githubOnly(repo);
  if (!heads.live) {
    throw new ApiFailure(503, 'not-configured', REPO_MESSAGES.liveMissing(liveBranch), { missing: ['GITHUB_BRANCH'] });
  }
  const reasons: string[] = [];
  let ahead = 0;
  let behind = 0;
  let files: PublishPlan['files'] = [];
  let blob: PublishPlan['blob'] = { added: [], removed: [] };
  let deploy: DeployState | null = null;
  let deployDetail: string | null = null;

  if (!heads.draft) {
    reasons.push(MESSAGES.noDraft);
  } else {
    if (heads.draft !== heads.live) {
      const state = await repo.compare(heads.live, heads.draft);
      ahead = state.ahead;
      behind = state.behind;
      files = state.files;
    }
    if (ahead === 0) reasons.push(MESSAGES.nothing);
    else if (behind > 0) reasons.push(REPO_MESSAGES.diverged);
    if (options.blob && ahead > 0) {
      const [draft, live] = await Promise.all([repo.readContent('draft'), repo.readContent('live')]);
      const inDraft = blobAddresses(draft);
      const inLive = blobAddresses(live);
      blob = {
        added: [...inDraft].filter((address) => !inLive.has(address)).sort(),
        removed: [...inLive].filter((address) => !inDraft.has(address)).sort(),
      };
    }
    const report = await lookupDeploys({ env, heads, liveBranch, draftBranch, only: 'draft' });
    deploy = report.draft;
    const blocked = deployBlocksPublish(deploy, heads.draft, report.draftUnknown === null);
    if (blocked) reasons.push(blocked);
    if (report.draftUnknown !== null) deployDetail = DEPLOY_MESSAGES.unread(report.draftUnknown);
  }
  if (!mayPublishTo(liveBranch, env)) reasons.push(REPO_MESSAGES.publishOutsideProduction);

  return {
    ok: true,
    liveBranch,
    draftBranch,
    liveHead: heads.live,
    draftHead: heads.draft,
    ahead,
    behind,
    diverged: ahead > 0 && behind > 0,
    files,
    blob,
    deploy,
    deployDetail,
    allowed: reasons.length === 0,
    reasons,
  };
}

export const GET = adminRoute({}, async ({ env }) => {
  const repo = getContentRepo(env);
  githubOnly(repo);
  return json(await planOf(repo, env, await repo.heads(), { blob: true }));
});

export const POST = adminRoute({}, async ({ req, env }) => {
  const { draftHead } = await readJson(req, PublishBody, MAX_JSON_BODY_BYTES);
  const repo = getContentRepo(env);
  githubOnly(repo);
  const heads = await repo.heads();
  if (heads.draft !== draftHead) throw new ApiFailure(409, 'conflict', MESSAGES.staleHead);
  const plan = await planOf(repo, env, heads, { blob: false });
  if (!plan.allowed) {
    if (plan.diverged) throw new ApiFailure(409, 'diverged', plan.reasons.join(' '));
    throw new ApiFailure(403, 'not-allowed', plan.reasons.join(' '));
  }
  await repo.fastForwardLive(draftHead);
  const body: PublishResponse = { ok: true, liveHead: draftHead };
  return json(body);
});
