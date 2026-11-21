/**
 * Login, sessions, the lockout, and the origin check (ARCHITECTURE.md 11; acceptance 11).
 * Synthetic secrets only; nothing here is a real credential.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from '../app/api/auth/route';
import { SESSION_MAX_AGE_SECONDS } from '../lib/admin/contract';
import {
  clientAddress,
  createLoginLimiter,
  loginLimitBackend,
  memoryAttemptStore,
  setLoginLimiterForTests,
  type AttemptRecord,
  type AttemptStore,
} from '../lib/admin/server/ratelimit';
import { createSessionToken, passwordMatches, SESSION_COOKIE, verifySessionToken } from '../lib/auth';

const ORIGIN = 'https://admin.test';
const PASSWORD = 'correct horse battery staple, test only';
const SECRET = 'test-session-secret-that-is-long-enough-0123456789';

function login(password: string, init: { origin?: string | null; ip?: string; site?: string } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-real-ip': init.ip ?? '203.0.113.7' };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.site) headers['sec-fetch-site'] = init.site;
  return new NextRequest(`${ORIGIN}/api/auth`, { method: 'POST', headers, body: JSON.stringify({ password }) });
}

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie') ?? '';
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSWORD', PASSWORD);
  vi.stubEnv('SESSION_SECRET', SECRET);
  // As on a Vercel deployment, where the platform sets x-real-ip and it is the address counted.
  vi.stubEnv('VERCEL', '1');
  setLoginLimiterForTests(createLoginLimiter(memoryAttemptStore()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  setLoginLimiterForTests(null);
});

describe('login', () => {
  it('answers 401 for a wrong password and sets no cookie', async () => {
    const res = await POST(login('wrong password'));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(cookieOf(res)).toBe('');
  });

  it('locks an address out on the sixth wrong password, and then refuses even the right one', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await POST(login(`wrong ${i}`))).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);

    const locked = await POST(login(PASSWORD));
    expect(locked.status).toBe(429);
    const body = await locked.json();
    expect(body).toMatchObject({ ok: false, code: 'locked' });
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);

    // Another address is not affected.
    expect((await POST(login(PASSWORD, { ip: '198.51.100.9' }))).status).toBe(200);
  });

  it('counts parallel wrong passwords from one address one at a time', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => POST(login(`guess ${i}`))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
  });

  it('refuses a request without an Origin header', async () => {
    const res = await POST(login(PASSWORD, { origin: null }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden-origin' });
  });

  it('refuses another origin, and a cross-site fetch', async () => {
    expect((await POST(login(PASSWORD, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(login(PASSWORD, { site: 'cross-site' }))).status).toBe(403);
  });

  it('answers 503 and checks nothing when ADMIN_PASSWORD or SESSION_SECRET is missing', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    const res = await POST(login(PASSWORD));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'not-configured', missing: ['ADMIN_PASSWORD'] });
    vi.stubEnv('ADMIN_PASSWORD', PASSWORD);
    vi.stubEnv('SESSION_SECRET', 'too short');
    expect((await POST(login(PASSWORD))).status).toBe(503);
    expect(passwordMatches(PASSWORD)).toBe(false);
  });

  it('answers 415 for a body that is not JSON and 400 for one of the wrong shape', async () => {
    const form = new NextRequest(`${ORIGIN}/api/auth`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=x',
    });
    expect((await POST(form)).status).toBe(415);
    const extra = new NextRequest(`${ORIGIN}/api/auth`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, admin: true }),
    });
    expect((await POST(extra)).status).toBe(400);
  });

  it('signs in with the right password: a Strict, httpOnly, Secure cookie for eight hours', async () => {
    const res = await POST(login(PASSWORD));
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\.`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(res.headers.get('cache-control')).toContain('no-store');

    const token = cookie.split(';')[0].split('=').slice(1).join('=');
    const probe = new NextRequest(`${ORIGIN}/api/auth`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect((await GET(probe)).status).toBe(200);
  });
});

/** A store shared by several instances, with a network-like delay, as Runtime Cache is (AUTH-1). */
function sharedRemoteStore(delayMs = 5, options: { failReadsAfterLock?: boolean } = {}): AttemptStore & { failing: boolean } {
  const map = new Map<string, string>();
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  const store = {
    failing: false,
    async get(key: string) {
      await wait();
      if (store.failing) return null; // the cache client answers a failed or timed-out read as a miss
      const v = map.get(key);
      return v ? (JSON.parse(v) as AttemptRecord) : null;
    },
    async set(key: string, record: AttemptRecord) {
      await wait();
      map.set(key, JSON.stringify(record));
      if (options.failReadsAfterLock && record.lockedUntil !== null) store.failing = true;
    },
    async delete(key: string) {
      await wait();
      map.delete(key);
    },
  };
  return store;
}

describe('the login limit across instances (review AUTH-1)', () => {
  it('converges when four instances count one address at once, instead of each allowing five', async () => {
    const store = sharedRemoteStore();
    const instances = Array.from({ length: 4 }, () => createLoginLimiter(store));
    let checks = 0;
    const verify = () => {
      checks += 1;
      return false;
    };
    await Promise.all(Array.from({ length: 40 }, (_, i) => instances[i % 4].attempt('203.0.113.7', verify)));
    // Before the fix every instance allowed five: 20 checks. Now failures merge across instances.
    expect(checks).toBeLessThanOrEqual(9);
    for (const limiter of instances) expect((await limiter.check('203.0.113.7')).allowed).toBe(false);
  });

  it('keeps a lockout it saw when the shared cache stops answering', async () => {
    const store = sharedRemoteStore(1, { failReadsAfterLock: true });
    const limiter = createLoginLimiter(store);
    for (let i = 0; i < 5; i += 1) await limiter.attempt('198.51.100.20', () => false);
    expect(store.failing).toBe(true);
    const after = await limiter.attempt('198.51.100.20', () => true);
    expect(after).toMatchObject({ ok: false, locked: true });
  });
});

describe('the address a login is counted under', () => {
  it('on Vercel is x-real-ip, which Vercel sets; x-forwarded-for sent by a client is never used', () => {
    const env = { VERCEL: '1' };
    expect(clientAddress(new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }), env)).toBe('203.0.113.7');
    expect(clientAddress(new Headers({ 'x-forwarded-for': '198.51.100.1' }), env)).toBe('unknown');
  });

  it('off Vercel trusts no header at all, so changing headers cannot escape the count', async () => {
    vi.stubEnv('VERCEL', '');
    expect(clientAddress(new Headers({ 'x-real-ip': '203.0.113.7' }), {})).toBe('local');
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await POST(login(`wrong ${i}`, { ip: `192.0.2.${i}` }))).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('reports which store holds the count', () => {
    expect(loginLimitBackend()).toBe('memory');
    const key = Symbol.for('@vercel/request-context');
    const holder = globalThis as Record<symbol, unknown>;
    const saved = holder[key];
    holder[key] = { get: () => ({ cache: {} }) };
    try {
      expect(loginLimitBackend()).toBe('runtime-cache');
    } finally {
      holder[key] = saved;
    }
  });
});

describe('sessions', () => {
  it('rejects a tampered, an expired, and a foreign token', () => {
    const now = Date.UTC(2026, 10, 18, 12);
    const { token } = createSessionToken(process.env, now);
    expect(verifySessionToken(token, process.env, now + 1000)).not.toBeNull();

    const parts = token.split('.');
    const tampered = [parts[0], String(Number(parts[1]) + 3600), String(Number(parts[2]) + 3600), parts[3], parts[4]].join('.');
    expect(verifySessionToken(tampered, process.env, now)).toBeNull();

    expect(verifySessionToken(token, process.env, now + SESSION_MAX_AGE_SECONDS * 1000 + 1)).toBeNull();

    const other = { ...process.env, SESSION_SECRET: 'another-secret-that-is-also-long-enough-987654321' };
    expect(verifySessionToken(token, other, now)).toBeNull();
  });

  it('ends every session when the password changes', () => {
    const now = Date.now();
    const { token } = createSessionToken(process.env, now);
    const changed = { ...process.env, ADMIN_PASSWORD: 'a new password, test only' };
    expect(verifySessionToken(token, changed, now)).toBeNull();
  });

  it('answers 401 to a request without a session', async () => {
    const res = await GET(new NextRequest(`${ORIGIN}/api/auth`));
    expect(res.status).toBe(401);
  });

  it('logs out with an origin-checked DELETE that clears the cookie', async () => {
    const bare = new NextRequest(`${ORIGIN}/api/auth`, { method: 'DELETE' });
    expect((await DELETE(bare)).status).toBe(403);
    const res = await DELETE(new NextRequest(`${ORIGIN}/api/auth`, { method: 'DELETE', headers: { origin: ORIGIN } }));
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toContain('Max-Age=0');
  });
});
