/**
 * GET /api/status and lib/admin/server/deploy.ts (ARCHITECTURE.md 7.6 and 11; docs/V3_PLAN.md
 * D-31, D-32, Q-31): names and states only, never a value; write access only where GitHub's
 * answer shows it; the draft head and its unpublished commits; deploy state from Vercel or from
 * GitHub's deployment records, or why it cannot be read; the draft's preview address; and how the
 * status panel shows them, claiming nothing it cannot know. Synthetic settings only.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as status } from '../app/api/status/route';
import { BLOB_ACCESS_HINT, StatusDetails } from '../components/admin/shell/StatusPanel';
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
import { adminRequest, FAKE_REPO, FakeGitHub, installFakeGitHub, stubAdminEnv, TEST_ENV, type FakeDeployment } from './admin-github-fake';

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

/** Text as React writes it into HTML. */
function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/** What the status panel shows in one row for an answer, as HTML. */
function panelRow(body: StatusResponse, term: string): string {
  const html = renderToStaticMarkup(h(StatusDetails, { status: body }));
  const row = new RegExp(`<dt class="adm-dl__term">${term}</dt><dd class="adm-dl__desc">(.*?)</dd>`).exec(html);
  expect(row, `the ${term} row`).not.toBeNull();
  return row![1];
}

/** The repository as GitHub answers for it, with or without `private`, `archived`, and `permissions`. */
function repository(fields: { private?: boolean; archived?: boolean; permissions?: Record<string, boolean> }) {
  return { status: 200, body: { full_name: FAKE_REPO, ...fields } };
}

const NOT_KNOWN = '<span class="adm-badge adm-badge--neutral">not known</span>';

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
      draftHead: null,
      draftCommits: null,
      // GitHub says the account may push; a fine-grained token's own permissions are not in the answer.
      writeAccess: null,
    });
    expect(body.storage.blob).toEqual({ configured: true, host: 'teststore123.public.blob.vercel-storage.com' });
    expect(body.storage.repo).toEqual({ target: 'github', problem: null });
    expect(body.contentCheck).toEqual({ publicRules: rulesFile.rules.length, blocklistSet: true, failClosed: false });
    // No draft head to ask about; the published head's records cannot be read (403), and that is said, not "none".
    expect(body.deploy).toMatchObject({ source: 'github', draft: null, live: null, draftUnknown: null });
    expect(body.deploy.detail).toContain(DEPLOY_MESSAGES.githubCannotRead);
    expect(body.deploy.liveUnknown).toContain(DEPLOY_MESSAGES.githubCannotRead);
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

  it("says whether the token can write only where GitHub's answer shows it", async () => {
    // The preview's failure: GitHub reports the account's push permission for a fine-grained token
    // that may only read, and every save got 403. That answer must not read as "yes".
    fake.permissions = { admin: true, maintain: true, push: true, triage: true, pull: true };
    let { body } = await read();
    expect(body.github).toMatchObject({ tokenKind: 'fine-grained', ok: true, writeAccess: null });
    expect(body.github.writeDetail).toContain("A fine-grained token's own permissions cannot be read from GitHub");
    expect(body.github.writeDetail).toContain('The first save shows them');
    expect(body.github.writeDetail).toContain('names the permission GitHub asked for');
    expect(body.github.writeDetail).toContain('Contents: Read and write');

    // A classic token sees a private repository only with the repo scope, and that scope writes.
    const classic = ['ghp', 'SYNTHETIC0classic0token'].join('_');
    vi.stubEnv('GITHUB_TOKEN', classic);
    fake.overrides.set('GET ', repository({ private: true, permissions: { push: true, pull: true } }));
    ({ body } = await read());
    expect(body.github).toMatchObject({ tokenKind: 'classic', ok: true, writeAccess: true, writeDetail: null });

    // On a public repository its scopes decide, and this check does not read them.
    fake.overrides.set('GET ', repository({ private: false, permissions: { push: true, pull: true } }));
    ({ body } = await read());
    expect(body.github).toMatchObject({ tokenKind: 'classic', ok: true, writeAccess: null });
    expect(body.github.writeDetail).toContain('Whether this token can write is not known here');
    expect(body.github.writeDetail).toContain("this check does not read the token's own scopes");
    expect(body.github.writeDetail).toContain('The first save shows it');
    expect(body.github.writeDetail).not.toContain("GitHub's answer does not show");

    // An app token, and an answer without permissions: not known either.
    vi.stubEnv('GITHUB_TOKEN', ['ghs', 'SYNTHETIC0app0token'].join('_'));
    fake.overrides.set('GET ', repository({ private: true, permissions: { push: true, pull: true } }));
    ({ body } = await read());
    expect(body.github).toMatchObject({ tokenKind: 'app', ok: true, writeAccess: null });
    vi.stubEnv('GITHUB_TOKEN', classic);
    fake.overrides.set('GET ', repository({ private: true }));
    ({ body } = await read());
    expect(body.github).toMatchObject({ ok: true, writeAccess: null });
    expect(body.github.writeDetail).toContain('The first save shows it');

    // An account that cannot push leaves every token of it read-only: that "no" is known for any kind.
    for (const token of [TEST_ENV.GITHUB_TOKEN, classic]) {
      vi.stubEnv('GITHUB_TOKEN', token);
      fake.overrides.set('GET ', repository({ private: true, permissions: { push: false, pull: true } }));
      ({ body } = await read());
      expect(body.github).toMatchObject({ ok: false, writeAccess: false, writeDetail: null });
    }

    // GitHub refuses every write to an archived repository, whatever the account may do: "no", and the
    // connection says why, for a classic token on a private repository as for a fine-grained one.
    for (const token of [classic, TEST_ENV.GITHUB_TOKEN]) {
      vi.stubEnv('GITHUB_TOKEN', token);
      fake.overrides.set('GET ', repository({ private: true, archived: true, permissions: { push: true, pull: true } }));
      ({ body } = await read());
      expect(body.github).toMatchObject({ ok: false, writeAccess: false, writeDetail: null });
      expect(body.github.detail).toBe('The repository is archived, so GitHub refuses every write to it. Unarchive it in its settings on GitHub.');
      expect(panelRow(body, 'Write access')).toBe('<span class="adm-badge adm-badge--error">no</span>');
      expect(panelRow(body, 'Connection')).toContain('>failing</span> The repository is archived');
    }
  });

  it('shows "not known" and why in the panel for a fine-grained token, never "yes"', async () => {
    const { body } = await read();
    const row = panelRow(body, 'Write access');
    expect(row).toContain('>not known</span>');
    expect(row).not.toContain('>yes</span>');
    expect(row).toContain(escaped(body.github.writeDetail!));

    fake.permissions = { push: false, pull: true };
    expect(panelRow((await read()).body, 'Write access')).toBe('<span class="adm-badge adm-badge--error">no</span>');
  });

  it("says in the Vercel Blob row that a private store refuses the site's uploads", async () => {
    let { body } = await read();
    let row = panelRow(body, 'Vercel Blob');
    expect(row).toContain('>connected</span>');
    expect(row).toContain(`<p class="adm-muted">${escaped(BLOB_ACCESS_HINT)}</p>`);
    // The public host comes from the token, which does not say the store is public: it is given only as such.
    expect(row).toContain(
      '</span> If the store is public, its files are served from <span class="adm-mono">teststore123.public.blob.vercel-storage.com</span>.',
    );
    expect(row).not.toContain('connected</span> <span class="adm-mono">');

    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    ({ body } = await read());
    row = panelRow(body, 'Vercel Blob');
    expect(row).toContain('>not connected</span>');
    expect(row).toContain(escaped(BLOB_ACCESS_HINT));
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
    expect(body.github).toMatchObject({ draftExists: true, draftHead: draft, ahead: 1, behind: 0 });
    expect(body.deploy).toMatchObject({
      source: 'github',
      detail: DEPLOY_MESSAGES.fromGitHub,
      draft: { state: 'ready', url: 'https://site-draft123.vercel.app', sha: draft },
      live: { state: 'ready', url: 'https://site-live456.vercel.app', sha: fake.refs.get('main') },
      draftUnknown: null,
      liveUnknown: null,
    });
    expect(body.preview).toEqual({ branch: 'draft', url: 'https://site-draft123.vercel.app' });
    expect(panelRow(body, 'Draft')).toContain('>ready</span>');
    expect(panelRow(body, 'Published')).toContain('>ready</span>');
  });

  it("lists the draft's unpublished commits, for the preview watch", async () => {
    const main = fake.refs.get('main')!;
    fake.refs.set('draft', main);
    let { body } = await read();
    expect(body.github).toMatchObject({ draftHead: main, ahead: 0, behind: 0, draftCommits: [] });

    const first = fake.push('draft', { 'content/projects/raven.json': '{}' });
    const second = fake.push('draft', { 'public/media/site/new.webp': new Uint8Array([1, 2, 3]) });
    // The fake's compare leaves the list out, so the commits are not known.
    ({ body } = await read());
    expect(body.github).toMatchObject({ draftHead: second, ahead: 2, draftCommits: null });

    // GitHub's compare lists them oldest first; anything that is not a commit id is left out.
    fake.overrides.set(`GET /compare/${main}...${second}`, {
      status: 200,
      body: { status: 'ahead', ahead_by: 2, behind_by: 0, commits: [{ sha: first }, { sha: 'not-a-commit' }, {}, { sha: second }] },
    });
    ({ body } = await read());
    expect(body.github).toMatchObject({ draftHead: second, ahead: 2, behind: 0, draftCommits: [first, second] });
  });

  it('shows deployments it could not read as not known, and never says the draft head has none', async () => {
    fake.refs.set('draft', fake.refs.get('main')!);
    const draft = fake.push('draft', { 'content/projects/raven.json': '{}' });
    vi.stubEnv('VERCEL_TOKEN', '');
    // fake.deployments is null: GitHub answers 403, as for a token without Deployments read.
    let { body } = await read();
    expect(body.deploy).toMatchObject({
      source: 'github',
      draft: null,
      live: null,
      draftUnknown: DEPLOY_MESSAGES.githubCannotRead,
      liveUnknown: DEPLOY_MESSAGES.githubCannotRead,
    });
    expect(body.deploy.detail).toBe(
      `${DEPLOY_MESSAGES.githubCannotRead} No preview address yet: the deployment of the draft head could not be read, ` +
        'this deployment has no branch alias (VERCEL_BRANCH_URL), and DRAFT_PREVIEW_URL is not set.',
    );
    expect(panelRow(body, 'Draft')).toBe(NOT_KNOWN);
    expect(panelRow(body, 'Published')).toBe(NOT_KNOWN);

    // Without a draft head, the failed lookup still leaves the published head not known.
    fake.refs.delete('draft');
    ({ body } = await read());
    expect(body.deploy).toMatchObject({ draftUnknown: null, liveUnknown: DEPLOY_MESSAGES.githubCannotRead });
    expect(panelRow(body, 'Published')).toBe(NOT_KNOWN);

    // Once the lookup answers, a head without a deployment has none, and the preview sentence may say so.
    fake.refs.set('draft', draft);
    const records: FakeDeployment[] = [];
    fake.deployments = records;
    ({ body } = await read());
    expect(body.deploy).toMatchObject({ draftUnknown: null, liveUnknown: null });
    expect(panelRow(body, 'Draft')).toBe('No deployment found.');
    expect(panelRow(body, 'Published')).toBe('No deployment found.');
    expect(body.deploy.detail).toBe(`${DEPLOY_MESSAGES.fromGitHub} ${DEPLOY_MESSAGES.previewMissing}`);

    // A deployment still building has no address yet: it exists, so the sentence does not say it is missing.
    records.push({ id: 1, sha: draft, environment: 'Preview', created_at: '2026-11-18T10:00:00Z', statuses: [{ state: 'in_progress', created_at: '2026-11-18T10:00:01Z' }] });
    ({ body } = await read());
    expect(body.deploy.draft).toMatchObject({ state: 'building', sha: draft, url: null });
    expect(body.deploy.detail).toContain('No preview address yet: the deployment of the draft head has none so far');
    expect(body.deploy.detail).not.toContain('the draft head has no deployment');
  });

  it('says plainly what is wrong with the GitHub settings, and still answers', async () => {
    // The push permission belongs to the account behind the token: that account cannot write, so
    // no grant on the token helps, and the sentence says what does.
    fake.permissions = { push: false, pull: true };
    let { body } = await read();
    expect(body.github).toMatchObject({ ok: false, writeAccess: false, writeDetail: null });
    expect(body.github.detail).toBe(
      'The account (or app) behind the token cannot push to this repository, so the token cannot write to it either. Give ' +
        'that account write access, or use a token of an account that has it, with Contents: Read and write.',
    );
    expect(body.github.detail).not.toContain('The token can read the repository but cannot write to it');

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
