/**
 * POST /api/check (ARCHITECTURE.md 12; docs/V3_PLAN.md D-19, D-24, D-76): the public patterns and
 * the private terms over text taken from a file before upload. A private-term hit names its rule,
 * never the term. The terms here are synthetic.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as check } from '../app/api/check/route';
import { MAX_CHECK_ITEMS, type CheckResponse } from '../lib/admin/contract';
import { blocklistState, checkContent, checkTexts, requireBlocklist } from '../lib/admin/server/content-check';
import { ApiFailure } from '../lib/admin/server/guard';
import { adminRequest, installFakeGitHub, ORIGIN, stubAdminEnv } from './admin-github-fake';

/** Built from its code point, so this file holds no dash character. */
const EM_DASH = String.fromCharCode(0x2014);

beforeEach(() => {
  stubAdminEnv();
  installFakeGitHub();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function post(body: unknown, options: { origin?: string | null; session?: boolean } = {}): Promise<Response> {
  return check(adminRequest('POST', '/api/check', { body, ...options }));
}

describe('POST /api/check', () => {
  it('passes clean text', async () => {
    const res = await post({ source: 'Bench report.pdf', items: [{ label: 'page 1', text: 'Bench notes for the pack.' }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, findings: [] });
  });

  it('names a public rule by id under the file and the label', async () => {
    const res = await post({
      source: 'Bench report.pdf',
      items: [
        { label: 'page 1', text: 'Clean words.' },
        { label: 'page 2', text: `A dash ${EM_DASH} here.` },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CheckResponse;
    expect(body.findings).toEqual([
      { file: 'Bench report.pdf', path: 'page 2', rule: 'DASH', message: expect.any(String), severity: 'error' },
    ]);
  });

  it('names a private-term hit by rule only, never the term', async () => {
    const res = await post({ source: 'parts.glb', items: [{ label: 'part names', text: 'bracket, ZORBLAXIAN housing, cover' }] });
    const raw = await res.text();
    expect(raw.toLowerCase()).not.toContain('zorblaxian');
    const body = JSON.parse(raw) as CheckResponse;
    expect(body.findings).toEqual([expect.objectContaining({ file: 'parts.glb', path: 'part names', rule: 'BLOCKLIST', severity: 'error' })]);
  });

  it('matches whole words only, and cs: terms with exact case', () => {
    const state = blocklistState();
    expect(checkTexts('a', [{ label: 'x', text: 'zorblaxianish' }], state)).toEqual([]);
    expect(checkTexts('a', [{ label: 'x', text: 'quuxworth' }], state)).toEqual([]);
    expect(checkTexts('a', [{ label: 'x', text: 'Quuxworth' }], state)).toHaveLength(1);
  });

  it('answers 503 on Vercel and in CI without CONTENT_BLOCKLIST', async () => {
    vi.stubEnv('CONTENT_BLOCKLIST', '');
    vi.stubEnv('VERCEL', '1');
    let res = await post({ source: 'a.pdf', items: [{ label: 'page 1', text: 'words' }] });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'not-configured', missing: ['CONTENT_BLOCKLIST'] });
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CI', 'true');
    res = await post({ source: 'a.pdf', items: [{ label: 'page 1', text: 'words' }] });
    expect(res.status).toBe(503);
    // A blank list (only bars) is no list.
    vi.stubEnv('CONTENT_BLOCKLIST', ' | ');
    expect((await post({ source: 'a.pdf', items: [] })).status).toBe(503);
  });

  it('runs the public rules alone on the owner machine without CONTENT_BLOCKLIST', async () => {
    vi.stubEnv('CONTENT_BLOCKLIST', '');
    const res = await post({ source: 'a.pdf', items: [{ label: 'page 1', text: `zorblaxian ${EM_DASH}` }] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as CheckResponse).findings.map((f) => f.rule)).toEqual(['DASH']);
  });

  it('refuses a request without an Origin header, without a session, or with a bad body', async () => {
    const body = { source: 'a.pdf', items: [{ label: 'page 1', text: 'words' }] };
    let res = await post(body, { origin: null });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden-origin' });
    expect((await post(body, { session: false })).status).toBe(401);
    expect((await post({ source: '', items: [] })).status).toBe(400);
    expect((await post({ ...body, extra: 1 })).status).toBe(400);
    const tooMany = { source: 'a.pdf', items: Array.from({ length: MAX_CHECK_ITEMS + 1 }, () => ({ label: 'x', text: 'y' })) };
    expect((await post(tooMany)).status).toBe(400);
    const form = new NextRequest(`${ORIGIN}/api/check`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'text/plain', cookie: adminRequest('GET', '/').headers.get('cookie')! },
      body: 'words',
    });
    expect((await check(form)).status).toBe(415);
  });

  it('answers 503 without ADMIN_PASSWORD', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    const res = await post({ source: 'a.pdf', items: [] }, { session: false });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'not-configured', missing: ['ADMIN_PASSWORD'] });
  });
});

describe('the content check over whole content', () => {
  it('reports a missing site file, and warns on the owner machine that private terms were not checked', () => {
    vi.stubEnv('CONTENT_BLOCKLIST', '');
    const result = checkContent([]);
    expect(result.errors).toEqual([expect.objectContaining({ file: 'content/site.json', rule: 'SCHEMA' })]);
    expect(result.warnings).toEqual([expect.objectContaining({ rule: 'BLOCKLIST', path: 'CONTENT_BLOCKLIST', severity: 'warning' })]);
  });

  it('fails closed where it must', () => {
    vi.stubEnv('CONTENT_BLOCKLIST', '');
    vi.stubEnv('VERCEL', '1');
    let error: unknown;
    try {
      requireBlocklist();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiFailure);
    expect((error as ApiFailure).status).toBe(503);
  });
});
