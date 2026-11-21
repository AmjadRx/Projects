/** The build-output secret scan (scripts/check-secrets.mjs), on a fake build with synthetic values. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script with no type declarations.
import { blocklistTerms, scanBuild, scanEnvironment } from '../scripts/check-secrets.mjs';

const made: string[] = [];

function fakeBuild(files: Record<string, string>): string {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'check-secrets-'));
  made.push(dist);
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dist, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return dist;
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const SECRET = 'synthetic-session-secret-0123456789abcdef';
const PASSWORD = 'synthetic password, test only';

describe('the build-output secret scan', () => {
  it('passes a clean build', () => {
    const dist = fakeBuild({ 'static/chunks/app.js': 'console.log("hello")', 'server/app/index.html': '<p>Hi</p>' });
    const result = scanBuild(dist, { SESSION_SECRET: SECRET, ADMIN_PASSWORD: PASSWORD });
    expect(result.hits).toEqual([]);
    expect(result.files).toBe(2);
  });

  it('finds a planted secret value, raw, JSON-escaped, or URL-encoded, and never returns it', () => {
    const dist = fakeBuild({
      'static/chunks/a.js': `const x = "${SECRET}";`,
      'static/chunks/b.js': `fetch("/x?p=${encodeURIComponent(PASSWORD)}")`,
      'server/app/page.rsc': JSON.stringify({ leak: PASSWORD }),
    });
    const result = scanBuild(dist, { SESSION_SECRET: SECRET, ADMIN_PASSWORD: PASSWORD });
    expect(result.hits).toEqual(
      expect.arrayContaining([
        { label: 'SESSION_SECRET', file: 'static/chunks/a.js' },
        { label: 'ADMIN_PASSWORD', file: 'static/chunks/b.js' },
        { label: 'ADMIN_PASSWORD', file: 'server/app/page.rsc' },
      ]),
    );
    const printed = JSON.stringify(result);
    expect(printed).not.toContain(SECRET);
    expect(printed).not.toContain(PASSWORD);
  });

  it('catches token shapes whatever the variable', () => {
    const fakeGitHub = `github_pat_${'A1'.repeat(20)}`;
    const fakeBlob = `vercel_blob_rw_abcDEF123456_${'x9'.repeat(10)}`;
    const dist = fakeBuild({ 'static/chunks/c.js': `"${fakeGitHub}" "${fakeBlob}"` });
    const labels = scanBuild(dist, {}).hits.map((h: { label: string }) => h.label);
    expect(labels).toEqual(expect.arrayContaining(['a GitHub fine-grained token', 'a Vercel Blob read-write token']));
  });

  it('finds a private key, but not a library that only compares against the header', () => {
    // Built at run time, so this file holds no key-shaped text; the material is not a real key.
    const begin = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');
    const end = ['-----END', 'PRIVATE', 'KEY-----'].join(' ');
    const material = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(3);
    const dist = fakeBuild({
      'static/chunks/key.js': `const k = "${begin}\n${material}\n${end}";`,
      'static/chunks/escaped.js': 'const k = "' + begin + '\\n' + material + '\\n' + end + '";',
      'static/chunks/lib.js': `if (typeof e !== "string" || e.indexOf("${begin}") !== 0) throw new TypeError("x");`,
    });
    const hits = scanBuild(dist, {}).hits;
    expect(hits).toEqual(
      expect.arrayContaining([
        { label: 'a private key', file: 'static/chunks/key.js' },
        { label: 'a private key', file: 'static/chunks/escaped.js' },
      ]),
    );
    expect(hits.some((h: { file: string }) => h.file === 'static/chunks/lib.js')).toBe(false);
  });

  it('checks private terms in browser code only, by entry number', () => {
    const dist = fakeBuild({
      'static/chunks/d.js': 'const label = "Zyxwvut Qponml";',
      'server/app/about.html': '<p>Zyxwvut Qponml</p>',
    });
    const result = scanBuild(dist, { CONTENT_BLOCKLIST: 'ab|zyxwvut qponml|cs:Exactcase' });
    expect(result.hits).toEqual([{ label: 'CONTENT_BLOCKLIST entry 2', file: 'static/chunks/d.js' }]);
    expect(JSON.stringify(result)).not.toContain('Zyxwvut');
  });

  it('counts a private term as a whole word, as the content check does, and only notes it inside longer words', () => {
    const dist = fakeBuild({
      'static/chunks/inside.js': 'const a = "prezyxwvutpost", b = zyxwvut_id, c = "Zyxwvut9";',
      'static/chunks/word.js': 'const s = "by Zyxwvut, 2026";',
      'static/chunks/case.js': 'const s = "zyxwvut";',
    });
    const loose = scanBuild(dist, { CONTENT_BLOCKLIST: 'zyxwvut' });
    const byFile = (x: { file: string }, y: { file: string }) => x.file.localeCompare(y.file);
    expect([...loose.hits].sort(byFile)).toEqual([
      { label: 'CONTENT_BLOCKLIST entry 1', file: 'static/chunks/case.js' },
      { label: 'CONTENT_BLOCKLIST entry 1', file: 'static/chunks/word.js' },
    ]);
    expect(loose.notes).toEqual([{ label: 'CONTENT_BLOCKLIST entry 1', file: 'static/chunks/inside.js' }]);
    // cs: keeps exact case: only the capitalized whole word counts, and the lower-case one is not noted.
    const exact = scanBuild(dist, { CONTENT_BLOCKLIST: 'cs:Zyxwvut' });
    expect(exact.hits).toEqual([{ label: 'CONTENT_BLOCKLIST entry 1', file: 'static/chunks/word.js' }]);
    expect(exact.notes).toEqual([{ label: 'CONTENT_BLOCKLIST entry 1', file: 'static/chunks/inside.js' }]);
    expect(JSON.stringify([loose, exact]).toLowerCase()).not.toContain('zyxwvut');
  });

  it('finds a value saved with pasted quotes in the form the app uses it (review AUTH-3)', () => {
    const dist = fakeBuild({ 'static/chunks/q.js': `const p = "${PASSWORD}";` });
    const result = scanBuild(dist, { ADMIN_PASSWORD: `'${PASSWORD}'` });
    expect(result.hits).toEqual([{ label: 'ADMIN_PASSWORD', file: 'static/chunks/q.js' }]);
  });

  it('reads secret variables from .env.local when the environment lacks them, and never returns them', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-secrets-root-'));
    made.push(root);
    fs.writeFileSync(path.join(root, '.env.local'), `SESSION_SECRET="${SECRET}"\nOTHER=ignored\nexport ADMIN_PASSWORD=from-file-only\n`);
    const env = scanEnvironment(root, { ADMIN_PASSWORD: PASSWORD });
    expect(env.SESSION_SECRET).toBe(SECRET);
    expect(env.ADMIN_PASSWORD).toBe(PASSWORD);
    expect(env.OTHER).toBeUndefined();
  });

  it('ignores blocklist entries too short to scan safely', () => {
    expect(blocklistTerms('ab| cd |longer entry|cs:Exact Name').map((t: { index: number }) => t.index)).toEqual([3, 4]);
  });
});
