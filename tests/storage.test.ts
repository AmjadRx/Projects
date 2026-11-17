import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// lib/storage.ts imports "server-only", whose default entry throws outside a React Server
// Components build. Vitest is not one, so the marker is replaced by an empty module here.
vi.mock('server-only', () => ({}));
// No test reaches Vercel Blob: the SDK calls are mocks.
vi.mock('@vercel/blob', () => ({ put: vi.fn(), list: vi.fn(), del: vi.fn() }));

import { del, list, put } from '@vercel/blob';
import {
  BLOB_MAX_BYTES,
  checkFolder,
  checkType,
  chooseStore,
  createDiskStorage,
  createGitHubStorage,
  fileTypeOf,
  getBlobStorage,
  getRepoStorage,
  getStorageForSize,
  mediaRefOf,
  planUpload,
  REPO_MAX_BYTES,
  sanitizeFileName,
  StorageError,
  storageStatus,
  storeForSize,
  type GitHubSettings,
} from '../lib/storage';

// Placeholder credentials: not real tokens.
const GITHUB_TOKEN = 'fake-github-token-for-tests';
const BLOB_TOKEN = 'fake-blob-token-for-tests';

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof StorageError ? error.code : `not a StorageError: ${String(error)}`;
  }
  return undefined;
}

async function rejection(promise: Promise<unknown>): Promise<StorageError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StorageError) return error;
    throw error;
  }
  throw new Error('expected a StorageError, but the call succeeded');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// -------------------------------------------------------------------------------------------
// Choosing the store by size
// -------------------------------------------------------------------------------------------

describe('storeForSize', () => {
  it('keeps files up to 4,000,000 bytes in the repository', () => {
    expect(storeForSize(1, { blobConfigured: false })).toBe('repo');
    expect(storeForSize(REPO_MAX_BYTES, { blobConfigured: false })).toBe('repo');
    expect(storeForSize(REPO_MAX_BYTES, { blobConfigured: true })).toBe('repo');
    expect(REPO_MAX_BYTES).toBe(4_000_000);
  });

  it('sends larger files to Blob, up to the 500 MB ceiling', () => {
    expect(storeForSize(REPO_MAX_BYTES + 1, { blobConfigured: true })).toBe('blob');
    expect(storeForSize(BLOB_MAX_BYTES, { blobConfigured: true, ext: 'mp4' })).toBe('blob');
    expect(BLOB_MAX_BYTES).toBe(500_000_000);
  });

  it('refuses a large file while Blob is not set up, and says how to set it up', () => {
    let error: unknown;
    try {
      storeForSize(REPO_MAX_BYTES + 1, { blobConfigured: false });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(StorageError);
    const refusal = error as StorageError;
    expect(refusal.code).toBe('blob-not-configured');
    expect(refusal.status).toBe(413);
    expect(refusal.message).toContain('4,000,000 bytes');
    expect(refusal.message).toContain('BLOB_READ_WRITE_TOKEN');
    expect(refusal.message).toContain('Storage');
  });

  it('refuses files over the ceiling, empty files, and sizes that are not byte counts', () => {
    expect(codeOf(() => storeForSize(BLOB_MAX_BYTES + 1, { blobConfigured: true }))).toBe('too-large');
    expect(codeOf(() => storeForSize(0, { blobConfigured: true }))).toBe('empty-file');
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codeOf(() => storeForSize(bad, { blobConfigured: true }))).toBe('invalid-size');
    }
  });

  it('keeps SVG in the repository only, so a large SVG has no store', () => {
    expect(storeForSize(1000, { blobConfigured: true, ext: 'svg' })).toBe('repo');
    expect(codeOf(() => storeForSize(REPO_MAX_BYTES + 1, { blobConfigured: true, ext: 'svg' }))).toBe(
      'repo-only-too-large',
    );
  });

  it('reads whether Blob is set up from the environment', () => {
    expect(chooseStore(REPO_MAX_BYTES + 1, 'mp4', { BLOB_READ_WRITE_TOKEN: BLOB_TOKEN })).toBe('blob');
    expect(codeOf(() => chooseStore(REPO_MAX_BYTES + 1, 'mp4', {}))).toBe('blob-not-configured');
    expect(getStorageForSize(10, 'png', { env: {}, rootDir: os.tmpdir() }).target).toBe('disk');
  });

  it('plans an upload with every check that needs no bytes', () => {
    const plan = planUpload({ folder: 'raven', name: 'Test Clip.MOV', size: 5_000_000 }, { blobConfigured: true });
    expect(plan).toMatchObject({ folder: 'raven', name: 'test-clip.mov', ext: 'mov', store: 'blob', size: 5_000_000 });
    expect(plan.type.contentType).toBe('video/quicktime');
    expect(
      codeOf(() => planUpload({ folder: 'ghost', name: 'a.png', size: 10 }, { blobConfigured: true, knownFolders: ['raven'] })),
    ).toBe('unknown-folder');
  });
});

// -------------------------------------------------------------------------------------------
// Folders, names, and types
// -------------------------------------------------------------------------------------------

describe('folders', () => {
  it('accepts "site" and slug-safe project folders', () => {
    for (const folder of ['site', 'raven', 'fsae-bronco-racing', 'engr172-build-a-bronco', 'stm32-embedded-projects']) {
      expect(checkFolder(folder)).toBe(folder);
    }
  });

  it('refuses anything else', () => {
    for (const folder of ['', '.', '..', '../site', 'site/..', 'a/b', 'a\\b', 'Raven', 'raven ', '-raven', 'raven-', 'a--b', 'x'.repeat(65)]) {
      expect(codeOf(() => checkFolder(folder))).toBe('bad-folder');
    }
    expect(codeOf(() => checkFolder(undefined))).toBe('bad-folder');
  });

  it('checks the folder against the projects that exist, when given', () => {
    expect(checkFolder('raven', ['raven', 'palmsync'])).toBe('raven');
    expect(checkFolder('site', ['raven'])).toBe('site');
    expect(codeOf(() => checkFolder('ghost', ['raven']))).toBe('unknown-folder');
  });
});

describe('file names', () => {
  it('cleans a name: last segment, lower case, hyphens, lower-case extension', () => {
    expect(sanitizeFileName('My Photo (1).JPG').name).toBe('my-photo-1.jpg');
    expect(sanitizeFileName('Cafe\u0301 Menu.PDF').name).toBe('cafe-menu.pdf');
    expect(sanitizeFileName('drawing.v2.final.SVG').name).toBe('drawing-v2-final.svg');
    expect(sanitizeFileName('clip.mp4. ').name).toBe('clip.mp4');
    expect(sanitizeFileName('\u7167\u7247.webp').name).toBe('file.webp');
    expect(sanitizeFileName('CON.png').name).toBe('con-file.png');
  });

  it('never keeps a path separator or ".."', () => {
    for (const raw of ['../../etc/passwd.png', '..\\..\\windows\\win.ini.png', 'a/../b.jpg', '..png', '...png', '/abs/path/x.gif']) {
      const { name } = sanitizeFileName(raw);
      expect(name).not.toMatch(/[\\/]/);
      expect(name).not.toContain('..');
      expect(name).toMatch(/^[a-z0-9-]+\.[a-z0-9]+$/);
    }
    expect(sanitizeFileName('../../etc/passwd.png').name).toBe('passwd.png');
  });

  it('caps the length before the extension', () => {
    const { name, base } = sanitizeFileName(`${'a'.repeat(200)}.png`);
    expect(base).toHaveLength(64);
    expect(name).toBe(`${'a'.repeat(64)}.png`);
  });

  it('refuses a name without an extension', () => {
    expect(codeOf(() => sanitizeFileName('README'))).toBe('no-extension');
    expect(codeOf(() => sanitizeFileName('photo.'))).toBe('no-extension');
  });
});

describe('types', () => {
  const allowed = [
    ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'],
    ['mp4', 'webm', 'mov'],
    ['pdf', 'docx', 'xlsx', 'pptx'],
    ['glb', 'gltf', 'stl', 'obj', '3mf', 'ply'],
    ['mp3', 'm4a', 'wav'],
    ['csv', 'txt', 'zip'],
    ['vtt'],
  ].flat();

  it('accepts the allow-list in both stores', () => {
    for (const ext of allowed) {
      expect(checkType(ext, 'repo').ext).toBe(ext);
      expect(checkType(ext, 'blob').ext).toBe(ext);
    }
  });

  it('accepts SVG in the repository only', () => {
    expect(checkType('svg', 'repo').contentType).toBe('image/svg+xml');
    expect(codeOf(() => checkType('svg', 'blob'))).toBe('repo-only-type');
  });

  it('refuses HTML, XML, and JavaScript in both stores', () => {
    for (const ext of ['html', 'htm', 'xhtml', 'xml', 'xsl', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'svgz']) {
      expect(codeOf(() => checkType(ext, 'repo'))).toBe('refused-type');
      expect(codeOf(() => checkType(ext, 'blob'))).toBe('refused-type');
    }
  });

  it('refuses every other type', () => {
    for (const ext of ['exe', 'heic', 'step', 'doc', 'gz', 'constructor', 'tostring']) {
      expect(codeOf(() => checkType(ext))).toBe('unsupported-type');
    }
  });

  it('gives each accepted type its content type and MediaRef kind', () => {
    expect(fileTypeOf('a.GLB')).toMatchObject({ contentType: 'model/gltf-binary', kind: 'model' });
    expect(fileTypeOf('mp3')).toMatchObject({ contentType: 'audio/mpeg', kind: 'audio' });
    expect(fileTypeOf('captions.vtt')?.kind).toBeUndefined();
    expect(fileTypeOf('page.html')).toBeNull();
    expect(mediaRefOf({ name: 'a.pdf', src: '/media/site/a.pdf', store: 'repo' })).toEqual({
      kind: 'document',
      src: '/media/site/a.pdf',
      store: 'repo',
    });
    expect(mediaRefOf({ name: 'a.zip', src: '/media/site/a.zip', store: 'repo' })).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------
// The repository through GitHub
// -------------------------------------------------------------------------------------------

const API = 'https://api.github.com/repos/owner/site-repo';
const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BLOB = 'c'.repeat(40);
const NEW_TREE = 'd'.repeat(40);
const COMMIT = 'e'.repeat(40);
const MAIN_HEAD = 'f'.repeat(40);

const SETTINGS: GitHubSettings = {
  token: GITHUB_TOKEN,
  repo: 'owner/site-repo',
  productionBranch: 'main',
  draftBranch: 'draft',
};

interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}
interface Reply {
  status: number;
  body?: unknown;
}

/** Stubs the global fetch with a small GitHub API: `routes` maps "METHOD /path" (no query) to a reply. */
function stubGitHub(routes: Record<string, Reply>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(API)) throw new Error(`unexpected address ${url}`);
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathAndQuery = url.slice(API.length);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: pathAndQuery, body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const reply = routes[`${method} ${pathAndQuery.split('?')[0]}`] ?? { status: 404, body: { message: 'Not Found' } };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

const DRAFT: Record<string, Reply> = {
  'GET /git/ref/heads/draft': { status: 200, body: { ref: 'refs/heads/draft', object: { sha: HEAD, type: 'commit' } } },
  [`GET /git/commits/${HEAD}`]: { status: 200, body: { sha: HEAD, tree: { sha: TREE } } },
  'GET /contents/public/media/raven': {
    status: 200,
    body: [
      { type: 'file', name: 'cover.jpeg', size: 1234, sha: '1'.repeat(40) },
      { type: 'file', name: 'Diagram.png', size: 99, sha: '2'.repeat(40) },
      { type: 'file', name: '.gitkeep', size: 0, sha: '3'.repeat(40) },
      { type: 'dir', name: 'old', size: 0, sha: '4'.repeat(40) },
    ],
  },
  'POST /git/blobs': { status: 201, body: { sha: BLOB } },
  'POST /git/trees': { status: 201, body: { sha: NEW_TREE } },
  'POST /git/commits': { status: 201, body: { sha: COMMIT } },
  'PATCH /git/refs/heads/draft': { status: 200, body: { ref: 'refs/heads/draft', object: { sha: COMMIT } } },
};

const steps = (calls: Call[]) => calls.map((call) => `${call.method} ${call.path.split('?')[0]}`);
const find = (calls: Call[], step: string) => calls.find((call) => `${call.method} ${call.path.split('?')[0]}` === step);

describe('the repository store through GitHub', () => {
  it('commits a put to the draft branch: base64 content, the branch, and the message', async () => {
    const { calls } = stubGitHub(DRAFT);
    const storage = createGitHubStorage({ settings: SETTINGS });
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x10, 0x80]);

    const file = await storage.put({ folder: 'raven', name: 'Bench Photo.WEBP', bytes });

    expect(file).toEqual({
      store: 'repo',
      folder: 'raven',
      name: 'bench-photo.webp',
      pathname: 'public/media/raven/bench-photo.webp',
      src: '/media/raven/bench-photo.webp',
      downloadHref: '/media/raven/bench-photo.webp',
      size: 8,
      contentType: 'image/webp',
    });
    expect(steps(calls)).toEqual([
      'GET /git/ref/heads/draft',
      'GET /contents/public/media/raven',
      'POST /git/blobs',
      `GET /git/commits/${HEAD}`,
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/draft',
    ]);
    expect(find(calls, 'GET /contents/public/media/raven')?.path).toBe(`/contents/public/media/raven?ref=${HEAD}`);
    expect(find(calls, 'POST /git/blobs')?.body).toEqual({
      content: Buffer.from(bytes).toString('base64'),
      encoding: 'base64',
    });
    expect(find(calls, 'POST /git/trees')?.body).toEqual({
      base_tree: TREE,
      tree: [{ path: 'public/media/raven/bench-photo.webp', mode: '100644', type: 'blob', sha: BLOB }],
    });
    expect(find(calls, 'POST /git/commits')?.body).toEqual({
      message: 'media: add raven/bench-photo.webp',
      tree: NEW_TREE,
      parents: [HEAD],
    });
    expect(find(calls, 'PATCH /git/refs/heads/draft')?.body).toEqual({ sha: COMMIT, force: false });
    for (const call of calls) {
      expect(call.headers.authorization).toBe(`Bearer ${GITHUB_TOKEN}`);
      expect(call.headers['x-github-api-version']).toBe('2022-11-28');
      expect(call.path).not.toMatch(/heads\/main/);
    }
  });

  it('uses the commit message it is given', async () => {
    const { calls } = stubGitHub(DRAFT);
    const storage = createGitHubStorage({ settings: SETTINGS });
    await storage.put(
      { folder: 'raven', name: 'b.png', bytes: new Uint8Array([1]) },
      { message: 'media: add the bench photo' },
    );
    expect((find(calls, 'POST /git/commits')?.body as { message: string }).message).toBe('media: add the bench photo');
  });

  it('commits a batch as one commit', async () => {
    const { calls } = stubGitHub(DRAFT);
    const storage = createGitHubStorage({ settings: SETTINGS });
    const files = await storage.putMany([
      { folder: 'raven', name: 'one.png', bytes: new Uint8Array([1]) },
      { folder: 'site', name: 'two.png', bytes: new Uint8Array([2]) },
    ]);
    expect(files.map((file) => file.src)).toEqual(['/media/raven/one.png', '/media/site/two.png']);
    expect(calls.filter((call) => call.path === '/git/blobs')).toHaveLength(2);
    expect(calls.filter((call) => call.path === '/git/commits')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    expect((find(calls, 'POST /git/trees')?.body as { tree: { path: string }[] }).tree.map((entry) => entry.path)).toEqual([
      'public/media/raven/one.png',
      'public/media/site/two.png',
    ]);
    expect((find(calls, 'POST /git/commits')?.body as { message: string }).message).toBe(
      'media: add 2 files (raven/one.png, site/two.png)',
    );
  });

  it('refuses a name that is already there, unless Replace was chosen', async () => {
    const { calls } = stubGitHub(DRAFT);
    const storage = createGitHubStorage({ settings: SETTINGS });
    const refusal = await rejection(storage.put({ folder: 'raven', name: 'Cover.JPEG', bytes: new Uint8Array([1]) }));
    expect(refusal.code).toBe('exists');
    expect(refusal.status).toBe(409);
    expect(calls.some((call) => call.method !== 'GET')).toBe(false);

    await storage.put({ folder: 'raven', name: 'cover.jpeg', bytes: new Uint8Array([1]) }, { replace: true });
    expect((find(calls, 'POST /git/commits')?.body as { message: string }).message).toBe('media: replace raven/cover.jpeg');
  });

  it('makes no commit when a Replace leaves the tree as it was', async () => {
    const { calls } = stubGitHub({ ...DRAFT, 'POST /git/trees': { status: 201, body: { sha: TREE } } });
    const storage = createGitHubStorage({ settings: SETTINGS });
    const file = await storage.put({ folder: 'raven', name: 'cover.jpeg', bytes: new Uint8Array([1]) }, { replace: true });
    expect(file.src).toBe('/media/raven/cover.jpeg');
    expect(find(calls, 'POST /git/commits')).toBeUndefined();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('refuses a name that differs from one already there only in letter case, even with Replace', async () => {
    stubGitHub(DRAFT);
    const storage = createGitHubStorage({ settings: SETTINGS });
    const refusal = await rejection(
      storage.put({ folder: 'raven', name: 'diagram.png', bytes: new Uint8Array([1]) }, { replace: true }),
    );
    expect(refusal.code).toBe('exists');
    expect(refusal.message).toContain('Diagram.png');
  });

  it('reports a conflict when the draft branch moved during the save', async () => {
    stubGitHub({ ...DRAFT, 'PATCH /git/refs/heads/draft': { status: 422, body: { message: 'Update is not a fast forward' } } });
    const storage = createGitHubStorage({ settings: SETTINGS });
    const refusal = await rejection(storage.put({ folder: 'raven', name: 'x.png', bytes: new Uint8Array([1]) }));
    expect(refusal.code).toBe('conflict');
    expect(refusal.status).toBe(409);
  });

  it('refuses to write when the draft branch does not exist yet', async () => {
    const { 'GET /git/ref/heads/draft': _missing, ...rest } = DRAFT;
    const { calls } = stubGitHub(rest);
    const storage = createGitHubStorage({ settings: SETTINGS });
    const refusal = await rejection(storage.put({ folder: 'raven', name: 'x.png', bytes: new Uint8Array([1]) }));
    expect(refusal.code).toBe('draft-missing');
    expect(calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  it('lists a folder of the draft branch: files only, no dotfiles, by name', async () => {
    const { calls } = stubGitHub(DRAFT);
    const storage = createGitHubStorage({ settings: SETTINGS });
    const files = await storage.list('raven');
    expect(files.map((file) => [file.name, file.size, file.src])).toEqual([
      ['Diagram.png', 99, '/media/raven/Diagram.png'],
      ['cover.jpeg', 1234, '/media/raven/cover.jpeg'],
    ]);
    expect(steps(calls)).toEqual(['GET /git/ref/heads/draft', 'GET /contents/public/media/raven']);
    expect(await storage.list('palmsync')).toEqual([]);
  });

  it('lists the production branch while the draft branch does not exist', async () => {
    const { 'GET /git/ref/heads/draft': _missing, ...rest } = DRAFT;
    const { calls } = stubGitHub({
      ...rest,
      'GET /git/ref/heads/main': { status: 200, body: { object: { sha: MAIN_HEAD } } },
    });
    const storage = createGitHubStorage({ settings: SETTINGS });
    await storage.list('raven');
    expect(find(calls, 'GET /contents/public/media/raven')?.path).toBe(`/contents/public/media/raven?ref=${MAIN_HEAD}`);
  });

  it('deletes in one commit with a null tree entry, and skips files that are not there', async () => {
    const { calls } = stubGitHub(DRAFT);
    const storage = createGitHubStorage({ settings: SETTINGS });
    await storage.delete(['/media/raven/cover.jpeg', '/media/raven/cover.jpeg', '/media/raven/gone.png']);
    expect(find(calls, 'POST /git/trees')?.body).toEqual({
      base_tree: TREE,
      tree: [{ path: 'public/media/raven/cover.jpeg', mode: '100644', type: 'blob', sha: null }],
    });
    expect((find(calls, 'POST /git/commits')?.body as { message: string }).message).toBe('media: remove raven/cover.jpeg');
    expect(find(calls, 'PATCH /git/refs/heads/draft')?.body).toEqual({ sha: COMMIT, force: false });

    calls.length = 0;
    await storage.delete('/media/raven/gone.png');
    expect(calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  it('refuses a delete outside public/media before any request', async () => {
    const { fetchMock } = stubGitHub(DRAFT);
    const storage = createGitHubStorage({ settings: SETTINGS });
    for (const src of ['/media/../content/site.json', '/media/raven/../../x.png', 'public/media/raven/a.png', '/media/Raven/a.png', '/media/raven/.gitkeep']) {
      const refusal = await rejection(storage.delete(src));
      expect(['bad-path', 'bad-folder']).toContain(refusal.code);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives the site address of a file', () => {
    const storage = createGitHubStorage({ settings: SETTINGS });
    expect(storage.url({ folder: 'raven', name: 'cover.jpeg' })).toBe('/media/raven/cover.jpeg');
    expect(codeOf(() => storage.url({ folder: 'raven', name: '../x.png' }))).toBe('bad-path');
  });
});

describe('the draft branch guard', () => {
  const refusals: [string, Partial<GitHubSettings>, string][] = [
    ['no draft branch', { draftBranch: '' }, 'no-draft-branch'],
    ['the draft branch is main', { draftBranch: 'main' }, 'protected-branch'],
    ['main in another letter case', { draftBranch: 'Main' }, 'protected-branch'],
    ['main written as a full ref', { draftBranch: 'refs/heads/main' }, 'protected-branch'],
    ['the production branch', { productionBranch: 'live', draftBranch: 'live' }, 'protected-branch'],
    ['an invalid branch name', { draftBranch: 'bad..name' }, 'bad-branch'],
  ];

  for (const [label, change, code] of refusals) {
    it(`refuses every write, with no request made: ${label}`, async () => {
      const { fetchMock } = stubGitHub(DRAFT);
      const storage = createGitHubStorage({ settings: { ...SETTINGS, ...change } });
      expect((await rejection(storage.put({ folder: 'site', name: 'a.png', bytes: new Uint8Array([1]) }))).code).toBe(code);
      expect((await rejection(storage.putMany([{ folder: 'site', name: 'a.png', bytes: new Uint8Array([1]) }]))).code).toBe(code);
      expect((await rejection(storage.delete('/media/site/a.png'))).code).toBe(code);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('reads the branch names from the environment, with no default branch', async () => {
    const { fetchMock } = stubGitHub(DRAFT);
    const storage = getRepoStorage({
      env: { GITHUB_TOKEN, GITHUB_REPO: 'owner/site-repo', GITHUB_BRANCH: 'main' },
    });
    expect(storage.target).toBe('github');
    expect((await rejection(storage.put({ folder: 'site', name: 'a.png', bytes: new Uint8Array([1]) }))).code).toBe(
      'no-draft-branch',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes to a draft branch named in the environment, with quotes pasted around it', async () => {
    const { calls } = stubGitHub(DRAFT);
    const storage = getRepoStorage({
      env: { GITHUB_TOKEN, GITHUB_REPO: 'owner/site-repo', GITHUB_BRANCH: 'main', GITHUB_DRAFT_BRANCH: ' "draft" ' },
    });
    await storage.put({ folder: 'site', name: 'a.png', bytes: new Uint8Array([1]) });
    expect(find(calls, 'PATCH /git/refs/heads/draft')).toBeDefined();
  });
});

describe('GitHub failures', () => {
  it('reports GitHub refusals without the token', async () => {
    stubGitHub({ 'GET /git/ref/heads/draft': { status: 401, body: { message: `Bad credentials ${GITHUB_TOKEN}` } } });
    const storage = createGitHubStorage({ settings: SETTINGS });
    const refusal = await rejection(storage.put({ folder: 'site', name: 'a.png', bytes: new Uint8Array([1]) }));
    expect(refusal.code).toBe('github-failed');
    expect(refusal.message).toContain('401');
    expect(refusal.message).toContain('Bad credentials');
    expect(refusal.message).not.toContain(GITHUB_TOKEN);
  });

  it('reports an unreachable GitHub', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const storage = createGitHubStorage({ settings: SETTINGS });
    expect((await rejection(storage.list('site'))).code).toBe('github-unreachable');
  });

  it('keeps the token off the storage object', () => {
    const storage = createGitHubStorage({ settings: SETTINGS });
    expect(JSON.stringify(storage)).not.toContain(GITHUB_TOKEN);
    expect(Object.values(storage).some((value) => typeof value === 'string' && value.includes(GITHUB_TOKEN))).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------
// The repository on disk (local development)
// -------------------------------------------------------------------------------------------

describe('the repository store on disk', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('is the repository store in development when no GitHub variables are set', () => {
    expect(getRepoStorage({ env: { NODE_ENV: 'development' }, rootDir: root }).target).toBe('disk');
  });

  it('writes under public/media, refuses to overwrite, and replaces on request', async () => {
    const storage = createDiskStorage({ rootDir: root });
    const file = await storage.put({ folder: 'site', name: 'Test Image.PNG', bytes: new Uint8Array([1, 2, 3]) });
    const onDisk = path.join(root, 'public', 'media', 'site', 'test-image.png');
    expect(file).toMatchObject({ store: 'repo', src: '/media/site/test-image.png', size: 3 });
    expect([...fs.readFileSync(onDisk)]).toEqual([1, 2, 3]);

    expect((await rejection(storage.put({ folder: 'site', name: 'test-image.png', bytes: new Uint8Array([9]) }))).code).toBe(
      'exists',
    );
    expect([...fs.readFileSync(onDisk)]).toEqual([1, 2, 3]);

    await storage.put({ folder: 'site', name: 'test-image.png', bytes: new Uint8Array([9]) }, { replace: true });
    expect([...fs.readFileSync(onDisk)]).toEqual([9]);
  });

  it('lists files by name with their sizes, skipping dotfiles and folders', async () => {
    const storage = createDiskStorage({ rootDir: root });
    const dir = path.join(root, 'public', 'media', 'raven');
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'b.jpeg'), 'bb');
    fs.writeFileSync(path.join(dir, 'a.png'), 'a');
    expect((await storage.list('raven')).map((file) => [file.name, file.size, file.src])).toEqual([
      ['a.png', 1, '/media/raven/a.png'],
      ['b.jpeg', 2, '/media/raven/b.jpeg'],
    ]);
    expect(await storage.list('palmsync')).toEqual([]);
  });

  it('deletes by the stored address, and skips a file that is not there', async () => {
    const storage = createDiskStorage({ rootDir: root });
    const file = await storage.put({ folder: 'raven', name: 'gone.txt', bytes: new TextEncoder().encode('x') });
    await storage.delete(file.src);
    expect(fs.existsSync(path.join(root, 'public', 'media', 'raven', 'gone.txt'))).toBe(false);
    await storage.delete('/media/raven/gone.txt');
    expect((await rejection(storage.delete('/media/../../outside.txt'))).code).toBe('bad-path');
    expect(storage.url(file)).toBe('/media/raven/gone.txt');
  });

  it('refuses types, sizes, and unknown folders before writing', async () => {
    const storage = createDiskStorage({ rootDir: root, knownFolders: ['raven'] });
    const byte = new Uint8Array([1]);
    expect((await rejection(storage.put({ folder: 'site', name: 'page.html', bytes: byte }))).code).toBe('refused-type');
    expect((await rejection(storage.put({ folder: 'site', name: 'tool.exe', bytes: byte }))).code).toBe('unsupported-type');
    expect((await rejection(storage.put({ folder: 'ghost', name: 'a.png', bytes: byte }))).code).toBe('unknown-folder');
    expect((await rejection(storage.put({ folder: 'site', name: 'empty.png', bytes: new Uint8Array(0) }))).code).toBe(
      'empty-file',
    );
    expect(
      (await rejection(storage.put({ folder: 'site', name: 'big.png', bytes: new Uint8Array(REPO_MAX_BYTES + 1) }))).code,
    ).toBe('too-large-for-repo');
    expect(fs.existsSync(path.join(root, 'public'))).toBe(false);
  });

  it('stores SVG only through an inspector, and writes the bytes the inspector returns', async () => {
    const storage = createDiskStorage({ rootDir: root });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');
    expect((await rejection(storage.put({ folder: 'site', name: 'plan.svg', bytes: svg }))).code).toBe('svg-not-sanitized');

    const clean = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const inspect = vi.fn(() => clean);
    await storage.put({ folder: 'site', name: 'Plan.SVG', bytes: svg }, { inspect });
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ folder: 'site', name: 'plan.svg', ext: 'svg', store: 'repo' }));
    expect(fs.readFileSync(path.join(root, 'public', 'media', 'site', 'plan.svg'), 'utf8')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
  });

  it('lets an inspector refuse a file', async () => {
    const storage = createDiskStorage({ rootDir: root });
    const inspect = () => {
      throw new StorageError('unsupported-type', 'The bytes are not a PNG image.', 415);
    };
    expect((await rejection(storage.put({ folder: 'site', name: 'a.png', bytes: new Uint8Array([1]) }, { inspect }))).message).toBe(
      'The bytes are not a PNG image.',
    );
  });
});

describe('choosing the repository backend from the environment', () => {
  it('refuses the disk on a read-only server', () => {
    expect(codeOf(() => getRepoStorage({ env: { NODE_ENV: 'production' } }))).toBe('repo-not-configured');
    expect(codeOf(() => getRepoStorage({ env: { VERCEL: '1' } }))).toBe('repo-not-configured');
  });

  it('refuses half a GitHub configuration', () => {
    expect(codeOf(() => getRepoStorage({ env: { GITHUB_TOKEN } }))).toBe('github-incomplete');
    expect(codeOf(() => getRepoStorage({ env: { GITHUB_REPO: 'owner/site-repo' } }))).toBe('github-incomplete');
    expect(codeOf(() => getRepoStorage({ env: { GITHUB_TOKEN, GITHUB_REPO: 'not a repository' } }))).toBe('bad-repo');
    expect(codeOf(() => getRepoStorage({ env: { GITHUB_TOKEN, GITHUB_REPO: 'owner/..' } }))).toBe('bad-repo');
  });

  it('reports the storage status with no secret in it', () => {
    const github = storageStatus({
      GITHUB_TOKEN,
      GITHUB_REPO: 'owner/site-repo',
      GITHUB_BRANCH: 'main',
      GITHUB_DRAFT_BRANCH: 'draft',
      BLOB_READ_WRITE_TOKEN: BLOB_TOKEN,
    });
    expect(github).toEqual({
      repo: { target: 'github', writable: true, draftBranch: 'draft', problem: null },
      blob: { configured: true },
      limits: { repoMaxBytes: 4_000_000, blobMaxBytes: 500_000_000 },
    });
    const text = JSON.stringify(github);
    expect(text).not.toContain(GITHUB_TOKEN);
    expect(text).not.toContain(BLOB_TOKEN);

    const guarded = storageStatus({ GITHUB_TOKEN, GITHUB_REPO: 'owner/site-repo', GITHUB_DRAFT_BRANCH: 'main' });
    expect(guarded.repo).toMatchObject({ target: 'github', writable: false, draftBranch: null });
    expect(guarded.repo.problem).toContain('production branch');

    expect(storageStatus({}).repo).toEqual({ target: 'disk', writable: true, draftBranch: null, problem: null });
    expect(storageStatus({ NODE_ENV: 'production' }).repo.target).toBe('none');
  });
});

// -------------------------------------------------------------------------------------------
// Vercel Blob
// -------------------------------------------------------------------------------------------

const BLOB_HOST = 'https://abc123storeid.public.blob.vercel-storage.com';

describe('the Blob store', () => {
  beforeEach(() => {
    vi.mocked(put).mockReset();
    vi.mocked(list).mockReset();
    vi.mocked(del).mockReset();
  });

  const blobEnv = { env: { BLOB_READ_WRITE_TOKEN: BLOB_TOKEN } };

  it('is refused while BLOB_READ_WRITE_TOKEN is not set, with how to set it up', () => {
    let error: unknown;
    try {
      getBlobStorage({ env: {} });
    } catch (caught) {
      error = caught;
    }
    expect((error as StorageError).code).toBe('blob-not-configured');
    expect((error as StorageError).message).toContain('BLOB_READ_WRITE_TOKEN');
  });

  it('puts a public file under the folder prefix, with a random suffix and no overwrite', async () => {
    const pathname = 'media/site/test-clip-Xy12AbCdEf34GhIjKl56Mn.mp4';
    vi.mocked(put).mockResolvedValue({
      url: `${BLOB_HOST}/${pathname}`,
      downloadUrl: `${BLOB_HOST}/${pathname}?download=1`,
      pathname,
      contentType: 'video/mp4',
      contentDisposition: 'inline; filename="test-clip.mp4"',
      etag: '"etag-1"',
    });
    const storage = getBlobStorage(blobEnv);
    expect(storage.target).toBe('blob');
    // Small on purpose: the size rule is tested above, and a failed match prints the whole buffer.
    const bytes = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);

    const file = await storage.put({ folder: 'site', name: 'Test Clip.MP4', bytes });

    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('media/site/test-clip.mp4', expect.any(Buffer), {
      access: 'public',
      addRandomSuffix: true,
      allowOverwrite: false,
      contentType: 'video/mp4',
      multipart: false,
      token: BLOB_TOKEN,
    });
    expect((vi.mocked(put).mock.calls[0]?.[1] as Buffer).byteLength).toBe(bytes.byteLength);
    expect(file).toEqual({
      store: 'blob',
      folder: 'site',
      name: 'test-clip-Xy12AbCdEf34GhIjKl56Mn.mp4',
      pathname,
      src: `${BLOB_HOST}/${pathname}`,
      downloadHref: `${BLOB_HOST}/${pathname}?download=1`,
      size: bytes.byteLength,
      contentType: 'video/mp4',
    });
    expect(storage.url(file)).toBe(file.src);
  });

  it('never stores SVG, HTML, XML, or JavaScript', async () => {
    const storage = getBlobStorage(blobEnv);
    const byte = new Uint8Array([1]);
    expect((await rejection(storage.put({ folder: 'site', name: 'plan.svg', bytes: byte }, { inspect: (f) => f.bytes }))).code).toBe(
      'repo-only-type',
    );
    for (const name of ['page.html', 'feed.xml', 'app.js']) {
      expect((await rejection(storage.put({ folder: 'site', name, bytes: byte }))).code).toBe('refused-type');
    }
    expect(put).not.toHaveBeenCalled();
  });

  it('lists every page of a folder, direct children only, by name', async () => {
    const uploadedAt = new Date('2026-11-01T10:00:00Z');
    const blob = (pathname: string, size: number) => ({
      url: `${BLOB_HOST}/${pathname}`,
      downloadUrl: `${BLOB_HOST}/${pathname}?download=1`,
      pathname,
      size,
      uploadedAt,
      etag: `"${pathname}"`,
    });
    vi.mocked(list)
      .mockResolvedValueOnce({
        blobs: [blob('media/raven/z-model-Ab12.glb', 300), blob('media/raven/deeper/x-Cd34.png', 1)],
        cursor: 'page-2',
        hasMore: true,
      })
      .mockResolvedValueOnce({ blobs: [blob('media/raven/a-clip-Ef56.mp4', 200)], hasMore: false });
    const storage = getBlobStorage(blobEnv);

    const files = await storage.list('raven');

    expect(list).toHaveBeenCalledTimes(2);
    expect(vi.mocked(list).mock.calls[0]?.[0]).toEqual({ prefix: 'media/raven/', limit: 1000, token: BLOB_TOKEN });
    expect(vi.mocked(list).mock.calls[1]?.[0]).toEqual({ prefix: 'media/raven/', limit: 1000, token: BLOB_TOKEN, cursor: 'page-2' });
    expect(files.map((file) => [file.name, file.size, file.store, file.uploadedAt])).toEqual([
      ['a-clip-Ef56.mp4', 200, 'blob', '2026-11-01T10:00:00.000Z'],
      ['z-model-Ab12.glb', 300, 'blob', '2026-11-01T10:00:00.000Z'],
    ]);
    expect(files[0]?.downloadHref).toBe(`${BLOB_HOST}/media/raven/a-clip-Ef56.mp4?download=1`);
  });

  it('deletes by the stored address, and only inside its own prefix', async () => {
    vi.mocked(del).mockResolvedValue(undefined);
    const storage = getBlobStorage(blobEnv);
    const src = `${BLOB_HOST}/media/raven/a-clip-Ef56.mp4`;

    await storage.delete(src);
    expect(del).toHaveBeenCalledWith(src, { token: BLOB_TOKEN });

    await storage.delete([src, `${BLOB_HOST}/media/site/b-Gh78.pdf`, src]);
    expect(del).toHaveBeenLastCalledWith([src, `${BLOB_HOST}/media/site/b-Gh78.pdf`], { token: BLOB_TOKEN });

    vi.mocked(del).mockClear();
    for (const bad of [
      'https://example.com/media/raven/a.mp4',
      `${BLOB_HOST.replace('https:', 'http:')}/media/raven/a.mp4`,
      `${BLOB_HOST}/other/raven/a.mp4`,
      `${BLOB_HOST}/media/raven/deeper/a.mp4`,
      `${BLOB_HOST}/media/../raven/a.mp4`,
      '/media/raven/a.mp4',
    ]) {
      const refusal = await rejection(storage.delete(bad));
      expect(['bad-path', 'bad-folder']).toContain(refusal.code);
    }
    expect(del).not.toHaveBeenCalled();
  });

  it('returns the stored address from url(), and refuses one it did not store', () => {
    const storage = getBlobStorage(blobEnv);
    const src = `${BLOB_HOST}/media/raven/a-clip-Ef56.mp4`;
    expect(storage.url({ folder: 'raven', name: 'a-clip-Ef56.mp4', src })).toBe(src);
    expect(codeOf(() => storage.url({ folder: 'raven', name: 'a-clip-Ef56.mp4' }))).toBe('bad-path');
    expect(codeOf(() => storage.url({ folder: 'site', name: 'a-clip-Ef56.mp4', src }))).toBe('bad-path');
    expect(codeOf(() => storage.url({ folder: 'raven', name: 'a.mp4', src: 'https://example.com/media/raven/a.mp4' }))).toBe(
      'bad-path',
    );
  });

  it('uses its own prefix when given one', async () => {
    vi.mocked(put).mockResolvedValue({
      url: `${BLOB_HOST}/preview/media/site/a-Ab12.png`,
      downloadUrl: `${BLOB_HOST}/preview/media/site/a-Ab12.png?download=1`,
      pathname: 'preview/media/site/a-Ab12.png',
      contentType: 'image/png',
      contentDisposition: 'inline',
      etag: '"e"',
    });
    const storage = getBlobStorage({ ...blobEnv, blobPrefix: 'preview/media' });
    const file = await storage.put({ folder: 'site', name: 'a.png', bytes: new Uint8Array([1]) });
    expect(vi.mocked(put).mock.calls[0]?.[0]).toBe('preview/media/site/a.png');
    expect(file.name).toBe('a-Ab12.png');
    expect(codeOf(() => getBlobStorage({ ...blobEnv, blobPrefix: '../media' }))).toBe('bad-path');
  });

  it('reports Blob refusals without the token', async () => {
    vi.mocked(put).mockRejectedValue(new Error(`Vercel Blob: Access denied for ${BLOB_TOKEN}`));
    const storage = getBlobStorage(blobEnv);
    const refusal = await rejection(storage.put({ folder: 'site', name: 'a.png', bytes: new Uint8Array([1]) }));
    expect(refusal.code).toBe('blob-failed');
    expect(refusal.message).toContain('Access denied');
    expect(refusal.message).not.toContain(BLOB_TOKEN);
    expect(JSON.stringify(storage)).not.toContain(BLOB_TOKEN);
  });
});
