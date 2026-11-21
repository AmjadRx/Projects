/**
 * POST { src, name }: renames a media file (docs/V3_PLAN.md D-25). The extension never changes,
 * the new name is cleaned and content-checked, and a name already in the folder is refused. A
 * repository file moves in one commit that also rewrites every draft reference; a Blob file is
 * copied under the new name, the draft references are rewritten in one commit, and the old object
 * stays until a publish leaves nothing that uses it (D-27). The work is in
 * lib/admin/server/media.ts.
 */
import { MAX_JSON_BODY_BYTES, MediaRenameBody } from '@/lib/admin/contract';
import { adminRoute, json, readJson } from '@/lib/admin/server/guard';
import { renameMedia } from '@/lib/admin/server/media';
import { getContentRepo } from '@/lib/admin/server/repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = adminRoute({}, async ({ req, env }) => {
  const body = await readJson(req, MediaRenameBody, MAX_JSON_BODY_BYTES);
  return json(await renameMedia({ repo: getContentRepo(env), env }, body));
});
