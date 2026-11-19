/**
 * POST /api/discard (ARCHITECTURE.md 7.1; docs/V3_PLAN.md D-20, D-27): resets the draft branch to
 * the live head, dropping every unpublished save. Session and Origin required; the body is a
 * `DiscardBody`: `{ "confirm": true, "draftHead": <the draft head the confirmation showed> }`.
 * When the draft is no longer that head (a save from another window landed after the dialog
 * opened), nothing is reset and the answer is 409 conflict, so no save is discarded unseen; the
 * ref is read once more just before the forced update. Blob files stay where they are (D-27). In
 * local development there is no draft branch, so this answers 409.
 */
import { DiscardBody, MAX_JSON_BODY_BYTES, type DiscardResponse } from '@/lib/admin/contract';
import { adminRoute, ApiFailure, json, readJson } from '@/lib/admin/server/guard';
import { getContentRepo, REPO_MESSAGES } from '@/lib/admin/server/repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = adminRoute({}, async ({ req, env }) => {
  const { draftHead } = await readJson(req, DiscardBody, MAX_JSON_BODY_BYTES);
  const repo = getContentRepo(env);
  if (repo.source !== 'github' || !repo.liveBranch) throw new ApiFailure(409, 'not-allowed', REPO_MESSAGES.noDraftOnDisk);
  const heads = await repo.heads();
  if (!heads.live) {
    throw new ApiFailure(503, 'not-configured', REPO_MESSAGES.liveMissing(repo.liveBranch), { missing: ['GITHUB_BRANCH'] });
  }
  if (heads.draft !== draftHead) throw new ApiFailure(409, 'conflict', REPO_MESSAGES.draftMoved);
  if (heads.draft && heads.draft !== heads.live) await repo.resetDraft(heads.live, draftHead);
  const body: DiscardResponse = { ok: true, head: heads.live };
  return json(body);
});
