/**
 * POST { pathname, url, ticket }: confirms a browser upload to Vercel Blob (ARCHITECTURE.md 11
 * "Uploads"; docs/V3_PLAN.md D-24, D-26). The ticket must be this server's, unexpired, and for this
 * pathname; the stored file must be larger than 4 MB and no larger than allowed, its bytes must be
 * the type its name says, an image must carry no metadata, and its name (and a GLB model's names)
 * must pass the content check. A file that fails is replaced by a small placeholder, which the
 * upload's token can never overwrite, and which the library hides and removes once the token has
 * expired. The work is in lib/admin/server/media.ts.
 */
import { BlobConfirmBody, MAX_JSON_BODY_BYTES } from '@/lib/admin/contract';
import { adminRoute, json, readJson } from '@/lib/admin/server/guard';
import { confirmBlobUpload } from '@/lib/admin/server/media';
import { getContentRepo } from '@/lib/admin/server/repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** A large image is read through once to confirm that it carries no metadata; a large model's names are all checked. */
export const maxDuration = 300;

export const POST = adminRoute({}, async ({ req, env }) => {
  const body = await readJson(req, BlobConfirmBody, MAX_JSON_BODY_BYTES);
  return json(await confirmBlobUpload({ repo: getContentRepo(env), env }, body));
});
