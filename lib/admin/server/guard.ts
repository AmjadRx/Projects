/**
 * The guard every admin route runs behind (ARCHITECTURE.md 11; docs/V3_PLAN.md D-16, D-39, D-40).
 * Server only.
 *
 * `adminRoute(options, handler)` wraps a route handler and, in this order:
 * 1. answers 503 with the missing variable names when ADMIN_PASSWORD or SESSION_SECRET is not set
 *    (there are no fallback credentials);
 * 2. for a mutating request (POST, PUT, PATCH, DELETE), answers 403 unless the Origin header names
 *    this site's own origin, and unless Sec-Fetch-Site, when the browser sends it, is same-origin;
 * 3. answers 401 without a valid session (except the login route itself);
 * 4. runs the handler, turning a thrown `ApiFailure` into its JSON answer and anything else into a
 *    plain 500 that reveals nothing.
 *
 * Every answer carries `Cache-Control: no-store`. Bodies are read with `readJson` (content type,
 * size limit, zod schema) or `readForm`, never with `req.json()` directly.
 */
import 'server-only';
import type { NextRequest } from 'next/server';
import type { z } from 'zod';
import type { ApiError, ErrorCode } from '../contract';
import { sessionFromCookieHeader, type Session } from '../../auth';
import { adminEnv, type Env } from './env';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

/** Thrown inside a handler to answer with an ApiError. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly extra: Partial<Omit<ApiError, 'ok' | 'code' | 'error'>>;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    extra: Partial<Omit<ApiError, 'ok' | 'code' | 'error'>> = {},
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}

/** A JSON answer that is never cached. */
export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...init.headers },
  });
}

export function fail(
  status: number,
  code: ErrorCode,
  error: string,
  extra: Partial<Omit<ApiError, 'ok' | 'code' | 'error'>> = {},
  headers: Record<string, string> = {},
): Response {
  const body: ApiError = { ok: false, code, error, ...extra };
  return json(body, { status, headers });
}

/** This request's own origin, as the browser sees it ("https://host"). */
export function ownOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host')?.trim() || url.host;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(/:$/, '');
  return `${proto}://${host}`.toLowerCase();
}

/**
 * True when a mutating request comes from this site's own pages: an Origin header equal to this
 * origin, and no Sec-Fetch-Site other than same-origin. A missing Origin is refused.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin || origin === 'null') return false;
  const site = req.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  return origin.trim().toLowerCase() === ownOrigin(req);
}

export interface AdminContext {
  req: NextRequest;
  /** The signed-in session; null only for routes with `session: false` (login). */
  session: Session | null;
  env: Env;
}

export interface AdminRouteOptions {
  /** False only for the login route and the session probe. Default true. */
  session?: boolean;
  /** For tests. Defaults to process.env. */
  env?: () => Env;
}

export type AdminHandler = (ctx: AdminContext) => Promise<Response> | Response;

export function adminRoute(options: AdminRouteOptions, handler: AdminHandler): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    const env = options.env ? options.env() : process.env;
    try {
      const state = adminEnv(env);
      if (!state.configured) {
        return fail(
          503,
          'not-configured',
          'The admin is not set up on this deployment: set ADMIN_PASSWORD and SESSION_SECRET (at least 32 characters) in the hosting dashboard and redeploy.',
          { missing: state.missing },
        );
      }
      if (MUTATING.has(req.method.toUpperCase()) && !sameOrigin(req)) {
        return fail(403, 'forbidden-origin', 'Refused: this request did not come from this site.');
      }
      let session: Session | null = null;
      if (options.session !== false) {
        session = sessionFromCookieHeader(req.headers.get('cookie'), env);
        if (!session) return fail(401, 'unauthorized', 'Your session has ended. Sign in again.');
      }
      return await handler({ req, session, env });
    } catch (error) {
      if (error instanceof ApiFailure) return fail(error.status, error.code, error.message, error.extra, error.headers);
      // Nothing about an unexpected error reaches the browser or the logs: it could hold a value.
      return fail(500, 'server', 'Something went wrong on the server. Try again; if it persists, check the status panel.');
    }
  };
}

/**
 * Reads a JSON body: `content-type: application/json` (else 415), at most `maxBytes` (else 413),
 * valid JSON that passes `schema` (else 400 with the issues as findings).
 */
export async function readJson<S extends z.ZodType>(req: Request, schema: S, maxBytes: number): Promise<z.output<S>> {
  const type = req.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type.trim())) {
    throw new ApiFailure(415, 'unsupported-media-type', 'Send this request as JSON.');
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiFailure(413, 'too-large', 'This request is too large.');
  const buffer = await readLimited(req, maxBytes);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch {
    throw new ApiFailure(400, 'bad-request', 'The request body is not valid JSON.');
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiFailure(400, 'bad-request', 'The request body does not have the expected shape.', {
      findings: parsed.error.issues.slice(0, 20).map((issue) => ({
        file: '(request)',
        path: issue.path.map(String).join('.') || '(root)',
        rule: 'REQUEST',
        message: issue.message,
        severity: 'error' as const,
      })),
    });
  }
  return parsed.data;
}

/** The body's bytes, refusing more than `maxBytes` even when Content-Length is missing or wrong. */
export async function readLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiFailure(413, 'too-large', 'This request is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Reads a multipart body after checking its declared size (else 413) and its type (else 415). */
export async function readForm(req: Request, maxBytes: number): Promise<FormData> {
  const type = req.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\b/i.test(type.trim())) {
    throw new ApiFailure(415, 'unsupported-media-type', 'Send files as multipart/form-data.');
  }
  const bytes = await readLimited(req, maxBytes);
  try {
    return await new Response(bytes as unknown as BodyInit, { headers: { 'content-type': type } }).formData();
  } catch {
    throw new ApiFailure(400, 'bad-request', 'The upload could not be read.');
  }
}
