/**
 * The admin's length rule for SESSION_SECRET (lib/admin/server/env.ts: adminEnv and
 * MIN_SESSION_SECRET_LENGTH, read through lib/storage/shared.ts envValue). Shorter than 32
 * characters, after spaces and pasted quotes are removed, and the admin refuses to run (503
 * not-configured). Every secret here is synthetic and made at run time.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { adminEnv, MIN_SESSION_SECRET_LENGTH } from '../lib/admin/server/env';

const PASSWORD = 'synthetic admin password, tests only';
const env = (secret: string | undefined) => ({ ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: secret });
const chars = (n: number) => 'a'.repeat(n);
const REFUSED = { configured: false, missing: ['SESSION_SECRET'] };
const ACCEPTED = { configured: true, missing: [] };

describe('the SESSION_SECRET length rule', () => {
  it('needs at least 32 characters: 31 is refused, 32 is accepted', () => {
    expect(MIN_SESSION_SECRET_LENGTH).toBe(32);
    expect(adminEnv(env(chars(31)))).toEqual(REFUSED);
    expect(adminEnv(env(chars(32)))).toEqual(ACCEPTED);
  });

  it('accepts the 64-character base64url value that randomBytes(48) gives', () => {
    const value = randomBytes(48).toString('base64url');
    expect(value).toHaveLength(64);
    expect(adminEnv(env(value))).toEqual(ACCEPTED);
  });

  it('removes spaces, a line break and quotes pasted around the value, then counts what is left', () => {
    const value = randomBytes(48).toString('base64url');
    expect(adminEnv(env(`  "${value}"\n`))).toEqual(ACCEPTED);
    expect(adminEnv(env(`'${value}'`))).toEqual(ACCEPTED);
    // 33 characters as typed, but 31 once the quotes are removed.
    expect(adminEnv(env(`"${chars(31)}"`))).toEqual(REFUSED);
  });

  it('treats a missing, empty or blank value as missing', () => {
    expect(adminEnv(env(undefined))).toEqual(REFUSED);
    expect(adminEnv(env(''))).toEqual(REFUSED);
    expect(adminEnv(env('   '))).toEqual(REFUSED);
  });
});
