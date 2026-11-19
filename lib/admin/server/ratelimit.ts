/**
 * The login limit (ARCHITECTURE.md 11): five failed attempts per ten minutes per address, then a
 * ten-minute lockout. Server only.
 *
 * Where the count lives: Vercel Runtime Cache (`getCache` from @vercel/functions), which every
 * instance of the function in a region shares, so a new or a second instance sees the same count.
 * It is a cache, not a database: Vercel keeps one per region and per environment (Preview and
 * Production never share), may evict an entry early when the project's cache is full, and gives no
 * atomic update. So this count is enforced exactly inside one instance and closely, not exactly,
 * across instances:
 * - each failure is stored with its own id and records are merged as a union, never overwritten;
 *   after writing, an attempt reads the shared record again and writes back the union, so two
 *   instances that counted at the same moment converge instead of erasing each other;
 * - each instance keeps its own copy of the record too, so a cache read that fails or times out
 *   (the client then answers as if the key were missing) cannot clear a lockout this instance saw.
 * The hard limit in front of all instances is the Vercel Firewall rate-limit rule on
 * POST /api/auth (docs/ADMIN_GUIDE.md), which counts at Vercel's edge. When a request runs without
 * Runtime Cache (off Vercel, in tests, or if Vercel ever withholds it), `getCache` falls back to
 * the instance's memory; `loginLimitBackend()` says which store is in use, and the status panel
 * shows it.
 *
 * Which address: on Vercel, `ipAddress()` from @vercel/functions, which reads x-real-ip. Vercel
 * sets it (identical to x-forwarded-for, which Vercel overwrites so a client's value is never
 * forwarded). Off Vercel no header is trusted, because any client can send one: every request
 * shares one local count. Addresses are stored only as SHA-256 digests.
 *
 * While an address is locked, attempts are refused before the password is checked, so even the
 * right password waits. A successful login clears the address's failures.
 */
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { getCache, ipAddress } from '@vercel/functions';
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS } from '../contract';
import type { Env } from './env';

/** One failed attempt: a unique id (so concurrent writers can merge) and its time in milliseconds. */
export type Failure = [id: string, at: number];

export interface AttemptRecord {
  /** Failed attempts in the current window, oldest first. */
  failures: Failure[];
  /** When set, attempts are refused until this time (milliseconds). */
  lockedUntil: number | null;
}

/** Where attempt records live. `getCache()` in production; a Map in tests. */
export interface AttemptStore {
  get(key: string): Promise<AttemptRecord | null>;
  set(key: string, record: AttemptRecord, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

function isFailure(value: unknown): value is Failure {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number';
}

function isRecord(value: unknown): value is AttemptRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.failures) && v.failures.every(isFailure) && (v.lockedUntil === null || typeof v.lockedUntil === 'number');
}

/** The shared runtime cache, namespaced, with keys used as given (they are already digests). */
export function runtimeAttemptStore(): AttemptStore {
  const cache = getCache({ namespace: 'amr-admin-login', keyHashFunction: (key) => key });
  return {
    async get(key) {
      const value = await cache.get(key);
      return isRecord(value) ? value : null;
    },
    async set(key, record, ttlSeconds) {
      await cache.set(key, record, { ttl: Math.max(1, Math.ceil(ttlSeconds)), name: '' });
    },
    async delete(key) {
      await cache.delete(key);
    },
  };
}

export function memoryAttemptStore(): AttemptStore {
  const map = new Map<string, { record: AttemptRecord; until: number }>();
  return {
    async get(key) {
      const hit = map.get(key);
      if (!hit || hit.until <= Date.now()) return null;
      return structuredClone(hit.record);
    },
    async set(key, record, ttlSeconds) {
      map.set(key, { record: structuredClone(record), until: Date.now() + ttlSeconds * 1000 });
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

/**
 * The client address a login attempt is counted under. On Vercel: the address Vercel itself
 * records (x-real-ip, through Vercel's `ipAddress()`), or one shared "unknown" count if it is ever
 * missing. Off Vercel: one shared local count, because there a client could send any header.
 */
export function clientAddress(headers: Headers, env: Env = process.env): string {
  if ((env.VERCEL ?? '').trim() === '') return 'local';
  return ipAddress(headers)?.trim() || 'unknown';
}

/**
 * Which store holds the login count for the current request: Vercel Runtime Cache when the
 * platform provides it (the same check `getCache` makes), otherwise this instance's memory.
 */
export function loginLimitBackend(): 'runtime-cache' | 'memory' {
  const holder = (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] as
    | { get?: () => { cache?: unknown } | undefined }
    | undefined;
  return holder?.get?.()?.cache ? 'runtime-cache' : 'memory';
}

export function addressKey(address: string): string {
  return createHash('sha256').update(`amr-admin-login:${address}`, 'utf8').digest('hex');
}

export interface LimitCheck {
  allowed: boolean;
  /** Seconds until an attempt is allowed again, when refused. */
  retryAfter: number;
  /** Failed attempts left in the current window, when allowed. */
  remaining: number;
}

export type AttemptResult =
  | { ok: true }
  | {
      ok: false;
      /** True when the address is locked: the password was not even checked. */
      locked: boolean;
      /** Seconds until the next attempt is allowed, when locked. */
      retryAfter: number;
      /** Wrong passwords left before the lockout. */
      remaining: number;
    };

export interface LoginLimiter {
  /** Is this address allowed to try now? Does not count anything. */
  check(address: string, nowMs?: number): Promise<LimitCheck>;
  /**
   * One login attempt: refused while locked; otherwise runs `verify` and counts a wrong password.
   * Attempts from one address run one at a time inside an instance; across instances the shared
   * record is merged (see the module comment).
   */
  attempt(address: string, verify: () => boolean | Promise<boolean>, nowMs?: () => number): Promise<AttemptResult>;
}

export function createLoginLimiter(
  store: AttemptStore,
  options: { maxFailures?: number; windowSeconds?: number } = {},
): LoginLimiter {
  const maxFailures = options.maxFailures ?? LOGIN_MAX_FAILURES;
  const windowMs = (options.windowSeconds ?? LOGIN_WINDOW_SECONDS) * 1000;
  /** One queue per address digest, so attempts from one address never interleave here. */
  const queues = new Map<string, Promise<unknown>>();
  /** This instance's own copy of each record, merged with the shared one on every attempt. */
  const shadow = new Map<string, AttemptRecord>();

  function prune(record: AttemptRecord | null | undefined, now: number): AttemptRecord {
    const failures = (record?.failures ?? []).filter(([, at]) => now - at < windowMs);
    const lockedUntil = record?.lockedUntil && record.lockedUntil > now ? record.lockedUntil : null;
    return { failures, lockedUntil };
  }

  /** The union of two records: every failure once (by id), and the later lock. */
  function merge(a: AttemptRecord, b: AttemptRecord): AttemptRecord {
    const byId = new Map<string, number>();
    for (const [id, at] of [...a.failures, ...b.failures]) {
      const seen = byId.get(id);
      if (seen === undefined || at < seen) byId.set(id, at);
    }
    const failures = [...byId.entries()].sort((x, y) => x[1] - y[1]) as Failure[];
    const locks = [a.lockedUntil, b.lockedUntil].filter((t): t is number => t !== null);
    return { failures, lockedUntil: locks.length > 0 ? Math.max(...locks) : null };
  }

  /** Locks the record when it holds the maximum of failures; the lock runs a full window from now. */
  function lockIfDue(record: AttemptRecord, now: number): AttemptRecord {
    if (record.lockedUntil === null && record.failures.length >= maxFailures) return { ...record, lockedUntil: now + windowMs };
    return record;
  }

  function sameRecord(a: AttemptRecord | null, b: AttemptRecord): boolean {
    if (!a) return false;
    if (a.lockedUntil !== b.lockedUntil || a.failures.length !== b.failures.length) return false;
    const ids = new Set(a.failures.map(([id]) => id));
    return b.failures.every(([id]) => ids.has(id));
  }

  function verdict(record: AttemptRecord, now: number): LimitCheck {
    if (record.lockedUntil !== null) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((record.lockedUntil - now) / 1000)), remaining: 0 };
    }
    return { allowed: true, retryAfter: 0, remaining: Math.max(0, maxFailures - record.failures.length) };
  }

  function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    queues.set(key, next);
    void next
      .finally(() => {
        if (queues.get(key) === next) queues.delete(key);
      })
      .catch(() => undefined);
    return next;
  }

  async function current(key: string, now: number): Promise<AttemptRecord> {
    const shared = prune(await store.get(key).catch(() => null), now);
    return merge(prune(shadow.get(key), now), shared);
  }

  return {
    async check(address, nowMs = Date.now()) {
      return verdict(await current(addressKey(address), nowMs), nowMs);
    },

    attempt(address, verify, clock = () => Date.now()) {
      const key = addressKey(address);
      return serialized(key, async (): Promise<AttemptResult> => {
        const now = clock();
        const before = await current(key, now);
        const gate = verdict(before, now);
        if (!gate.allowed) return { ok: false, locked: true, retryAfter: gate.retryAfter, remaining: 0 };

        if (await verify()) {
          shadow.delete(key);
          await store.delete(key).catch(() => undefined);
          return { ok: true };
        }

        // Count this wrong password, write it, then read the shared record again and write back
        // the union, so a failure another instance wrote at the same moment is not lost.
        const counted = lockIfDue(merge(before, { failures: [[randomUUID(), now]], lockedUntil: null }), now);
        shadow.set(key, counted);
        const ttl = windowMs / 1000;
        await store.set(key, counted, ttl).catch(() => undefined);
        const again = prune(await store.get(key).catch(() => null), now);
        const merged = lockIfDue(merge(counted, again), now);
        shadow.set(key, merged);
        if (!sameRecord(again, merged)) await store.set(key, merged, ttl).catch(() => undefined);

        const after = verdict(merged, now);
        return { ok: false, locked: false, retryAfter: after.allowed ? 0 : after.retryAfter, remaining: after.remaining };
      });
    },
  };
}

let shared: LoginLimiter | null = null;

/** The limiter the login route uses. */
export function loginLimiter(): LoginLimiter {
  if (!shared) shared = createLoginLimiter(runtimeAttemptStore());
  return shared;
}

/** Tests replace the shared limiter with one on a memory store. */
export function setLoginLimiterForTests(limiter: LoginLimiter | null): void {
  shared = limiter;
}
