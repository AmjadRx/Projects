import { NextResponse, type NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { sessionValid } from '@/lib/auth';
import { ghConfigured, ghDeleteFile, ghPutFile } from '@/lib/github';
import { ProjectSchema, SiteSchema } from '@/lib/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SITE_PATH = 'content/site.json';
const PROJECT_RE = /^content\/projects\/[a-z0-9-]+\.json$/;

interface SaveBody {
  files?: { path: string; data: unknown }[];
  deletes?: string[];
}

function validPath(p: string): boolean {
  return p === SITE_PATH || PROJECT_RE.test(p);
}

export async function POST(req: NextRequest) {
  if (!sessionValid(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: SaveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const files = body.files ?? [];
  const deletes = body.deletes ?? [];
  if (!files.length && !deletes.length) {
    return NextResponse.json({ ok: false, error: 'Nothing to save' }, { status: 400 });
  }

  // Validate paths + content shape
  const prepared: { path: string; json: string }[] = [];
  for (const f of files) {
    if (!validPath(f.path)) {
      return NextResponse.json({ ok: false, error: `Invalid path: ${f.path}` }, { status: 400 });
    }
    const schema = f.path === SITE_PATH ? SiteSchema : ProjectSchema;
    const parsed = schema.safeParse(f.data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        { ok: false, error: `${f.path}: ${issue.path.join('.')} ${issue.message}` },
        { status: 400 },
      );
    }
    prepared.push({ path: f.path, json: JSON.stringify(parsed.data, null, 2) + '\n' });
  }
  for (const d of deletes) {
    if (!validPath(d) || d === SITE_PATH) {
      return NextResponse.json({ ok: false, error: `Invalid delete: ${d}` }, { status: 400 });
    }
  }

  try {
    if (ghConfigured()) {
      for (const f of prepared) {
        await ghPutFile(f.path, Buffer.from(f.json), `content: update ${f.path.replace('content/', '').replace('.json', '')}`);
      }
      for (const d of deletes) {
        await ghDeleteFile(d, `content: remove ${d.replace('content/', '').replace('.json', '')}`);
      }
      return NextResponse.json({
        ok: true,
        mode: 'github',
        savedAt: new Date().toISOString(),
        committed: prepared.length + deletes.length,
      });
    }

    // Production servers have a read-only filesystem; saving requires the GitHub CMS.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        {
          ok: false,
          error:
            'GitHub CMS is not configured. Open Settings in this admin for a live diagnosis, or set GITHUB_TOKEN and GITHUB_REPO in your hosting dashboard and redeploy.',
        },
        { status: 503 },
      );
    }

    // Dev fallback: local filesystem
    for (const f of prepared) {
      const abs = path.join(process.cwd(), f.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.json);
    }
    for (const d of deletes) {
      const abs = path.join(process.cwd(), d);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }
    return NextResponse.json({
      ok: true,
      mode: 'fs',
      savedAt: new Date().toISOString(),
      committed: prepared.length + deletes.length,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
