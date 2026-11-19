// @vitest-environment jsdom
/**
 * A browser upload to Vercel Blob that does not finish (components/admin/media/manager.ts,
 * BlobWatch and settleBlob; components/admin/media/logic.ts, blobRefusal; the paced body in
 * components/admin/media/services.tsx). On the preview a 5.3 MB file went to a Blob store created
 * as private: every PUT answered 503, @vercel/blob 2.9.0 kept retrying for over ten minutes, the
 * queue showed "Uploading to Vercel Blob 99%" the whole time, and Cancel left the item uploading.
 * The real queue runs here with stand-in routes and a stand-in `put` that hangs, rejects, resolves,
 * plays a script, or retries the way the library does:
 *
 * - a normal upload is unaffected, and leaves no timer behind;
 * - Cancel ends the item at once while `put` hangs or waits to retry, and nothing continues;
 * - a store that refuses every try of the whole file fails the item within seconds, naming the
 *   likely cause without claiming it; a connection that drops midway, and a blip across the parts
 *   of a large file, are left to the library, which stores the file;
 * - an upload that does not start, or stops moving, is stopped with a message that says which;
 * - once every byte is sent the queue waits for the answer (a large file's parts are put
 *   together then), and when it stops waiting, or Vercel Blob says the pathname is taken, it asks
 *   the server, which checks a file it finds there: no file is left unchecked, none stored twice;
 * - a refusal the library reports keeps its reason, and gets the private store cause only when a
 *   store's access can give it;
 * - the real services hand the abort signal to `put` from @vercel/blob/client, and pace the body;
 * - on the page, pressing Cancel shows the item as cancelled at once.
 */
import {
  BlobAccessError,
  BlobClientTokenExpiredError,
  BlobContentTypeNotAllowedError,
  BlobError,
  BlobFileTooLargeError,
  BlobNotFoundError,
  BlobPathnameMismatchError,
  BlobPreconditionFailedError,
  BlobRequestAbortedError,
  BlobServiceNotAvailable,
  BlobServiceRateLimited,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
  BlobUnknownError,
} from '@vercel/blob';
import { createElement as h, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiResult, BlobConfirmBody, BlobConfirmResponse, BlobTokenBody } from '../lib/admin/contract';
import type { PreparedUpload } from '../lib/admin/convert/types';
import type { CallOptions } from '../components/admin/state/api';
import { ACCEPT_ANY, blobRefusal, isBlobAlreadyStored, isBlobRefusal } from '../components/admin/media/logic';
import {
  BLOB_ANSWER_MS,
  BLOB_NO_ANSWER,
  BLOB_NOT_STARTED,
  BLOB_QUIET_MS,
  BLOB_RETRIES_ALLOWED,
  BLOB_STALLED,
  BLOB_START_MS,
  blobNotAccepted,
  UploadManager,
  type BlobPutOptions,
  type MediaApi,
  type MediaServices,
  type QueueItem,
} from '../components/admin/media/manager';
import { UploadQueue } from '../components/admin/media/Queue';
import { MediaProvider, realMediaServices, useMediaManager, useQueueItems } from '../components/admin/media/services';

const blobClient = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ put: blobClient.put }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

afterEach(() => {
  vi.useRealTimers();
  blobClient.put.mockReset();
});

/** The size of the file on the preview. */
const SIZE = 5_300_000;
const TARGET = 'library:raven';
/** The store's host, as /api/status gives it. */
const HOST = 'store.public.blob.vercel-storage.com';
const BLOB_URL = `https://${HOST}/media/raven/data-0a1b2c.csv`;
/** An en dash or an em dash, built from char codes so this file holds neither. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const PRIVATE_STORE =
  'Vercel Blob refused the file. This site stores Blob files as public, and a store created as private refuses them. Check the Blob store connected to this environment.';
const EXISTS = 'This blob already exists, use `allowOverwrite: true` if you want to overwrite it.';
/** What /api/upload/confirm answers when nothing is stored at the pathname. */
const NOT_UPLOADED = { ok: false as const, code: 'bad-request' as const, error: 'The uploaded file is not in Vercel Blob. Upload it again.' };

// ---------------------------------------------------------------------------------------------
// Stand-ins
// ---------------------------------------------------------------------------------------------

function csv(name = 'data.csv'): File {
  return new File(['a,b\n1,2\n'], name, { type: 'text/csv' });
}

/** What the converter makes of a CSV: the file as it is, 5.3 MB, so it goes to Vercel Blob. */
function prepared(file: File): PreparedUpload {
  return {
    kind: 'file',
    mediaKind: null,
    original: { name: file.name, size: file.size, type: file.type },
    parts: [{ role: 'main', name: file.name, blob: { size: SIZE } as unknown as Blob, contentType: 'text/csv' }],
    meta: {},
    warnings: [],
  };
}

interface StandIns {
  /** The token's multipart flag (a file over 100 MB). */
  multipart?: boolean;
  /** The confirm route's answer; by default the file is stored and passes. */
  confirm?: (body: BlobConfirmBody, options?: CallOptions) => Promise<ApiResult<BlobConfirmResponse>>;
}

function storedFile(body: BlobConfirmBody): BlobConfirmResponse {
  return { ok: true, file: { store: 'blob', folder: 'raven', name: 'data.csv', src: body.url, previewSrc: body.url, downloadHref: body.url } };
}

/** Stand-in routes around a stand-in `put`. */
function servicesFor(put: MediaServices['putBlob'], standIns: StandIns = {}) {
  const tokens: BlobTokenBody[] = [];
  const confirms: BlobConfirmBody[] = [];
  const unused = async () => ({ ok: false as const, code: 'server' as const, error: 'Not used here.' });
  const api: MediaApi = {
    status: async () =>
      ({
        ok: true,
        storage: { repo: { target: 'github', problem: null }, blob: { configured: true, host: HOST }, limits: { repoMaxBytes: 4_000_000, blobMaxBytes: 500_000_000 } },
      }) as never,
    check: async () => ({ ok: true, findings: [] }),
    uploadRepo: unused,
    blobToken: async (body) => {
      tokens.push(body);
      return { ok: true, pathname: `media/raven/data-${tokens.length}.csv`, clientToken: 'vercel_blob_client_synthetic', ticket: 'ticket', multipart: standIns.multipart ?? false };
    },
    blobConfirm: async (body, options) => {
      confirms.push(body);
      return standIns.confirm ? standIns.confirm(body, options) : storedFile(body);
    },
    mediaList: async (folder) => ({ ok: true, folder, files: [] }),
    mediaDelete: unused,
    mediaRename: unused,
    mediaReferences: async (src) => ({ ok: true, src, draft: [], live: [] }),
    mediaFolders: async () => ({ ok: true, folders: [] }),
    content: unused,
    mediaFileHref: (src) => `/api/upload/file?src=${encodeURIComponent(src)}`,
  };
  const services: MediaServices = {
    api,
    loadGroup: async () => async (files) => files.map((main) => ({ main, companions: [] })),
    loadPrepare: async () => async (files) => ({ prepared: [prepared(files[0])], failed: [] }),
    putBlob: put,
  };
  return { services, tokens, confirms };
}

/** The queue on stand-ins; its target places a stored file with a note, so a finished item stays in the list. */
function harness(put: MediaServices['putBlob'], standIns: StandIns = {}) {
  const { services, tokens, confirms } = servicesFor(put, standIns);
  const manager = new UploadManager(services);
  manager.register(TARGET, () => ({ applied: true, note: 'Placed in the test.' }));
  return { manager, tokens, confirms };
}

interface PutCall {
  options: BlobPutOptions;
  resolve: (value: { url: string }) => void;
  reject: (error: unknown) => void;
}

/**
 * A stand-in `put` that sends 99% of the bytes and then waits for the test. It never looks at
 * the abort signal, as @vercel/blob does not while it waits to retry.
 */
function heldPut() {
  const calls: PutCall[] = [];
  const put: MediaServices['putBlob'] = (_pathname, _body, options) =>
    new Promise((resolve, reject) => {
      calls.push({ options, resolve, reject });
      options.onUploadProgress({ loaded: 0, total: SIZE, percentage: 0 });
      options.onUploadProgress({ loaded: Math.floor(SIZE * 0.99), total: SIZE, percentage: 99 });
    });
  return { put, calls };
}

/**
 * How one try of @vercel/blob 2.9.0 ends: stored; a 503; its answer lost after the whole file was
 * sent; its connection dropped halfway through the file; or a 400 saying the pathname is taken.
 */
type Answer = 'ok' | 503 | 'lost' | 'midway' | 'exists';

/**
 * A stand-in `put` that behaves like @vercel/blob 2.9.0 on one PUT (src/api.ts, requestApi) with
 * the paced body: progress at 0 first; each try sends the file from the start in 64 KiB steps
 * (half of it when its connection drops midway) and holds back the 100% step until the answer,
 * which comes 300 ms after the last byte; a 503 or a dropped connection is tried again after 1,
 * 2, 4, ... seconds, ten times, and a 400 is not; the abort signal is read while a try is open and
 * when the next one starts, and an aborted try gives the upload up.
 */
function libraryPut(answers: readonly Answer[]) {
  const seen = { tries: 0, settled: false };
  const put: MediaServices['putBlob'] = (_pathname, _body, options) =>
    new Promise((resolve, reject) => {
      const signal = options.abortSignal;
      const step = 64 * 1024;
      const give = (error: unknown) => {
        seen.settled = true;
        reject(error);
      };
      options.onUploadProgress({ loaded: 0, total: SIZE, percentage: 0 });
      const attempt = (n: number) => {
        if (signal.aborted) {
          give(new BlobRequestAbortedError());
          return;
        }
        seen.tries += 1;
        const answer = answers[Math.min(n, answers.length - 1)];
        const sent = answer === 'midway' ? SIZE / 2 : SIZE;
        for (let loaded = step; loaded < sent; loaded += step) {
          options.onUploadProgress({ loaded, total: SIZE, percentage: Number(((loaded / SIZE) * 100).toFixed(2)) });
          if (signal.aborted) {
            give(new BlobRequestAbortedError());
            return;
          }
        }
        let timer: ReturnType<typeof setTimeout> | null = null;
        const aborted = () => {
          if (timer !== null) clearTimeout(timer);
          give(new BlobRequestAbortedError());
        };
        signal.addEventListener('abort', aborted, { once: true });
        timer = setTimeout(() => {
          signal.removeEventListener('abort', aborted);
          if (answer === 'ok') {
            options.onUploadProgress({ loaded: SIZE, total: SIZE, percentage: 100 });
            seen.settled = true;
            resolve({ url: BLOB_URL });
          } else if (answer === 'exists') {
            give(new BlobError(EXISTS));
          } else if (n >= 10) {
            give(answer === 503 ? new BlobServiceNotAvailable() : new TypeError('Failed to fetch'));
          } else {
            setTimeout(() => attempt(n + 1), 1000 * 2 ** n);
          }
        }, 300);
      };
      attempt(0);
    });
  return { put, seen };
}

/** A step of a scripted `put`: progress (a share of the file) at a time, or Vercel Blob's answer. */
type Step = { at: number; share: number } | { at: number; stored: true };

/**
 * A stand-in `put` that plays a script in fake time, for what the retry stand-in cannot show: a
 * large file reports nothing while Vercel Blob starts or completes its multipart upload, and the
 * sum of its parts in between, which goes back whenever parts are sent again. Without an answer
 * it hangs. The abort signal ends it, as it ends the library's requests.
 */
function scriptedPut(script: readonly Step[]) {
  const seen = { aborted: false };
  const put: MediaServices['putBlob'] = (_pathname, _body, options) =>
    new Promise((resolve, reject) => {
      const timers = script.map((step) =>
        setTimeout(() => {
          if ('stored' in step) resolve({ url: BLOB_URL });
          else options.onUploadProgress({ loaded: Math.round(SIZE * step.share), total: SIZE, percentage: step.share * 100 });
        }, step.at),
      );
      options.abortSignal.addEventListener(
        'abort',
        () => {
          for (const timer of timers) clearTimeout(timer);
          seen.aborted = true;
          reject(new BlobRequestAbortedError());
        },
        { once: true },
      );
    });
  return { put, seen };
}

// ---------------------------------------------------------------------------------------------
// Driving the queue in fake time
// ---------------------------------------------------------------------------------------------

/** Lets the queue's promises run; fake time stands still. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await vi.advanceTimersByTimeAsync(0);
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    if (condition()) return;
    await vi.advanceTimersByTimeAsync(0);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function itemNamed(manager: UploadManager, name = 'data.csv'): QueueItem {
  const found = manager.getSnapshot().find((item) => item.name === name);
  if (!found) throw new Error(`No queue item named ${name}`);
  return found;
}

async function start(manager: UploadManager, ...files: File[]): Promise<void> {
  await manager.add(files.length > 0 ? files : [csv()], { target: TARGET, folder: 'raven', accept: ACCEPT_ANY });
}

/** The confirm of a file found at the ticket's pathname: the address is the store's host and the pathname. */
const settled = (n = 1): BlobConfirmBody => ({ pathname: `media/raven/data-${n}.csv`, url: `https://${HOST}/media/raven/data-${n}.csv`, ticket: 'ticket' });

// ---------------------------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------------------------

describe('a browser upload to Vercel Blob', () => {
  it('stores a file as before: one put with a live abort signal, the confirm with its address, and no timer left', async () => {
    vi.useFakeTimers();
    const library = libraryPut(['ok']);
    const calls: BlobPutOptions[] = [];
    const { manager, tokens, confirms } = harness((pathname, body, options) => {
      calls.push(options);
      return library.put(pathname, body, options);
    });
    await start(manager);
    await until(() => calls.length === 1, 'the upload');
    expect(itemNamed(manager)).toMatchObject({ stage: 'storing', stageText: 'Uploading to Vercel Blob' });
    expect(calls[0]).toMatchObject({ access: 'public', token: 'vercel_blob_client_synthetic', multipart: false, contentType: 'text/csv' });
    expect(calls[0].abortSignal.aborted).toBe(false);
    expect(tokens).toEqual([{ folder: 'raven', name: 'data.csv', size: SIZE, contentType: 'text/csv' }]);

    await vi.advanceTimersByTimeAsync(300);
    await until(() => itemNamed(manager).stage === 'done', 'the stored file');
    expect(itemNamed(manager)).toMatchObject({ stage: 'done', stageText: 'Stored in Vercel Blob', message: null, applied: true });
    expect(confirms).toEqual([{ pathname: 'media/raven/data-1.csv', url: BLOB_URL, ticket: 'ticket' }]);
    expect(library.seen.tries).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(BLOB_ANSWER_MS * 2);
    expect(itemNamed(manager).stage).toBe('done');
    expect(calls[0].abortSignal.aborted).toBe(false);
  });

  it('rides out an answer lost after the whole file was sent: @vercel/blob sends it again, and the file is stored', async () => {
    vi.useFakeTimers();
    const library = libraryPut(['lost', 'ok']);
    const { manager, confirms } = harness(library.put);
    await start(manager);
    await until(() => library.seen.tries === 1, 'the first try');
    await vi.advanceTimersByTimeAsync(300 + 1000 + 300);
    await until(() => itemNamed(manager).stage === 'done', 'the stored file');
    expect(BLOB_RETRIES_ALLOWED).toBe(1);
    expect(library.seen.tries).toBe(2);
    expect(confirms).toHaveLength(1);
  });

  it('rides out a connection that drops midway, as often as @vercel/blob tries again, and stores the file', async () => {
    vi.useFakeTimers();
    const library = libraryPut(['midway', 'midway', 'midway', 'ok']);
    const { manager, confirms } = harness(library.put);
    await start(manager);
    await until(() => library.seen.tries === 1, 'the first try');
    // Three drops, each answered 300 ms after the last byte, then waits of 1, 2, and 4 seconds.
    await vi.advanceTimersByTimeAsync(4 * 300 + 1000 + 2000 + 4000);
    await until(() => itemNamed(manager).stage === 'done', 'the stored file');
    expect(itemNamed(manager)).toMatchObject({ stage: 'done', message: null });
    expect(library.seen.tries).toBe(4);
    expect(confirms).toEqual([{ pathname: 'media/raven/data-1.csv', url: BLOB_URL, ticket: 'ticket' }]);
  });

  it('rides out a blip that sends the parts of a large file in flight again, and stores the file', async () => {
    vi.useFakeTimers();
    // Vercel Blob starts the multipart upload in a second; then the sum of the parts goes back
    // three times as the parts in flight are sent again, climbs to the whole file, and the parts
    // are put together.
    const script = scriptedPut([
      { at: 1000, share: 0 },
      { at: 1500, share: 0.3 },
      { at: 1650, share: 0.25 },
      { at: 1800, share: 0.2 },
      { at: 1950, share: 0.15 },
      { at: 4000, share: 0.6 },
      { at: 6000, share: 1 },
      { at: 8000, stored: true },
    ]);
    const { manager, confirms } = harness(script.put, { multipart: true });
    await start(manager);
    await vi.advanceTimersByTimeAsync(8000);
    await until(() => itemNamed(manager).stage === 'done', 'the stored file');
    expect(itemNamed(manager)).toMatchObject({ stage: 'done', message: null });
    expect(script.seen.aborted).toBe(false);
    expect(confirms).toHaveLength(1);
  });

  it('ends the item at once when Cancel is pressed while put hangs at 99%, and nothing continues', async () => {
    vi.useFakeTimers();
    const held = heldPut();
    const { manager, confirms } = harness(held.put);
    await start(manager, csv('data.csv'), csv('next.csv'));
    await until(() => held.calls.length === 1, 'the upload');
    await vi.advanceTimersByTimeAsync(200);
    expect(itemNamed(manager)).toMatchObject({ stage: 'storing', fraction: 0.99 });
    expect(itemNamed(manager, 'next.csv').stage).toBe('ready');

    // Pressed twice, as on the preview.
    const id = itemNamed(manager).id;
    manager.cancel(id);
    manager.cancel(id);
    await flush();
    expect(itemNamed(manager)).toMatchObject({ stage: 'canceled', stageText: 'Cancelled', fraction: null, retryable: true });
    expect(held.calls[0].options.abortSignal.aborted).toBe(true);

    // The queue moves on to the next file instead of waiting for the library.
    await until(() => held.calls.length === 2, 'the next upload');
    expect(itemNamed(manager, 'next.csv').stage).toBe('storing');

    // The library's late progress and late answer change nothing.
    held.calls[0].options.onUploadProgress({ loaded: SIZE, total: SIZE, percentage: 100 });
    held.calls[0].resolve({ url: BLOB_URL });
    await flush();
    await vi.advanceTimersByTimeAsync(BLOB_QUIET_MS * 2);
    expect(itemNamed(manager)).toMatchObject({ stage: 'canceled', fraction: null, message: null });
    expect(confirms).toHaveLength(0);
  });

  it('ends the item at once when Cancel is pressed while @vercel/blob waits to retry, and the library sends nothing more', async () => {
    vi.useFakeTimers();
    const library = libraryPut([503]);
    const { manager, confirms } = harness(library.put);
    await start(manager);
    await until(() => library.seen.tries === 1, 'the first try');
    // The 503 came after 300 ms; the library waits a second before its next try.
    await vi.advanceTimersByTimeAsync(300 + 500);
    expect(itemNamed(manager).stage).toBe('storing');

    manager.cancel(itemNamed(manager).id);
    await flush();
    expect(itemNamed(manager)).toMatchObject({ stage: 'canceled', stageText: 'Cancelled', retryable: true });

    // Its next try reads the aborted signal and gives up before sending a byte.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(library.seen.tries).toBe(1);
    expect(library.seen.settled).toBe(true);
    expect(itemNamed(manager).stage).toBe('canceled');
    expect(confirms).toHaveLength(0);
  });

  it('stops @vercel/blob from sending a refused file for half an hour: its second retry fails the item within seconds, naming the likely cause without claiming it', async () => {
    vi.useFakeTimers();
    const library = libraryPut([503]);
    const { manager, confirms } = harness(library.put);
    await start(manager);
    await until(() => library.seen.tries === 1, 'the first try');
    // 300 ms answer, 1 s wait, the second try, 300 ms answer, 2 s wait, then the third try starts over.
    await vi.advanceTimersByTimeAsync(300 + 1000 + 300 + 2000);
    await flush();
    expect(itemNamed(manager)).toMatchObject({ stage: 'failed', retryable: true, message: blobNotAccepted(2) });
    expect(blobNotAccepted(2)).toBe(
      'Vercel Blob did not accept the file after 2 tries, so the upload was stopped. A likely cause is a store created as private, which refuses this site\'s public files. Check the Blob store connected to this environment, then try again.',
    );
    expect(library.seen.tries).toBe(BLOB_RETRIES_ALLOWED + 2);
    expect(library.seen.settled).toBe(true);

    // Nothing is retried in the background, and nothing is asked of the server.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(library.seen.tries).toBe(BLOB_RETRIES_ALLOWED + 2);
    expect(itemNamed(manager).stage).toBe('failed');
    expect(confirms).toHaveLength(0);
  });

  it('stops a large file whose multipart upload Vercel Blob does not start, after 30 seconds, saying so', async () => {
    vi.useFakeTimers();
    // A store that refuses the upload answers the library's start request with 503 again and
    // again, and the library reports no progress meanwhile.
    const script = scriptedPut([]);
    const { manager, confirms } = harness(script.put, { multipart: true });
    await start(manager);
    await flush();
    await vi.advanceTimersByTimeAsync(BLOB_START_MS - 1);
    expect(itemNamed(manager).stage).toBe('storing');
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(BLOB_START_MS).toBe(30_000);
    expect(itemNamed(manager)).toMatchObject({ stage: 'failed', retryable: true, message: BLOB_NOT_STARTED });
    expect(BLOB_NOT_STARTED).toContain('did not start within 30 seconds');
    expect(BLOB_NOT_STARTED).not.toContain('bytes sent');
    expect(script.seen.aborted).toBe(true);
    expect(confirms).toHaveLength(0);
  });

  it('stops a single upload that sends nothing within 30 seconds', async () => {
    vi.useFakeTimers();
    const script = scriptedPut([{ at: 0, share: 0 }]);
    const { manager } = harness(script.put);
    await start(manager);
    await flush();
    await vi.advanceTimersByTimeAsync(BLOB_START_MS);
    await flush();
    expect(itemNamed(manager)).toMatchObject({ stage: 'failed', message: BLOB_NOT_STARTED });
  });

  it('stops an upload whose bytes stop moving midway for 90 seconds, without asking the server', async () => {
    vi.useFakeTimers();
    const script = scriptedPut([
      { at: 0, share: 0 },
      { at: 500, share: 0.5 },
    ]);
    const { manager, confirms } = harness(script.put);
    await start(manager);
    await flush();
    await vi.advanceTimersByTimeAsync(500 + BLOB_QUIET_MS - 1);
    expect(itemNamed(manager).stage).toBe('storing');
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(BLOB_QUIET_MS).toBe(90_000);
    expect(itemNamed(manager)).toMatchObject({ stage: 'failed', retryable: true, message: BLOB_STALLED });
    expect(script.seen.aborted).toBe(true);
    expect(confirms).toHaveLength(0);
  });

  it('keeps a slow upload going while its bytes move, and waits minutes for the answer after them', async () => {
    vi.useFakeTimers();
    const calls: PutCall[] = [];
    const put: MediaServices['putBlob'] = (_pathname, _body, options) =>
      new Promise((resolve, reject) => {
        calls.push({ options, resolve, reject });
        options.onUploadProgress({ loaded: 0, total: SIZE, percentage: 0 });
        options.onUploadProgress({ loaded: 64 * 1024, total: SIZE, percentage: 1.24 });
      });
    const { manager, confirms } = harness(put);
    await start(manager);
    await until(() => calls.length === 1, 'the upload');
    const { options } = calls[0];
    // Twenty minutes of bytes, a step every minute, up to the last one the library reports.
    for (let minute = 1; minute <= 20; minute += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(itemNamed(manager).stage).toBe('storing');
      const loaded = minute === 20 ? SIZE - 57_120 : Math.floor((SIZE * minute) / 21);
      options.onUploadProgress({ loaded, total: SIZE, percentage: Number(((loaded / SIZE) * 100).toFixed(2)) });
    }
    // Then four minutes until Vercel Blob answers.
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(itemNamed(manager).stage).toBe('storing');
    calls[0].resolve({ url: BLOB_URL });
    await until(() => itemNamed(manager).stage === 'done', 'the stored file');
    expect(options.abortSignal.aborted).toBe(false);
    expect(confirms).toEqual([{ pathname: 'media/raven/data-1.csv', url: BLOB_URL, ticket: 'ticket' }]);
  });

  it('waits for the answer once every byte is sent: a single upload answered 100 seconds later is stored', async () => {
    vi.useFakeTimers();
    const script = scriptedPut([
      { at: 0, share: 0 },
      { at: 500, share: 0.99 },
      { at: 100_500, stored: true },
    ]);
    const { manager, confirms } = harness(script.put);
    await start(manager);
    await vi.advanceTimersByTimeAsync(100_500);
    await until(() => itemNamed(manager).stage === 'done', 'the stored file');
    expect(confirms).toEqual([{ pathname: 'media/raven/data-1.csv', url: BLOB_URL, ticket: 'ticket' }]);
    expect(script.seen.aborted).toBe(false);
  });

  it('waits while Vercel Blob puts the parts of a large file together: answered 100 seconds after the last part, it is stored', async () => {
    vi.useFakeTimers();
    const script = scriptedPut([
      { at: 1000, share: 0 },
      { at: 3000, share: 1 },
      { at: 103_000, stored: true },
    ]);
    const { manager, confirms } = harness(script.put, { multipart: true });
    await start(manager);
    await vi.advanceTimersByTimeAsync(103_000);
    await until(() => itemNamed(manager).stage === 'done', 'the stored file');
    expect(confirms).toHaveLength(1);
    expect(script.seen.aborted).toBe(false);
  });

  it('asks the server when the answer has not come 5 minutes after the last bytes, and stores the file Vercel Blob kept', async () => {
    vi.useFakeTimers();
    const held = heldPut();
    const { manager, tokens, confirms } = harness(held.put);
    await start(manager);
    await until(() => held.calls.length === 1, 'the upload');
    const folderVersion = manager.version('raven');

    await vi.advanceTimersByTimeAsync(BLOB_ANSWER_MS - 1);
    expect(itemNamed(manager).stage).toBe('storing');
    expect(confirms).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => itemNamed(manager).stage === 'done', 'the stored file');
    expect(BLOB_ANSWER_MS).toBe(300_000);
    expect(held.calls[0].options.abortSignal.aborted).toBe(true);
    expect(confirms).toEqual([settled()]);
    expect(itemNamed(manager)).toMatchObject({ stage: 'done', stageText: 'Stored in Vercel Blob', message: null });
    expect(itemNamed(manager).result?.main.src).toBe(`https://${HOST}/media/raven/data-1.csv`);
    expect(manager.version('raven')).toBe(folderVersion + 1);
    // One file, uploaded once.
    expect(tokens).toHaveLength(1);
    expect(held.calls).toHaveLength(1);
  });

  it('fails with the no-answer message when the server finds nothing, and Try again uploads anew', async () => {
    vi.useFakeTimers();
    const held = heldPut();
    let asked = 0;
    const { manager, tokens, confirms } = harness(held.put, {
      confirm: async (body) => {
        asked += 1;
        return asked === 1 ? NOT_UPLOADED : storedFile(body);
      },
    });
    await start(manager);
    await until(() => held.calls.length === 1, 'the upload');
    await vi.advanceTimersByTimeAsync(BLOB_ANSWER_MS);
    await until(() => itemNamed(manager).stage === 'failed', 'the failed item');
    expect(itemNamed(manager)).toMatchObject({ stage: 'failed', retryable: true, message: BLOB_NO_ANSWER });
    expect(BLOB_NO_ANSWER).toBe('Vercel Blob did not answer within 5 minutes of the last bytes sent, so the upload was stopped. Try again.');
    expect(confirms).toEqual([settled()]);

    manager.retry(itemNamed(manager).id);
    await until(() => held.calls.length === 2, 'the second upload');
    expect(tokens).toHaveLength(2);
    held.calls[1].resolve({ url: BLOB_URL });
    await until(() => itemNamed(manager).stage === 'done', 'the stored file');
    expect(confirms).toEqual([settled(), { pathname: 'media/raven/data-2.csv', url: BLOB_URL, ticket: 'ticket' }]);
  });

  it('refuses the file when the server finds it and its check refuses it', async () => {
    vi.useFakeTimers();
    const held = heldPut();
    const { manager } = harness(held.put, {
      confirm: async () => ({ ok: false, code: 'invalid-file', error: 'The stored file is not a CSV file.' }),
    });
    await start(manager);
    await until(() => held.calls.length === 1, 'the upload');
    await vi.advanceTimersByTimeAsync(BLOB_ANSWER_MS);
    await until(() => itemNamed(manager).stage === 'refused', 'the refused item');
    expect(itemNamed(manager)).toMatchObject({ stage: 'refused', message: 'The stored file is not a CSV file.', retryable: false });
  });

  it('ends the item as cancelled when Cancel is pressed while the queue asks the server', async () => {
    vi.useFakeTimers();
    const held = heldPut();
    const { manager } = harness(held.put, {
      confirm: (_body, options) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener('abort', () => resolve({ ok: false, code: 'server', error: 'The request was cancelled.' }), { once: true });
        }),
    });
    await start(manager);
    await until(() => held.calls.length === 1, 'the upload');
    await vi.advanceTimersByTimeAsync(BLOB_ANSWER_MS);
    await until(() => itemNamed(manager).stageText === 'Checking whether the file reached Vercel Blob', 'the question to the server');
    manager.cancel(itemNamed(manager).id);
    await until(() => itemNamed(manager).stage === 'canceled', 'the cancelled item');
    expect(itemNamed(manager)).toMatchObject({ stage: 'canceled', retryable: true, message: null });
  });

  it('stores the file an earlier try kept when Vercel Blob then says its pathname is taken', async () => {
    vi.useFakeTimers();
    // The first answer is lost after the whole file was sent; Vercel Blob kept it, so the
    // library's second try is told the pathname already holds a file.
    const library = libraryPut(['lost', 'exists']);
    const { manager, tokens, confirms } = harness(library.put);
    await start(manager);
    await until(() => library.seen.tries === 1, 'the first try');
    await vi.advanceTimersByTimeAsync(300 + 1000 + 300);
    await until(() => itemNamed(manager).stage === 'done', 'the stored file');
    expect(library.seen.tries).toBe(2);
    expect(confirms).toEqual([settled()]);
    expect(tokens).toHaveLength(1);
    expect(itemNamed(manager)).toMatchObject({ stage: 'done', message: null });
  });

  it('fails the item at once when put rejects with a 503, with the status and the likely cause', async () => {
    vi.useFakeTimers();
    const held = heldPut();
    const { manager, confirms } = harness(held.put);
    await start(manager);
    await until(() => held.calls.length === 1, 'the upload');
    held.calls[0].reject(Object.assign(new Error('Service Unavailable'), { status: 503 }));
    await flush();
    expect(itemNamed(manager)).toMatchObject({
      stage: 'failed',
      retryable: true,
      message:
        'Vercel Blob refused the file (503). This site stores Blob files as public, and a store created as private refuses them. Check the Blob store connected to this environment.',
    });
    expect(confirms).toHaveLength(0);
  });

  it('fails the item at once when put rejects with the library\'s own refusal, which carries no status', async () => {
    vi.useFakeTimers();
    const held = heldPut();
    const { manager } = harness(held.put);
    await start(manager);
    await until(() => held.calls.length === 1, 'the upload');
    held.calls[0].reject(new BlobServiceNotAvailable());
    await flush();
    expect(itemNamed(manager)).toMatchObject({ stage: 'failed', retryable: true, message: PRIVATE_STORE });
  });

  it('keeps the library\'s reason when Vercel Blob refuses the file for a cause other than the store\'s access', async () => {
    vi.useFakeTimers();
    const held = heldPut();
    const { manager, confirms } = harness(held.put);
    await start(manager);
    await until(() => held.calls.length === 1, 'the upload');
    held.calls[0].reject(new BlobFileTooLargeError('the file length cannot be greater than 5300000'));
    await flush();
    expect(itemNamed(manager)).toMatchObject({
      stage: 'failed',
      message: 'Vercel Blob refused the file (File is too large, the file length cannot be greater than 5300000). Try again.',
    });
    expect(confirms).toHaveLength(0);
  });

  it('keeps a dropped connection that outlasts the library\'s retries a plain failure, not a refusal', async () => {
    vi.useFakeTimers();
    const held = heldPut();
    const { manager } = harness(held.put);
    await start(manager);
    await until(() => held.calls.length === 1, 'the upload');
    held.calls[0].reject(new TypeError('Failed to fetch'));
    await flush();
    expect(itemNamed(manager)).toMatchObject({
      stage: 'failed',
      retryable: true,
      message: 'The upload to Vercel Blob did not finish (Failed to fetch). Try again.',
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The refusal message, from @vercel/blob 2.9.0's own errors
// ---------------------------------------------------------------------------------------------

describe('blobRefusal', () => {
  it('names the store\'s access for a 503, an unknown error, and access denied', () => {
    for (const error of [new BlobServiceNotAvailable(), new BlobUnknownError(), new BlobAccessError()]) {
      expect(isBlobRefusal(error)).toBe(true);
      expect(blobRefusal(error)).toBe(PRIVATE_STORE);
    }
  });

  it('gives the status when the error carries one', () => {
    const error = Object.assign(new Error('Bad gateway'), { status: 502 });
    expect(isBlobRefusal(error)).toBe(true);
    expect(blobRefusal(error)).toBe(PRIVATE_STORE.replace('the file.', 'the file (502).'));
    expect(blobRefusal(Object.assign(new Error('Conflict'), { status: 409 }))).toBe('Vercel Blob refused the file (409: Conflict). Try again.');
    expect(isBlobRefusal(Object.assign(new Error('x'), { status: 'nope' }))).toBe(false);
  });

  it('names the cause the library names: a suspended or missing store, an expired token, too many requests', () => {
    expect(blobRefusal(new BlobStoreSuspendedError())).toBe(
      'Vercel Blob refused the file. The Blob store connected to this environment is suspended. Check it in Vercel (Storage).',
    );
    expect(blobRefusal(new BlobStoreNotFoundError())).toBe(
      'Vercel Blob refused the file. The Blob store connected to this environment does not exist. Connect a Blob store to this environment in Vercel (Storage).',
    );
    expect(blobRefusal(new BlobClientTokenExpiredError())).toBe(
      'Vercel Blob refused the file. The permission this site gave the browser for this upload ran out before the file was stored. Try again.',
    );
    expect(blobRefusal(new BlobServiceRateLimited(30))).toBe(
      'Vercel Blob refused the file. It is taking too many requests at the moment. Wait a minute and try again.',
    );
  });

  it('keeps the library\'s own reason for the refusals a store\'s access does not give', () => {
    const cases: [unknown, string][] = [
      [new BlobFileTooLargeError('the file length cannot be greater than 5300000'), 'File is too large, the file length cannot be greater than 5300000'],
      [new BlobContentTypeNotAllowedError('"text/csv" is not allowed'), 'Content type mismatch, "text/csv" is not allowed'],
      [new BlobPathnameMismatchError('"pathname" does not match the token payload'), 'Pathname mismatch, "pathname" does not match the token payload. Check the pathname used in upload() or put() matches the one from the client token'],
      [new BlobPreconditionFailedError(), 'Precondition failed: ETag mismatch'],
      [new BlobNotFoundError(), 'The requested blob does not exist'],
      [new BlobError(EXISTS), 'This blob already exists, use `allowOverwrite: true` if you want to overwrite it'],
      [new BlobError('client/`put` must be called with a client token'), 'client/`put` must be called with a client token'],
    ];
    for (const [error, reason] of cases) {
      expect(isBlobRefusal(error)).toBe(true);
      expect(blobRefusal(error)).toBe(`Vercel Blob refused the file (${reason}). Try again.`);
    }
  });

  it('writes a library reason without a dash, and no longer than a line or two', () => {
    const dashed = new BlobError(`This operation is not available when using a client token. Use a read${String.fromCharCode(0x2013)}write or OIDC token on the server.`);
    expect(blobRefusal(dashed)).toBe(
      'Vercel Blob refused the file (This operation is not available when using a client token. Use a read-write or OIDC token on the server). Try again.',
    );
    const long = blobRefusal(new BlobError('x'.repeat(500)));
    expect(long).toBe(`Vercel Blob refused the file (${'x'.repeat(197)}...). Try again.`);
  });

  it('tells the refusal that means an earlier try stored the file', () => {
    expect(isBlobAlreadyStored(new BlobError(EXISTS))).toBe(true);
    expect(isBlobAlreadyStored(new BlobServiceNotAvailable())).toBe(false);
    expect(isBlobAlreadyStored(new Error('This blob already exists'))).toBe(false);
    expect(isBlobAlreadyStored(null)).toBe(false);
  });

  it('does not call a stopped request or a dropped connection a refusal', () => {
    expect(isBlobRefusal(new BlobRequestAbortedError())).toBe(false);
    expect(isBlobRefusal(new TypeError('Failed to fetch'))).toBe(false);
    expect(isBlobRefusal(new DOMException('The user aborted a request.', 'AbortError'))).toBe(false);
    expect(isBlobRefusal(null)).toBe(false);
  });

  it('writes no dash in any message', () => {
    const errors = [
      new BlobServiceNotAvailable(),
      new BlobStoreSuspendedError(),
      new BlobStoreNotFoundError(),
      new BlobClientTokenExpiredError(),
      new BlobServiceRateLimited(30),
      new BlobFileTooLargeError('the file length cannot be greater than 5300000'),
      new BlobError(EXISTS),
    ];
    const messages = [BLOB_NOT_STARTED, BLOB_STALLED, BLOB_NO_ANSWER, blobNotAccepted(2), ...errors.map((error) => blobRefusal(error))];
    for (const message of messages) expect(message).not.toMatch(DASHES);
  });
});

// ---------------------------------------------------------------------------------------------
// The real services
// ---------------------------------------------------------------------------------------------

/** Every chunk a stream gives, read one at a time. */
async function chunksOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

describe('the admin\'s putBlob', () => {
  const options = (multipart: boolean, controller: AbortController): BlobPutOptions => ({
    access: 'public',
    token: 'vercel_blob_client_synthetic',
    multipart,
    contentType: 'text/csv',
    abortSignal: controller.signal,
    onUploadProgress: () => undefined,
  });

  it('hands the abort signal and the other options to put from @vercel/blob/client, and returns the address', async () => {
    blobClient.put.mockResolvedValue({ url: BLOB_URL, pathname: 'media/raven/data-1.csv' });
    const controller = new AbortController();
    const body = new Blob(['a,b\n1,2\n'], { type: 'text/csv' });
    await expect(realMediaServices().putBlob('media/raven/data-1.csv', body, options(false, controller))).resolves.toEqual({ url: BLOB_URL });
    expect(blobClient.put).toHaveBeenCalledTimes(1);
    const [pathname, sent, given] = blobClient.put.mock.calls[0] as [string, Blob, BlobPutOptions];
    expect(pathname).toBe('media/raven/data-1.csv');
    expect(sent).toBeInstanceOf(Blob);
    expect(sent.size).toBe(body.size);
    expect(sent.type).toBe('text/csv');
    expect(given.abortSignal).toBe(controller.signal);
    expect(given).toMatchObject({ access: 'public', token: 'vercel_blob_client_synthetic', multipart: false, contentType: 'text/csv' });
  });

  it('paces a single upload\'s body: handed on 64 KiB at a time, every byte once, from the start on every try', async () => {
    blobClient.put.mockResolvedValue({ url: BLOB_URL, pathname: 'media/raven/data-1.csv' });
    // Over one read of a megabyte, so the pieces cross from one read to the next.
    const bytes = new Uint8Array(1024 * 1024 + 200 * 1024 + 7).map((_, i) => i % 251);
    const body = new Blob([bytes], { type: 'text/csv' });
    await realMediaServices().putBlob('media/raven/data-1.csv', body, options(false, new AbortController()));
    const sent = blobClient.put.mock.calls[0][1] as Blob;

    const reader = sent.stream().getReader();
    const first = await reader.read();
    expect(first.value?.byteLength).toBe(64 * 1024);
    await reader.cancel();

    // Each try of the library streams the whole file again, from the start.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const chunks = await chunksOf(sent.stream());
      expect(chunks.map((chunk) => chunk.byteLength)).toEqual([...Array<number>(19).fill(65_536), 8_199]);
      const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
      let at = 0;
      for (const chunk of chunks) {
        joined.set(chunk, at);
        at += chunk.byteLength;
      }
      expect(joined).toEqual(bytes);
    }
  });

  it('hands a large file\'s body to the multipart upload as it is', async () => {
    blobClient.put.mockResolvedValue({ url: BLOB_URL, pathname: 'media/raven/data-1.csv' });
    const body = new Blob(['a,b\n1,2\n'], { type: 'text/csv' });
    await realMediaServices().putBlob('media/raven/data-1.csv', body, options(true, new AbortController()));
    expect(blobClient.put.mock.calls[0][1]).toBe(body);
  });
});

// ---------------------------------------------------------------------------------------------
// On the page
// ---------------------------------------------------------------------------------------------

const tick = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function untilReal(condition: () => boolean, what: string, ms = 4000): Promise<void> {
  const begin = Date.now();
  while (!condition()) {
    if (Date.now() - begin > ms) throw new Error(`Timed out waiting for ${what}`);
    await tick(10);
  }
}

function Page({ onManager }: { onManager: (manager: UploadManager) => void }) {
  const manager = useMediaManager();
  useEffect(() => {
    onManager(manager);
  }, [manager, onManager]);
  const items = useQueueItems(() => true, 'all');
  return h(UploadQueue, { items });
}

describe('the queue on the page', () => {
  it('shows the item as cancelled as soon as Cancel is pressed, though put never answers', async () => {
    const held = heldPut();
    const { services } = servicesFor(held.put);
    const grabbed: UploadManager[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onManager = (m: UploadManager) => {
      grabbed.push(m);
    };
    root.render(h(MediaProvider, { services, children: h(Page, { onManager }) }));
    try {
      await untilReal(() => grabbed.length > 0, 'the queue');
      await grabbed[0].add([csv()], { target: TARGET, folder: 'raven', accept: ACCEPT_ANY });
      const row = () => container.querySelector<HTMLLIElement>('li[data-stage]');
      // As on the preview: the bytes are sent, and the item shows 99% while put does not answer.
      await untilReal(() => held.calls.length === 1 && !!row()?.textContent?.includes('Uploading to Vercel Blob 99%'), 'the upload at 99%');
      expect(row()?.dataset.stage).toBe('storing');

      const cancel = container.querySelector<HTMLButtonElement>('button[aria-label="Cancel the upload of data.csv"]');
      expect(cancel).not.toBeNull();
      cancel?.click();
      cancel?.click();
      await untilReal(() => row()?.dataset.stage === 'canceled', 'the cancelled item', 1000);
      expect(row()?.textContent).toContain('cancelled');
      expect(container.querySelector('button[aria-label="Try data.csv again"]')).not.toBeNull();
      expect(held.calls[0].options.abortSignal.aborted).toBe(true);
    } finally {
      root.unmount();
      container.remove();
    }
  });
});
