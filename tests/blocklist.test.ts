import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { checkText, missingBlocklistIsError, parseBlocklist } from '../lib/lint';

// Every term here is made up. Real terms live only in the CONTENT_BLOCKLIST variable.

describe('CONTENT_BLOCKLIST parsing and matching', () => {
  const entries = parseBlocklist('zorblax| cs:Quuxly |  |frob.nitz||café');

  it('drops blank entries and keeps the position of each entry', () => {
    expect(entries.map((e) => e.index)).toEqual([1, 2, 4, 6]);
  });

  it('matches whole words without regard to case', () => {
    expect(checkText('The Zorblax unit', [], entries)).toHaveLength(1);
    expect(checkText('zorblaxes everywhere', [], entries)).toHaveLength(0);
  });

  it('matches a cs: entry with exact case only', () => {
    expect(checkText('Quuxly said so', [], entries)).toHaveLength(1);
    expect(checkText('quuxly said so', [], entries)).toHaveLength(0);
  });

  it('treats the characters of an entry literally', () => {
    expect(checkText('a frob.nitz part', [], entries)).toHaveLength(1);
    expect(checkText('a frobxnitz part', [], entries)).toHaveLength(0);
  });

  it('uses Unicode word boundaries', () => {
    expect(checkText('a café nearby', [], entries)).toHaveLength(1);
    expect(checkText('a cafés nearby', [], entries)).toHaveLength(0);
    expect(checkText('a caféteria nearby', [], entries)).toHaveLength(0);
  });

  it('reports a hit by entry number, never by the term', () => {
    const [hit] = checkText('The Zorblax unit', [], entries);
    expect(hit.rule).toBe('BLOCKLIST');
    expect(hit.message).toContain('term 1');
    expect(hit.message.toLowerCase()).not.toContain('zorblax');
  });

  it('is empty when the variable is missing or blank', () => {
    expect(parseBlocklist(undefined)).toEqual([]);
    expect(parseBlocklist(' | ')).toEqual([]);
  });

  it('fails closed in CI and on Vercel, and only warns elsewhere', () => {
    expect(missingBlocklistIsError({ CI: '1' })).toBe(true);
    expect(missingBlocklistIsError({ VERCEL: '1' })).toBe(true);
    expect(missingBlocklistIsError({})).toBe(false);
  });
});

describe('scripts/check-content.mjs', () => {
  const run = (blocklist: string) =>
    spawnSync(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/check-content.mjs'],
      { encoding: 'utf8', env: { ...process.env, CONTENT_BLOCKLIST: blocklist } },
    );

  it('passes the seed with a list of terms it does not contain', () => {
    const result = run('zorblax|cs:Quuxly');
    expect(result.stdout).toContain('0 errors');
    expect(result.status).toBe(0);
  });

  it('fails when a term appears, and names the file and field but never the term', () => {
    // "Molicel" appears in the seed's battery text and in no file name or field name.
    const result = run('Molicel');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('BLOCKLIST');
    expect(result.stdout).toContain('content/projects/fsae-bronco-racing.json');
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).not.toContain('molicel');
  });

  it('checks the admin source too, since its JavaScript is a public static file', () => {
    // "Login lockout" appears only in the admin's status panel, not in content/ or docs/.
    const result = run('Login lockout');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('components/admin/shell/StatusPanel.tsx');
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).not.toContain('login lockout');
  });
});
