/**
 * POST /api/check (ARCHITECTURE.md 12; docs/V3_PLAN.md D-19, D-24, D-76): runs the public patterns,
 * then the private CONTENT_BLOCKLIST terms, over text the admin took from a file before uploading
 * it (a PDF's or a Word file's words and properties, a model's part names). Session and Origin
 * required; the body is a `CheckBody`. Every hit is an error under the file's name and the item's
 * label; a private-term hit names its rule, never the term. Without CONTENT_BLOCKLIST on Vercel or
 * in CI the answer is 503.
 */
import { CheckBody, MAX_CHECK_TEXT_BYTES, type CheckResponse } from '@/lib/admin/contract';
import { checkTexts, requireBlocklist } from '@/lib/admin/server/content-check';
import { adminRoute, json, readJson } from '@/lib/admin/server/guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = adminRoute({}, async ({ req, env }) => {
  const body = await readJson(req, CheckBody, MAX_CHECK_TEXT_BYTES);
  const blocklist = requireBlocklist(env);
  const response: CheckResponse = { ok: true, findings: checkTexts(body.source, body.items, blocklist) };
  return json(response);
});
