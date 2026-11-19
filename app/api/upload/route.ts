/**
 * The media library (ARCHITECTURE.md 11 "Uploads" and "Paths", 13A; docs/V3_PLAN.md D-23 to D-27).
 *
 * GET ?folder=<folder>[&refs=1]: the folder's files in the repository (draft branch) and in Vercel
 * Blob, with reference counts in the draft and the published content when `refs=1`. A folder is
 * "site", a project saved on the draft, or a folder that already holds files in either store (the
 * files of a renamed or deleted project).
 * GET ?folders=1: every media folder that exists in either store, with the project or "site" that
 * owns it (null when no saved project does) and its number of files (MediaFoldersResponse).
 * POST (multipart/form-data, UploadFields plus one or more "file" parts of at most 4 MB each):
 * each file is checked from its bytes, cleaned, and content-checked; all of them become one commit
 * on the draft branch. Larger files go to Blob through ./token and ./confirm.
 * DELETE { src }: removes a file that the draft no longer uses (and, for Blob, that the published
 * site no longer uses either); otherwise 409 'referenced' lists the fields.
 *
 * Every method needs a session; POST and DELETE also check the Origin. The work is in
 * lib/admin/server/media.ts.
 */
import { MAX_JSON_BODY_BYTES, MAX_REPO_UPLOAD_BODY_BYTES, MediaDeleteBody } from '@/lib/admin/contract';
import { adminRoute, json, readForm, readJson } from '@/lib/admin/server/guard';
import { deleteMedia, listFolders, listMedia, uploadMedia } from '@/lib/admin/server/media';
import { getContentRepo } from '@/lib/admin/server/repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = adminRoute({}, async ({ req, env }) => {
  const params = req.nextUrl.searchParams;
  const ctx = { repo: getContentRepo(env), env };
  if (params.get('folders') === '1') return json(await listFolders(ctx));
  return json(await listMedia(ctx, params));
});

export const POST = adminRoute({}, async ({ req, env }) => {
  const form = await readForm(req, MAX_REPO_UPLOAD_BODY_BYTES);
  return json(await uploadMedia({ repo: getContentRepo(env), env }, form));
});

export const DELETE = adminRoute({}, async ({ req, env }) => {
  const body = await readJson(req, MediaDeleteBody, MAX_JSON_BODY_BYTES);
  return json(await deleteMedia({ repo: getContentRepo(env), env }, body));
});
