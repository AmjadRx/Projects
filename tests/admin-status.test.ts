/**
 * GET /api/status and lib/admin/server/deploy.ts (ARCHITECTURE.md 7.6 and 11; docs/V3_PLAN.md
 * D-31, D-32, Q-31): names and states only, never a value; deploy state from Vercel or from
 * GitHub's deployment records; the draft's preview address. Synthetic settings only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as status } from '../app/api/status/route';
import rulesFile from '../content-rules.public.json';
import type { StatusResponse } from '../lib/admin/contract';
import {
  branchAlias,
  branchSlug,
  DEPLOY_MESSAGES,
  lookupDeploys,
  resolvePreview,
  vercelDeployments,
} from '../lib/admin/server/deploy';
import { ADMIN_VARIABLES } from '../lib/admin/server/env';
import { adminRequest, FakeGitHub, installFakeGitHub, stubAdminEnv, TEST_ENV } from './admin-github-fake';

let fake: FakeGitHub;

beforeEach(() => {
  stubAdminEnv();
  fake = installFakeGitHub();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function read(): Promise<{ body: StatusResponse; raw: string }> {
  const res = await status(adminRequest('GET', '/api/status'));
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toContain('no-store');
  const raw = await res.text();
  return { body: JSON.parse(raw) as StatusResponse, raw };
}

describe('GET /api/status', () => {
  it('reports names and states, and no secret value anywhere', async () => {
    const { body, raw } = await read();
    for (const value of Object.values(TEST_ENV)) {
      if (value === TEST_ENV.GITHUB_REPO || value === TEST_ENV.GITHUB_BRANCH || value === TEST_ENV.GITHUB_DRAFT_BRANCH) continue;
      expect(raw).not.toContain(value);
    }
    for (const term of TEST_ENV.CONTENT_BLOCKLIST.split('|')) expect(raw.toLowerCase()).not.toContain(term.replace(/^cs:/, '').toLowerCase());
    expect(raw).not.toContain('github_pat_');
    expect(raw).not.toContain('SYNTHETIC');

    expect(body.env.map((v) => v.name)).toEqual(ADMIN_VARIABLES.map((v) => v.name));
    expect(body.env.every((v) => Object.keys(v).sort().join() === 'name,note,present,required')).toBe(true);
    expect(body.env.find((v) => v.name === 'GITHUB_TOKEN')?.present).toBe(true);
    expect(body.env.find((v) => v.name === 'VERCEL_TEAM_ID')?.present).toBe(false);

    expect(body.github).toMatchObject({
      configured: true,
      ok: true,
      tokenKind: 'fine-grained',
      repo: 'owner/site-repo',
      liveBranch: 'main',
      draftBranch: 'draft',
      liveExists: true,
      draftExists: false,
      writeAccess: true,
    });
    expect(body.storage.blob).toEqual({ configured: true, host: 'teststore123.public.blob.vercel-storage.com' });
    expect(body.storage.repo).toEqual({ target: 'github', problem: null });
    expect(body.contentCheck).toEqual({ publicRules: rulesFile.rules.length, blocklistSet: true, failClosed: false });
    expect(body.deploy).toMatchObject({ source: 'github', draft: null, live: null });
    expect(body.deploy.detail).toContain(DEPLOY_MESSAGES.githubCannotRead);
    expect(body.preview).toEqual({ branch: 'draft', url: null });
    expect(body.session.expiresAt).toBeGreaterThan(Date.now());
    expect(body.runtime.node).toBe(process.version);
  });

  it('names the token kind by its prefix only', async () => {
    for (const [token, kind] of [
      ['ghp_SYNTHETIC0classic', 'classic'],
      ['ghs_SYNTHETIC0app', 'app'],
      ['ghu_SYNTHETIC0user', 'app'],
      ['SYNTHETIC0other', 'unknown'],
    ]) {
      vi.stubEnv('GITHUB_TOKEN', token);
      const { body, raw } = await read();
      expect(body.github.tokenKind).toBe(kind);
      expect(raw).not.toContain(token);
    }
  });

  it('reports the draft, how far it is ahead, and the deploy state from GitHub records', async () => {
    fake.refs.set('draft', fake.refs.get('main')!);
    const draft = fake.push('draft', { 'content/projects/raven.json': '{}' });
    fake.deployments = [
      {
        id: 1,
        sha: draft,
        environment: 'Preview',
        created_at: '2026-11-18T10:00:00Z',
        statuses: [
          { state: 'pending', created_at: '2026-11-18T10:00:01Z' },
          { state: 'success', environment_url: 'https://site-draft123.vercel.app', created_at: '2026-11-18T10:01:00Z' },
        ],
      },
      {
        id: 2,
        sha: fake.refs.get('main')!,
        environment: 'Production',
        created_at: '2026-11-17T10:00:00Z',
        statuses: [{ state: 'success', environment_url: 'https://site-live456.vercel.app', created_at: '2026-11-17T10:01:00Z' }],
      },
    ];
    // Without a Vercel token, deploy state comes from GitHub's records (Q-31).
    vi.stubEnv('VERCEL_TOKEN', '');
    const { body } = await read();
    expect(body.github).toMatchObject({ draftExists: true, ahead: 1, behind: 0 });
    expect(body.deploy).toMatchObject({
      source: 'github',
      detail: DEPLOY_MESSAGES.fromGitHub,
      draft: { state: 'ready', url: 'https://site-draft123.vercel.app', sha: draft },
      live: { state: 'ready', url: 'https://site-live456.vercel.app', sha: fake.refs.get('main') },
    });
    expect(body.preview).toEqual({ branch: 'draft', url: 'https://site-draft123.vercel.app' });
  });

  it('says plainly what is wrong with the GitHub settings, and still answers', async () => {
    fake.permissions = { push: false, pull: true };
    let { body } = await read();
    expect(body.github).toMatchObject({ ok: false, writeAccess: false });
    expect(body.github.detail).toContain('Read and write');

    vi.stubEnv('GITHUB_DRAFT_BRANCH', 'main');
    ({ body } = await read());
    expect(body.github.ok).toBe(false);
    expect(body.github.detail).toContain('GITHUB_DRAFT_BRANCH');

    fake.overrides.set('GET ', { status: 401, body: { message: 'Bad credentials' } });
    ({ body } = await read());
    expect(body.github).toMatchObject({ ok: false, configured: true });
    expect(body.github.detail).toContain('401');
  });

  it('reports local development without GitHub', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GITHUB_REPO', '');
    const { body } = await read();
    expect(body.github).toMatchObject({ configured: false, ok: false, tokenKind: null, repo: null });
    expect(body.storage.repo.target).toBe('disk');
    expect(body.deploy.source).toBe('none');
    expect(body.preview).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it('needs a session, and answers 503 without ADMIN_PASSWORD', async () => {
    expect((await status(adminRequest('GET', '/api/status', { session: false }))).status).toBe(401);
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect((await status(adminRequest('GET', '/api/status', { session: false }))).status).toBe(503);
  });
});

describe('the preview address', () => {
  it('works out the branch alias from the alias of this deployment', () => {
    expect(branchSlug('Sandbox/Draft_1')).toBe('sandbox-draft-1');
    const env = { VERCEL_BRANCH_URL: 'amjad-site-git-v3-amjads-projects.vercel.app', VERCEL_GIT_COMMIT_REF: 'v3' };
    expect(branchAlias(env, 'sandbox/draft_1')).toBe('https://amjad-site-git-sandbox-draft-1-amjads-projects.vercel.app');
    expect(branchAlias(env, 'draft')).toBe('https://amjad-site-git-draft-amjads-projects.vercel.app');
    expect(branchAlias({ ...env, VERCEL_GIT_COMMIT_REF: 'main' }, 'draft')).toBeNull();
    expect(branchAlias({}, 'draft')).toBeNull();
    expect(branchAlias(env, `draft-${'x'.repeat(60)}`)).toBeNull();
  });

  it('prefers the head deployment, then the alias, then DRAFT_PREVIEW_URL', () => {
    const head = 'a'.repeat(40);
    const deploy = { state: 'ready' as const, url: 'https://site-head.vercel.app', sha: head, createdAt: null };
    const env = {
      VERCEL_BRANCH_URL: 'site-git-v3-team.vercel.app',
      VERCEL_GIT_COMMIT_REF: 'v3',
      DRAFT_PREVIEW_URL: 'preview.example.com',
    };
    expect(resolvePreview({ env, draftBranch: 'draft', draftHead: head, draftDeploy: deploy }).preview?.url).toBe('https://site-head.vercel.app');
    expect(resolvePreview({ env, draftBranch: 'draft', draftHead: 'b'.repeat(40), draftDeploy: deploy }).preview?.url).toBe(
      'https://site-git-draft-team.vercel.app',
    );
    expect(resolvePreview({ env: { DRAFT_PREVIEW_URL: 'preview.example.com' }, draftBranch: 'draft' }).preview?.url).toBe('https://preview.example.com');
    const none = resolvePreview({ env: {}, draftBranch: 'draft' });
    expect(none).toEqual({ preview: { branch: 'draft', url: null }, reason: DEPLOY_MESSAGES.previewMissing });
    expect(resolvePreview({ env, draftBranch: null })).toEqual({ preview: null, reason: null });
  });
});

describe('deploy state from Vercel', () => {
  const settings = { token: 'SYNTHETICvercelTOKEN', projectId: 'prj_SYNTHETIC', teamId: 'team_SYNTHETIC' };
  const draft = 'd'.repeat(40);
  const live = 'e'.repeat(40);

  function vercelStub(reply: { status: number; body?: unknown }) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const stub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://api.vercel.com/')) return fake.fetch(input, init);
      calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
    });
    return { calls, stub };
  }

  it('matches deployments by commit, with the token only in the Authorization header', async () => {
    const { calls, stub } = vercelStub({
      status: 200,
      body: {
        deployments: [
          { url: 'site-1.vercel.app', created: 3, readyState: 'BUILDING', target: null, meta: { githubCommitSha: draft, githubCommitRef: 'draft' } },
          { url: 'site-2.vercel.app', created: 2, readyState: 'READY', target: 'production', meta: { githubCommitSha: live, githubCommitRef: 'main' } },
        ],
      },
    });
    const report = await lookupDeploys({ heads: { live, draft }, liveBranch: 'main', draftBranch: 'draft', fetch: stub, vercel: settings });
    expect(report).toMatchObject({
      source: 'vercel',
      draft: { state: 'building', url: 'https://site-1.vercel.app', sha: draft },
      live: { state: 'ready', url: 'https://site-2.vercel.app', sha: live },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.vercel.com/v7/deployments?projectId=prj_SYNTHETIC&limit=10&teamId=team_SYNTHETIC');
    expect(calls[0].url).not.toContain(settings.token);
    expect(calls[0].headers.authorization).toBe(`Bearer ${settings.token}`);
    expect(JSON.stringify(report)).not.toContain(settings.token);
  });

  it('falls back to GitHub records when Vercel refuses, and says so', async () => {
    const { stub } = vercelStub({ status: 403, body: { error: { message: `token ${settings.token} refused` } } });
    fake.deployments = [];
    const report = await lookupDeploys({ heads: { live, draft }, liveBranch: 'main', draftBranch: 'draft', fetch: stub, vercel: settings });
    expect(report.source).toBe('github');
    expect(report.detail).toContain(DEPLOY_MESSAGES.vercelRefused(403));
    expect(JSON.stringify(report)).not.toContain(settings.token);
  });

  it('maps every Vercel state', async () => {
    const { stub } = vercelStub({
      status: 200,
      body: {
        deployments: ['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED', 'SOMETHING'].map((state, i) => ({
          url: `site-${i}.vercel.app`,
          created: i,
          readyState: state,
          meta: { githubCommitSha: String(i).repeat(40) },
        })),
      },
    });
    const list = await vercelDeployments(settings, stub);
    expect(list.map((d) => d.state)).toEqual(['unknown', 'canceled', 'error', 'ready', 'building', 'queued', 'queued']);
  });
});
