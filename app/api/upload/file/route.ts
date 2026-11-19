/**
 * GET ?src=/media/<folder>/<name>: a repository media file from the draft branch (or the live
 * branch while there is no draft), so the admin can show files that are not published yet
 * (docs/V3_PLAN.md D-17). Session only; never cached; the type comes from the bytes; served with
 * `nosniff` and a sandboxing policy, so an SVG drawing opened on its own can run nothing; one byte
 * range is honoured for video and audio. The work is in lib/admin/server/media.ts.
 */
import { adminRoute } from '@/lib/admin/server/guard';
import { mediaFileResponse } from '@/lib/admin/server/media';
import { getContentRepo } from '@/lib/admin/server/repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = adminRoute({}, async ({ req, env }) => {
  return mediaFileResponse({ repo: getContentRepo(env), env }, req.nextUrl.searchParams.get('src'), req.headers.get('range'));
});
