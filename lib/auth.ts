import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

export const SESSION_COOKIE = 'amr_admin';

/** Admin auth requires the ADMIN_PASSWORD env var. There is no fallback. */
export function authConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function secret(): string {
  return process.env.ADMIN_PASSWORD ?? '';
}

export function passwordValid(provided: string): boolean {
  if (!provided || !authConfigured()) return false;
  const expected = secret();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function sessionToken(): string {
  return createHmac('sha256', secret()).update('amr-admin-session-v2').digest('hex');
}

export function sessionValid(req: NextRequest): boolean {
  if (!authConfigured()) return false;
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return false;
  const expected = sessionToken();
  if (cookie.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function sessionCookieHeader(clear = false): string {
  const base = `${SESSION_COOKIE}=${clear ? '' : sessionToken()}; Path=/; HttpOnly; SameSite=Lax`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const age = clear ? '; Max-Age=0' : '; Max-Age=604800';
  return base + secure + age;
}
