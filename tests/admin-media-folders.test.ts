/**
 * The media folders the library can reach (ARCHITECTURE.md 13A: "one library per project plus a
 * site library"; docs/V3_PLAN.md D-24, D-27; review findings CLIENT-3 and CLIENT-5, server side):
 *
 * - GET /api/upload?folders=1 lists every folder that exists, in the repository (the draft, or the
 *   published branch while there is no draft) and in Blob, with the project or "site" that owns it
 *   and its number of files across both stores;
 * - the folder check accepts "site", a saved project, or a folder that already holds files, so the
 *   files of a renamed or deleted project can still be listed, renamed, replaced, deleted, and
 *   added to; a folder that exists nowhere, or a name `checkFolder` refuses, is still refused.
 *
 * Called as route handlers against the in-memory GitHub in ./admin-github-fake.ts (the real
 * lib/admin/server/repo.ts underneath), with Vercel Blob mocked. All settings are synthetic.
 */
import { crc32, deflateSync } from 'node:zlib';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/upload/route';
import { POST as TOKEN } from '../app/api/upload/token/route';
import { serializeContent, type ApiError, type MediaFoldersResponse, type MediaListResponse, type UploadResponse } from '../lib/admin/contract';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth';
import { adminRequest, FakeGitHub, installFakeGitHub, ORIGIN, stubAdminEnv } from './admin-github-fake';

const blob = vi.hoisted(() => ({ list: vi.fn(), del: vi.fn(), head: vi.fn(), put: vi.fn(), copy: vi.fn(), token: vi.fn() }));

vi.mock('@vercel/blob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vercel/blob')>();
  return { ...actual, list: blob.list, del: blob.del, head: blob.head, put: blob.put, copy: blob.copy };
});
vi.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: blob.token }));

/** The store host of the synthetic BLOB_READ_WRITE_TOKEN in ./admin-github-fake.ts. */
const HOST = 'teststore123.public.blob.vercel-storage.com';
const HOUR = 60 * 60 * 1000;
const enc = (text: string) => new TextEncoder().encode(text);

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = enc(type);
  const size = new Uint8Array(4);
  const crc = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, data.byteLength);
  new DataView(crc.buffer).setUint32(0, crc32(cat(name, data)));
  return cat(size, name, data, crc);
}

const PNG_1X1 = cat(
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
  pngChunk('IDAT', deflateSync(Buffer.from([0, 0]))),
  pngChunk('IEND', new Uint8Array(0)),
);

interface BlobObject {
  url: string;
  downloadUrl: string;
  pathname: string;
  size: number;
  uploadedAt: Date;
  etag: string;
}

function stored(pathname: string, size: number, age = 3 * HOUR): BlobObject {
  const url = `https://${HOST}/${pathname}`;
  return { url, downloadUrl: `${url}?download=1`, pathname, size, uploadedAt: new Date(Date.now() - age), etag: pathname };
}

/** What the Blob store holds: a project's file, an orphan folder's file, placeholders, and names no folder may have. */
const OBJECTS: BlobObject[] = [
  stored('media/raven/flight-0123456789ab.mp4', 6_000_000),
  stored('media/old-demo/clip-0123456789ab.mp4', 7_000_000),
  stored('media/old-demo/refused-ba9876543210.mp4', 23, 5 * 60 * 1000),
  stored('media/gone/refused-0123456789ab.mp4', 23),
  stored('media/Bad_Folder/clip-0123456789ab.mp4', 6_000_000),
  stored('media/raven/nested/clip-0123456789ab.mp4', 6_000_000),
];

let fake: FakeGitHub;
let objects: BlobObject[];

beforeEach(() => {
  stubAdminEnv();
  fake = installFakeGitHub();
  objects = [...OBJECTS];
  for (const mock of Object.values(blob)) mock.mockReset();
  blob.list.mockImplementation(async ({ prefix = '' }: { prefix?: string } = {}) => ({
    blobs: objects.filter((object) => object.pathname.startsWith(prefix)),
    hasMore: false,
  }));
  blob.del.mockResolvedValue(undefined);
  blob.token.mockResolvedValue('vercel_blob_client_teststore123_synthetic');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function folders(): Promise<MediaFoldersResponse> {
  const res = await GET(adminRequest('GET', '/api/upload?folders=1'));
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toContain('no-store');
  return (await res.json()) as MediaFoldersResponse;
}

async function list(folder: string): Promise<Response> {
  return GET(adminRequest('GET', `/api/upload?folder=${encodeURIComponent(folder)}`));
}

function upload(folder: string, name: string, bytes: Uint8Array): NextRequest {
  const form = new FormData();
  form.set('folder', folder);
  form.append('file', new File([bytes as unknown as BlobPart], name));
  return new NextRequest(`${ORIGIN}/api/upload`, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie: `${SESSION_COOKIE}=${createSessionToken(process.env).token}` },
    body: form,
  });
}

function token(folder: string): Promise<Response> {
  return TOKEN(adminRequest('POST', '/api/upload/token', { body: { folder, name: 'clip.mp4', size: 5_000_000, contentType: 'video/mp4' } }));
}

/** The files directly inside each folder of public/media on a branch, as the library counts them. */
function repoCounts(branch: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of fake.filesAt(branch).keys()) {
    const match = /^public\/media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(.+)$/.exec(file);
    if (!match) continue;
    const listed = !match[2].includes('/') && match[2] !== '.gitkeep';
    counts.set(match[1], (counts.get(match[1]) ?? 0) + (listed ? 1 : 0));
  }
  return counts;
}

/** A slug rename as a save makes it: the project file moves; its media stay in the old folder. */
function renameProject(from: string, to: string): void {
  const text = fake.filesAt('main').get(`content/projects/${from}.json`)!;
  fake.push('main', {
    [`content/projects/${from}.json`]: null,
    [`content/projects/${to}.json`]: serializeContent({ ...JSON.parse(text), slug: to }),
  });
}

describe('GET /api/upload?folders=1', () => {
  it('lists every folder in either store with its owner and its files, and nothing else', async () => {
    fake.push('main', {
      'public/media/raven-v1/cover.webp': 'placeholder bytes',
      'public/media/raven-v1/arm.png': 'placeholder bytes',
      'public/media/raven-v1/notes/old.txt': 'a nested file: the folder exists, the file is not listed',
      'public/media/empty-folder/.gitkeep': '',
      'public/media/Bad_Folder/x.png': 'a folder name checkFolder refuses',
      'public/media/readme.txt': 'not in a folder',
    });
    const answer = await folders();
    const repo = repoCounts('main');
    const byName = new Map(answer.folders.map((entry) => [entry.folder, entry]));

    expect(answer.folders.map((entry) => entry.folder)).toEqual([...answer.folders.map((entry) => entry.folder)].sort());
    expect(byName.get('site')).toEqual({ folder: 'site', owner: 'site', files: repo.get('site') });
    expect(byName.get('raven')).toEqual({ folder: 'raven', owner: 'raven', files: (repo.get('raven') ?? 0) + 1 });
    expect(byName.get('raven-v1')).toEqual({ folder: 'raven-v1', owner: null, files: 2 });
    expect(byName.get('empty-folder')).toEqual({ folder: 'empty-folder', owner: null, files: 0 });
    // Only in Blob; its placeholder is not a file.
    expect(byName.get('old-demo')).toEqual({ folder: 'old-demo', owner: null, files: 1 });
    // Placeholders only: nothing to reach. Names checkFolder refuses never appear.
    for (const absent of ['gone', 'Bad_Folder', 'readme.txt', 'nested', 'content']) expect(byName.has(absent), absent).toBe(false);
    // Every other folder is one the seed holds in the repository, owned by its saved project.
    for (const [folder, files] of repo) {
      if (['site', 'raven', 'raven-v1', 'empty-folder'].includes(folder)) continue;
      expect(byName.get(folder), folder).toEqual({ folder, owner: folder, files });
    }
    expect(answer.folders).toHaveLength(new Set([...repo.keys(), 'old-demo']).size);
  });

  it('reads only the Blob media prefix, and removes placeholders whose token has surely expired', async () => {
    await folders();
    for (const [options] of blob.list.mock.calls) expect(options.prefix).toMatch(/^media\//);
    expect(blob.del).toHaveBeenCalledTimes(1);
    expect(blob.del).toHaveBeenCalledWith([`https://${HOST}/media/gone/refused-0123456789ab.mp4`], expect.objectContaining({ token: expect.any(String) }));
    expect(fake.unexpected).toEqual([]);
    expect(fake.writes()).toEqual([]);
  });

  it('lists the repository folders alone while Blob is not set up', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    const answer = await folders();
    expect(answer.folders.map((entry) => entry.folder)).toEqual([...repoCounts('main').keys()].sort());
    expect(blob.list).not.toHaveBeenCalled();
  });

  it('needs a session', async () => {
    expect((await GET(adminRequest('GET', '/api/upload?folders=1', { session: false }))).status).toBe(401);
  });
});

describe('a folder whose project was renamed or deleted stays within reach (CLIENT-5)', () => {
  it('lists the old folder with no owner, and lists, uploads to, and issues Blob tokens for it', async () => {
    const before = repoCounts('main').get('raven') ?? 0;
    expect(before).toBeGreaterThan(0);
    renameProject('raven', 'raven-evtol');

    const answer = await folders();
    expect(answer.folders.find((entry) => entry.folder === 'raven')).toEqual({ folder: 'raven', owner: null, files: before + 1 });
    // The new slug owns no folder until something is uploaded under it.
    expect(answer.folders.some((entry) => entry.folder === 'raven-evtol')).toBe(false);

    const listed = await list('raven');
    expect(listed.status).toBe(200);
    const files = ((await listed.json()) as MediaListResponse).files;
    expect(files.filter((file) => file.store === 'repo')).toHaveLength(before);
    expect(files.filter((file) => file.store === 'blob').map((file) => file.name)).toEqual(['flight-0123456789ab.mp4']);

    const added = await POST(upload('raven', 'detail.png', PNG_1X1));
    expect(added.status).toBe(200);
    expect(((await added.json()) as UploadResponse).files[0]).toMatchObject({ folder: 'raven', src: '/media/raven/detail.png' });
    expect(fake.filesAt('draft').has('public/media/raven/detail.png')).toBe(true);

    expect((await token('raven')).status).toBe(200);
    expect((await list('raven-evtol')).status).toBe(200);
  });

  it('keeps a deleted project folder reachable through its files', async () => {
    fake.push('main', { 'content/projects/raven.json': null });
    expect((await list('raven')).status).toBe(200);
    expect((await folders()).folders.find((entry) => entry.folder === 'raven')?.owner).toBeNull();
  });

  it('accepts a folder that holds files only in Blob, and never lists its placeholders', async () => {
    const res = await list('old-demo');
    expect(res.status).toBe(200);
    expect(((await res.json()) as MediaListResponse).files.map((file) => file.src)).toEqual([`https://${HOST}/media/old-demo/clip-0123456789ab.mp4`]);
    expect((await token('old-demo')).status).toBe(200);
  });
});

describe('folders that may not be used', () => {
  it('refuses a folder that holds nothing anywhere, and writes nothing', async () => {
    for (const folder of ['never-was', 'gone']) {
      const res = await list(folder);
      expect(res.status, folder).toBe(400);
      expect(((await res.json()) as ApiError).error).toMatch(/Save a new project/);
    }
    expect((await POST(upload('never-was', 'a.png', PNG_1X1))).status).toBe(400);
    expect((await token('never-was')).status).toBe(400);
    expect(fake.refs.has('draft')).toBe(false);
    expect(blob.token).not.toHaveBeenCalled();
  });

  it('refuses a name checkFolder refuses, even when such a folder holds files', async () => {
    fake.push('main', { 'public/media/Bad_Folder/x.png': 'bytes' });
    for (const folder of ['Bad_Folder', '../raven', 'raven/..', '%2e%2e', 'site/../raven', '']) {
      const res = await list(folder);
      expect(res.status, folder).toBe(400);
      expect(((await res.json()) as ApiError).findings?.[0]).toMatchObject({ path: '(path)', rule: 'PATH' });
    }
    expect((await POST(upload('../raven', 'a.png', PNG_1X1))).status).toBe(400);
    expect(fake.refs.has('draft')).toBe(false);
  });
});
