/**
 * GET /api/content (ARCHITECTURE.md 7.1 and 7.5; docs/V3_PLAN.md D-16 to D-18). Session required.
 *
 * - No query: every content file from the draft branch, or from the live branch while there is no
 *   draft, as stored: `data` is parsed from the stored text and never passed through zod, so key
 *   order and empty strings survive. Files that fail schema version 3 still come back, with SCHEMA
 *   findings. With the heads, the branch names, how far the draft is ahead, and the preview.
 * - `?ref=live&path=<content path>`: one file as published, for "Revert this file to published"
 *   (`data` is null when the file is not on the live branch).
 * Local development without GitHub variables reads the working tree's content/.
 */
import {
  isContentPath,
  SITE_FILE,
  type ContentResponse,
  type Finding,
  type PublishedFileResponse,
} from '@/lib/admin/contract';
import { lookupDeploys, resolvePreview } from '@/lib/admin/server/deploy';
import { adminRoute, ApiFailure, json } from '@/lib/admin/server/guard';
import { getContentRepo, pathFailure } from '@/lib/admin/server/repo';
import { validateContent } from '@/lib/lint';
import { ProjectSchema, SiteSchema } from '@/lib/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MESSAGES = {
  badRef: 'Only ref=live is supported, with a content path.',
  siteMissing: 'content/site.json was not found on the branch.',
  notJson: 'This stored file is not valid JSON.',
} as const;

export const GET = adminRoute({}, async ({ req, env }) => {
  const params = req.nextUrl.searchParams;
  const ref = params.get('ref');
  const path = params.get('path');
  const repo = getContentRepo(env);

  if (ref !== null || path !== null) {
    if (ref !== 'live') throw new ApiFailure(400, 'bad-request', MESSAGES.badRef);
    if (path === null || !isContentPath(path)) throw pathFailure(path ?? '', 'The admin reads only content/site.json and content/projects/<slug>.json here.');
    const bytes = await repo.readFile('live', path);
    let data: unknown = null;
    if (bytes) {
      try {
        data = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new ApiFailure(422, 'invalid-file', MESSAGES.notJson);
      }
    }
    const body: PublishedFileResponse = { ok: true, file: path, data };
    return json(body);
  }

  const heads = await repo.heads();
  const snapshot = await repo.readContent();
  const findings: Finding[] = [];
  const parsed = snapshot.files.map((file) => {
    try {
      return { file: file.path, data: JSON.parse(file.text) as unknown };
    } catch {
      findings.push({ file: file.path, path: '(file)', rule: 'SCHEMA', message: MESSAGES.notJson, severity: 'error' });
      return { file: file.path, data: null };
    }
  });
  const site = parsed.find((file) => file.file === SITE_FILE);
  if (!site) throw new ApiFailure(500, 'server', MESSAGES.siteMissing);
  const projects = parsed.filter((file) => file.file !== SITE_FILE);
  const { findings: invalid } = validateContent(
    { site, projects: projects.filter((file) => file.data !== null) },
    { SiteSchema, ProjectSchema },
  );
  findings.push(...invalid);

  let draftAhead = 0;
  if (heads.live && heads.draft && heads.live !== heads.draft) draftAhead = (await repo.compare(heads.live, heads.draft)).ahead;

  // The draft's preview exists only once the draft branch does (the first save creates it).
  let preview: ContentResponse['preview'] = repo.draftBranch ? { branch: repo.draftBranch, url: null } : null;
  if (repo.draftBranch && heads.draft) {
    const deploys = await lookupDeploys({ env, heads, liveBranch: repo.liveBranch, draftBranch: repo.draftBranch, only: 'draft' });
    preview = resolvePreview({ env, draftBranch: repo.draftBranch, draftHead: heads.draft, draftDeploy: deploys.draft }).preview;
  }

  const body: ContentResponse = {
    ok: true,
    source: snapshot.source,
    ref: snapshot.ref,
    head: snapshot.head,
    liveHead: heads.live,
    draftExists: heads.draft !== null,
    draftAhead,
    liveBranch: repo.liveBranch,
    draftBranch: repo.draftBranch,
    site,
    projects,
    findings,
    preview,
  };
  return json(body);
});
