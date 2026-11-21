/**
 * POST { folder, name, size, contentType }: a single-use browser upload to Vercel Blob for a file
 * over 4 MB (ARCHITECTURE.md 11 "Uploads"; docs/V3_PLAN.md D-23, D-26). The client token allows
 * one fixed pathname, no overwrite, one type, and at most `size` bytes for an hour; the signed
 * ticket goes back to ./confirm with the upload. A refused or deleted upload leaves a placeholder
 * at the pathname until the token has expired, so the token can store one file, once. Never for
 * SVG. 503 with the missing variable when Blob is not set up. The work is in
 * lib/admin/server/media.ts.
 */
import { BlobTokenBody, MAX_JSON_BODY_BYTES } from '@/lib/admin/contract';
import { adminRoute, json, readJson } from '@/lib/admin/server/guard';
import { issueBlobToken } from '@/lib/admin/server/media';
import { getContentRepo } from '@/lib/admin/server/repo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = adminRoute({}, async ({ req, env }) => {
  const body = await readJson(req, BlobTokenBody, MAX_JSON_BODY_BYTES);
  return json(await issueBlobToken({ repo: getContentRepo(env), env }, body));
});
