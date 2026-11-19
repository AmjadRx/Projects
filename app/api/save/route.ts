/**
 * POST /api/save (ARCHITECTURE.md 7.1, 7.2, and 11; docs/V3_PLAN.md D-17 to D-20, D-76): checks
 * the paths, the schema, and the whole content after the save, then makes one commit on the draft
 * branch (or writes the files in local development). Session and Origin required; the body is a
 * `SaveBody`. The steps and their answers are in lib/admin/server/save.ts.
 */
import { MAX_SAVE_BODY_BYTES, SaveBody } from '@/lib/admin/contract';
import { adminRoute, json, readJson } from '@/lib/admin/server/guard';
import { saveContent } from '@/lib/admin/server/save';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = adminRoute({}, async ({ req, env }) => {
  const body = await readJson(req, SaveBody, MAX_SAVE_BODY_BYTES);
  return json(await saveContent(body, { env }));
});
