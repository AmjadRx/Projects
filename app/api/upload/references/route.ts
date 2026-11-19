/**
 * GET ?src=: every field in the draft and in the published content that refers to a media file
 * (docs/V3_PLAN.md D-25, D-27), so the admin can list them before a delete or a rename. The work
 * is in lib/admin/server/media.ts and lib/admin/server/references.ts.
 */
import { adminRoute, json } from '@/lib/admin/server/guard';
import { mediaReferences } from '@/lib/admin/server/media';
import { getContentRepo } from '@/lib/admin/server/repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = adminRoute({}, async ({ req, env }) => {
  return json(await mediaReferences({ repo: getContentRepo(env), env }, req.nextUrl.searchParams.get('src')));
});
