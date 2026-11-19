/**
 * Admin login, session state, and logout (ARCHITECTURE.md 11).
 *
 * POST: { password } -> 200 and the session cookie; 401 for a wrong password; 429 with
 * Retry-After once an address has five wrong passwords in ten minutes (the lockout lasts ten
 * minutes, and even the right password waits); 403 without this site's Origin; 503 when
 * ADMIN_PASSWORD or SESSION_SECRET is missing.
 * GET: the session's expiry, or 401.
 * DELETE: logs out (clears the cookie). Origin-checked like every mutating route.
 */
import { LoginBody, MAX_JSON_BODY_BYTES, type SessionState } from '@/lib/admin/contract';
import { adminRoute, ApiFailure, json, readJson } from '@/lib/admin/server/guard';
import { clientAddress, loginLimiter } from '@/lib/admin/server/ratelimit';
import { cookieShouldBeSecure, createSessionToken, passwordMatches, sessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = adminRoute({ session: false }, async ({ req, env }) => {
  const { password } = await readJson(req, LoginBody, MAX_JSON_BODY_BYTES);
  const result = await loginLimiter().attempt(clientAddress(req.headers, env), () => passwordMatches(password, env));
  if (!result.ok) {
    if (result.locked) {
      throw new ApiFailure(
        429,
        'locked',
        'Too many wrong passwords from this address. Wait and try again.',
        { retryAfter: result.retryAfter },
        { 'Retry-After': String(result.retryAfter) },
      );
    }
    throw new ApiFailure(401, 'unauthorized', 'Wrong password.');
  }
  const { token, session } = createSessionToken(env);
  const body: SessionState = { ok: true, expiresAt: session.expiresAt };
  return json(body, { headers: { 'Set-Cookie': sessionCookie(token, cookieShouldBeSecure(req.url, env)) } });
});

export const GET = adminRoute({}, ({ session }) => {
  const body: SessionState = { ok: true, expiresAt: session!.expiresAt };
  return json(body);
});

export const DELETE = adminRoute({ session: false }, ({ req, env }) =>
  json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(null, cookieShouldBeSecure(req.url, env)) } }),
);
