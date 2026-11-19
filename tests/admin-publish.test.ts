/**
 * GET and POST /api/publish and POST /api/discard (ARCHITECTURE.md 7.1; docs/V3_PLAN.md D-18,
 * D-20, D-27, D-31, Q-30, 5.7, R-07), against the in-memory GitHub in ./admin-github-fake.ts.
 * Publish is a fast-forward only, never into main outside production, and never with a draft head
 * the owner did not see. Synthetic settings only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getContent } from '../app/api/content/route';
import { POST as discard } from '../app/api/discard/route';
import { GET as getPlan, POST as publish } from '../app/api/publish/route';
import { POST as save } from '../app/api/save/route';
import { serializeContent, type ContentResponse, type PublishPlan } from '../lib/admin/contract';
import { DEPLOY_MESSAGES } from '../lib/admin/server/deploy';
import { REPO_MESSAGES } from '../lib/admin/server/repo';
import { adminRequest, FakeGitHub, installFakeGitHub, saveBodyFrom, stubAdminEnv } from './admin-github-fake';

type Json = Record<string, any>;

const RAVEN = 'content/projects/raven.json';
const BLOB = 'https://teststore123.public.blob.vercel-storage.com/media/raven/clip-AbC123xyz.mp4';

let fake: FakeGitHub;

beforeEach(() => {
  stubAdminEnv();
  fake = installFakeGitHub();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function load(): Promise<ContentResponse> {
  return (await (await getContent(adminRequest('GET', '/api/content'))).json()) as ContentResponse;
}

/** Saves an edit of raven's pitch (and, when given, its cover) to the draft, and returns the new draft head. */
async function saveEdit(note: string, cover?: string): Promise<string> {
  const content = await load();
  const raven = structuredClone(content.projects.find((p) => p.file === RAVEN)!.data) as Json;
  raven.pitch = `${raven.pitch} ${note}`;
  if (cover) raven.cover = { kind: 'video', src: cover, alt: '' };
  const res = await save(adminRequest('POST', '/api/save', { body: saveBodyFrom(content, [{ path: RAVEN, data: raven }]) }));
  expect(res.status).toBe(200);
  return (await res.json()).head;
}

async function plan(): Promise<PublishPlan> {
  const res = await getPlan(adminRequest('GET', '/api/publish'));
  expect(res.status).toBe(200);
  return (await res.json()) as PublishPlan;
}

describe('the publish plan', () => {
  it('has nothing to publish before the first save', async () => {
    const result = await plan();
    expect(result).toMatchObject({ ok: true, liveBranch: 'main', draftBranch: 'draft', draftHead: null, ahead: 0, allowed: false });
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('lists the changed files and the Blob addresses the draft adds', async () => {
    vi.stubEnv('GITHUB_BRANCH', 'sandbox-live');
    vi.stubEnv('GITHUB_DRAFT_BRANCH', 'sandbox-draft');
    fake.refs.set('sandbox-live', fake.refs.get('main')!);
    const head = await saveEdit('Planned.', BLOB);
    const result = await plan();
    expect(result).toMatchObject({
      liveBranch: 'sandbox-live',
      draftBranch: 'sandbox-draft',
      draftHead: head,
      ahead: 1,
      behind: 0,
      diverged: false,
      files: [{ path: RAVEN, status: 'modified' }],
      blob: { added: [BLOB], removed: [] },
      allowed: true,
      reasons: [],
    });
  });

  it('is not allowed into main outside the production deployment', async () => {
    await saveEdit('Planned.');
    const result = await plan();
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain(REPO_MESSAGES.publishOutsideProduction);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect((await plan()).allowed).toBe(true);
  });

  it('stays disabled while the draft preview builds, and after it failed', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const head = await saveEdit('Planned.');
    fake.deployments = [
      {
        id: 7,
        sha: head,
        environment: 'Preview',
        created_at: '2026-11-18T10:00:00Z',
        statuses: [{ state: 'in_progress', created_at: '2026-11-18T10:00:05Z' }],
      },
    ];
    let result = await plan();
    expect(result.deploy).toMatchObject({ state: 'building', sha: head });
    expect(result.reasons).toEqual([DEPLOY_MESSAGES.stillBuilding]);
    fake.deployments[0].statuses.push({ state: 'failure', created_at: '2026-11-18T10:01:00Z' });
    result = await plan();
    expect(result.reasons).toEqual([DEPLOY_MESSAGES.buildFailed]);
    fake.deployments[0].statuses.push({ state: 'success', environment_url: 'https://site-abc123.vercel.app', created_at: '2026-11-18T10:02:00Z' });
    result = await plan();
    expect(result).toMatchObject({ allowed: true, deploy: { state: 'ready', url: 'https://site-abc123.vercel.app' } });
  });

  it('reports a diverged draft', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    await saveEdit('Draft.');
    fake.push('main', { 'content/projects/palmsync.json': '{}' });
    const result = await plan();
    expect(result).toMatchObject({ ahead: 1, behind: 1, diverged: true, allowed: false });
    expect(result.reasons).toContain(REPO_MESSAGES.diverged);
  });
});

describe('POST /api/publish', () => {
  it('fast-forwards main to the confirmed draft head on the production deployment, and writes nothing else', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const head = await saveEdit('Publish me.');
    const before = fake.calls.length;
    const res = await publish(adminRequest('POST', '/api/publish', { body: { draftHead: head } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, liveHead: head });
    expect(fake.refs.get('main')).toBe(head);
    const writes = fake.calls.slice(before).filter((call) => call.method !== 'GET');
    expect(writes).toEqual([expect.objectContaining({ method: 'PATCH', path: '/git/refs/heads/main', body: { sha: head, force: false } })]);
  });

  it('refuses a draft head the owner did not see', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const seen = await saveEdit('First.');
    await saveEdit('Second.');
    const live = fake.refs.get('main');
    const res = await publish(adminRequest('POST', '/api/publish', { body: { draftHead: seen } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'conflict', error: 'The draft changed after you opened the dialog. Review it again.' });
    expect(fake.refs.get('main')).toBe(live);
  });

  it('refuses to publish into main outside the production deployment', async () => {
    const head = await saveEdit('Not on a preview.');
    const live = fake.refs.get('main');
    const res = await publish(adminRequest('POST', '/api/publish', { body: { draftHead: head } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'not-allowed', error: REPO_MESSAGES.publishOutsideProduction });
    expect(fake.refs.get('main')).toBe(live);
    expect(fake.calls.some((call) => call.method !== 'GET' && call.path.includes('heads/main'))).toBe(false);
  });

  it('refuses when live has commits the draft lacks', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const head = await saveEdit('Draft.');
    const live = fake.push('main', { 'content/projects/palmsync.json': '{}' });
    const res = await publish(adminRequest('POST', '/api/publish', { body: { draftHead: head } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'diverged' });
    expect(fake.refs.get('main')).toBe(live);
  });

  it('refuses when there is nothing to publish', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    fake.refs.set('draft', fake.refs.get('main')!);
    const res = await publish(adminRequest('POST', '/api/publish', { body: { draftHead: fake.refs.get('main') } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'not-allowed' });
  });

  it('refuses a request without an Origin header, without a session, or with a bad body', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const head = await saveEdit('Draft.');
    const live = fake.refs.get('main');
    let res = await publish(adminRequest('POST', '/api/publish', { body: { draftHead: head }, origin: null }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden-origin' });
    res = await publish(adminRequest('POST', '/api/publish', { body: { draftHead: head }, session: false }));
    expect(res.status).toBe(401);
    res = await publish(adminRequest('POST', '/api/publish', { body: { draftHead: 'main' } }));
    expect(res.status).toBe(400);
    expect(fake.refs.get('main')).toBe(live);
  });
});

describe('POST /api/discard', () => {
  it('resets the draft to the live head', async () => {
    const live = fake.refs.get('main')!;
    await saveEdit('Throw me away.');
    const draftHead = fake.refs.get('draft');
    expect(draftHead).not.toBe(live);
    const res = await discard(adminRequest('POST', '/api/discard', { body: { confirm: true, draftHead } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, head: live });
    expect(fake.refs.get('draft')).toBe(live);
    expect(fake.refs.get('main')).toBe(live);
    expect(fake.calls.filter((call) => call.method === 'PATCH').pop()).toMatchObject({ path: '/git/refs/heads/draft', body: { sha: live, force: true } });
    const content = await load();
    expect(serializeContent(content.projects.find((p) => p.file === RAVEN)!.data)).toBe(fake.filesAt('main').get(RAVEN));
  });

  it('refuses without the confirmation, without an Origin header, or without a session', async () => {
    const head = await saveEdit('Keep me.');
    expect((await discard(adminRequest('POST', '/api/discard', { body: { draftHead: head } }))).status).toBe(400);
    expect((await discard(adminRequest('POST', '/api/discard', { body: { confirm: true } }))).status).toBe(400);
    expect((await discard(adminRequest('POST', '/api/discard', { body: { confirm: true, draftHead: head }, origin: null }))).status).toBe(403);
    expect((await discard(adminRequest('POST', '/api/discard', { body: { confirm: true, draftHead: head }, session: false }))).status).toBe(401);
    expect(fake.refs.get('draft')).toBe(head);
  });
});

describe('on the local disk', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GITHUB_REPO', '');
  });

  it('has no draft to publish or discard', async () => {
    let res = await getPlan(adminRequest('GET', '/api/publish'));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'not-allowed', error: REPO_MESSAGES.noDraftOnDisk });
    res = await publish(adminRequest('POST', '/api/publish', { body: { draftHead: 'a'.repeat(40) } }));
    expect(res.status).toBe(409);
    res = await discard(adminRequest('POST', '/api/discard', { body: { confirm: true, draftHead: null } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'not-allowed', error: REPO_MESSAGES.noDraftOnDisk });
    expect(fake.calls).toEqual([]);
  });
});
