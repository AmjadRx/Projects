import { NextResponse, type NextRequest } from 'next/server';
import { getStore } from '@netlify/blobs';
import type { Content } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const password = req.headers.get('x-admin-password') ?? '';
  const expected = process.env.ADMIN_PASSWORD ?? '';

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'ADMIN_PASSWORD is not configured on the server.' },
      { status: 500 },
    );
  }
  if (!password || password !== expected) {
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
