import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

const FALLBACK_PASSWORD = 'AMRx(2004)SCU';
export const SESSION_COOKIE = 'amr_admin';

function secret(): string {
  return process.env.ADMIN_PASSWORD || FALLBACK_PASSWORD;
}

export function passwordValid(provided: string): boolean {
  if (!provided) return false;
  const env = process.env.ADMIN_PASSWORD;
  if (env && provided === env) return true;
  return provided === FALLBACK_PASSWORD;
}

export function sessionToken(): string {
  return createHmac('sha256', secret()).update('amr-admin-session-v2').digest('hex');
}

export function sessionValid(req: NextRequest): boolean {
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
