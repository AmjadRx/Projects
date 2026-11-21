/**
 * The admin's repository (lib/admin/server/repo.ts): branch settings with no default, path checks
 * before any request, reads from draft or live, D-20's draft preparation, one commit per save,
 * publish by fast-forward only, discard, and the disk in local development. GitHub is the
 * in-memory fake in ./admin-github-fake.ts; settings are synthetic.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { serializeContent } from '../lib/admin/contract';
import { ApiFailure } from '../lib/admin/server/guard';
import { getContentRepo, gitBlobSha, isRepoDirPath, isRepoFilePath, REPO_MESSAGES, type ContentRepo } from '../lib/admin/server/repo';
import { FakeGitHub, ROOT, seedFiles, stubAdminEnv, TEST_ENV } from './admin-github-fake';

const encoder = new TextEncoder();
const text = (bytes: Uint8Array | null) => (bytes === null ? null : new TextDecoder().decode(bytes));

async function failure(promise: Promise<unknown>): Promise<ApiFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiFailure) return error;
    throw error;
  }
  throw new Error('expected an ApiFailure, but the call succeeded');
}

function thrown(run: () => unknown): ApiFailure {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiFailure) return error;
    throw error;
  }
  throw new Error('expected an ApiFailure');
}

let fake: FakeGitHub;

function repo(): ContentRepo {
  return getContentRepo(process.env, { fetch: fake.fetch });
}

beforeEach(() => {
  stubAdminEnv();
  fake = new FakeGitHub();
  fake.init('main', seedFiles(ROOT));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('settings', () => {
  it('uses GitHub with both branches named', () => {
    const r = repo();
    expect(r.source).toBe('github');
    expect(r.liveBranch).toBe('main');
    expect(r.draftBranch).toBe('draft');
  });

  it('has no default branch: a missing GITHUB_BRANCH or GITHUB_DRAFT_BRANCH is a 503 that names it', () => {
    vi.stubEnv('GITHUB_BRANCH', '');
    let error = thrown(() => repo());
    expect(error.status).toBe(503);
    expect(error.code).toBe('not-configured');
    expect(error.extra.missing).toEqual(['GITHUB_BRANCH']);

    vi.stubEnv('GITHUB_BRANCH', 'main');
    vi.stubEnv('GITHUB_DRAFT_BRANCH', '');
    error = thrown(() => repo());
    expect(error.extra.missing).toEqual(['GITHUB_DRAFT_BRANCH']);
  });

  it('refuses a draft branch that is main or the live branch', () => {
    for (const [live, draft] of [
      ['main', 'main'],
      ['sandbox-live', 'Sandbox-Live'],
      ['sandbox-live', 'MAIN'],
    ]) {
      vi.stubEnv('GITHUB_BRANCH', live);
      vi.stubEnv('GITHUB_DRAFT_BRANCH', draft);
      const error = thrown(() => repo());
      expect(error.status).toBe(503);
      expect(error.extra.missing).toEqual(['GITHUB_DRAFT_BRANCH']);
    }
  });

  it('names the missing half of the GitHub settings', () => {
    vi.stubEnv('GITHUB_REPO', '');
    const error = thrown(() => repo());
    expect(error.status).toBe(503);
    expect(error.extra.missing).toEqual(['GITHUB_REPO']);
  });

  it('refuses to run without GitHub on a read-only server, and uses the disk in development', () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GITHUB_REPO', '');
    expect(getContentRepo(process.env, { rootDir: os.tmpdir() }).source).toBe('disk');
    vi.stubEnv('VERCEL', '1');
    const error = thrown(() => repo());
    expect(error.status).toBe(503);
    expect(error.extra.missing).toEqual(expect.arrayContaining(['GITHUB_TOKEN', 'GITHUB_REPO']));
  });
});

describe('paths', () => {
  const refused = [
    '../.env',
    '.env.local',
    'content/../package.json',
    'content/projects/../site.json',
    'content/projects/Raven.json',
    'content/projects/raven.json/',
    'content/projects/sub/raven.json',
    'public/media/raven/../../../package.json',
    'public/media/Raven/a.png',
    'public/media/raven/.gitkeep',
    'public/media/raven/a\\b.png',
    'public/media/raven',
    'public/a.png',
    'package.json',
    '/content/site.json',
  ];

  it('accepts content files and public/media/<folder>/<name> only', () => {
    expect(isRepoFilePath('content/site.json')).toBe(true);
    expect(isRepoFilePath('content/projects/raven.json')).toBe(true);
    expect(isRepoFilePath('public/media/raven/img-7657.jpeg')).toBe(true);
    expect(isRepoFilePath('public/media/site/clip-AbC123.mp4')).toBe(true);
    for (const bad of refused) expect(isRepoFilePath(bad)).toBe(false);
    expect(isRepoDirPath('public/media')).toBe(true);
    expect(isRepoDirPath('public/media/raven')).toBe(true);
    expect(isRepoDirPath('content/projects')).toBe(true);
    for (const bad of ['public', 'public/media/..', 'public/media/raven/x', '.', '', 'content/..']) expect(isRepoDirPath(bad)).toBe(false);
  });

  it('refuses a bad path with 400 and rule PATH before any request', async () => {
    const r = repo();
    for (const bad of refused) {
      const read = await failure(r.readFile('draft', bad));
      expect(read.status).toBe(400);
      expect(read.code).toBe('bad-request');
      expect(read.extra.findings?.[0]).toMatchObject({ file: bad, path: '(path)', rule: 'PATH', severity: 'error' });
      const write = await failure(r.commit(fake.refs.get('main')!, [{ path: bad, bytes: encoder.encode('x') }], 'x'));
      expect(write.status).toBe(400);
    }
    const list = await failure(r.listFiles('draft', 'public'));
    expect(list.status).toBe(400);
    expect(fake.calls).toEqual([]);
  });

  it('refuses the same path twice in one commit', async () => {
    const r = repo();
    const error = await failure(
      r.commit(fake.refs.get('main')!, [
        { path: 'content/site.json', bytes: encoder.encode('{}') },
        { path: 'content/site.json', bytes: null },
      ], 'x'),
    );
    expect(error.status).toBe(400);
    expect(fake.calls).toEqual([]);
  });
});

describe('reading', () => {
  it('reads the live branch while there is no draft, as stored', async () => {
    const snapshot = await repo().readContent();
    expect(snapshot).toMatchObject({ source: 'github', ref: 'live', head: fake.refs.get('main') });
    const seed = seedFiles(ROOT);
    expect(snapshot.files.map((f) => f.path)).toEqual([...seed.keys()].filter((p) => p.startsWith('content/')));
    for (const file of snapshot.files) {
      expect(file.text).toBe(text(seed.get(file.path)!));
      // Every seed file round-trips through the stored format.
      expect(serializeContent(JSON.parse(file.text))).toBe(file.text);
    }
  });

  it('reads the draft once it exists, and live when asked', async () => {
    fake.refs.set('draft', fake.refs.get('main')!);
    const draftHead = fake.push('draft', { 'content/projects/new-thing.json': '{}' });
    const r = repo();
    const draft = await r.readContent();
    expect(draft).toMatchObject({ ref: 'draft', head: draftHead });
    expect(draft.files.some((f) => f.path === 'content/projects/new-thing.json')).toBe(true);
    const live = await r.readContent('live');
    expect(live.ref).toBe('live');
    expect(live.files.some((f) => f.path === 'content/projects/new-thing.json')).toBe(false);
  });

  it('sends the token only in the Authorization header, with the API version', async () => {
    await repo().readContent();
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const call of fake.calls) {
      expect(call.headers.authorization).toBe(`Bearer ${TEST_ENV.GITHUB_TOKEN}`);
      expect(call.headers['x-github-api-version']).toBe('2022-11-28');
      expect(call.path).not.toContain(TEST_ENV.GITHUB_TOKEN);
    }
  });

  it('reads one file, a large one through its blob, and null for a missing one', async () => {
    const large = new Uint8Array(1_500_000).fill(7);
    fake.push('main', { 'public/media/raven/large-file.bin': large });
    const r = repo();
    expect(text(await r.readFile('live', 'content/site.json'))).toBe(fs.readFileSync(path.join(ROOT, 'content/site.json'), 'utf8'));
    const bytes = await r.readFile('draft', 'public/media/raven/large-file.bin');
    expect(bytes?.byteLength).toBe(large.byteLength);
    expect(fake.steps()).toContain('GET /git/blobs/' + gitBlobSha(large));
    expect(await r.readFile('live', 'public/media/raven/no-such-file.png')).toBeNull();
  });

  it('lists a media folder recursively, with sizes and blob shas', async () => {
    const r = repo();
    const all = await r.listFiles('live', 'public/media');
    expect(all.map((f) => f.path)).toContain('public/media/raven/img-7657.jpeg');
    expect(all.map((f) => f.path)).toContain('public/media/site/.gitkeep');
    const raven = await r.listFiles('live', 'public/media/raven');
    expect(raven.every((f) => f.path.startsWith('public/media/raven/'))).toBe(true);
    const entry = raven.find((f) => f.path === 'public/media/raven/img-7657.jpeg')!;
    expect(entry.sha).toBe(gitBlobSha(encoder.encode('placeholder for public/media/raven/img-7657.jpeg')));
    expect(entry.size).toBeGreaterThan(0);
    expect(await r.listFiles('live', 'public/media/no-such-folder')).toEqual([]);
  });
});

describe('preparing the draft (D-20)', () => {
  it('creates the draft at the live head', async () => {
    const live = fake.refs.get('main')!;
    expect(await repo().prepareDraft()).toBe(live);
    expect(fake.refs.get('draft')).toBe(live);
    expect(fake.steps()).toContain('POST /git/refs');
  });

  it('moves a draft with nothing unpublished up to live, without force', async () => {
    fake.refs.set('draft', fake.refs.get('main')!);
    const live = fake.push('main', { 'content/projects/raven.json': '{"changed": "on live"}' });
    expect(await repo().prepareDraft()).toBe(live);
    expect(fake.refs.get('draft')).toBe(live);
    const update = fake.calls.find((call) => call.method === 'PATCH');
    expect(update?.body).toEqual({ sha: live, force: false });
  });

  it('merges live into a draft with unpublished commits', async () => {
    fake.refs.set('draft', fake.refs.get('main')!);
    fake.push('draft', { 'content/projects/raven.json': 'draft edit' });
    const live = fake.push('main', { 'content/projects/palmsync.json': 'live edit' });
    const head = await repo().prepareDraft();
    expect(head).toBe(fake.refs.get('draft'));
    const files = fake.filesAt('draft');
    expect(files.get('content/projects/raven.json')).toBe('draft edit');
    expect(files.get('content/projects/palmsync.json')).toBe('live edit');
    expect(fake.commits.get(head!)!.parents).toContain(live);
    expect(fake.calls.find((call) => call.path === '/merges')?.body).toMatchObject({ base: 'draft', head: live });
  });

  it('reports a conflicting merge as 409 conflict and leaves the draft alone', async () => {
    fake.refs.set('draft', fake.refs.get('main')!);
    const draft = fake.push('draft', { 'content/projects/raven.json': 'draft edit' });
    fake.push('main', { 'content/projects/raven.json': 'live edit' });
    const error = await failure(repo().prepareDraft());
    expect(error.status).toBe(409);
    expect(error.code).toBe('conflict');
    expect(fake.refs.get('draft')).toBe(draft);
  });

  it('leaves a draft that is only ahead as it is', async () => {
    fake.refs.set('draft', fake.refs.get('main')!);
    const draft = fake.push('draft', { 'content/projects/raven.json': 'draft edit' });
    expect(await repo().prepareDraft()).toBe(draft);
    expect(fake.writes()).toEqual([]);
  });

  it('reports what it did and the head it started from, so a refused save can put it back', async () => {
    const live = fake.refs.get('main')!;
    expect(await repo().prepareDraftReport!()).toEqual({ head: live, previous: null, action: 'created' });
    expect(await repo().prepareDraftReport!()).toEqual({ head: live, previous: live, action: 'none' });
    const newer = fake.push('main', { 'content/projects/raven.json': 'live edit' });
    expect(await repo().prepareDraftReport!()).toEqual({ head: newer, previous: live, action: 'fast-forward' });
    const draft = fake.push('draft', { 'content/projects/palmsync.json': 'draft edit' });
    fake.push('main', { 'content/projects/moonlamp.json': 'live again' });
    const merged = await repo().prepareDraftReport!();
    expect(merged).toEqual({ head: fake.refs.get('draft'), previous: draft, action: 'merged' });
    expect(fake.commits.get(merged.head!)!.parents[0]).toBe(draft);
  });

  it('names the commit a merge was made on, even when a save landed just before the merge', async () => {
    fake.refs.set('draft', fake.refs.get('main')!);
    fake.push('draft', { 'content/projects/raven.json': 'draft edit' });
    fake.push('main', { 'content/projects/palmsync.json': 'live edit' });
    let landed = '';
    fake.overrides.set('POST /merges', () => {
      landed = fake.push('draft', { 'content/projects/moonlamp.json': 'saved meanwhile' });
      return undefined;
    });
    expect(await repo().prepareDraftReport!()).toMatchObject({ action: 'merged', previous: landed });
  });
});

describe('committing', () => {
  it('makes one commit on the draft: blobs, a tree on the head, a commit, a non-forced update', async () => {
    const r = repo();
    const head = (await r.prepareDraft())!;
    const commit = await r.commit(
      head,
      [
        { path: 'content/projects/raven.json', bytes: encoder.encode('{"a": 1}') },
        { path: 'public/media/raven/new.webp', bytes: new Uint8Array([1, 2, 3]) },
        { path: 'content/projects/palmsync.json', bytes: null },
      ],
      'content: update raven',
    );
    expect(commit).toBe(fake.refs.get('draft'));
    expect(fake.commits.get(commit!)).toMatchObject({ parents: [head], message: 'content: update raven' });
    const files = fake.filesAt('draft');
    expect(files.get('content/projects/raven.json')).toBe('{"a": 1}');
    expect(files.has('public/media/raven/new.webp')).toBe(true);
    expect(files.has('content/projects/palmsync.json')).toBe(false);
    expect(fake.refs.get('main')).toBe(head);
    expect(fake.calls.filter((call) => call.path === '/git/commits' && call.method === 'POST')).toHaveLength(1);
    expect(fake.calls.find((call) => call.method === 'PATCH')?.body).toEqual({ sha: commit, force: false });
    expect(fake.calls.some((call) => call.method !== 'GET' && call.path.includes('heads/main'))).toBe(false);
  });

  it('makes no commit when nothing changes, and drops the removal of a file that is not there', async () => {
    const r = repo();
    const head = (await r.prepareDraft())!;
    const seed = seedFiles(ROOT);
    const before = fake.calls.length;
    const commit = await r.commit(
      head,
      [
        { path: 'content/site.json', bytes: seed.get('content/site.json')! },
        { path: 'content/projects/no-such-project.json', bytes: null },
      ],
      'content: update site',
    );
    expect(commit).toBeNull();
    expect(fake.refs.get('draft')).toBe(head);
    const later = fake.calls.slice(before).map((call) => `${call.method} ${call.path}`);
    expect(later.some((step) => step.startsWith('POST /git/commits') || step.startsWith('PATCH'))).toBe(false);
  });

  it('refuses with 409 when the draft moved after the head was read, and keeps the other save', async () => {
    const r = repo();
    const head = (await r.prepareDraft())!;
    const other = fake.push('draft', { 'content/projects/raven.json': 'someone else' });
    const error = await failure(r.commit(head, [{ path: 'content/projects/palmsync.json', bytes: encoder.encode('mine') }], 'x'));
    expect(error.status).toBe(409);
    expect(error.code).toBe('conflict');
    expect(fake.refs.get('draft')).toBe(other);
  });

  it('refuses with 409 when the draft was moved back meanwhile (a discard), instead of bringing it back', async () => {
    const r = repo();
    const start = (await r.prepareDraft())!;
    const saved = fake.push('draft', { 'content/projects/raven.json': 'saved' });
    fake.refs.set('draft', start);
    const error = await failure(r.commit(saved, [{ path: 'content/projects/palmsync.json', bytes: encoder.encode('x') }], 'x'));
    expect(error.status).toBe(409);
    expect(fake.refs.get('draft')).toBe(start);
  });

  it('never puts the token in an error', async () => {
    fake.overrides.set('POST /git/blobs', { status: 500, body: { message: `boom ${TEST_ENV.GITHUB_TOKEN} boom` } });
    const r = repo();
    const head = (await r.prepareDraft())!;
    const error = await failure(r.commit(head, [{ path: 'content/site.json', bytes: encoder.encode('{}') }], 'x'));
    expect(error.status).toBe(502);
    expect(error.code).toBe('github');
    expect(error.message).not.toContain(TEST_ENV.GITHUB_TOKEN);
    expect(error.message).toContain('500');
  });
});

describe('publishing and discarding', () => {
  it('refuses to write main outside the production deployment, before any request', async () => {
    const draft = fake.push('main', {});
    const error = await failure(repo().fastForwardLive(draft));
    expect(error.status).toBe(403);
    expect(error.code).toBe('not-allowed');
    expect(error.message).toBe(REPO_MESSAGES.publishOutsideProduction);
    expect(fake.calls).toEqual([]);
  });

  it('fast-forwards main on the production deployment', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    fake.refs.set('draft', fake.refs.get('main')!);
    const draft = fake.push('draft', { 'content/projects/raven.json': 'publish me' });
    await repo().fastForwardLive(draft);
    expect(fake.refs.get('main')).toBe(draft);
    expect(fake.calls.find((call) => call.method === 'PATCH')).toMatchObject({ path: '/git/refs/heads/main', body: { sha: draft, force: false } });
  });

  it('fast-forwards a sandbox live branch anywhere', async () => {
    vi.stubEnv('GITHUB_BRANCH', 'sandbox-live');
    fake.refs.set('sandbox-live', fake.refs.get('main')!);
    fake.refs.set('draft', fake.refs.get('main')!);
    const draft = fake.push('draft', { 'content/projects/raven.json': 'publish me' });
    await repo().fastForwardLive(draft);
    expect(fake.refs.get('sandbox-live')).toBe(draft);
    expect(fake.refs.get('main')).not.toBe(draft);
  });

  it('refuses a publish when live has commits the draft lacks', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    fake.refs.set('draft', fake.refs.get('main')!);
    const draft = fake.push('draft', { 'content/projects/raven.json': 'draft' });
    const live = fake.push('main', { 'content/projects/palmsync.json': 'live' });
    const error = await failure(repo().fastForwardLive(draft));
    expect(error.status).toBe(409);
    expect(error.code).toBe('diverged');
    expect(fake.refs.get('main')).toBe(live);
  });

  it('resets only while the draft is still the head the caller expects', async () => {
    const live = fake.refs.get('main')!;
    fake.refs.set('draft', live);
    const seen = fake.push('draft', { 'content/projects/raven.json': 'seen in the dialog' });
    const later = fake.push('draft', { 'content/projects/palmsync.json': 'saved later' });
    let error = await failure(repo().resetDraft(live, seen));
    expect(error.status).toBe(409);
    expect(error.code).toBe('conflict');
    expect(error.message).toBe(REPO_MESSAGES.draftMoved);
    error = await failure(repo().resetDraft(live, null));
    expect(error.status).toBe(409);
    expect(fake.refs.get('draft')).toBe(later);
    expect(fake.calls.some((call) => call.method === 'PATCH')).toBe(false);
    await repo().resetDraft(live, later);
    expect(fake.refs.get('draft')).toBe(live);
  });

  it('resets the draft to a commit with a forced update', async () => {
    const live = fake.refs.get('main')!;
    fake.refs.set('draft', live);
    fake.push('draft', { 'content/projects/raven.json': 'unpublished' });
    await repo().resetDraft(live);
    expect(fake.refs.get('draft')).toBe(live);
    expect(fake.calls.find((call) => call.method === 'PATCH')).toMatchObject({ path: '/git/refs/heads/draft', body: { sha: live, force: true } });
  });

  it('compares two commits with the files that differ', async () => {
    const base = fake.refs.get('main')!;
    fake.refs.set('draft', base);
    const head = fake.push('draft', { 'content/projects/raven.json': 'x', 'content/projects/new-one.json': '{}', 'content/projects/palmsync.json': null });
    const result = await repo().compare(base, head);
    expect(result).toMatchObject({ ahead: 1, behind: 0, status: 'ahead' });
    expect(result.files).toEqual(
      expect.arrayContaining([
        { path: 'content/projects/raven.json', status: 'modified' },
        { path: 'content/projects/new-one.json', status: 'added' },
        { path: 'content/projects/palmsync.json', status: 'removed' },
      ]),
    );
  });
});

describe('the disk in local development', () => {
  let dir: string;

  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GITHUB_REPO', '');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-repo-'));
    for (const [file, bytes] of seedFiles(ROOT)) {
      fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), bytes);
    }
    fs.writeFileSync(path.join(dir, '.env.local'), 'NOT_A_REAL_SETTING=1');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function disk(): ContentRepo {
    return getContentRepo(process.env, { rootDir: dir });
  }

  it('reads content as stored and has no branches', async () => {
    const r = disk();
    expect(r.source).toBe('disk');
    expect(await r.heads()).toEqual({ live: null, draft: null });
    expect(await r.prepareDraft()).toBeNull();
    expect(await r.prepareDraftReport!()).toEqual({ head: null, previous: null, action: 'none' });
    const snapshot = await r.readContent();
    expect(snapshot).toMatchObject({ source: 'disk', ref: null, head: null });
    expect(snapshot.files.find((f) => f.path === 'content/site.json')?.text).toBe(fs.readFileSync(path.join(dir, 'content/site.json'), 'utf8'));
  });

  it('writes and removes files in place and makes no commit', async () => {
    const r = disk();
    const result = await r.commit(
      null,
      [
        { path: 'content/projects/raven.json', bytes: encoder.encode('{"edited": true}') },
        { path: 'public/media/raven/new.png', bytes: new Uint8Array([9]) },
        { path: 'content/projects/palmsync.json', bytes: null },
        { path: 'content/projects/never-there.json', bytes: null },
      ],
      'ignored on disk',
    );
    expect(result).toBeNull();
    expect(fs.readFileSync(path.join(dir, 'content/projects/raven.json'), 'utf8')).toBe('{"edited": true}');
    expect(fs.existsSync(path.join(dir, 'public/media/raven/new.png'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'content/projects/palmsync.json'))).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'content/projects')).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('never reads or writes outside content/ and public/media/', async () => {
    const r = disk();
    for (const bad of ['../.env.local', '.env.local', 'content/../.env.local', 'public/media/raven/../../../.env.local']) {
      expect((await failure(r.readFile('draft', bad))).status).toBe(400);
      expect((await failure(r.commit(null, [{ path: bad, bytes: encoder.encode('x') }], 'x'))).status).toBe(400);
    }
    expect(fs.readFileSync(path.join(dir, '.env.local'), 'utf8')).toBe('NOT_A_REAL_SETTING=1');
  });

  it('lists files with the blob sha GitHub would give them', async () => {
    const files = await disk().listFiles('draft', 'public/media/raven');
    const entry = files.find((f) => f.path === 'public/media/raven/img-7657.jpeg')!;
    expect(entry.sha).toBe(gitBlobSha(fs.readFileSync(path.join(dir, 'public/media/raven/img-7657.jpeg'))));
  });

  it('has no draft branch to compare, publish, or reset', async () => {
    const r = disk();
    for (const run of [() => r.compare('a'.repeat(40), 'b'.repeat(40)), () => r.fastForwardLive('a'.repeat(40)), () => r.resetDraft('a'.repeat(40))]) {
      const error = await failure(run());
      expect(error.status).toBe(409);
      expect(error.code).toBe('not-allowed');
      expect(error.message).toBe(REPO_MESSAGES.noDraftOnDisk);
    }
  });
});
