import { NextResponse, type NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { sessionValid } from '@/lib/auth';
import { ghConfigured, ghDeleteFile, ghListDir, ghPutFile } from '@/lib/github';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IMAGE_MAX = 8 * 1024 * 1024;
const VIDEO_MAX = 25 * 1024 * 1024;
const SCOPE_RE = /^[a-z0-9-]+$/;

function sanitizeName(name: string): string {
  const ext = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const base = path
    .basename(name, path.extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${base || 'file'}${ext}`;
}

/** GET ?scope=slug — list media files for a scope. */
export async function GET(req: NextRequest) {
  if (!sessionValid(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const scope = req.nextUrl.searchParams.get('scope') ?? '';
  if (!SCOPE_RE.test(scope)) return NextResponse.json({ error: 'Bad scope' }, { status: 400 });

  try {
    if (ghConfigured()) {
      const entries = await ghListDir(`public/media/${scope}`);
      return NextResponse.json({
        files: entries
          .filter((e) => e.type === 'file' && e.name !== '.gitkeep')
          .map((e) => ({ name: e.name, src: `/media/${scope}/${e.name}`, size: e.size })),
      });
    }
    const dir = path.join(process.cwd(), 'public', 'media', scope);
    if (!fs.existsSync(dir)) return NextResponse.json({ files: [] });
    const files = fs
      .readdirSync(dir)
      .filter((f) => f !== '.gitkeep')
      .map((f) => ({
        name: f,
        src: `/media/${scope}/${f}`,
        size: fs.statSync(path.join(dir, f)).size,
      }));
    return NextResponse.json({ files });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** POST multipart — upload a file into public/media/{scope}/. */
export async function POST(req: NextRequest) {
  if (!sessionValid(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }
  const file = form.get('file');
  const scope = String(form.get('scope') ?? '');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  if (!SCOPE_RE.test(scope)) return NextResponse.json({ error: 'Bad scope' }, { status: 400 });

  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) {
    return NextResponse.json({ error: 'Only image and video files allowed' }, { status: 400 });
  }
  if (isImage && file.size > IMAGE_MAX) {
    return NextResponse.json({ error: 'Image exceeds 8 MB limit' }, { status: 400 });
  }
  if (isVideo && file.size > VIDEO_MAX) {
    return NextResponse.json(
      { error: 'Video exceeds 25 MB. Paste a YouTube or Vimeo link instead.' },
      { status: 400 },
    );
  }

  const name = sanitizeName(file.name);
  const rel = `public/media/${scope}/${name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    if (ghConfigured()) {
      await ghPutFile(rel, buffer, `media: upload ${scope}/${name}`);
    } else {
      const abs = path.join(process.cwd(), rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buffer);
    }
    return NextResponse.json({
      ok: true,
      src: `/media/${scope}/${name}`,
      kind: isVideo ? 'video' : 'image',
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** DELETE {src} — remove a media file. */
export async function DELETE(req: NextRequest) {
  if (!sessionValid(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { src?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const src = body.src ?? '';
  const m = src.match(/^\/media\/([a-z0-9-]+)\/([a-z0-9.-]+)$/);
  if (!m) return NextResponse.json({ error: 'Bad src' }, { status: 400 });

  const rel = `public${src}`;
  try {
    if (ghConfigured()) {
      await ghDeleteFile(rel, `media: remove ${m[1]}/${m[2]}`);
    } else {
      const abs = path.join(process.cwd(), rel);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
