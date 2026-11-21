/**
 * Every admin route, not only the ones each route's own tests exercise (ARCHITECTURE.md 11 and 15,
 * item 11): without ADMIN_PASSWORD, or without SESSION_SECRET, every handler of every route under
 * app/api answers 503 and names what is missing; with both set, every handler but the sign-in and
 * sign-out answers 401 without a session; and every mutating handler refuses another origin with
 * 403, a session or not. The routes are found on disk, so a route added later is held to the same
 * rules. A wrong password's 401 and the lockout on the sixth attempt are in tests/admin-auth.test.ts.
 * Synthetic settings only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth';
import { ORIGIN, ROOT, stubAdminEnv } from './admin-github-fake';

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** The handlers that need no session: signing in, and signing out. */
const SESSION_FREE = new Set(['POST /api/auth', 'DELETE /api/auth']);

/** Every route file under app/api, as its address (/api/save) and its file. */
function routeFiles(): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^route\.(ts|tsx|js)$/.test(entry.name)) {
        const route = `/${path.relative(path.join(ROOT, 'app'), dir).split(path.sep).join('/')}`;
        out.push({ route, file: full });
      }
    }
  };
  walk(path.join(ROOT, 'app', 'api'));
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

type Handler = { name: string; route: string; method: (typeof METHODS)[number]; call: (req: NextRequest) => Promise<Response> };

async function handlers(): Promise<Handler[]> {
  const out: Handler[] = [];
  for (const { route, file } of routeFiles()) {
    const mod = (await import(file)) as Record<string, unknown>;
    for (const method of METHODS) {
      const call = mod[method];
      if (typeof call === 'function') out.push({ name: `${method} ${route}`, route, method, call: call as Handler['call'] });
    }
  }
  return out;
}

/** A request to a handler: JSON with a body for a mutating method, from `origin`, with or without a session. */
function request(handler: Handler, options: { origin?: string; session?: boolean } = {}): NextRequest {
  const headers: Record<string, string> = { origin: options.origin ?? ORIGIN };
  if (options.session) headers.cookie = `${SESSION_COOKIE}=${createSessionToken(process.env).token}`;
  const body = MUTATING.has(handler.method) ? JSON.stringify({}) : undefined;
  if (body) headers['content-type'] = 'application/json';
  return new NextRequest(`${ORIGIN}${handler.route}`, { method: handler.method, headers, body });
}

let all: Handler[] = [];

beforeEach(async () => {
  stubAdminEnv();
  if (all.length === 0) all = await handlers();
}, 120_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('every admin route (ARCHITECTURE.md 11; acceptance 11)', () => {
  it('is found: every route under app/api, each with its handlers', () => {
    const routes = routeFiles().map((r) => r.route);
    expect(routes).toEqual(expect.arrayContaining(['/api/auth', '/api/save', '/api/publish', '/api/discard', '/api/upload', '/api/status', '/api/content']));
    for (const route of routes) expect(all.filter((h) => h.route === route).length, route).toBeGreaterThan(0);
    // Each handler is the guard's: the source exports every method through adminRoute.
    for (const { route, file } of routeFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const method of all.filter((h) => h.route === route).map((h) => h.method)) {
        expect(source, `${method} ${route}`).toMatch(new RegExp(`export const ${method} = adminRoute\\(`));
      }
    }
  });

  it('answers 503 without ADMIN_PASSWORD, naming it, whatever the request', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    const wrong: string[] = [];
    for (const handler of all) {
      const res = await handler.call(request(handler));
      const body = handler.method === 'HEAD' ? null : await res.json();
      if (res.status !== 503 || (body && (body.code !== 'not-configured' || !body.missing?.includes('ADMIN_PASSWORD')))) {
        wrong.push(`${handler.name}: ${res.status} ${JSON.stringify(body)}`);
      }
      expect(res.headers.get('cache-control'), handler.name).toContain('no-store');
    }
    expect(wrong).toEqual([]);
  });

  it('answers 503 without SESSION_SECRET, naming it', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    const wrong: string[] = [];
    for (const handler of all) {
      const res = await handler.call(request(handler));
      const body = handler.method === 'HEAD' ? null : await res.json();
      if (res.status !== 503 || (body && !body.missing?.includes('SESSION_SECRET'))) wrong.push(`${handler.name}: ${res.status} ${JSON.stringify(body)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('answers 401 without a session, but for signing in and out', async () => {
    const wrong: string[] = [];
    for (const handler of all.filter((h) => !SESSION_FREE.has(h.name))) {
      const res = await handler.call(request(handler, { session: false }));
      const body = handler.method === 'HEAD' ? null : await res.json();
      if (res.status !== 401 || (body && body.code !== 'unauthorized')) wrong.push(`${handler.name}: ${res.status} ${JSON.stringify(body)}`);
    }
    expect(wrong).toEqual([]);
    expect(all.filter((h) => SESSION_FREE.has(h.name)).map((h) => h.name).sort()).toEqual([...SESSION_FREE].sort());
  });

  it('refuses another origin on every mutating handler with 403, with or without a session', async () => {
    const wrong: string[] = [];
    for (const handler of all.filter((h) => MUTATING.has(h.method))) {
      for (const session of [false, true]) {
        const res = await handler.call(request(handler, { origin: 'https://elsewhere.example', session }));
        const body = await res.json();
        if (res.status !== 403 || body.code !== 'forbidden-origin') wrong.push(`${handler.name}${session ? ' (signed in)' : ''}: ${res.status} ${JSON.stringify(body)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
