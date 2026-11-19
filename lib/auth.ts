/**
 * Admin login and sessions (ARCHITECTURE.md 11; docs/V3_PLAN.md D-36, D-37, D-39). Server only.
 *
 * - No fallback credentials: every function refuses when ADMIN_PASSWORD or SESSION_SECRET is
 *   missing (lib/admin/server/env.ts), and the routes answer 503.
 * - The password check is constant-time for any input length: both sides are reduced to an
 *   HMAC-SHA256 digest under a key made fresh for each process, and the two digests are compared
 *   with `timingSafeEqual`. Comparing digests also hides the password's length.
 * - A session is a token signed with HMAC-SHA256 under SESSION_SECRET:
 *   `v1.<issued>.<expires>.<nonce>.<signature>`, times in seconds. It lasts eight hours and is
 *   bound to a digest of the current password, so changing ADMIN_PASSWORD (or rotating
 *   SESSION_SECRET) ends every session at once.
 * - The cookie is httpOnly, SameSite=Strict, and Secure (left off only for plain-HTTP local
 *   development, where browsers would drop a Secure cookie), with Path=/ and an eight-hour Max-Age.
 */
import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SESSION_MAX_AGE_SECONDS } from './admin/contract';
import { adminEnv, adminSecrets, type Env } from './admin/server/env';

export const SESSION_COOKIE = 'amr_admin';
const TOKEN_VERSION = 'v1';
/** Clock skew allowed for a token issued "in the future" by another server instance. */
const SKEW_SECONDS = 60;

/** A random key for this process, used only to turn passwords into equal-length digests. */
const COMPARE_KEY = randomBytes(32);

function digest(value: string): Buffer {
  return createHmac('sha256', COMPARE_KEY).update(value, 'utf8').digest();
}

export function authConfigured(env: Env = process.env): boolean {
  return adminEnv(env).configured;
}

/** Constant-time check of a login password. False whenever the admin is not configured. */
export function passwordMatches(provided: string, env: Env = process.env): boolean {
  if (!authConfigured(env) || typeof provided !== 'string') return false;
  const { password } = adminSecrets(env);
  return timingSafeEqual(digest(provided), digest(password));
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/** The signature over a token's payload, bound to the current password. */
function sign(payload: string, env: Env): Buffer {
  const { password, sessionSecret } = adminSecrets(env);
  const passwordTag = createHash('sha256').update(`amr-admin-password:${password}`, 'utf8').digest('hex');
  return createHmac('sha256', sessionSecret).update(`${payload}|${passwordTag}`, 'utf8').digest();
}

export interface Session {
  /** Unix time in milliseconds. */
  issuedAt: number;
  expiresAt: number;
}

/** A new session token and its times. `nowMs` is for tests. */
export function createSessionToken(env: Env = process.env, nowMs: number = Date.now()): { token: string; session: Session } {
  const issued = Math.floor(nowMs / 1000);
  const expires = issued + SESSION_MAX_AGE_SECONDS;
  const nonce = base64url(randomBytes(16));
  const payload = `${TOKEN_VERSION}.${issued}.${expires}.${nonce}`;
  const token = `${payload}.${base64url(sign(payload, env))}`;
  return { token, session: { issuedAt: issued * 1000, expiresAt: expires * 1000 } };
}

/** The session a token carries, or null when it is malformed, forged, expired, or the admin is not configured. */
export function verifySessionToken(token: string | undefined | null, env: Env = process.env, nowMs: number = Date.now()): Session | null {
  if (!token || token.length > 400 || !authConfigured(env)) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== TOKEN_VERSION) return null;
  const [, issuedText, expiresText, nonce, signature] = parts;
  if (
    !/^\d{1,12}$/.test(issuedText) ||
    !/^\d{1,12}$/.test(expiresText) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    return null;
  }
  const expected = sign(`${TOKEN_VERSION}.${issuedText}.${expiresText}.${nonce}`, env);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const issued = Number(issuedText);
  const expires = Number(expiresText);
  const now = Math.floor(nowMs / 1000);
  if (expires - issued !== SESSION_MAX_AGE_SECONDS) return null;
  if (issued > now + SKEW_SECONDS || expires <= now) return null;
  return { issuedAt: issued * 1000, expiresAt: expires * 1000 };
}

/** Reads the session from a request's cookies. */
export function sessionFromCookieHeader(cookieHeader: string | null | undefined, env: Env = process.env, nowMs: number = Date.now()): Session | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return verifySessionToken(decodeURIComponent(part.slice(eq + 1).trim()), env, nowMs);
    }
  }
  return null;
}

/**
 * The Set-Cookie value for a new session, or one that clears it. `secure` is false only for
 * plain-HTTP local development (see `cookieShouldBeSecure`).
 */
export function sessionCookie(token: string | null, secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=${token ?? ''}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  parts.push(token ? `Max-Age=${SESSION_MAX_AGE_SECONDS}` : 'Max-Age=0');
  return parts.join('; ');
}

/** Secure everywhere except a plain-HTTP request to this machine during development. */
export function cookieShouldBeSecure(requestUrl: string, env: Env = process.env): boolean {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return true;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  return !(url.protocol === 'http:' && local && env.VERCEL === undefined);
}
