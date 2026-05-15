import { NextResponse, type NextRequest } from 'next/server';
import { getStore } from '@netlify/blobs';
import type { Content } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FALLBACK_PASSWORD = 'AMRx(2004)SCU';

function isAuthorized(provided: string): boolean {
  if (!provided) return false;
  if (provided === FALLBACK_PASSWORD) return true;
  const env = process.env.ADMIN_PASSWORD;
  if (env && env.length > 0 && provided === env) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const password = req.headers.get('x-admin-password') ?? '';

  if (!isAuthorized(password)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Content;
  try {
    payload = (await req.json()) as Content;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object' || !payload.personal) {
    return NextResponse.json({ ok: false, error: 'Invalid content shape' }, { status: 400 });
  }

  const stamped: Content = {
    ...payload,
    lastUpdated: new Date().toISOString().slice(0, 10),
  };

  try {
    const store = getStore({ name: 'portfolio-content', consistency: 'strong' });
    await store.setJSON('main', stamped);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message ?? 'Save failed' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, savedAt: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export function GET() {
  return NextResponse.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
}
