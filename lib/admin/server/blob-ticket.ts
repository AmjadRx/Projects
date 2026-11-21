/**
 * The ticket that ties a browser upload to Vercel Blob back to the token that allowed it
 * (ARCHITECTURE.md 11 "Uploads"; docs/V3_PLAN.md D-26). Server only.
 *
 * /api/upload/token signs what it allowed (the pathname, the size, the type, and an expiry) with
 * HMAC-SHA256 under SESSION_SECRET, and /api/upload/confirm accepts only a ticket it can verify:
 * `base64url(JSON) "." base64url(HMAC)`. The signature is compared in constant time. The ticket
 * holds nothing secret; it only cannot be forged, so the confirm route never inspects (or
 * replaces) a file the server did not allow. The ticket keeps no state: what makes the upload
 * single-use is the pathname, which the token may write only while nothing is stored there and
 * which a refusal fills with a placeholder (lib/admin/server/media.ts, `occupy`).
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { adminSecrets, type Env } from './env';

export interface BlobTicket {
  /** The Blob pathname the token allowed, such as "media/raven/clip-0123456789ab.mp4". */
  pathname: string;
  /** The most bytes the token allowed. */
  size: number;
  contentType: string;
  /** Unix time in milliseconds after which the ticket is refused. */
  exp: number;
}

export type TicketCheck = { ok: true; ticket: BlobTicket } | { ok: false; reason: 'invalid' | 'expired' };

/** Keeps a ticket's signature from ever matching a signature made for anything else. */
const PURPOSE = 'amr-blob-ticket.v1';
const MAX_TICKET_LENGTH = 2000;

function mac(payload: string, env: Env): Buffer {
  const { sessionSecret } = adminSecrets(env);
  return createHmac('sha256', sessionSecret).update(`${PURPOSE}.${payload}`, 'utf8').digest();
}

export function signTicket(ticket: BlobTicket, env: Env = process.env): string {
  const body = { pathname: ticket.pathname, size: ticket.size, contentType: ticket.contentType, exp: ticket.exp };
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${payload}.${mac(payload, env).toString('base64url')}`;
}

function isTicket(value: unknown): value is BlobTicket {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 4 &&
    typeof record.pathname === 'string' &&
    record.pathname.length > 0 &&
    record.pathname.length <= 400 &&
    typeof record.size === 'number' &&
    Number.isSafeInteger(record.size) &&
    record.size > 0 &&
    typeof record.contentType === 'string' &&
    record.contentType.length > 0 &&
    record.contentType.length <= 100 &&
    typeof record.exp === 'number' &&
    Number.isSafeInteger(record.exp)
  );
}

/** The ticket's contents when its signature is this server's and it has not expired. */
export function verifyTicket(ticket: string, env: Env = process.env, nowMs: number = Date.now()): TicketCheck {
  if (typeof ticket !== 'string' || ticket.length > MAX_TICKET_LENGTH) return { ok: false, reason: 'invalid' };
  const parts = ticket.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'invalid' };
  const [payload, signature] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return { ok: false, reason: 'invalid' };
  const expected = mac(payload, env);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'invalid' };
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!isTicket(data)) return { ok: false, reason: 'invalid' };
  if (data.exp <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, ticket: data };
}
