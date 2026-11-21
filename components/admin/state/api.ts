/**
 * The admin's API client: one typed function per route in `API` (lib/admin/contract.ts).
 *
 * - Every function returns `ApiResult<T>` and never throws on an HTTP error: a route's own JSON
 *   error comes back as it is (`ApiError` with its `code`); an answer that is not the route's JSON
 *   (a proxy page, a platform limit) becomes an `ApiError` chosen from the status; a network
 *   failure becomes `{ code: 'server' }` with a plain sentence. Check with `isApiError(result)`.
 * - JSON requests send `content-type: application/json`; every request sends the session cookie
 *   (`credentials: 'same-origin'`) and is never cached.
 * - A 401 `unauthorized` from any call except `login`, `logout`, and the `session` probe tells
 *   `sessionGate`: the shell opens the sign-in dialog, and the caller may wait for it and retry
 *   once (`withReauth`). Pass `{ quiet: true }` for background calls (polls) that should not open
 *   the dialog.
 * - `uploadRepo` uses XMLHttpRequest, the one browser API that reports upload progress.
 *
 * Browser code; imports nothing that reads the environment.
 */
import {
  API,
  isApiError,
  MAX_REPO_UPLOAD_BODY_BYTES,
  type ApiError,
  type ApiResult,
  type BlobConfirmBody,
  type BlobConfirmResponse,
  type BlobTokenBody,
  type BlobTokenResponse,
  type CheckBody,
  type CheckResponse,
  type ContentResponse,
  type DiscardResponse,
  type ErrorCode,
  type MediaDeleteResponse,
  type MediaListResponse,
  type MediaReferencesResponse,
  type MediaRenameResponse,
  type PublishedFileResponse,
  type PublishPlan,
  type PublishResponse,
  type SaveBody,
  type SaveResponse,
  type SessionState,
  type StatusResponse,
  type UploadResponse,
} from '@/lib/admin/contract';

export { isApiError };
export type { ApiError, ApiResult };

export interface CallOptions {
  signal?: AbortSignal;
  /** A 401 does not open the sign-in dialog (background polls). */
  quiet?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Signing in again
// ---------------------------------------------------------------------------------------------

type Listener = () => void;

/**
 * The sign-in-again gate between the API client and the shell (docs/V3_PLAN.md D-20: when the
 * session ends, the editor keeps its state, asks for the password in a dialog, and retries).
 *
 * A 401 calls `notify()`, which opens one shared wait and tells the subscribers (the shell, which
 * opens the ReloginDialog). Callers await `wait()`: true once the owner signed in again, false if
 * they cancelled. The shell answers with `settle(ok)`. Without a subscriber nothing waits.
 */
export class SessionGate {
  private readonly listeners = new Set<Listener>();
  private pending: { promise: Promise<boolean>; resolve: (ok: boolean) => void } | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A call came back 401: open the shared wait and tell the shell. */
  notify(): void {
    if (this.listeners.size === 0) return;
    if (this.pending === null) {
      let resolve: (ok: boolean) => void = () => undefined;
      const promise = new Promise<boolean>((r) => {
        resolve = r;
      });
      this.pending = { promise, resolve };
    }
    for (const listener of [...this.listeners]) listener();
  }

  /** True while the shell is asking for the password. */
  get waiting(): boolean {
    return this.pending !== null;
  }

  /** True once the owner signed in again, false if they cancelled; false at once when nothing waits. */
  wait(): Promise<boolean> {
    return this.pending ? this.pending.promise : Promise.resolve(false);
  }

  /** The shell's answer: the owner signed in again (true) or closed the dialog (false). */
  settle(ok: boolean): void {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(ok);
  }
}

/** The one gate for the admin page. */
export const sessionGate = new SessionGate();

/** True for the route's own 401: the session ended or was never there. */
export function isUnauthorized(result: unknown): result is ApiError {
  return isApiError(result) && result.code === 'unauthorized';
}

/**
 * Runs `call`; when it comes back 401, waits for the owner to sign in again and runs it once
 * more. Returns the first answer when they cancel.
 */
export async function withReauth<T>(call: () => Promise<ApiResult<T>>, gate: SessionGate = sessionGate): Promise<ApiResult<T>> {
  const first = await call();
  if (!isUnauthorized(first)) return first;
  if (!(await gate.wait())) return first;
  return call();
}

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

export const NETWORK_ERROR = 'Could not reach the server. Check the connection and try again.';

function failure(code: ErrorCode, error: string, extra: Partial<Omit<ApiError, 'ok' | 'code' | 'error'>> = {}): ApiError {
  return { ok: false, code, error, ...extra };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : undefined;
}

/** An ApiError for an answer that is not the route's own JSON. */
function fromStatus(status: number, retryAfter: string | null): ApiError {
  if (status >= 200 && status < 300) return failure('server', "The server's answer could not be read. Reload the page and try again.");
  if (status === 413) return failure('too-large', 'This request is too large for the server.');
  if (status === 429) {
    const seconds = retryAfterSeconds(retryAfter);
    return failure('locked', 'Too many requests. Wait a moment and try again.', seconds === undefined ? {} : { retryAfter: seconds });
  }
  if (status === 401 || status === 403) {
    return failure('server', `The deployment refused the request (HTTP ${status}) before it reached the admin. Reload the page; on a protected preview, sign in to Vercel again.`);
  }
  if (status === 404) return failure('server', 'This admin route was not found on the server (HTTP 404).');
  if (status >= 500) return failure('server', `The server could not answer (HTTP ${status}). Try again; if it persists, check the status panel in Settings.`);
  return failure('server', `Unexpected answer from the server (HTTP ${status}).`);
}

/**
 * Turns an HTTP answer into an ApiResult: the route's success JSON (`ok: true`), the route's
 * error JSON as it is, or an ApiError worked out from the status.
 */
export function interpret<T>(status: number, text: string, retryAfter: string | null = null): ApiResult<T> {
  let data: unknown;
  if (text.trim() !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (status >= 200 && status < 300 && isRecord(data) && data.ok === true) return data as T;
  if (isApiError(data) && typeof data.code === 'string' && typeof data.error === 'string') return data;
  return fromStatus(status, retryAfter);
}

interface RequestOptions extends CallOptions {
  /** False for login, logout, and the session probe: their 401 is an answer, not an ended session. */
  notify?: boolean;
}

function report<T>(result: ApiResult<T>, status: number, options: RequestOptions): ApiResult<T> {
  if (status === 401 && isUnauthorized(result) && options.notify !== false && !options.quiet) sessionGate.notify();
  return result;
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', url: string, body: unknown, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store', headers, signal: options.signal };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return failure('server', options.signal?.aborted ? 'The request was cancelled.' : NETWORK_ERROR);
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    text = '';
  }
  return report(interpret<T>(res.status, text, res.headers.get('retry-after')), res.status, options);
}

// ---------------------------------------------------------------------------------------------
// Uploads with progress
// ---------------------------------------------------------------------------------------------

/** One file for a repository upload: the name to store (cleaned again on the server) and its bytes. */
export interface UploadFile {
  name: string;
  blob: Blob;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0 to 1. */
  fraction: number;
}

/** The bytes of a batch, plus room for the form fields and part headers. */
export function uploadBodySize(files: readonly UploadFile[]): number {
  return files.reduce((sum, f) => sum + f.blob.size + 512 + f.name.length * 2, 1024);
}

function uploadRepo(
  folder: string,
  files: readonly UploadFile[],
  replace: boolean,
  onProgress?: (progress: UploadProgress) => void,
  options: CallOptions = {},
): Promise<ApiResult<UploadResponse>> {
  if (files.length === 0) return Promise.resolve(failure('bad-request', 'No files to upload.'));
  const total = uploadBodySize(files);
  if (total > MAX_REPO_UPLOAD_BODY_BYTES) {
    return Promise.resolve(failure('too-large', 'These files are too large for one repository upload. Send fewer at a time, or larger files through Blob.'));
  }
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve(failure('server', 'The upload was cancelled.'));
      return;
    }
    const form = new FormData();
    form.append('folder', folder);
    form.append('replace', replace ? '1' : '0');
    for (const file of files) form.append('file', file.blob, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', API.media);
    xhr.responseType = 'text';
    xhr.setRequestHeader('accept', 'application/json');
    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (!onProgress) return;
      const size = event.lengthComputable && event.total > 0 ? event.total : total;
      onProgress({ loaded: event.loaded, total: size, fraction: size > 0 ? Math.min(1, event.loaded / size) : 0 });
    };
    xhr.onload = () => {
      resolve(report(interpret<UploadResponse>(xhr.status, xhr.responseText ?? '', xhr.getResponseHeader('retry-after')), xhr.status, options));
    };
    xhr.onerror = () => resolve(failure('server', NETWORK_ERROR));
    xhr.onabort = () => resolve(failure('server', 'The upload was cancelled.'));
    xhr.ontimeout = () => resolve(failure('server', 'The upload took too long. Try again with fewer files.'));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

// ---------------------------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------------------------

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/**
 * One function per route. The query parameter names (`folder`, `refs`, `src`, `ref`, `path`) are
 * the ones the routes read.
 */
export const api = {
  /** GET /api/auth: the session's expiry, or 401 when signed out, or 503 not-configured. */
  session: (options: CallOptions = {}) => request<SessionState>('GET', API.auth, undefined, { ...options, notify: false }),
  /** POST /api/auth: 401 wrong password, 429 locked with `retryAfter`. */
  login: (password: string, options: CallOptions = {}) => request<SessionState>('POST', API.auth, { password }, { ...options, notify: false }),
  /** DELETE /api/auth: clears the session cookie. */
  logout: (options: CallOptions = {}) => request<{ ok: true }>('DELETE', API.auth, undefined, { ...options, notify: false }),

  /** GET /api/content: every content file from the draft (or live) branch, or the disk. */
  content: (options: CallOptions = {}) => request<ContentResponse>('GET', API.content, undefined, options),
  /** GET /api/content?ref=live&path=: one file as published, for "Revert this file to published". */
  publishedFile: (path: string, options: CallOptions = {}) =>
    request<PublishedFileResponse>('GET', `${API.content}?${query({ ref: 'live', path })}`, undefined, options),
  /**
   * POST /api/save: one commit on the draft branch (or a write to disk). 422 content-check; 409
   * conflict when a file it writes is not, on the draft, the version named in `expected`.
   */
  save: (body: SaveBody, options: CallOptions = {}) => request<SaveResponse>('POST', API.save, body, options),

  /** GET /api/publish: what a publish would do. */
  publishPlan: (options: CallOptions = {}) => request<PublishPlan>('GET', API.publish, undefined, options),
  /** POST /api/publish: fast-forwards the live branch to `draftHead`, the head shown in the confirmation. */
  publish: (draftHead: string, options: CallOptions = {}) => request<PublishResponse>('POST', API.publish, { draftHead }, options),
  /**
   * POST /api/discard: resets the draft branch to the live branch, if the draft is still at
   * `draftHead`, the head shown in the confirmation (null: there was no draft); 409 conflict when
   * it moved.
   */
  discard: (draftHead: string | null, options: CallOptions = {}) =>
    request<DiscardResponse>('POST', API.discard, { confirm: true, draftHead }, options),

  /** GET /api/status: the diagnostics for the status panel and the deploy state. */
  status: (options: CallOptions = {}) => request<StatusResponse>('GET', API.status, undefined, options),
  /** POST /api/check: the content check over text taken from a file before it is uploaded. */
  check: (body: CheckBody, options: CallOptions = {}) => request<CheckResponse>('POST', API.check, body, options),

  /** GET /api/upload?folder=&refs=1: the files of a media folder ("site" or a project slug). */
  mediaList: (folder: string, refs = false, options: CallOptions = {}) =>
    request<MediaListResponse>('GET', `${API.media}?${query(refs ? { folder, refs: '1' } : { folder })}`, undefined, options),
  /** DELETE /api/upload: removes a media file; 409 referenced while content still uses it. */
  mediaDelete: (src: string, options: CallOptions = {}) => request<MediaDeleteResponse>('DELETE', API.media, { src }, options),
  /** POST /api/upload/rename: renames a file and rewrites the draft's references in the same commit. */
  mediaRename: (src: string, name: string, options: CallOptions = {}) =>
    request<MediaRenameResponse>('POST', API.mediaRename, { src, name }, options),
  /** GET /api/upload/references?src=: where draft and live content use a media file. */
  mediaReferences: (src: string, options: CallOptions = {}) =>
    request<MediaReferencesResponse>('GET', `${API.mediaReferences}?${query({ src })}`, undefined, options),
  /** POST /api/upload (multipart): small files into the repository, one commit, with upload progress. */
  uploadRepo,
  /** POST /api/upload/token: a single-use browser upload ticket for Vercel Blob. */
  blobToken: (body: BlobTokenBody, options: CallOptions = {}) => request<BlobTokenResponse>('POST', API.mediaToken, body, options),
  /** POST /api/upload/confirm: the server checks a finished Blob upload's bytes. */
  blobConfirm: (body: BlobConfirmBody, options: CallOptions = {}) => request<BlobConfirmResponse>('POST', API.mediaConfirm, body, options),
  /** The session route that streams a repository media file from the draft branch, for previews. */
  mediaFileHref: (src: string) => `${API.mediaFile}?${query({ src })}`,
};

export type AdminApi = typeof api;
