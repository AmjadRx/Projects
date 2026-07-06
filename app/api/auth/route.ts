import { NextResponse, type NextRequest } from 'next/server';
import { passwordValid, sessionCookieHeader, sessionValid } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }
  if (!passwordValid(body.password ?? '')) {
    return NextResponse.json({ ok: false, error: 'Incorrect password' }, { status: 401 });
  }
  return NextResponse.json(
    { ok: true },
    { headers: { 'Set-Cookie': sessionCookieHeader() } },
  );
}

export async function GET(req: NextRequest) {
  if (!sessionValid(req)) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  return NextResponse.json(
    { ok: true },
    { headers: { 'Set-Cookie': sessionCookieHeader(true) } },
  );
}
