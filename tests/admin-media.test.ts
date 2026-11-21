/**
 * The media routes (ARCHITECTURE.md 11 "Uploads" and "Paths", 13A; docs/V3_PLAN.md D-17, D-23 to
 * D-27): sessions and origins, paths outside public/media, types from bytes, the content check of
 * names and words (a Blob GLB's names included), references (every string field, and absolute
 * addresses on the site's own host), Blob tokens and tickets with the placeholders that keep a
 * token single-use, and the preview route's headers.
 *
 * The repository is an in-memory ContentRepo, Vercel Blob is mocked, and every secret is
 * synthetic.
 */
import { crc32, deflateSync } from 'node:zlib';
import { BlobNotFoundError } from '@vercel/blob';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as CONFIRM } from '../app/api/upload/confirm/route';
import { GET as FILE } from '../app/api/upload/file/route';
import { GET as REFERENCES } from '../app/api/upload/references/route';
import { POST as RENAME } from '../app/api/upload/rename/route';
import { DELETE, GET, POST } from '../app/api/upload/route';
import { POST as TOKEN } from '../app/api/upload/token/route';
import { serializeContent, type ApiError, type BlobTokenResponse, type MediaListResponse } from '../lib/admin/contract';
import { signTicket } from '../lib/admin/server/blob-ticket';
import type { CompareResult, ContentRepo, ContentSnapshot, FileChange, RepoFileEntry } from '../lib/admin/server/repo';
import { bufferSource, PHOTO_MESSAGE, scanImageMetadata } from '../lib/admin/server/sniff';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth';

const state = vi.hoisted(() => ({ repo: null as unknown }));
const blob = vi.hoisted(() => ({ head: vi.fn(), del: vi.fn(), copy: vi.fn(), list: vi.fn(), put: vi.fn(), token: vi.fn() }));

vi.mock('../lib/admin/server/repo', () => ({ getContentRepo: () => state.repo }));
vi.mock('@vercel/blob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vercel/blob')>();
  return { ...actual, head: blob.head, del: blob.del, copy: blob.copy, list: blob.list, put: blob.put };
});
vi.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: blob.token }));

// ---------------------------------------------------------------------------------------------
// Synthetic settings and files
// ---------------------------------------------------------------------------------------------

const ORIGIN = 'https://admin.test';
const PASSWORD = 'media route test password, synthetic';
const SECRET = 'media-route-test-session-secret-0123456789';
const BLOB_TOKEN = ['vercel', 'blob', 'rw', 'teststore42', 'syntheticTokenForTests'].join('_');
const HOST = 'teststore42.public.blob.vercel-storage.com';
const CLIP = `https://${HOST}/media/raven/clip-0123456789ab.mp4`;
const SPARE = `https://${HOST}/media/raven/spare-ba9876543210.mp4`;

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function u32(n: number, little: boolean): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, little);
  return out;
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  return cat(enc(fourcc), u32(data.byteLength, true), data, new Uint8Array(data.byteLength % 2));
}

const WEBP_1X1 = Uint8Array.from(Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'));

/** A 1 x 1 WebP with EXIF and XMP chunks, as a camera or an editor might leave them. */
function webpWithMetadata(): Uint8Array {
  const vp8x = riffChunk('VP8X', new Uint8Array([0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const exif = riffChunk('EXIF', cat(enc('Exif'), new Uint8Array([0, 0]), enc('II*'), new Uint8Array([0, 8, 0, 0, 0, 0, 0])));
  const xmp = riffChunk('XMP ', enc('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'));
  const body = cat(enc('WEBP'), vp8x, WEBP_1X1.subarray(12), exif, xmp);
  return cat(enc('RIFF'), u32(body.byteLength, true), body);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = enc(type);
  return cat(u32(data.byteLength, false), name, data, u32(crc32(cat(name, data)), false));
}

const PNG_1X1 = cat(
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
  pngChunk('IDAT', deflateSync(Buffer.from([0, 0]))),
  pngChunk('IEND', new Uint8Array(0)),
);
const MP4 = cat(u32(24, false), enc('ftypisom'), u32(0x200, false), enc('isomiso2'), u32(16, false), enc('free'), new Uint8Array(8));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const HEIC = cat(u32(24, false), enc('ftypheic'), u32(0, false), enc('mif1heic'));
const VTT = 'WEBVTT\n\n00:00.000 --> 00:01.000\nThe arm folds.\n';
const SVG_WITH_SCRIPT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><path d="M0 0L10 10"/></svg>';

const SITE = {
  personal: { name: 'Owner', photo: { kind: 'image', src: '/media/site/me.webp', alt: '' } },
  about: { paragraphs: ['Built in the lab.'] },
};
const RAVEN = {
  slug: 'raven',
  cover: { kind: 'image', src: '/media/raven/cover.webp', alt: '' },
  pitch: 'A tri-tiltrotor.',
  blocks: [
    { id: 'b1', type: 'text', md: 'The arm ![arm](/media/raven/arm.png). Not /media/raven/arm.png2.' },
    { id: 'b2', type: 'video', media: { kind: 'video', src: CLIP } },
  ],
};

// ---------------------------------------------------------------------------------------------
// An in-memory repository
// ---------------------------------------------------------------------------------------------

const CONTENT_FILE = /^content\/(?:site|projects\/[a-z0-9-]+)\.json$/;

class MemoryRepo implements ContentRepo {
  readonly source = 'github' as const;
  readonly liveBranch = 'live-test';
  readonly draftBranch = 'draft-test';
  live: Map<string, Uint8Array>;
  draft: Map<string, Uint8Array> | null = null;
  liveHead = 'a'.repeat(40);
  draftHead: string | null = null;
  commits: { expected: string | null; changes: FileChange[]; message: string }[] = [];
  prepared = 0;
  /** Files the next prepareDraft brings into the draft, as a merge of a live branch that moved on would. */
  mergeOnPrepare: Record<string, Uint8Array | string> | null = null;
  private serial = 0;

  constructor(files: Record<string, Uint8Array | string>) {
    this.live = new Map(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? enc(value) : value]));
  }

  private tree(which: 'draft' | 'live'): Map<string, Uint8Array> {
    return which === 'live' || this.draft === null ? this.live : this.draft;
  }

  /** Writes a file to the draft only, as an unpublished save would. */
  setDraft(path: string, value: string): void {
    this.draft ??= new Map(this.live);
    this.draftHead ??= this.liveHead;
    this.draft.set(path, enc(value));
  }

  async heads() {
    return { live: this.liveHead, draft: this.draftHead };
  }

  async readContent(which: 'draft' | 'live' = 'draft'): Promise<ContentSnapshot> {
    const tree = this.tree(which);
    const files = [...tree].filter(([path]) => CONTENT_FILE.test(path)).map(([path, bytes]) => ({ path, text: dec(bytes) }));
    const fromDraft = which === 'draft' && this.draft !== null;
    return { source: 'github', ref: fromDraft ? 'draft' : 'live', head: fromDraft ? this.draftHead : this.liveHead, files };
  }

  async readFile(which: 'draft' | 'live', path: string): Promise<Uint8Array | null> {
    return this.tree(which).get(path) ?? null;
  }

  async listFiles(which: 'draft' | 'live', dir: string): Promise<RepoFileEntry[]> {
    return [...this.tree(which)]
      .filter(([path]) => path.startsWith(`${dir}/`))
      .map(([path, bytes]) => ({ path, sha: String(bytes.byteLength), size: bytes.byteLength }));
  }

  async prepareDraft(): Promise<string | null> {
    this.prepared += 1;
    this.draft ??= new Map(this.live);
    this.draftHead ??= this.liveHead;
    if (this.mergeOnPrepare) {
      for (const [path, value] of Object.entries(this.mergeOnPrepare)) this.draft.set(path, typeof value === 'string' ? enc(value) : value);
      this.mergeOnPrepare = null;
      this.draftHead = 'd'.repeat(40);
    }
    return this.draftHead;
  }

  async commit(expected: string | null, changes: readonly FileChange[], message: string): Promise<string | null> {
    if (expected !== this.draftHead || this.draft === null) throw new Error('commit on a moved head');
    for (const change of changes) {
      if (!/^(?:content\/|public\/media\/[a-z0-9-]+\/[A-Za-z0-9_][A-Za-z0-9_.-]*$)/.test(change.path) || change.path.includes('..')) {
        throw new Error(`commit outside content/ and public/media/: ${change.path}`);
      }
      if (change.bytes) this.draft.set(change.path, change.bytes);
      else this.draft.delete(change.path);
    }
    this.commits.push({ expected, changes: [...changes], message });
    this.serial += 1;
    this.draftHead = this.serial.toString(16).padStart(40, 'c');
    return this.draftHead;
  }

  async compare(): Promise<CompareResult> {
    throw new Error('not used here');
  }

  async fastForwardLive(): Promise<void> {
    throw new Error('not used here');
  }

  async resetDraft(): Promise<void> {
    throw new Error('not used here');
  }
}

function makeRepo(extra: Record<string, Uint8Array | string> = {}): MemoryRepo {
  return new MemoryRepo({
    'content/site.json': serializeContent(SITE),
    'content/projects/raven.json': serializeContent(RAVEN),
    'public/media/site/me.webp': WEBP_1X1,
    'public/media/raven/.gitkeep': '',
    'public/media/raven/cover.webp': WEBP_1X1,
    'public/media/raven/arm.png': PNG_1X1,
    'public/media/raven/old.png': PNG_1X1,
    ...extra,
  });
}

let repo: MemoryRepo;

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

function cookie(): string {
  return `${SESSION_COOKIE}=${createSessionToken(process.env).token}`;
}

interface RequestOptions {
  origin?: string | null;
  session?: boolean;
}

function headersFor(options: RequestOptions, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.session !== false) headers.cookie = cookie();
  return headers;
}

function upload(folder: string, files: File[], fields: Record<string, string> = {}, options: RequestOptions = {}): NextRequest {
  const form = new FormData();
  form.set('folder', folder);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  for (const file of files) form.append('file', file);
  return new NextRequest(`${ORIGIN}/api/upload`, { method: 'POST', headers: headersFor(options), body: form });
}

function jsonRequest(path: string, method: string, body: unknown, options: RequestOptions = {}): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: headersFor(options, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

function getRequest(path: string, options: RequestOptions = {}): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, { headers: headersFor({ ...options, origin: null }) });
}

function file(name: string, bytes: Uint8Array | string): File {
  return new File([(typeof bytes === 'string' ? enc(bytes) : bytes) as unknown as BlobPart], name);
}

async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** A stand-in for the public Blob host: answers range requests and whole reads from `bytes`. */
function serveBlob(bytes: Uint8Array) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    if (!range) return new Response(bytes as unknown as BodyInit, { status: 200 });
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range) ?? [];
    return new Response(bytes.slice(Number(start), Number(end) + 1) as unknown as BodyInit, { status: 206 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function issueToken(name: string, size: number, contentType: string): Promise<BlobTokenResponse> {
  const res = await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'raven', name, size, contentType }));
  expect(res.status).toBe(200);
  return body<BlobTokenResponse>(res);
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * The Blob object at `pathname` was overwritten with a placeholder through the store's read-write
 * token, at the same pathname, rather than deleted: the client token (no overwrite) can then never
 * write that pathname again.
 */
function expectPlaceholderAt(pathname: string): void {
  expect(blob.put).toHaveBeenCalledWith(
    pathname,
    expect.any(String),
    expect.objectContaining({ access: 'public', addRandomSuffix: false, allowOverwrite: true, token: BLOB_TOKEN }),
  );
  const [, placeholder] = blob.put.mock.calls.find(([at]) => at === pathname)!;
  expect(enc(placeholder as string).byteLength).toBeLessThanOrEqual(4_000_000);
  expect(blob.del).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSWORD', PASSWORD);
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', BLOB_TOKEN);
  vi.stubEnv('BLOB_STORE_HOST', '');
  vi.stubEnv('CONTENT_BLOCKLIST', 'Zorblax|cs:QuuxWorks');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('CI', '');
  repo = makeRepo();
  state.repo = repo;
  for (const mock of Object.values(blob)) mock.mockReset();
  blob.token.mockResolvedValue('vercel_blob_client_teststore42_synthetic');
  blob.del.mockResolvedValue(undefined);
  blob.list.mockResolvedValue({ blobs: [], hasMore: false });
  blob.put.mockImplementation(async (pathname: string) => ({
    url: `https://${HOST}/${pathname}`,
    downloadUrl: `https://${HOST}/${pathname}?download=1`,
    pathname,
    contentType: 'text/plain; charset=utf-8',
    contentDisposition: 'inline',
    etag: 'placeholder',
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('the guard on every media route', () => {
  it('answers 401 without a session and 403 without an Origin, before touching the repository', async () => {
    expect((await POST(upload('raven', [file('a.webp', WEBP_1X1)], {}, { session: false }))).status).toBe(401);
    expect((await POST(upload('raven', [file('a.webp', WEBP_1X1)], {}, { origin: null }))).status).toBe(403);
    expect((await POST(upload('raven', [file('a.webp', WEBP_1X1)], {}, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await DELETE(jsonRequest('/api/upload', 'DELETE', { src: '/media/raven/old.png' }, { origin: null }))).status).toBe(403);
    expect((await TOKEN(jsonRequest('/api/upload/token', 'POST', {}, { origin: null }))).status).toBe(403);
    expect((await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', {}, { origin: null }))).status).toBe(403);
    expect((await RENAME(jsonRequest('/api/upload/rename', 'POST', {}, { origin: null }))).status).toBe(403);
    expect((await GET(getRequest('/api/upload?folder=raven', { session: false }))).status).toBe(401);
    expect((await FILE(getRequest('/api/upload/file?src=%2Fmedia%2Fraven%2Fold.png', { session: false }))).status).toBe(401);
    expect((await REFERENCES(getRequest('/api/upload/references?src=%2Fmedia%2Fraven%2Fold.png', { session: false }))).status).toBe(401);
    expect(repo.prepared).toBe(0);
    expect(repo.commits).toHaveLength(0);
  });

  it('validates every JSON body with its schema', async () => {
    const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: '/media/raven/old.png', force: true }));
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: 'bad-request' });
  });
});

describe('GET /api/upload', () => {
  it('lists repository and Blob files with previews, downloads, and reference counts', async () => {
    blob.list.mockResolvedValue({
      blobs: [
        { url: CLIP, downloadUrl: `${CLIP}?download=1`, pathname: 'media/raven/clip-0123456789ab.mp4', size: 5_000_000, uploadedAt: new Date('2026-11-01T00:00:00Z'), etag: 'e' },
        { url: SPARE, downloadUrl: `${SPARE}?download=1`, pathname: 'media/raven/spare-ba9876543210.mp4', size: 6_000_000, uploadedAt: new Date('2026-11-02T00:00:00Z'), etag: 'f' },
      ],
      hasMore: false,
    });
    const res = await GET(getRequest('/api/upload?folder=raven&refs=1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const list = await body<MediaListResponse>(res);
    expect(list.files.map((f) => f.name)).toEqual(['arm.png', 'clip-0123456789ab.mp4', 'cover.webp', 'old.png', 'spare-ba9876543210.mp4']);
    const arm = list.files.find((f) => f.name === 'arm.png');
    expect(arm).toMatchObject({
      store: 'repo',
      src: '/media/raven/arm.png',
      previewSrc: '/api/upload/file?src=%2Fmedia%2Fraven%2Farm.png',
      downloadHref: '/media/raven/arm.png',
      refs: { draft: 1, live: 1 },
    });
    expect(list.files.find((f) => f.name === 'cover.webp')?.refs).toEqual({ draft: 1, live: 1 });
    expect(list.files.find((f) => f.name === 'old.png')?.refs).toEqual({ draft: 0, live: 0 });
    expect(list.files.find((f) => f.src === CLIP)).toMatchObject({ store: 'blob', previewSrc: CLIP, downloadHref: `${CLIP}?download=1`, refs: { draft: 1, live: 1 } });
    expect(list.files.find((f) => f.src === SPARE)?.refs).toEqual({ draft: 0, live: 0 });
    expect(blob.list).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'media/raven/', token: BLOB_TOKEN }));
  });

  it('lists only "site", the projects saved in the draft, and folders that already hold files', async () => {
    expect((await GET(getRequest('/api/upload?folder=site'))).status).toBe(200);
    for (const folder of ['ghost-project', '../raven', 'Raven', '']) {
      const res = await GET(getRequest(`/api/upload?folder=${encodeURIComponent(folder)}`));
      expect(res.status, folder).toBe(400);
    }
  });
});

describe('POST /api/upload', () => {
  it('stores a WebP without its metadata, in one commit on the draft branch', async () => {
    const res = await POST(upload('raven', [file('Flight Test.WEBP', webpWithMetadata())]));
    expect(res.status).toBe(200);
    const answer = await body(res);
    expect(answer).toMatchObject({
      ok: true,
      files: [
        {
          store: 'repo',
          folder: 'raven',
          name: 'flight-test.webp',
          src: '/media/raven/flight-test.webp',
          previewSrc: '/api/upload/file?src=%2Fmedia%2Fraven%2Fflight-test.webp',
          contentType: 'image/webp',
        },
      ],
    });
    expect(answer.commit).toBe(repo.draftHead);
    expect(repo.commits).toHaveLength(1);
    expect(repo.commits[0].message).toBe('media: add raven/flight-test.webp');
    const stored = repo.draft?.get('public/media/raven/flight-test.webp');
    expect(stored).toBeDefined();
    expect(await scanImageMetadata('webp', bufferSource(stored!))).toEqual({ metadata: [], damaged: false });
  });

  it('commits every file of one request together', async () => {
    const res = await POST(upload('raven', [file('detail.png', PNG_1X1), file('captions.vtt', VTT)]));
    expect(res.status).toBe(200);
    expect(repo.commits).toHaveLength(1);
    expect(repo.commits[0].changes.map((c) => c.path)).toEqual(['public/media/raven/detail.png', 'public/media/raven/captions.vtt']);
    expect(repo.commits[0].message).toBe('media: add 2 files (raven/detail.png, raven/captions.vtt)');
  });

  it('sanitizes an SVG drawing before it is stored', async () => {
    const res = await POST(upload('raven', [file('frame.svg', SVG_WITH_SCRIPT)]));
    expect(res.status).toBe(200);
    const stored = dec(repo.draft!.get('public/media/raven/frame.svg')!);
    expect(stored).toContain('<path d="M0 0L10 10"/>');
    expect(stored).not.toContain('script');
    expect(stored).not.toContain('onload');
  });

  it('refuses PNG bytes named .webp, and photos sent straight to the server', async () => {
    const mismatch = await POST(upload('raven', [file('photo.webp', PNG_1X1)]));
    expect(mismatch.status).toBe(422);
    expect(await body<ApiError>(mismatch)).toMatchObject({ code: 'invalid-file' });
    const photo = await POST(upload('raven', [file('photo.jpg', JPEG)]));
    expect(photo.status).toBe(422);
    expect((await body<ApiError>(photo)).error).toBe(`"photo.jpg": ${PHOTO_MESSAGE}`);
    const heic = await POST(upload('raven', [file('IMG_0042.HEIC', HEIC)]));
    expect(heic.status).toBe(422);
    expect((await body<ApiError>(heic)).error).toBe(`"img-0042.heic": ${PHOTO_MESSAGE}`);
    expect(repo.commits).toHaveLength(0);
    expect(repo.prepared).toBe(0);
  });

  it('refuses a folder outside public/media and a project that is not saved yet', async () => {
    for (const folder of ['../', '..\\', '/etc', 'site/../x', '%2e%2e', 'ghost-project']) {
      const res = await POST(upload(folder, [file('a.png', PNG_1X1)]));
      expect(res.status, folder).toBe(400);
      const answer = await body<ApiError>(res);
      expect(answer.code).toBe('bad-request');
      expect(answer.findings?.[0]).toMatchObject({ path: '(path)', rule: 'PATH' });
    }
    expect((await body<ApiError>(await POST(upload('ghost-project', [file('a.png', PNG_1X1)])))).error).toMatch(/Save a new project/);
    expect(repo.prepared).toBe(0);
    expect(repo.commits).toHaveLength(0);
  });

  it('refuses a file name that carries a folder path, and never repeats it', async () => {
    for (const name of ['../../etc/passwd.png', '..\\..\\boot.png', 'site/../x.png', '/etc/hosts.png', '..']) {
      const res = await POST(upload('raven', [file('a.png', PNG_1X1), file(name, PNG_1X1)]));
      expect(res.status, name).toBe(400);
      const answer = await body<ApiError>(res);
      expect(answer.error).toMatch(/^file 2: A file name may not contain a folder path/);
      expect(answer.findings?.[0]).toMatchObject({ file: 'file 2', path: '(path)', rule: 'PATH' });
    }
    expect(repo.commits).toHaveLength(0);
  });

  it('refuses a name that trips a public rule, with the rule id and the field', async () => {
    const res = await POST(upload('raven', [file('Lorem Ipsum.png', PNG_1X1)]));
    expect(res.status).toBe(422);
    const answer = await body<ApiError>(res);
    expect(answer.code).toBe('content-check');
    expect(answer.findings).toContainEqual(expect.objectContaining({ file: 'lorem-ipsum.png', path: 'name', rule: 'PLACEHOLDER' }));
    expect(repo.commits).toHaveLength(0);
  });

  it('refuses a private term by its entry number, and never repeats it', async () => {
    const res = await POST(upload('raven', [file('a.png', PNG_1X1), file('zorblax-notes.txt', 'Plain notes.\n')]));
    expect(res.status).toBe(422);
    const raw = await res.text();
    expect(raw.toLowerCase()).not.toContain('zorblax');
    const answer = JSON.parse(raw) as ApiError;
    expect(answer.findings).toContainEqual(expect.objectContaining({ file: 'file 2', path: 'name', rule: 'BLOCKLIST' }));
  });

  it('checks the words inside a text file, by line', async () => {
    const res = await POST(upload('raven', [file('captions.vtt', `${VTT}\n00:01.000 --> 00:02.000\nlorem ipsum\n`)]));
    expect(res.status).toBe(422);
    expect((await body<ApiError>(res)).findings).toContainEqual(expect.objectContaining({ file: 'captions.vtt', path: 'line 7', rule: 'PLACEHOLDER' }));
  });

  it('fails closed without CONTENT_BLOCKLIST on Vercel', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('CONTENT_BLOCKLIST', '');
    const res = await POST(upload('raven', [file('a.png', PNG_1X1)]));
    expect(res.status).toBe(503);
    expect(await body(res)).toMatchObject({ code: 'not-configured', missing: ['CONTENT_BLOCKLIST'] });
    vi.stubEnv('CONTENT_BLOCKLIST', ' | ');
    expect((await POST(upload('raven', [file('a.png', PNG_1X1)]))).status).toBe(503);
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CI', 'true');
    expect((await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'raven', name: 'a.mp4', size: 5_000_000, contentType: 'video/mp4' }))).status).toBe(503);
    expect(repo.commits).toHaveLength(0);
    expect(blob.token).not.toHaveBeenCalled();
  });

  it('refuses a name already in the folder unless Replace is chosen, and a name that differs only in case', async () => {
    const taken = await POST(upload('raven', [file('cover.webp', WEBP_1X1)]));
    expect(taken.status).toBe(409);
    expect(await body(taken)).toMatchObject({ code: 'exists' });
    // A refusal leaves the branches alone: no draft is created or moved for it.
    expect(repo.prepared).toBe(0);
    expect(repo.draft).toBeNull();
    const replaced = await POST(upload('raven', [file('cover.webp', WEBP_1X1)], { replace: '1' }));
    expect(replaced.status).toBe(200);
    expect(repo.commits.at(-1)?.message).toBe('media: replace raven/cover.webp');

    repo = makeRepo({ 'public/media/raven/IMG-7414.png': PNG_1X1 });
    state.repo = repo;
    const other = await POST(upload('raven', [file('img-7414.png', PNG_1X1)], { replace: '1' }));
    expect(other.status).toBe(409);
    expect((await body<ApiError>(other)).error).toMatch(/only in letter case/);
    const twice = await POST(upload('raven', [file('a.png', PNG_1X1), file('A.png', PNG_1X1)]));
    expect(twice.status).toBe(409);
  });

  it('checks the names again when preparing the draft brought in files from the live branch', async () => {
    repo.setDraft('content/site.json', serializeContent(SITE));
    repo.mergeOnPrepare = { 'public/media/raven/detail.png': PNG_1X1 };
    const res = await POST(upload('raven', [file('detail.png', PNG_1X1)]));
    expect(res.status).toBe(409);
    expect(await body(res)).toMatchObject({ code: 'exists' });
    expect(repo.commits).toHaveLength(0);
  });

  it('refuses unexpected form fields, an empty upload, and a file over 4 MB', async () => {
    expect((await POST(upload('raven', [file('a.png', PNG_1X1)], { path: 'public/x' }))).status).toBe(400);
    expect((await POST(upload('raven', []))).status).toBe(400);
    const big = await POST(upload('raven', [file('big.png', new Uint8Array(4_000_001))]));
    expect(big.status).toBe(413);
  });
});

describe('DELETE /api/upload', () => {
  it('refuses a file the draft still uses, and lists the fields', async () => {
    const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: '/media/raven/arm.png' }));
    expect(res.status).toBe(409);
    const answer = await body<ApiError>(res);
    expect(answer.code).toBe('referenced');
    expect(answer.error).toMatch(/Remove it from these fields first/);
    expect(answer.references?.draft).toEqual([{ file: 'content/projects/raven.json', path: 'blocks[0].md' }]);
    expect(repo.commits).toHaveLength(0);
    expect(repo.prepared).toBe(0);
  });

  it('checks the references again when preparing the draft brought in content from the live branch', async () => {
    repo.setDraft('content/site.json', serializeContent(SITE));
    repo.mergeOnPrepare = { 'content/site.json': serializeContent({ ...SITE, about: { paragraphs: ['See /media/raven/old.png.'] } }) };
    const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: '/media/raven/old.png' }));
    expect(res.status).toBe(409);
    expect((await body<ApiError>(res)).references?.draft).toEqual([{ file: 'content/site.json', path: 'about.paragraphs[0]' }]);
    expect(repo.commits).toHaveLength(0);
  });

  it('removes an unused repository file in one commit', async () => {
    const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: '/media/raven/old.png' }));
    expect(res.status).toBe(200);
    expect(repo.commits).toHaveLength(1);
    expect(repo.commits[0]).toMatchObject({ message: 'media: remove raven/old.png', changes: [{ path: 'public/media/raven/old.png', bytes: null }] });
    expect(repo.draft?.has('public/media/raven/old.png')).toBe(false);
    expect((await DELETE(jsonRequest('/api/upload', 'DELETE', { src: '/media/raven/old.png' }))).status).toBe(404);
  });

  it('refuses a Blob file the published site still uses, even when the draft no longer does', async () => {
    repo.setDraft('content/projects/raven.json', serializeContent({ ...RAVEN, blocks: [] }));
    const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: CLIP }));
    expect(res.status).toBe(409);
    const answer = await body<ApiError>(res);
    expect(answer.references).toEqual({ draft: [], live: [{ file: 'content/projects/raven.json', path: 'blocks[1].media.src' }] });
    expect(answer.error).toMatch(/published site/);
    expect(blob.del).not.toHaveBeenCalled();
  });

  it('deletes an unused Blob file with the store token', async () => {
    // Uploaded two hours ago: the token that allowed it has expired, so the pathname may be freed.
    blob.head.mockResolvedValue({ url: SPARE, pathname: 'media/raven/spare-ba9876543210.mp4', size: 6_000_000, contentType: 'video/mp4', uploadedAt: new Date(Date.now() - 2 * HOUR) });
    const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: SPARE }));
    expect(res.status).toBe(200);
    expect(blob.del).toHaveBeenCalledWith(SPARE, { token: BLOB_TOKEN });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('refuses an address outside the media folders or this Blob store', async () => {
    for (const src of [
      '/media/../package.json',
      '/media/raven/../../package.json',
      '/etc/passwd',
      '/media/%2e%2e/x.png',
      'https://evil.example/media/raven/a.png',
      'https://otherstore.public.blob.vercel-storage.com/media/raven/a.mp4',
      `https://${HOST}/elsewhere/raven/a.mp4`,
      `https://${HOST}/media/raven/a.mp4?x=1`,
    ]) {
      const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src }));
      expect(res.status, src).toBe(400);
    }
    expect(blob.del).not.toHaveBeenCalled();
    expect(repo.commits).toHaveLength(0);
  });
});

describe('uploads to Vercel Blob', () => {
  it('issues a single-use token for one pathname, type, and size', async () => {
    const before = Date.now();
    const answer = await issueToken('Flight Clip.mp4', 50_000_000, 'video/mp4');
    expect(answer.pathname).toMatch(/^media\/raven\/flight-clip-[0-9a-f]{12}\.mp4$/);
    expect(answer.multipart).toBe(false);
    expect(answer.clientToken).toBe('vercel_blob_client_teststore42_synthetic');
    const options = blob.token.mock.calls[0][0];
    expect(options).toMatchObject({
      token: BLOB_TOKEN,
      pathname: answer.pathname,
      allowedContentTypes: ['video/mp4'],
      maximumSizeInBytes: 50_000_000,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    expect(options.validUntil).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
    expect(options.validUntil).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);
    expect((await issueToken('long.mp4', 150_000_000, 'video/mp4')).multipart).toBe(true);
  });

  it('refuses a token for SVG, for 4 MB or less, for a photo, for a mismatched type, and without Blob', async () => {
    const svg = await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'raven', name: 'big.svg', size: 5_000_000, contentType: 'image/svg+xml' }));
    expect(svg.status).toBe(422);
    const small = await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'raven', name: 'a.mp4', size: 4_000_000, contentType: 'video/mp4' }));
    expect(small.status).toBe(400);
    const photo = await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'raven', name: 'a.jpg', size: 5_000_000, contentType: 'image/jpeg' }));
    expect((await body<ApiError>(photo)).error).toBe(PHOTO_MESSAGE);
    const heic = await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'raven', name: 'a.heic', size: 5_000_000, contentType: 'image/heic' }));
    expect((await body<ApiError>(heic)).error).toBe(PHOTO_MESSAGE);
    const step = await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'raven', name: 'arm.step', size: 5_000_000, contentType: 'model/step' }));
    expect(step.status).toBe(422);
    expect((await body<ApiError>(step)).error).toMatch(/GLB/);
    const type = await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'raven', name: 'a.mp4', size: 5_000_000, contentType: 'text/html' }));
    expect(type.status).toBe(422);
    const path = await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'raven', name: '../site/a.mp4', size: 5_000_000, contentType: 'video/mp4' }));
    expect(path.status).toBe(400);
    const folder = await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'site/../x', name: 'a.mp4', size: 5_000_000, contentType: 'video/mp4' }));
    expect(folder.status).toBe(400);
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    const off = await TOKEN(jsonRequest('/api/upload/token', 'POST', { folder: 'raven', name: 'a.mp4', size: 5_000_000, contentType: 'video/mp4' }));
    expect(off.status).toBe(503);
    const notSet = await body<ApiError>(off);
    expect(notSet).toMatchObject({ code: 'not-configured', missing: ['BLOB_READ_WRITE_TOKEN'] });
    expect(notSet.error).toMatch(/Vercel Blob/);
    expect(blob.token).not.toHaveBeenCalled();
  });

  it('confirms an upload whose bytes are its type', async () => {
    const { pathname, ticket } = await issueToken('flight.mp4', 50_000_000, 'video/mp4');
    const url = `https://${HOST}/${pathname}`;
    blob.head.mockResolvedValue({ url, pathname, size: 50_000_000, contentType: 'video/mp4', uploadedAt: new Date('2026-11-18T10:00:00Z') });
    const fetchMock = serveBlob(MP4);
    const res = await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }));
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({
      ok: true,
      file: { store: 'blob', folder: 'raven', src: url, previewSrc: url, downloadHref: `${url}?download=1`, size: 50_000_000, uploadedAt: '2026-11-18T10:00:00.000Z' },
    });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('range')).toBe('bytes=0-65535');
    expect(blob.head).toHaveBeenCalledWith(url, { token: BLOB_TOKEN });
    expect(blob.del).not.toHaveBeenCalled();
  });

  it('refuses a forged, an expired, or a mismatched ticket without touching the store', async () => {
    const { pathname, ticket } = await issueToken('flight.mp4', 50_000_000, 'video/mp4');
    const url = `https://${HOST}/${pathname}`;
    // A character in the middle of the signature: the last one also carries padding bits.
    const at = ticket.length - 10;
    const forged = `${ticket.slice(0, at)}${ticket[at] === 'A' ? 'B' : 'A'}${ticket.slice(at + 1)}`;
    const expired = signTicket({ pathname, size: 50_000_000, contentType: 'video/mp4', exp: Date.now() - 1000 });
    const other = signTicket({ pathname: 'media/raven/other-0123456789ab.mp4', size: 50_000_000, contentType: 'video/mp4', exp: Date.now() + 60_000 });
    const cases: [Record<string, string>, RegExp][] = [
      [{ pathname, url, ticket: forged }, /not valid/],
      [{ pathname, url, ticket: 'not.a-ticket' }, /not valid/],
      [{ pathname, url, ticket: expired }, /expired/],
      [{ pathname, url, ticket: other }, /another file/],
      [{ pathname: 'media/raven/other-0123456789ab.mp4', url, ticket }, /another file/],
      [{ pathname, url: `https://otherstore.public.blob.vercel-storage.com/${pathname}`, ticket }, /not a media file/],
    ];
    for (const [request, message] of cases) {
      const res = await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', request));
      expect(res.status).toBe(400);
      expect((await body<ApiError>(res)).error).toMatch(message);
    }
    expect(blob.head).not.toHaveBeenCalled();
    expect(blob.del).not.toHaveBeenCalled();
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('replaces an upload whose bytes are not its type with a placeholder', async () => {
    const { pathname, ticket } = await issueToken('flight.mp4', 50_000_000, 'video/mp4');
    const url = `https://${HOST}/${pathname}`;
    blob.head.mockResolvedValue({ url, pathname, size: 50_000_000, contentType: 'video/mp4', uploadedAt: new Date() });
    serveBlob(PNG_1X1);
    const res = await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }));
    expect(res.status).toBe(422);
    expectPlaceholderAt(pathname);
  });

  it('replaces an image upload that still carries metadata with a placeholder', async () => {
    const { pathname, ticket } = await issueToken('poster.webp', 5_000_000, 'image/webp');
    const url = `https://${HOST}/${pathname}`;
    blob.head.mockResolvedValue({ url, pathname, size: 5_000_000, contentType: 'image/webp', uploadedAt: new Date() });
    serveBlob(webpWithMetadata());
    const res = await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }));
    expect(res.status).toBe(422);
    expect((await body<ApiError>(res)).error).toMatch(/metadata \(EXIF/);
    expectPlaceholderAt(pathname);
  });

  it('replaces an upload larger than its ticket allowed or of another type, and reports a missing upload', async () => {
    const { pathname, ticket } = await issueToken('flight.mp4', 50_000_000, 'video/mp4');
    const url = `https://${HOST}/${pathname}`;
    blob.head.mockResolvedValueOnce({ url, pathname, size: 50_000_001, contentType: 'video/mp4', uploadedAt: new Date() });
    expect((await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }))).status).toBe(422);
    expect(blob.put).toHaveBeenCalledTimes(1);
    blob.head.mockResolvedValueOnce({ url, pathname, size: 50_000_000, contentType: 'text/html', uploadedAt: new Date() });
    expect((await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }))).status).toBe(422);
    expect(blob.put).toHaveBeenCalledTimes(2);
    expectPlaceholderAt(pathname);
    blob.head.mockRejectedValueOnce(new BlobNotFoundError());
    expect((await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }))).status).toBe(400);
    expect(blob.put).toHaveBeenCalledTimes(2);
    expect(blob.del).not.toHaveBeenCalled();
  });
});

describe('POST /api/upload/rename', () => {
  it('renames a repository file and rewrites the draft references in the same commit', async () => {
    const res = await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: '/media/raven/arm.png', name: 'Arm Mount' }));
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({
      ok: true,
      file: { store: 'repo', name: 'arm-mount.png', src: '/media/raven/arm-mount.png' },
      rewrote: ['content/projects/raven.json'],
    });
    expect(repo.commits).toHaveLength(1);
    const [commit] = repo.commits;
    expect(commit.message).toBe('media: rename raven/arm.png to raven/arm-mount.png');
    expect(commit.changes.map((c) => [c.path, c.bytes === null])).toEqual([
      ['public/media/raven/arm-mount.png', false],
      ['public/media/raven/arm.png', true],
      ['content/projects/raven.json', false],
    ]);
    const saved = dec(repo.draft!.get('content/projects/raven.json')!);
    const expected = structuredClone(RAVEN);
    expected.blocks[0].md = 'The arm ![arm](/media/raven/arm-mount.png). Not /media/raven/arm.png2.';
    expect(saved).toBe(serializeContent(expected));
    expect(Buffer.from(repo.draft!.get('public/media/raven/arm-mount.png')!).equals(Buffer.from(PNG_1X1))).toBe(true);
  });

  it('keeps the extension, cleans the name, and refuses a name already in the folder', async () => {
    expect((await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: '/media/raven/old.png', name: 'old.webp' }))).status).toBe(400);
    expect((await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: '/media/raven/old.png', name: 'arm' }))).status).toBe(409);
    expect((await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: '/media/raven/old.png', name: 'Lorem Ipsum' }))).status).toBe(422);
    expect((await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: '/media/raven/old.png', name: '../site/old.png' }))).status).toBe(400);
    expect(repo.commits).toHaveLength(0);
    const moved = await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: '/media/raven/old.png', name: 'Spare Part.png' }));
    expect(moved.status).toBe(200);
    expect(await body(moved)).toMatchObject({ file: { name: 'spare-part.png' }, rewrote: [] });
  });

  it('treats an address with a query or a fragment as a reference, and keeps that part in a rename', async () => {
    repo.setDraft('content/site.json', serializeContent({ ...SITE, links: [{ label: 'Drawing', href: '/media/raven/old.png#detail' }] }));
    const listed = await body<MediaListResponse>(await GET(getRequest('/api/upload?folder=raven&refs=1')));
    expect(listed.files.find((f) => f.name === 'old.png')?.refs).toEqual({ draft: 1, live: 0 });
    const refused = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: '/media/raven/old.png' }));
    expect(refused.status).toBe(409);
    expect((await body<ApiError>(refused)).references?.draft).toEqual([{ file: 'content/site.json', path: 'links[0].href' }]);
    const renamed = await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: '/media/raven/old.png', name: 'spare' }));
    expect(renamed.status).toBe(200);
    expect(JSON.parse(dec(repo.draft!.get('content/site.json')!)).links[0].href).toBe('/media/raven/spare.png#detail');
  });

  it('removes the old name first when only the letter case changes, so a case-insensitive disk keeps the file', async () => {
    repo = makeRepo({ 'public/media/raven/IMG-7414.png': PNG_1X1 });
    state.repo = repo;
    const res = await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: '/media/raven/IMG-7414.png', name: 'img-7414' }));
    expect(res.status).toBe(200);
    expect(repo.commits[0].changes.map((c) => [c.path, c.bytes === null])).toEqual([
      ['public/media/raven/IMG-7414.png', true],
      ['public/media/raven/img-7414.png', false],
    ]);
  });

  it('copies a Blob file under the new name, rewrites the draft, and keeps the old object', async () => {
    const copied = `https://${HOST}/media/raven/flight-test-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op.mp4`;
    blob.head.mockResolvedValue({ url: CLIP, pathname: 'media/raven/clip-0123456789ab.mp4', size: 5_000_000, contentType: 'video/mp4', uploadedAt: new Date() });
    blob.copy.mockResolvedValue({ url: copied, pathname: 'media/raven/flight-test-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op.mp4', contentType: 'video/mp4' });
    const res = await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: CLIP, name: 'Flight Test.mp4' }));
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ file: { store: 'blob', src: copied }, rewrote: ['content/projects/raven.json'] });
    expect(blob.copy).toHaveBeenCalledWith(CLIP, 'media/raven/flight-test.mp4', expect.objectContaining({ access: 'public', addRandomSuffix: true, allowOverwrite: false, token: BLOB_TOKEN }));
    expect(blob.del).not.toHaveBeenCalled();
    expect(dec(repo.draft!.get('content/projects/raven.json')!)).toContain(copied);
  });
});

describe('GET /api/upload/file and /api/upload/references', () => {
  it('streams a draft file with headers that let it run nothing', async () => {
    repo.setDraft('public/media/raven/fresh.webp', '');
    repo.draft!.set('public/media/raven/fresh.webp', WEBP_1X1);
    const res = await FILE(getRequest('/api/upload/file?src=%2Fmedia%2Fraven%2Ffresh.webp'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="fresh.webp"');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(WEBP_1X1))).toBe(true);
  });

  it('answers one byte range, as Safari needs to play video and audio', async () => {
    const size = WEBP_1X1.byteLength;
    const ranged = (range: string) =>
      FILE(new NextRequest(`${ORIGIN}/api/upload/file?src=%2Fmedia%2Fraven%2Fcover.webp`, { headers: { cookie: cookie(), range } }));
    const part = await ranged('bytes=2-5');
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 2-5/${size}`);
    expect(part.headers.get('accept-ranges')).toBe('bytes');
    expect(part.headers.get('content-security-policy')).toContain('sandbox');
    expect(Buffer.from(await part.arrayBuffer()).equals(Buffer.from(WEBP_1X1.subarray(2, 6)))).toBe(true);
    const tail = await ranged('bytes=-4');
    expect(tail.headers.get('content-range')).toBe(`bytes ${size - 4}-${size - 1}/${size}`);
    const past = await ranged(`bytes=${size}-`);
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe(`bytes */${size}`);
    // Several ranges or a malformed one: the whole file, as a server may answer.
    expect((await ranged('bytes=0-1,4-5')).status).toBe(200);
    expect((await ranged('bytes=5-2')).status).toBe(200);
  });

  it('serves a file by the type of its bytes, not its name', async () => {
    repo = makeRepo({ 'public/media/raven/img-7414.webp': PNG_1X1 });
    state.repo = repo;
    const res = await FILE(getRequest('/api/upload/file?src=%2Fmedia%2Fraven%2Fimg-7414.webp'));
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('answers 404 for a missing file and 400 for a path outside the media folders', async () => {
    expect((await FILE(getRequest(`/api/upload/file?src=${encodeURIComponent('/media/raven/missing.png')}`))).status).toBe(404);
    for (const src of ['/media/../package.json', '/etc/passwd', '/media/raven/..%2fx.png', '/media/raven/a/b.png', 'media/raven/a.png', '']) {
      const res = await FILE(getRequest(`/api/upload/file?src=${encodeURIComponent(src)}`));
      expect(res.status, src).toBe(400);
    }
  });

  it('lists the draft and published fields that use a file', async () => {
    const res = await REFERENCES(getRequest(`/api/upload/references?src=${encodeURIComponent('/media/raven/cover.webp')}`));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({
      ok: true,
      src: '/media/raven/cover.webp',
      draft: [{ file: 'content/projects/raven.json', path: 'cover.src' }],
      live: [{ file: 'content/projects/raven.json', path: 'cover.src' }],
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Review findings (Phase 6): each test states the behavior the fix guarantees
// ---------------------------------------------------------------------------------------------

/** RAVEN with more blocks after its own two. */
function ravenWith(...blocks: unknown[]): string {
  return serializeContent({ ...RAVEN, blocks: [...RAVEN.blocks, ...blocks] });
}

describe('references the site renders (MEDIA-1)', () => {
  const BULLETS = { id: 'b3', type: 'bullets', items: ['Read the [drawing](/media/raven/old.png).', 'Nothing here'] };
  const NESTED = { id: 'b4', type: 'twoCol', left: [{ id: 'b5', type: 'bullets', items: ['See (/media/raven/old.png)'] }], right: [] };
  const OWN_HOST = [
    { id: 'b6', type: 'file', label: 'Drawing', src: 'https://www.amjadrehawi.com/media/raven/old.png' },
    { id: 'b7', type: 'linkRow', links: [{ label: 'Drawing', url: 'https://amjadrehawi.com/media/raven/old.png#detail' }] },
  ];

  it('refuses to delete a repository file that a bullets item links, and names the field', async () => {
    repo.setDraft('content/projects/raven.json', ravenWith(BULLETS, NESTED));
    const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: '/media/raven/old.png' }));
    expect(res.status).toBe(409);
    const answer = await body<ApiError>(res);
    expect(answer.code).toBe('referenced');
    expect(answer.references?.draft).toEqual([
      { file: 'content/projects/raven.json', path: 'blocks[2].items[0]' },
      { file: 'content/projects/raven.json', path: 'blocks[3].left[0].items[0]' },
    ]);
    expect(repo.commits).toHaveLength(0);
    expect(repo.draft?.has('public/media/raven/old.png')).toBe(true);
  });

  it('refuses to delete a repository file named by an absolute address on the site host, www included', async () => {
    repo.setDraft('content/projects/raven.json', ravenWith(...OWN_HOST));
    const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: '/media/raven/old.png' }));
    expect(res.status).toBe(409);
    expect((await body<ApiError>(res)).references?.draft).toEqual([
      { file: 'content/projects/raven.json', path: 'blocks[2].src' },
      { file: 'content/projects/raven.json', path: 'blocks[3].links[0].url' },
    ]);
    expect(repo.commits).toHaveLength(0);
  });

  it('counts those fields in the library, so the file is never offered as unused', async () => {
    repo.setDraft('content/projects/raven.json', ravenWith(BULLETS, NESTED, ...OWN_HOST));
    const list = await body<MediaListResponse>(await GET(getRequest('/api/upload?folder=raven&refs=1')));
    expect(list.files.find((f) => f.name === 'old.png')?.refs).toEqual({ draft: 4, live: 0 });
    const refs = await body(await REFERENCES(getRequest(`/api/upload/references?src=${encodeURIComponent('/media/raven/old.png')}`)));
    expect(refs).toMatchObject({ draft: expect.arrayContaining([{ file: 'content/projects/raven.json', path: 'blocks[2].items[0]' }]), live: [] });
  });

  it('rewrites a bullets link and own-host addresses in the rename commit, keeping each host and fragment', async () => {
    repo.setDraft('content/projects/raven.json', ravenWith(BULLETS, NESTED, ...OWN_HOST));
    const res = await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: '/media/raven/old.png', name: 'spare' }));
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ file: { src: '/media/raven/spare.png' }, rewrote: ['content/projects/raven.json'] });
    const saved = dec(repo.draft!.get('content/projects/raven.json')!);
    expect(saved).not.toMatch(/\/media\/raven\/old\.png(?![\w.-])/);
    const blocks = JSON.parse(saved).blocks;
    expect(blocks[2].items).toEqual(['Read the [drawing](/media/raven/spare.png).', 'Nothing here']);
    expect(blocks[3].left[0].items).toEqual(['See (/media/raven/spare.png)']);
    expect(blocks[4].src).toBe('https://www.amjadrehawi.com/media/raven/spare.png');
    expect(blocks[5].links[0].url).toBe('https://amjadrehawi.com/media/raven/spare.png#detail');
    // The same commit moves the file and rewrites the content.
    expect(repo.commits).toHaveLength(1);
    expect(repo.commits[0].changes.map((c) => c.path)).toEqual([
      'public/media/raven/spare.png',
      'public/media/raven/old.png',
      'content/projects/raven.json',
    ]);
  });

  it('refuses to delete a Blob file that a published bullets item links, though the draft dropped it', async () => {
    repo = makeRepo({ 'content/projects/raven.json': ravenWith({ id: 'b3', type: 'bullets', items: [`Watch the [demo](${SPARE}).`] }) });
    state.repo = repo;
    repo.setDraft('content/projects/raven.json', serializeContent(RAVEN));
    blob.head.mockResolvedValue({ url: SPARE, pathname: 'media/raven/spare-ba9876543210.mp4', size: 6_000_000, contentType: 'video/mp4', uploadedAt: new Date(Date.now() - 2 * HOUR) });
    const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: SPARE }));
    expect(res.status).toBe(409);
    const answer = await body<ApiError>(res);
    expect(answer.references).toEqual({ draft: [], live: [{ file: 'content/projects/raven.json', path: 'blocks[2].items[0]' }] });
    expect(answer.error).toMatch(/published site/);
    expect(blob.del).not.toHaveBeenCalled();
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('rewrites a bullets link to a Blob file when the file is renamed', async () => {
    repo.setDraft('content/projects/raven.json', ravenWith({ id: 'b3', type: 'bullets', items: [`Watch the [demo](${SPARE}).`] }));
    const copied = `https://${HOST}/media/raven/demo-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op.mp4`;
    blob.head.mockResolvedValue({ url: SPARE, pathname: 'media/raven/spare-ba9876543210.mp4', size: 6_000_000, contentType: 'video/mp4', uploadedAt: new Date() });
    blob.copy.mockResolvedValue({ url: copied, pathname: 'media/raven/demo-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op.mp4', contentType: 'video/mp4' });
    const res = await RENAME(jsonRequest('/api/upload/rename', 'POST', { src: SPARE, name: 'demo' }));
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ rewrote: ['content/projects/raven.json'] });
    expect(JSON.parse(dec(repo.draft!.get('content/projects/raven.json')!)).blocks[2].items[0]).toBe(`Watch the [demo](${copied}).`);
  });
});

describe('a Blob token stores one file, once (MEDIA-2)', () => {
  const MOV = cat(u32(20, false), enc('ftypqt  '), u32(0x200, false), enc('qt  '), u32(16, false), enc('free'), new Uint8Array(8));

  it('keeps the refused pathname occupied, so replaying the ticket never confirms a second upload', async () => {
    const { pathname, ticket } = await issueToken('clip.mp4', 5_000_000, 'video/mp4');
    const url = `https://${HOST}/${pathname}`;
    // The first upload is QuickTime under .mp4: refused, and its pathname held by a placeholder.
    blob.head.mockResolvedValueOnce({ url, pathname, size: 5_000_000, contentType: 'video/mp4', uploadedAt: new Date() });
    serveBlob(MOV);
    const first = await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }));
    expect(first.status).toBe(422);
    expectPlaceholderAt(pathname);
    // Blob now holds the placeholder at that pathname: the same ticket is refused, every time.
    const placeholder = enc(blob.put.mock.calls[0][1] as string);
    blob.head.mockResolvedValue({ url, pathname, size: placeholder.byteLength, contentType: 'text/plain; charset=utf-8', uploadedAt: new Date() });
    serveBlob(placeholder);
    for (let i = 0; i < 2; i += 1) {
      const again = await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }));
      expect(again.status).toBe(422);
      expect((await body<ApiError>(again)).error).toMatch(/go to the repository/);
    }
    expect(blob.del).not.toHaveBeenCalled();
  });

  it('refuses an upload of 4 MB or less, which belongs in the repository, and holds its pathname', async () => {
    const { pathname, ticket } = await issueToken('flight.mp4', 50_000_000, 'video/mp4');
    const url = `https://${HOST}/${pathname}`;
    blob.head.mockResolvedValue({ url, pathname, size: MP4.byteLength, contentType: 'video/mp4', uploadedAt: new Date() });
    serveBlob(MP4);
    const res = await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }));
    expect(res.status).toBe(422);
    expect((await body<ApiError>(res)).error).toMatch(/go to the repository/);
    expectPlaceholderAt(pathname);
  });

  it('holds the pathname of a Blob file deleted while its token may still be valid', async () => {
    blob.head.mockResolvedValue({ url: SPARE, pathname: 'media/raven/spare-ba9876543210.mp4', size: 6_000_000, contentType: 'video/mp4', uploadedAt: new Date(Date.now() - 5 * MINUTE) });
    const res = await DELETE(jsonRequest('/api/upload', 'DELETE', { src: SPARE }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ ok: true, commit: null });
    expectPlaceholderAt('media/raven/spare-ba9876543210.mp4');
  });

  it('deletes the object when the placeholder cannot be written, so refused bytes never stay public', async () => {
    const { pathname, ticket } = await issueToken('flight.mp4', 50_000_000, 'video/mp4');
    const url = `https://${HOST}/${pathname}`;
    blob.put.mockRejectedValue(new Error('Blob is down'));
    blob.head.mockResolvedValue({ url, pathname, size: 50_000_000, contentType: 'video/mp4', uploadedAt: new Date() });
    serveBlob(PNG_1X1);
    expect((await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }))).status).toBe(422);
    expect(blob.del).toHaveBeenCalledWith(url, { token: BLOB_TOKEN });
  });

  it('hides placeholders from the library and removes those whose token has surely expired', async () => {
    const young = `https://${HOST}/media/raven/young-0123456789ab.mp4`;
    const old = `https://${HOST}/media/raven/old-ba9876543210.mp4`;
    blob.list.mockResolvedValue({
      blobs: [
        { url: SPARE, downloadUrl: `${SPARE}?download=1`, pathname: 'media/raven/spare-ba9876543210.mp4', size: 6_000_000, uploadedAt: new Date(Date.now() - 3 * HOUR), etag: 'a' },
        { url: young, downloadUrl: `${young}?download=1`, pathname: 'media/raven/young-0123456789ab.mp4', size: 23, uploadedAt: new Date(Date.now() - 10 * MINUTE), etag: 'b' },
        { url: old, downloadUrl: `${old}?download=1`, pathname: 'media/raven/old-ba9876543210.mp4', size: 23, uploadedAt: new Date(Date.now() - 3 * HOUR), etag: 'c' },
      ],
      hasMore: false,
    });
    const list = await body<MediaListResponse>(await GET(getRequest('/api/upload?folder=raven&refs=1')));
    expect(list.files.filter((f) => f.store === 'blob').map((f) => f.src)).toEqual([SPARE]);
    expect(blob.del).toHaveBeenCalledTimes(1);
    expect(blob.del).toHaveBeenCalledWith([old], { token: BLOB_TOKEN });
  });

  it('still issues tokens that never allow an overwrite', async () => {
    await issueToken('clip.mp4', 5_000_000, 'video/mp4');
    expect(blob.token.mock.calls[0][0]).toMatchObject({ allowOverwrite: false, addRandomSuffix: false });
  });
});

/** A GLB whose header names `total` bytes (the size Blob reports), with this scene description and no binary chunk. */
function glb(description: unknown, total: number): Uint8Array {
  const text = JSON.stringify(description);
  const json = enc(text + ' '.repeat((4 - (enc(text).byteLength % 4)) % 4));
  return cat(enc('glTF'), u32(2, true), u32(total, true), u32(json.byteLength, true), enc('JSON'), json);
}

describe('the names of a Blob GLB go through the content check (CONVERT-4)', () => {
  const SIZE = 5_000_000;

  async function confirmGlb(model: Uint8Array) {
    const { pathname, ticket } = await issueToken('assembly.glb', SIZE, 'model/gltf-binary');
    const url = `https://${HOST}/${pathname}`;
    blob.head.mockResolvedValue({ url, pathname, size: SIZE, contentType: 'model/gltf-binary', uploadedAt: new Date() });
    const fetchMock = serveBlob(model);
    const res = await CONFIRM(jsonRequest('/api/upload/confirm', 'POST', { pathname, url, ticket }));
    return { res, pathname, fetchMock };
  }

  const nodes = (count: number, name: (i: number) => string) => Array.from({ length: count }, (_, i) => ({ name: name(i), mesh: 0 }));

  it('confirms a model whose names are clean', async () => {
    const { res } = await confirmGlb(glb({ asset: { version: '2.0' }, nodes: nodes(3, (i) => `Part ${i}`), meshes: [{ name: 'Body' }] }, SIZE));
    expect(res.status).toBe(200);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('refuses a model with a blocked name in a node past the 500th, a material, an animation, or a scene', async () => {
    const model = glb(
      {
        asset: { version: '2.0' },
        scenes: [{ name: 'Lorem Ipsum scene' }],
        nodes: nodes(600, (i) => (i === 550 ? 'Bracket by Zorblax' : `Part ${i}`)),
        meshes: [{ name: 'Body' }],
        materials: [{ name: 'lorem ipsum finish' }],
        animations: [{ name: 'Lorem ipsum turn', channels: [], samplers: [] }],
        textures: [{ name: 'Plain texture' }],
      },
      SIZE,
    );
    const { res, pathname } = await confirmGlb(model);
    expect(res.status).toBe(422);
    const raw = await res.text();
    expect(raw.toLowerCase()).not.toContain('zorblax');
    const answer = JSON.parse(raw) as ApiError;
    expect(answer.code).toBe('content-check');
    expect(answer.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'assembly.glb', path: 'nodes[550].name', rule: 'BLOCKLIST' }),
        expect.objectContaining({ file: 'assembly.glb', path: 'materials[0].name', rule: 'PLACEHOLDER' }),
        expect.objectContaining({ file: 'assembly.glb', path: 'animations[0].name', rule: 'PLACEHOLDER' }),
        expect.objectContaining({ file: 'assembly.glb', path: 'scenes[0].name', rule: 'PLACEHOLDER' }),
      ]),
    );
    expectPlaceholderAt(pathname);
  });

  it('reads a scene description larger than the first 64 KB with a second range request', async () => {
    const model = glb({ asset: { version: '2.0' }, nodes: nodes(900, (i) => (i === 899 ? 'lorem ipsum' : `Part ${i} ${'x'.repeat(80)}`)) }, SIZE);
    expect(model.byteLength).toBeGreaterThan(64 * 1024);
    const { res, fetchMock } = await confirmGlb(model);
    expect(res.status).toBe(422);
    expect((await body<ApiError>(res)).findings).toContainEqual(expect.objectContaining({ path: 'nodes[899].name', rule: 'PLACEHOLDER' }));
    const ranges = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('range'));
    expect(ranges).toEqual(['bytes=0-65535', `bytes=20-${model.byteLength - 1}`]);
  });

  it('refuses a model whose first chunk is not a readable scene description', async () => {
    const broken = glb({ asset: { version: '2.0' } }, SIZE);
    broken.set(enc('BIN\u0000'), 16);
    const { res, pathname } = await confirmGlb(broken);
    expect(res.status).toBe(422);
    expect((await body<ApiError>(res)).error).toMatch(/scene description cannot be read/);
    expectPlaceholderAt(pathname);
  });
});
