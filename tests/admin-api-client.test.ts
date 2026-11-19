/**
 * The admin's API client (components/admin/state/api.ts) with fetch and XMLHttpRequest stubbed,
 * the save flow against a stubbed API (components/admin/shell/saveFlow.ts), and the shell's pure
 * pieces: the deploy state, the hash route, the shortcuts, the publish blockers, and the status
 * line. No request leaves the test, and content/ is only read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  projectFileOf,
  SITE_FILE,
  textDigest,
  type ApiError,
  type ContentResponse,
  type PublishPlan,
  type SaveBody,
  type SaveResponse,
  type StatusResponse,
} from '../lib/admin/contract';
import { api, interpret, isUnauthorized, NETWORK_ERROR, SessionGate, sessionGate, withReauth } from '../components/admin/state/api';
import { createAdminStore, isDirty, type AdminStore } from '../components/admin/state/store';
import { firstRevealable, runSave, saveBodyOf, savedMessage } from '../components/admin/shell/saveFlow';
import { deployViewOf } from '../components/admin/shell/deploy';
import { formatRoute, parseRoute } from '../components/admin/shell/route';
import { shortcutOf } from '../components/admin/shell/keys';
import { publishBlockers } from '../components/admin/shell/PublishDialog';
import { statusLine } from '../components/admin/shell/SaveBar';
import { workingData } from '../components/admin/shell/RevertFile';
import { setIn } from '../components/admin/ui/paths';

const ROOT = path.resolve(__dirname, '..');
const HEAD = 'a'.repeat(40);
const NEXT_HEAD = 'b'.repeat(40);

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function textResponse(status: number, text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/html', ...headers } });
}

type FetchArgs = [string, RequestInit];

function stubFetch(...answers: (Response | Error)[]) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
    const next = answers.shift();
    if (!next) throw new Error('No more answers stubbed.');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof stubFetch>, n = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[n] as unknown as FetchArgs;
  return { url, init };
}

const unsubscribers: (() => void)[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  while (unsubscribers.length > 0) unsubscribers.pop()?.();
  sessionGate.settle(false);
});

describe('the API client', () => {
  it('returns the route JSON and sends JSON with the session cookie', async () => {
    const answer: SaveResponse = {
      ok: true,
      mode: 'github',
      commit: NEXT_HEAD,
      head: NEXT_HEAD,
      changed: [SITE_FILE],
      moved: [],
      merged: false,
      warnings: [],
      preview: null,
    };
    const fetchMock = stubFetch(jsonResponse(200, answer));
    const body: SaveBody = { base: HEAD, files: [{ path: SITE_FILE, data: { a: 1 } }], deletes: [], expected: { [SITE_FILE]: 'c'.repeat(64) } };
    await expect(api.save(body)).resolves.toEqual(answer);
    const { url, init } = call(fetchMock);
    expect(url).toBe('/api/save');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('sends no body and no content type on a GET', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { ok: true, expiresAt: 1 }));
    await api.session();
    const { url, init } = call(fetchMock);
    expect(url).toBe('/api/auth');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('passes the route error through as it is', async () => {
    const refused: ApiError = {
      ok: false,
      code: 'content-check',
      error: 'The content check refused the save.',
      findings: [{ file: SITE_FILE, path: 'thesis.body', rule: 'IP-CLAIM', message: 'm', severity: 'error' }],
    };
    stubFetch(jsonResponse(422, refused));
    await expect(api.save({ base: null, files: [], deletes: [], expected: {} })).resolves.toEqual(refused);
  });

  it('maps answers that are not the route JSON to a plain error by status', async () => {
    stubFetch(
      textResponse(502, '<html>Bad gateway</html>'),
      textResponse(413, 'Request Entity Too Large'),
      textResponse(429, 'slow down', { 'retry-after': '30' }),
      textResponse(200, '<html>login</html>'),
      textResponse(404, 'not found'),
      textResponse(401, '<html>Vercel Authentication</html>'),
    );
    const bad = await api.content();
    expect(bad).toMatchObject({ ok: false, code: 'server' });
    expect((bad as ApiError).error).toContain('HTTP 502');
    await expect(api.content()).resolves.toMatchObject({ ok: false, code: 'too-large' });
    await expect(api.content()).resolves.toMatchObject({ ok: false, code: 'locked', retryAfter: 30 });
    await expect(api.content()).resolves.toMatchObject({ ok: false, code: 'server' });
    await expect(api.content()).resolves.toMatchObject({ ok: false, code: 'server', error: expect.stringContaining('404') });
    // A platform 401 page is not the admin's session: it must not ask for the admin password.
    const platform = await api.content();
    expect(platform).toMatchObject({ ok: false, code: 'server' });
    expect(isUnauthorized(platform)).toBe(false);
  });

  it('turns a network failure or a cancel into a plain server error', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    await expect(api.status()).resolves.toEqual({ ok: false, code: 'server', error: NETWORK_ERROR });
    const controller = new AbortController();
    controller.abort();
    stubFetch(new DOMException('aborted', 'AbortError'));
    await expect(api.status({ signal: controller.signal })).resolves.toMatchObject({ code: 'server', error: 'The request was cancelled.' });
  });

  it('interprets bodies directly', () => {
    expect(interpret(200, '{"ok":true,"x":1}')).toEqual({ ok: true, x: 1 });
    expect(interpret(200, '{"x":1}')).toMatchObject({ ok: false, code: 'server' });
    expect(interpret(503, '{"ok":false,"code":"not-configured","error":"e","missing":["ADMIN_PASSWORD"]}')).toEqual({
      ok: false,
      code: 'not-configured',
      error: 'e',
      missing: ['ADMIN_PASSWORD'],
    });
    expect(interpret(500, '')).toMatchObject({ ok: false, code: 'server' });
  });

  it('builds query strings and bodies for the media and publish routes', async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, { ok: true, folder: 'raven', files: [] }),
      jsonResponse(200, { ok: true, src: '/media/raven/a b.webp', draft: [], live: [] }),
      jsonResponse(200, { ok: true, file: SITE_FILE, data: null }),
      jsonResponse(200, { ok: true, commit: null }),
      jsonResponse(200, { ok: true, head: HEAD }),
      jsonResponse(200, { ok: true, liveHead: HEAD }),
      jsonResponse(200, { ok: true, file: {}, rewrote: [], commit: null }),
    );
    await api.mediaList('raven', true);
    await api.mediaReferences('/media/raven/a b.webp');
    await api.publishedFile(SITE_FILE);
    await api.mediaDelete('/media/raven/a.webp');
    await api.discard(HEAD);
    await api.publish(HEAD);
    await api.mediaRename('/media/raven/a.webp', 'b');
    expect(call(fetchMock, 0).url).toBe('/api/upload?folder=raven&refs=1');
    expect(call(fetchMock, 1).url).toBe('/api/upload/references?src=%2Fmedia%2Fraven%2Fa+b.webp');
    expect(call(fetchMock, 2).url).toBe('/api/content?ref=live&path=content%2Fsite.json');
    expect(call(fetchMock, 3).init.method).toBe('DELETE');
    expect(JSON.parse(call(fetchMock, 3).init.body as string)).toEqual({ src: '/media/raven/a.webp' });
    expect(JSON.parse(call(fetchMock, 4).init.body as string)).toEqual({ confirm: true, draftHead: HEAD });
    expect(JSON.parse(call(fetchMock, 5).init.body as string)).toEqual({ draftHead: HEAD });
    expect(call(fetchMock, 6).url).toBe('/api/upload/rename');
    expect(api.mediaFileHref('/media/raven/a.webp')).toBe('/api/upload/file?src=%2Fmedia%2Fraven%2Fa.webp');
  });
});

describe('signing in again', () => {
  const unauthorized = (): Response => jsonResponse(401, { ok: false, code: 'unauthorized', error: 'Your session has ended. Sign in again.' });

  it('opens the gate on a 401 from a route, but not from login, the session probe, or a quiet poll', async () => {
    const opened = vi.fn();
    unsubscribers.push(sessionGate.subscribe(opened));
    stubFetch(unauthorized(), unauthorized(), unauthorized(), unauthorized());
    await api.login('wrong');
    await api.session();
    await api.status({ quiet: true });
    expect(opened).not.toHaveBeenCalled();
    expect(sessionGate.waiting).toBe(false);
    await api.save({ base: null, files: [], deletes: [], expected: {} });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(sessionGate.waiting).toBe(true);
  });

  it('retries once after the owner signs in again', async () => {
    unsubscribers.push(sessionGate.subscribe(() => setTimeout(() => sessionGate.settle(true), 0)));
    const fetchMock = stubFetch(unauthorized(), jsonResponse(200, { ok: true, liveHead: HEAD }));
    await expect(withReauth(() => api.publish(HEAD))).resolves.toEqual({ ok: true, liveHead: HEAD });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns the first answer when the owner cancels, and does not wait without a shell', async () => {
    unsubscribers.push(sessionGate.subscribe(() => setTimeout(() => sessionGate.settle(false), 0)));
    const fetchMock = stubFetch(unauthorized());
    await expect(withReauth(() => api.discard(HEAD))).resolves.toMatchObject({ code: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const lonely = new SessionGate();
    lonely.notify();
    expect(lonely.waiting).toBe(false);
    await expect(lonely.wait()).resolves.toBe(false);
  });

  it('shares one wait between calls that fail together', async () => {
    const gate = new SessionGate();
    let opened = 0;
    gate.subscribe(() => {
      opened += 1;
    });
    gate.notify();
    gate.notify();
    const both = Promise.all([gate.wait(), gate.wait()]);
    gate.settle(true);
    await expect(both).resolves.toEqual([true, true]);
    expect(opened).toBe(2);
    expect(gate.waiting).toBe(false);
  });
});

/** A stand-in for XMLHttpRequest that the test drives. */
class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  responseType = '';
  status = 0;
  responseText = '';
  responseHeaders: Record<string, string> = {};
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true } as ProgressEvent);
  }
  respond(status: number, text: string) {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

describe('repository uploads', () => {
  beforeEach(() => {
    FakeXhr.last = null;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });

  it('send a multipart form, report progress, and read the answer', async () => {
    const progress: number[] = [];
    const pending = api.uploadRepo(
      'raven',
      [
        { name: 'one.webp', blob: new Blob(['abc'], { type: 'image/webp' }) },
        { name: 'two.webp', blob: new Blob(['defg'], { type: 'image/webp' }) },
      ],
      true,
      (p) => progress.push(p.fraction),
    );
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/upload');
    const form = xhr.body as FormData;
    expect(form.get('folder')).toBe('raven');
    expect(form.get('replace')).toBe('1');
    expect(form.getAll('file').map((f) => (f as File).name)).toEqual(['one.webp', 'two.webp']);
    xhr.progress(50, 100);
    xhr.progress(100, 100);
    xhr.respond(200, JSON.stringify({ ok: true, files: [], commit: NEXT_HEAD }));
    await expect(pending).resolves.toEqual({ ok: true, files: [], commit: NEXT_HEAD });
    expect(progress).toEqual([0.5, 1]);
  });

  it('map errors like the JSON routes, and refuse a batch over the body limit without sending it', async () => {
    const pending = api.uploadRepo('raven', [{ name: 'a.bin', blob: new Blob(['x']) }], false);
    FakeXhr.last!.respond(409, JSON.stringify({ ok: false, code: 'exists', error: 'Taken.' }));
    await expect(pending).resolves.toMatchObject({ code: 'exists' });

    const failed = api.uploadRepo('raven', [{ name: 'a.bin', blob: new Blob(['x']) }], false);
    FakeXhr.last!.onerror?.();
    await expect(failed).resolves.toEqual({ ok: false, code: 'server', error: NETWORK_ERROR });

    FakeXhr.last = null;
    const big = new Blob([new Uint8Array(4_500_000)]);
    await expect(api.uploadRepo('raven', [{ name: 'big.webp', blob: big }], false)).resolves.toMatchObject({ code: 'too-large' });
    expect(FakeXhr.last).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The save flow against a stubbed API
// ---------------------------------------------------------------------------------------------

function content(head: string | null): ContentResponse {
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const projects = fs
    .readdirSync(path.join(ROOT, 'content/projects'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => `content/projects/${name}`);
  return {
    ok: true,
    source: head ? 'github' : 'disk',
    ref: head ? 'draft' : null,
    head,
    liveHead: head,
    draftExists: head !== null,
    draftAhead: 0,
    liveBranch: head ? 'sandbox-main' : null,
    draftBranch: head ? 'sandbox-draft' : null,
    site: { file: SITE_FILE, data: read(SITE_FILE) },
    projects: projects.map((file) => ({ file, data: read(file) })),
    findings: [],
    preview: null,
  };
}

function loaded(head: string | null = HEAD): AdminStore {
  const store = createAdminStore();
  store.begin();
  store.load(content(head));
  return store;
}

function ok(body: SaveBody, commit: string | null = NEXT_HEAD): SaveResponse {
  return {
    ok: true,
    mode: 'github',
    commit,
    head: commit ?? HEAD,
    changed: body.files.map((f) => f.path),
    moved: [],
    merged: false,
    warnings: [],
    preview: null,
  };
}

const dirty = (store: AdminStore) => isDirty(store.getState().doc, store.getState().info);

describe('saving', () => {
  it('sends nothing when nothing changed', async () => {
    const store = loaded();
    const save = vi.fn();
    await expect(runSave({ store, save, reauthenticate: async () => false })).resolves.toBe('nothing');
    expect(save).not.toHaveBeenCalled();
  });

  it('sends only the changed files on the loaded head, then records them as saved', async () => {
    const store = loaded();
    store.editSite((site) => setIn(site, 'personal.tagline', 'A changed tagline.'));
    const save = vi.fn(async (body: SaveBody) => ok(body));
    const committed = vi.fn();
    await expect(runSave({ store, save, reauthenticate: async () => false, onCommitted: committed })).resolves.toBe('saved');
    const body = save.mock.calls[0][0];
    expect(body.base).toBe(HEAD);
    expect(body.files.map((f) => f.path)).toEqual([SITE_FILE]);
    expect(body.deletes).toEqual([]);
    expect(dirty(store)).toBe(false);
    const state = store.getState();
    expect(state.save.status).toBe('saved');
    expect(state.save.message).toContain('bbbbbbb');
    expect(state.save.message).toContain('sandbox-draft');
    expect(state.info?.head).toBe(NEXT_HEAD);
    expect(committed).toHaveBeenCalledWith(NEXT_HEAD);
  });

  it('names the version of every file the editor holds, and null for a file it creates', async () => {
    const store = loaded();
    const raven = projectFileOf('raven');
    store.editProject(raven, (p) => ({ ...p, slug: 'raven-2' }));
    const held = { ...store.getState().info!.stored };
    const save = vi.fn(async (body: SaveBody) => ok(body));
    await expect(runSave({ store, save, reauthenticate: async () => false })).resolves.toBe('saved');
    const body = save.mock.calls[0][0];
    expect(body.deletes).toEqual([raven]);
    expect(Object.keys(body.expected).sort()).toEqual([...Object.keys(held), projectFileOf('raven-2')].sort());
    for (const [path, text] of Object.entries(held)) expect(body.expected[path]).toBe(textDigest(text));
    expect(body.expected[projectFileOf('raven-2')]).toBeNull();
  });

  it('marks files the server reports as moved, and the files of a conflict, as stale', async () => {
    const store = loaded();
    const raven = projectFileOf('raven');
    store.editSite((site) => setIn(site, 'personal.tagline', 'First.'));
    const save = vi.fn(async (body: SaveBody) => ({ ...ok(body), moved: [raven], merged: true }));
    await expect(runSave({ store, save, reauthenticate: async () => false })).resolves.toBe('saved');
    expect(store.getState().info).toMatchObject({ stale: [raven], liveMerged: true });

    store.editSite((site) => setIn(site, 'personal.tagline', 'Second.'));
    const conflict: ApiError = { ok: false, code: 'conflict', error: 'These files changed.', files: [SITE_FILE] };
    await expect(runSave({ store, save: async () => conflict, reauthenticate: async () => false })).resolves.toBe('conflict');
    expect(store.getState().info?.stale).toEqual([raven, SITE_FILE]);
    expect(dirty(store)).toBe(true);
  });

  it('sends a removed project as a delete', async () => {
    const store = loaded(null);
    store.removeProject(projectFileOf('moonlamp'));
    const save = vi.fn(async (body: SaveBody) => ({ ...ok(body, null), mode: 'disk' as const, head: null }));
    await runSave({ store, save, reauthenticate: async () => false });
    const body = save.mock.calls[0][0];
    expect(body.base).toBeNull();
    expect(body.deletes).toEqual([projectFileOf('moonlamp')]);
    expect(store.getState().save.message).toBe('Saved to the content files on this computer.');
    expect(dirty(store)).toBe(false);
  });

  it('keeps typing made while the request runs unsaved', async () => {
    const store = loaded();
    store.editSite((site) => setIn(site, 'personal.tagline', 'First.'));
    let finish: (answer: SaveResponse) => void = () => undefined;
    const save = vi.fn((body: SaveBody) => new Promise<SaveResponse>((resolve) => (finish = () => resolve(ok(body)))));
    const running = runSave({ store, save, reauthenticate: async () => false });
    expect(store.getState().save.status).toBe('saving');
    await expect(runSave({ store, save, reauthenticate: async () => false })).resolves.toBe('busy');
    store.editSite((site) => setIn(site, 'personal.tagline', 'Second.'));
    finish(ok(save.mock.calls[0][0]));
    await running;
    expect(dirty(store)).toBe(true);
    expect(store.changes().writes.map((w) => w.path)).toEqual([SITE_FILE]);
  });

  it('keeps the edits when the content check refuses, and takes the owner to the first field', async () => {
    const store = loaded();
    store.editSite((site) => setIn(site, 'thesis.body', 'Changed body.'));
    const refused: ApiError = {
      ok: false,
      code: 'content-check',
      error: 'The content check refused the save.',
      findings: [
        { file: '(request)', path: '(root)', rule: 'REQUEST', message: 'not a field', severity: 'error' },
        { file: SITE_FILE, path: 'thesis.body', rule: 'IP-CLAIM', message: 'No claim.', severity: 'error' },
      ],
    };
    const save = vi.fn(async () => refused);
    await expect(runSave({ store, save, reauthenticate: async () => false })).resolves.toBe('refused');
    const state = store.getState();
    expect(state.save.status).toBe('error');
    expect(state.save.findings).toHaveLength(2);
    expect(state.save.message).toContain('2 problems');
    expect(state.reveal).toMatchObject({ file: SITE_FILE, path: 'thesis.body' });
    expect(dirty(store)).toBe(true);
  });

  it('waits for the owner to sign in again after a 401 and sends the same body once more', async () => {
    const store = loaded();
    store.editSite((site) => setIn(site, 'personal.location', 'Somewhere'));
    const answers: (SaveResponse | ApiError)[] = [{ ok: false, code: 'unauthorized', error: 'Your session has ended.' }];
    const save = vi.fn(async (body: SaveBody) => answers.shift() ?? ok(body));
    const reauthenticate = vi.fn(async () => true);
    await expect(runSave({ store, save, reauthenticate })).resolves.toBe('saved');
    expect(reauthenticate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toBe(save.mock.calls[0][0]);
    expect(dirty(store)).toBe(false);
  });

  it('keeps the edits when the owner does not sign in again', async () => {
    const store = loaded();
    store.editSite((site) => setIn(site, 'personal.location', 'Somewhere'));
    const save = vi.fn(async () => ({ ok: false, code: 'unauthorized', error: 'Ended.' }) as ApiError);
    await expect(runSave({ store, save, reauthenticate: async () => false })).resolves.toBe('signed-out');
    expect(save).toHaveBeenCalledTimes(1);
    expect(store.getState().save.status).toBe('error');
    expect(dirty(store)).toBe(true);
  });

  it('reports a conflict to the shell, and any other refusal in plain words', async () => {
    const store = loaded();
    store.editSite((site) => setIn(site, 'personal.location', 'Somewhere'));
    const conflict: ApiError = { ok: false, code: 'conflict', error: 'The draft changed since you loaded it.', files: [SITE_FILE] };
    const onConflict = vi.fn();
    await expect(runSave({ store, save: async () => conflict, reauthenticate: async () => false, onConflict })).resolves.toBe('conflict');
    expect(onConflict).toHaveBeenCalledWith(conflict);
    expect(dirty(store)).toBe(true);

    const blocked: ApiError = { ok: false, code: 'not-configured', error: 'CONTENT_BLOCKLIST is not set on this deployment.' };
    await expect(runSave({ store, save: async () => blocked, reauthenticate: async () => false })).resolves.toBe('failed');
    expect(store.getState().save.message).toBe('Not saved. CONTENT_BLOCKLIST is not set on this deployment.');
  });

  it('words the result of a save', () => {
    const expected = { [SITE_FILE]: 'c'.repeat(64), 'content/projects/x.json': 'd'.repeat(64) };
    const body = saveBodyOf({ writes: [{ path: SITE_FILE, data: {}, text: '{}' }], deletes: ['content/projects/x.json'] }, HEAD, expected);
    expect(body).toEqual({ base: HEAD, files: [{ path: SITE_FILE, data: {} }], deletes: ['content/projects/x.json'], expected });
    expect(savedMessage(ok(body, null), 'draft')).toBe('Saved. Nothing had changed, so no commit was made.');
    const warned = { ...ok(body), warnings: [{ file: SITE_FILE, path: 'cover', rule: 'COVER', message: 'm', severity: 'warning' as const }] };
    expect(savedMessage(warned, 'draft')).toBe('Saved as commit bbbbbbb on the draft branch. 1 warning.');
    expect(firstRevealable([{ file: 'public/media/x.png', path: 'name', severity: 'error' }])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// The shell's pure pieces
// ---------------------------------------------------------------------------------------------

function status(draft: StatusResponse['deploy']['draft'], source: StatusResponse['deploy']['source'] = 'github'): StatusResponse {
  return {
    ok: true,
    runtime: { vercelEnv: 'preview', branch: 'v3', commit: HEAD, node: 'v24.0.0' },
    env: [],
    github: {
      configured: true,
      ok: true,
      detail: '',
      tokenKind: 'fine-grained',
      repo: 'owner/name',
      liveBranch: 'sandbox-main',
      draftBranch: 'sandbox-draft',
      liveExists: true,
      draftExists: true,
      writeAccess: true,
      ahead: 1,
      behind: 0,
    },
    storage: { repo: { target: 'github', problem: null }, blob: { configured: false, host: null }, limits: { repoMaxBytes: 4_000_000, blobMaxBytes: 500_000_000 } },
    contentCheck: { publicRules: 40, blocklistSet: true, failClosed: true },
    deploy: { source, detail: 'From GitHub deployment records.', draft, live: null },
    preview: { branch: 'sandbox-draft', url: 'https://draft.example.test' },
    session: { expiresAt: 0 },
    security: { loginLimit: 'runtime-cache', address: 'x-real-ip', detail: 'Counted in Vercel Runtime Cache.' },
  };
}

describe('the shell', () => {
  it('reads the draft build for the saved commit', () => {
    const at = (state: 'queued' | 'building' | 'ready' | 'error' | 'canceled' | 'unknown', sha: string | null = NEXT_HEAD) => ({
      state,
      url: 'https://build.example.test',
      sha,
      createdAt: null,
    });
    expect(deployViewOf(status(at('building')), NEXT_HEAD)).toMatchObject({ phase: 'building', url: 'https://build.example.test' });
    expect(deployViewOf(status(at('ready')), NEXT_HEAD)).toMatchObject({ phase: 'ready' });
    expect(deployViewOf(status(at('error')), NEXT_HEAD)).toMatchObject({ phase: 'failed' });
    expect(deployViewOf(status(at('ready', HEAD)), NEXT_HEAD)).toMatchObject({ phase: 'waiting', url: 'https://draft.example.test' });
    expect(deployViewOf(status(null, 'none'), NEXT_HEAD)).toMatchObject({ phase: 'unknown', detail: 'From GitHub deployment records.' });
  });

  it('keeps the tab and the project in the hash', () => {
    expect(parseRoute('')).toEqual({ tab: 'settings', project: null });
    expect(parseRoute('#tab=stats')).toEqual({ tab: 'stats', project: null });
    expect(parseRoute('#tab=projects&project=raven')).toEqual({ tab: 'projects', project: 'raven' });
    expect(parseRoute('#tab=projects&project=Bad%20Slug')).toEqual({ tab: 'projects', project: null });
    expect(parseRoute('#tab=stats&project=raven')).toEqual({ tab: 'stats', project: null });
    expect(parseRoute('#tab=nope')).toEqual({ tab: 'settings', project: null });
    expect(formatRoute('projects', 'raven')).toBe('#tab=projects&project=raven');
    expect(formatRoute('stats', 'raven')).toBe('#tab=stats');
    expect(parseRoute(formatRoute('honorsEdu'))).toEqual({ tab: 'honorsEdu', project: null });
  });

  it('reads the shortcuts', () => {
    const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
      key: k,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...mods,
    });
    expect(shortcutOf(key('s', { ctrlKey: true }))).toBe('save');
    expect(shortcutOf(key('s', { metaKey: true }))).toBe('save');
    expect(shortcutOf(key('z', { ctrlKey: true }))).toBe('undo');
    expect(shortcutOf(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutOf(key('y', { ctrlKey: true }))).toBe('redo');
    expect(shortcutOf(key('z'))).toBeNull();
    expect(shortcutOf(key('z', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('says why Publish is not available', () => {
    const plan: PublishPlan = {
      ok: true,
      liveBranch: 'sandbox-main',
      draftBranch: 'sandbox-draft',
      liveHead: HEAD,
      draftHead: NEXT_HEAD,
      ahead: 1,
      behind: 0,
      diverged: false,
      files: [{ path: SITE_FILE, status: 'modified' }],
      blob: { added: [], removed: [] },
      deploy: null,
      deployDetail: null,
      allowed: true,
      reasons: [],
    };
    expect(publishBlockers(plan, 0)).toEqual([]);
    expect(publishBlockers(plan, 2)[0]).toContain('2 files');
    expect(publishBlockers({ ...plan, ahead: 0 }, 0)).toEqual(['The draft has nothing the published branch lacks.']);
    expect(publishBlockers({ ...plan, allowed: false, reasons: ['The draft build failed.'] }, 0)).toEqual(['The draft build failed.']);
  });

  it('finds the working copy of a file for "Revert this file to published"', () => {
    const store = loaded();
    const state = store.getState();
    expect(workingData(state, SITE_FILE)).toBe(state.doc?.site);
    const raven = projectFileOf('raven');
    expect(workingData(state, raven)).toBe(state.doc?.projects.find((entry) => entry.key === raven)?.data);
    // A renamed project is still found by the file it was loaded from.
    store.editProject(raven, (p) => ({ ...p, slug: 'raven-renamed' }));
    expect(workingData(store.getState(), raven)).toMatchObject({ slug: 'raven-renamed' });
    expect(workingData(store.getState(), projectFileOf('raven-renamed'))).toMatchObject({ slug: 'raven-renamed' });
    expect(workingData(store.getState(), projectFileOf('nothing-here'))).toBeUndefined();
  });

  it('words the status line', () => {
    const base = { status: 'idle' as const, message: null, findings: [], warnings: [], at: null, commit: null };
    expect(statusLine(base, 0)).toEqual({ text: 'No unsaved changes', tone: 'idle' });
    expect(statusLine(base, 2)).toEqual({ text: 'Unsaved changes in 2 files', tone: 'dirty' });
    expect(statusLine(base, 1).text).toBe('Unsaved changes in 1 file');
    expect(statusLine({ ...base, status: 'saving' }, 1)).toEqual({ text: 'Saving', tone: 'busy' });
    expect(statusLine({ ...base, status: 'saved', message: 'Saved.' }, 0)).toEqual({ text: 'Saved.', tone: 'ok' });
    expect(statusLine({ ...base, status: 'error', message: 'Not saved.' }, 3)).toEqual({ text: 'Not saved.', tone: 'error' });
  });
});
