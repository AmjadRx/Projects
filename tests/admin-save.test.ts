/**
 * GET /api/content and POST /api/save (ARCHITECTURE.md 7.1, 7.2, 11, 12; docs/V3_PLAN.md D-16 to
 * D-20, D-76), called as route handlers against the in-memory GitHub in ./admin-github-fake.ts.
 * The rejected cases the owner asked for are here: a path outside content/, a forbidden pattern in
 * a field (a public rule and a synthetic private term), a missing Origin, no session, and a
 * missing ADMIN_PASSWORD. All settings are synthetic.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getContent } from '../app/api/content/route';
import { POST as save } from '../app/api/save/route';
import { serializeContent, type ContentResponse, type SaveResponse } from '../lib/admin/contract';
import { adminRequest, FakeGitHub, installFakeGitHub, ROOT, saveBodyFrom, seedFiles, stubAdminEnv } from './admin-github-fake';

type Json = Record<string, any>;

const RAVEN = 'content/projects/raven.json';
const SITE = 'content/site.json';
/** Built from its code point, so this file holds no dash character. */
const EM_DASH = String.fromCharCode(0x2014);

let fake: FakeGitHub;

beforeEach(() => {
  stubAdminEnv();
  fake = installFakeGitHub();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function load(): Promise<ContentResponse> {
  const res = await getContent(adminRequest('GET', '/api/content'));
  expect(res.status).toBe(200);
  return (await res.json()) as ContentResponse;
}

function fileOf(content: ContentResponse, file: string): Json {
  const found = file === SITE ? content.site : content.projects.find((p) => p.file === file);
  return structuredClone(found!.data) as Json;
}

async function post(body: unknown, options: { origin?: string | null; session?: boolean } = {}): Promise<Response> {
  return save(adminRequest('POST', '/api/save', { body, ...options }));
}

describe('GET /api/content', () => {
  it('serves every file as stored from live while there is no draft', async () => {
    const content = await load();
    expect(content).toMatchObject({
      ok: true,
      source: 'github',
      ref: 'live',
      head: fake.refs.get('main'),
      liveHead: fake.refs.get('main'),
      draftExists: false,
      draftAhead: 0,
      liveBranch: 'main',
      draftBranch: 'draft',
      findings: [],
      preview: { branch: 'draft', url: null },
    });
    const seed = seedFiles(ROOT);
    expect(serializeContent(content.site.data)).toBe(new TextDecoder().decode(seed.get(SITE)));
    // Raw data, not zod output: the hero model keeps its missing kind and its empty strings.
    expect((content.site.data as Json).settings.heroModel).toEqual({ src: '', alt: '' });
    for (const project of content.projects) {
      expect(serializeContent(project.data)).toBe(new TextDecoder().decode(seed.get(project.file)));
    }
  });

  it('returns a file as published for revert, and null for one live does not have', async () => {
    let res = await getContent(adminRequest('GET', `/api/content?ref=live&path=${encodeURIComponent(RAVEN)}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, file: RAVEN });
    expect(serializeContent(body.data)).toBe(fs.readFileSync(path.join(ROOT, RAVEN), 'utf8'));

    res = await getContent(adminRequest('GET', '/api/content?ref=live&path=content/projects/brand-new.json'));
    expect(await res.json()).toEqual({ ok: true, file: 'content/projects/brand-new.json', data: null });
  });

  it('refuses a revert path outside content/', async () => {
    for (const bad of ['../.env', 'content/../package.json', 'public/media/raven/img-7657.jpeg']) {
      const res = await getContent(adminRequest('GET', `/api/content?ref=live&path=${encodeURIComponent(bad)}`));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.findings[0]).toMatchObject({ rule: 'PATH', path: '(path)' });
    }
  });

  it('needs a session, and answers 503 without ADMIN_PASSWORD', async () => {
    expect((await getContent(adminRequest('GET', '/api/content', { session: false }))).status).toBe(401);
    vi.stubEnv('ADMIN_PASSWORD', '');
    const res = await getContent(adminRequest('GET', '/api/content', { session: false }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'not-configured', missing: ['ADMIN_PASSWORD'] });
  });
});

describe('POST /api/save: refused before anything is read or written', () => {
  it('refuses a path outside content/ with 400 and rule PATH', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    const before = fake.calls.length;
    const cases: { body: Json; file: string }[] = [
      { body: { base: content.head, files: [{ path: '../.env', data: raven }], deletes: [], expected: {} }, file: '../.env' },
      { body: { base: content.head, files: [{ path: 'content/../package.json', data: raven }], deletes: [], expected: {} }, file: 'content/../package.json' },
      { body: { base: content.head, files: [{ path: 'public/media/raven/a.json', data: raven }], deletes: [], expected: {} }, file: 'public/media/raven/a.json' },
      {
        body: { base: content.head, files: [{ path: 'content/projects/../site.json', data: raven }], deletes: [], expected: {} },
        file: 'content/projects/../site.json',
      },
      { body: { base: content.head, files: [], deletes: [SITE], expected: {} }, file: SITE },
      { body: { base: content.head, files: [], deletes: ['content/projects/../../package.json'], expected: {} }, file: 'content/projects/../../package.json' },
    ];
    for (const { body, file } of cases) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const answer = await res.json();
      expect(answer).toMatchObject({ ok: false, code: 'bad-request' });
      expect(answer.findings).toContainEqual({ file, path: '(path)', rule: 'PATH', message: expect.any(String), severity: 'error' });
    }
    expect(fake.calls.length).toBe(before);
  });

  it('refuses a path sent twice, or written and deleted together', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    let res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }, { path: RAVEN, data: raven }]));
    expect(res.status).toBe(400);
    res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }], [RAVEN]));
    expect(res.status).toBe(400);
  });

  it('refuses a request without an Origin header, from another origin, or without a session', async () => {
    const content = await load();
    const body = saveBodyFrom(content, []);
    let res = await post(body, { origin: null });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden-origin' });
    expect((await post(body, { origin: 'https://elsewhere.example' })).status).toBe(403);
    res = await post(body, { session: false });
    expect(res.status).toBe(401);
    expect(fake.writes()).toEqual([]);
  });

  it('answers 503 without ADMIN_PASSWORD', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    const res = await post({ base: null, files: [], deletes: [], expected: {} }, { session: false });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'not-configured', missing: ['ADMIN_PASSWORD'] });
  });

  it('refuses a body that is not a SaveBody', async () => {
    expect((await post({ base: 'not-a-sha', files: [], deletes: [], expected: {} })).status).toBe(400);
    expect((await post({ base: null, files: [], deletes: [], expected: {}, extra: true })).status).toBe(400);
  });

  it('refuses a file that fails schema version 3, and a slug that differs from the file name', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    let res = await post(saveBodyFrom(content, [{ path: RAVEN, data: { ...raven, notAField: 1 } }]));
    expect(res.status).toBe(422);
    let body = await res.json();
    expect(body.code).toBe('content-check');
    expect(body.findings[0]).toMatchObject({ file: RAVEN, rule: 'SCHEMA' });

    res = await post(saveBodyFrom(content, [{ path: 'content/projects/raven-two.json', data: raven }]));
    expect(res.status).toBe(422);
    body = await res.json();
    expect(body.findings).toContainEqual(expect.objectContaining({ file: 'content/projects/raven-two.json', path: 'slug', rule: 'SLUG' }));
    expect(fake.writes()).toEqual([]);
  });

  it('answers 503 on Vercel without CONTENT_BLOCKLIST, before anything is written', async () => {
    const content = await load();
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('CONTENT_BLOCKLIST', '');
    const raven = fileOf(content, RAVEN);
    raven.pitch = `${raven.pitch} Edited.`;
    const res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'not-configured', missing: ['CONTENT_BLOCKLIST'] });
    expect(fake.writes()).toEqual([]);
  });
});

describe('POST /api/save: the content check', () => {
  it('refuses a forbidden public pattern with the rule id, the file, and the exact field path', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    raven.pitch = `${raven.pitch} ${EM_DASH} added`;
    const res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('content-check');
    expect(body.findings).toContainEqual(expect.objectContaining({ file: RAVEN, path: 'pitch', rule: 'DASH', severity: 'error' }));
    expect(body.findings.every((f: Json) => f.severity === 'error')).toBe(true);
    expect(fake.calls.some((call) => call.method === 'POST' && call.path === '/git/commits')).toBe(false);
    // The check runs before the draft is made ready, so a refused first save creates no branch.
    expect(fake.refs.has('draft')).toBe(false);
    expect(fake.writes()).toEqual([]);
  });

  it('finds a pattern deep in a block, by its field path', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    const index = raven.blocks.findIndex((block: Json) => block.type === 'text');
    raven.blocks[index].md = `${raven.blocks[index].md} ${EM_DASH}`;
    const res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.findings).toContainEqual(expect.objectContaining({ file: RAVEN, rule: 'DASH', path: `blocks[${index}].md` }));
  });

  it('refuses a private term by file, field, and rule, and never says the term', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    raven.pitch = `${raven.pitch} Built with ZorBlaxian parts.`;
    const res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]));
    expect(res.status).toBe(422);
    const raw = await res.text();
    expect(raw.toLowerCase()).not.toContain('zorblaxian');
    expect(raw).not.toContain('Quuxworth');
    const body = JSON.parse(raw);
    expect(body.findings).toEqual([expect.objectContaining({ file: RAVEN, path: 'pitch', rule: 'BLOCKLIST', severity: 'error' })]);
  });

  it('matches a cs: term with exact case only', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    raven.pitch = `${raven.pitch} quuxworth`;
    expect((await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]))).status).toBe(200);
    const again = await load();
    const next = fileOf(again, RAVEN);
    next.pitch = `${next.pitch} Quuxworth`;
    expect((await post(saveBodyFrom(again, [{ path: RAVEN, data: next }]))).status).toBe(422);
  });

  it('checks the whole content after the save, so a file it does not send can fail', async () => {
    const content = await load();
    // A project that names a media file the branch does not have.
    const raven = fileOf(content, RAVEN);
    raven.cover.src = '/media/raven/not-uploaded.webp';
    const res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.findings).toContainEqual(expect.objectContaining({ file: RAVEN, path: 'cover.src', rule: 'MEDIA' }));
  });

  it('refuses a save that leaves a proof leading to a hidden project, naming the proof field', async () => {
    // ARCHITECTURE.md 4: a proof that does not resolve fails the content check (docs/V3_PLAN.md 5.7,
    // judged on the content after the save); the editor's warning list flags it before saving.
    const content = await load();
    const raven = fileOf(content, RAVEN);
    raven.visible = false;
    const res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('content-check');
    expect(body.findings).toContainEqual(expect.objectContaining({ file: SITE, rule: 'PROOF', path: 'stats[3].proof', severity: 'error' }));
  });

  it('saves with guard-rail warnings, which never block', async () => {
    const content = await load();
    const site = fileOf(content, SITE);
    site.nav = [...site.nav, { label: 'Elsewhere', href: '/no-such-page' }];
    const res = await post(saveBodyFrom(content, [{ path: SITE, data: site }]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SaveResponse;
    expect(body.warnings).toContainEqual(expect.objectContaining({ file: SITE, rule: 'INTERNAL-LINK', severity: 'warning' }));
  });
});

describe('POST /api/save: one commit on the draft', () => {
  it('commits only the changed file to the draft, as the client sent it, with a plain message', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    raven.pitch = `${raven.pitch} One more sentence.`;
    const res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }, { path: SITE, data: fileOf(content, SITE) }]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SaveResponse;
    expect(body).toMatchObject({ ok: true, mode: 'github', changed: [RAVEN] });
    expect(body.commit).toBe(fake.refs.get('draft'));
    expect(body.head).toBe(body.commit);
    expect(fake.refs.get('main')).toBe(content.head);
    expect(fake.log('draft')[0]).toBe('content: update raven');
    expect(fake.filesAt('draft').get(RAVEN)).toBe(serializeContent(raven));
    expect(fake.filesAt('draft').get(SITE)).toBe(fs.readFileSync(path.join(ROOT, SITE), 'utf8'));
    expect(fake.calls.filter((call) => call.method === 'POST' && call.path === '/git/commits')).toHaveLength(1);
    expect(fake.calls.some((call) => call.method !== 'GET' && call.path.includes('heads/main'))).toBe(false);
  });

  it('keeps key order and empty strings: the site file is stored as sent, never as zod output', async () => {
    const content = await load();
    const site = fileOf(content, SITE);
    site.contact.heading = `${site.contact.heading} (edited)`;
    const res = await post(saveBodyFrom(content, [{ path: SITE, data: site }]));
    expect(res.status).toBe(200);
    const stored = fake.filesAt('draft').get(SITE)!;
    expect(stored).toBe(serializeContent(site));
    // Only the edited line differs from the seed: same keys, same order, same empty strings.
    const before = fs.readFileSync(path.join(ROOT, SITE), 'utf8').split('\n');
    const after = stored.split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toHaveLength(1);
    // The schema would add kind: "model" to the empty hero model; the stored file does not.
    expect(JSON.parse(stored).settings.heroModel).toEqual({ src: '', alt: '' });
  });

  it('answers with the branch alias as the preview, or none when it cannot be worked out', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    raven.pitch = `${raven.pitch} Preview me.`;
    let res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]));
    expect(((await res.json()) as SaveResponse).preview).toBeNull();

    vi.stubEnv('VERCEL_BRANCH_URL', 'site-git-v3-team.vercel.app');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'v3');
    const again = await load();
    expect(again.preview).toEqual({ branch: 'draft', url: 'https://site-git-draft-team.vercel.app' });
    const next = fileOf(again, RAVEN);
    next.pitch = `${next.pitch} Again.`;
    res = await post(saveBodyFrom(again, [{ path: RAVEN, data: next }]));
    expect(((await res.json()) as SaveResponse).preview).toEqual({ branch: 'draft', url: 'https://site-git-draft-team.vercel.app' });
  });

  it('makes no commit and no build for a save that changes nothing', async () => {
    const content = await load();
    const files = [{ path: SITE, data: fileOf(content, SITE) }, ...content.projects.map((p) => ({ path: p.file, data: structuredClone(p.data) }))];
    const res = await post(saveBodyFrom(content, files));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SaveResponse;
    expect(body).toMatchObject({ ok: true, commit: null, changed: [] });
    expect(fake.calls.some((call) => call.method === 'POST' && call.path === '/git/commits')).toBe(false);
    expect(fake.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('adds and removes project files in one commit', async () => {
    const content = await load();
    const copy = fileOf(content, RAVEN);
    copy.slug = 'raven-2';
    copy.visible = false;
    copy.featured = false;
    const res = await post(saveBodyFrom(content, [{ path: 'content/projects/raven-2.json', data: copy }], ['content/projects/smart-plant-care.json']));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SaveResponse;
    expect(body.changed).toEqual(['content/projects/raven-2.json', 'content/projects/smart-plant-care.json']);
    expect(fake.log('draft')[0]).toBe('content: add raven-2; remove smart-plant-care');
    const files = fake.filesAt('draft');
    expect(files.has('content/projects/raven-2.json')).toBe(true);
    expect(files.has('content/projects/smart-plant-care.json')).toBe(false);
  });

  it('refuses with 409 when the draft changed the same file since the editor loaded it', async () => {
    const content = await load();
    // Another tab saved raven after this editor loaded.
    const first = fileOf(content, RAVEN);
    first.pitch = `${first.pitch} First tab.`;
    expect((await post(saveBodyFrom(content, [{ path: RAVEN, data: first }]))).status).toBe(200);
    const head = fake.refs.get('draft');

    const second = fileOf(content, RAVEN);
    second.pitch = `${second.pitch} Second tab.`;
    const res = await post(saveBodyFrom(content, [{ path: RAVEN, data: second }]));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'conflict', files: [RAVEN] });
    expect(fake.refs.get('draft')).toBe(head);
  });

  it('goes ahead on the current head when the draft moved but this save touches other files', async () => {
    const content = await load();
    const first = fileOf(content, RAVEN);
    first.pitch = `${first.pitch} First tab.`;
    expect((await post(saveBodyFrom(content, [{ path: RAVEN, data: first }]))).status).toBe(200);

    const palm = fileOf(content, 'content/projects/palmsync.json');
    palm.subtitle = `${palm.subtitle} (edited)`;
    const res = await post(saveBodyFrom(content, [{ path: 'content/projects/palmsync.json', data: palm }]));
    expect(res.status).toBe(200);
    const files = fake.filesAt('draft');
    expect(files.get(RAVEN)).toBe(serializeContent(first));
    expect(files.get('content/projects/palmsync.json')).toBe(serializeContent(palm));
  });

  it('brings live changes into a draft with unpublished work before saving (D-20)', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    raven.pitch = `${raven.pitch} Draft work.`;
    expect((await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]))).status).toBe(200);
    // Someone changes live directly.
    const livePalm = fileOf(content, 'content/projects/palmsync.json');
    livePalm.subtitle = `${livePalm.subtitle} (live)`;
    fake.push('main', { 'content/projects/palmsync.json': serializeContent(livePalm) });

    const reloaded = await load();
    const moon = fileOf(reloaded, 'content/projects/moonlamp.json');
    moon.subtitle = `${moon.subtitle} (draft)`;
    const res = await post(saveBodyFrom(reloaded, [{ path: 'content/projects/moonlamp.json', data: moon }]));
    expect(res.status).toBe(200);
    const files = fake.filesAt('draft');
    expect(files.get('content/projects/palmsync.json')).toBe(serializeContent(livePalm));
    expect(files.get(RAVEN)).toBe(serializeContent(raven));
    expect(files.get('content/projects/moonlamp.json')).toBe(serializeContent(moon));
  });
});

describe('POST /api/save on the local disk', () => {
  let dir: string;

  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GITHUB_REPO', '');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-save-'));
    for (const [file, bytes] of seedFiles(ROOT)) {
      fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), bytes);
    }
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('runs the same checks, then writes the file in place', async () => {
    const content = await load();
    expect(content).toMatchObject({ source: 'disk', ref: null, head: null, draftBranch: null, preview: null });
    const raven = fileOf(content, RAVEN);
    raven.pitch = `${raven.pitch} ${EM_DASH}`;
    expect((await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]))).status).toBe(422);

    raven.pitch = fileOf(content, RAVEN).pitch + ' Saved on disk.';
    const res = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, mode: 'disk', commit: null, head: null, changed: [RAVEN] });
    expect(fs.readFileSync(path.join(dir, RAVEN), 'utf8')).toBe(serializeContent(raven));
    expect(fake.calls).toEqual([]);
  });
});
