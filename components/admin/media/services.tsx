'use client';

/**
 * How the media components reach the upload queue and the routes.
 *
 * The admin needs no setup: without a `MediaProvider`, every component shares one queue that uses
 * the real API client (components/admin/state/api.ts, with the sign-in-again retry) and loads the
 * converters and the Blob client with dynamic imports when a file first needs them, so none of
 * them is in the admin's first load. A test page wraps its components in a `MediaProvider` with
 * stand-in services instead.
 *
 * Hooks here: the queue items of a target or a folder, a target's applier, a field's target name,
 * the storage status, a folder's file list, whether a media folder exists yet, the display
 * address of a file, and the bridge that tells the save bar about upload commits.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { API, projectFileOf, type MediaFoldersResponse, type MediaItem, type StatusResponse } from '@/lib/admin/contract';
import { api, interpret, isApiError, isUnauthorized, NETWORK_ERROR, sessionGate, withReauth, type ApiResult, type CallOptions } from '../state/api';
import { useAdmin, useAdminStore, useScopeFile } from '../state/hooks';
import type { AdminState, AdminStore } from '../state/store';
import { UploadManager, type Applier, type BlobPutOptions, type MediaApi, type MediaServices, type QueueItem } from './manager';
import { scopeOfFile, targetName, type PlaceKind } from './targets';

/** Wraps a route call so a 401 waits for the sign-in dialog and tries once more (D-20). */
function reauthed<A extends unknown[], T>(call: (...args: A) => Promise<ApiResult<T>>): (...args: A) => Promise<ApiResult<T>> {
  return (...args: A) => withReauth(() => call(...args));
}

/**
 * GET /api/upload?folders=1 (MediaFoldersResponse), the way the API client calls a route: the
 * session cookie, no cache, the route's own error or one worked out from the status, and a 401
 * that opens the sign-in dialog unless `quiet`.
 */
async function mediaFolders(options: CallOptions = {}): Promise<ApiResult<MediaFoldersResponse>> {
  let res: Response;
  try {
    res = await fetch(`${API.media}?${new URLSearchParams({ folders: '1' }).toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: options.signal,
    });
  } catch {
    return { ok: false, code: 'server', error: options.signal?.aborted ? 'The request was cancelled.' : NETWORK_ERROR };
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    text = '';
  }
  const result = interpret<MediaFoldersResponse>(res.status, text, res.headers.get('retry-after'));
  if (res.status === 401 && isUnauthorized(result) && !options.quiet) sessionGate.notify();
  return result;
}

/** The real routes, each retried once after the owner signs in again. */
export const realMediaApi: MediaApi = {
  status: (options) => api.status({ ...options, quiet: true }),
  check: reauthed(api.check),
  uploadRepo: reauthed(api.uploadRepo),
  blobToken: reauthed(api.blobToken),
  blobConfirm: reauthed(api.blobConfirm),
  mediaList: reauthed(api.mediaList),
  mediaDelete: reauthed(api.mediaDelete),
  mediaRename: reauthed(api.mediaRename),
  mediaReferences: reauthed(api.mediaReferences),
  mediaFolders: reauthed(mediaFolders),
  content: reauthed(api.content),
  mediaFileHref: api.mediaFileHref,
};

/** The admin's services: the real routes, and every heavy module loaded only when used. */
export function realMediaServices(): MediaServices {
  return {
    api: realMediaApi,
    loadPrepare: () => import('@/lib/admin/convert').then((module) => module.prepareUploads),
    loadGroup: () => import('@/lib/admin/convert/group').then((module) => module.groupFiles),
    putBlob: async (pathname: string, body: Blob, options: BlobPutOptions) => {
      const { put } = await import('@vercel/blob/client');
      const result = await put(pathname, body, options);
      return { url: result.url };
    },
  };
}

const ManagerContext = createContext<UploadManager | null>(null);
let sharedManager: UploadManager | null = null;

/** Gives the components inside it their own queue with these services (a test page's stand-ins). */
export function MediaProvider({ services, children }: { services: MediaServices; children: ReactNode }) {
  const ref = useRef<UploadManager | null>(null);
  if (ref.current === null) ref.current = new UploadManager(services);
  return <ManagerContext.Provider value={ref.current}>{children}</ManagerContext.Provider>;
}

/** The queue of the nearest MediaProvider, or the admin's shared one. */
export function useMediaManager(): UploadManager {
  const fromContext = useContext(ManagerContext);
  if (fromContext) return fromContext;
  sharedManager ??= new UploadManager(realMediaServices());
  return sharedManager;
}

const NO_ITEMS: readonly QueueItem[] = [];

function sameItems(a: readonly QueueItem[], b: readonly QueueItem[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * The queue items that `match` selects (a field's targets, or a library folder). `key` names the
 * selection, since callers build `match` inline. The component re-renders only when its own items
 * change, not on every progress step of another field's upload.
 */
export function useQueueItems(match: (item: QueueItem) => boolean, key: string): readonly QueueItem[] {
  const manager = useMediaManager();
  const matchRef = useRef(match);
  matchRef.current = match;
  const cache = useRef<{ source: readonly QueueItem[]; key: string; value: readonly QueueItem[] } | null>(null);
  const getSnapshot = useCallback(() => {
    const source = manager.getSnapshot();
    const last = cache.current;
    if (last && last.source === source && last.key === key) return last.value;
    const next = source.filter((item) => matchRef.current(item));
    const value = last && sameItems(last.value, next) ? last.value : next.length === 0 ? NO_ITEMS : next;
    cache.current = { source, key, value };
    return value;
  }, [manager, key]);
  return useSyncExternalStore(manager.subscribe, getSnapshot, () => NO_ITEMS);
}

/**
 * Registers what a target does with its stored uploads while the component is on the page (the
 * library's Replace). The applier may change on every render; the queue always calls the latest
 * one. A field's upload carries its own place instead (./targets.ts).
 */
export function useUploadTarget(target: string, applier: Applier): void {
  const manager = useMediaManager();
  const ref = useRef(applier);
  ref.current = applier;
  useEffect(() => manager.register(target, (result, item) => ref.current(result, item)), [manager, target]);
}

/**
 * The queue's name of this field's place now ("field:<scope>#<path>"): the uploads whose place
 * is this field carry it, wherever the field was when they started (./targets.ts). The scope is
 * the project's entry key, so a slug rename keeps the name's content part.
 */
export function useTargetName(kind: PlaceKind, path: string): string {
  const file = useScopeFile();
  const scope = useAdmin((state) => scopeOfFile(state, file));
  return targetName(kind, scope ?? `file:${file}`, path);
}

const bridged = new WeakMap<UploadManager, WeakSet<AdminStore>>();

/**
 * Upload, delete, and rename commits land on the draft branch, so the save bar counts them as
 * unpublished. The head the editor loaded stays the save's base: a media commit touches no
 * content file, so the next save is not a conflict. One bridge per queue and store, however
 * many fields ask for it.
 */
export function useCommitBridge(): void {
  const manager = useMediaManager();
  const store = useAdminStore();
  useEffect(() => {
    let stores = bridged.get(manager);
    if (!stores) {
      stores = new WeakSet<AdminStore>();
      bridged.set(manager, stores);
    }
    if (stores.has(store)) return;
    stores.add(store);
    manager.onCommit(() => noteDraftCommit(store));
  }, [manager, store]);
}

/** One more unpublished commit on the draft branch (GitHub mode only; the disk has no branches). */
export function noteDraftCommit(store: AdminStore): void {
  const info = store.getState().info;
  if (!info || info.source !== 'github') return;
  store.setBranchInfo({ draftExists: true, draftAhead: info.draftAhead + 1 });
}

/** The storage status for the library's header and the upload routing: Blob connected, or not, or not known yet. */
export function useStorageStatus(): StatusResponse['storage'] | null {
  const manager = useMediaManager();
  const [storage, setStorage] = useState<StatusResponse['storage'] | null>(null);
  useEffect(() => {
    let live = true;
    void manager.storageStatus().then((status) => {
      if (live) setStorage(status ? status.storage : null);
    });
    return () => {
      live = false;
    };
  }, [manager]);
  return storage;
}

const savedFolders = new WeakMap<object, Map<string, boolean>>();

/**
 * True when the media folder exists on the server: "site" always; a project's folder once the
 * project is saved under that slug, or while saved content points into it (the folder a renamed
 * project's files stay in). The server refuses uploads to a folder that does not exist yet.
 * Worked out once per saved state, since every field asks on every edit.
 */
export function folderExists(state: Pick<AdminState, 'info'>, folder: string): boolean {
  if (folder === 'site' || !state.info) return true;
  const stored = state.info.stored;
  let known = savedFolders.get(stored);
  if (!known) {
    known = new Map();
    savedFolders.set(stored, known);
  }
  const cached = known.get(folder);
  if (cached !== undefined) return cached;
  const mark = `/media/${folder}/`;
  const exists = stored[projectFileOf(folder)] !== undefined || Object.values(stored).some((text) => text.includes(mark));
  known.set(folder, exists);
  return exists;
}

export function useFolderSaved(folder: string): boolean {
  return useAdmin((state) => folderExists(state, folder));
}

export interface MediaListState {
  files: MediaItem[] | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** A folder's files in both stores, listed again whenever the queue or the library changes the folder. */
export function useMediaList(folder: string, options: { refs?: boolean; enabled?: boolean } = {}): MediaListState {
  const { refs = false, enabled = true } = options;
  const manager = useMediaManager();
  const version = useSyncExternalStore(
    manager.subscribe,
    () => manager.version(folder),
    () => 0,
  );
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<MediaListState, 'refresh'>>({ files: null, error: null, loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState({ files: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));
    void manager.api.mediaList(folder, refs, { signal: controller.signal }).then((answer) => {
      if (controller.signal.aborted) return;
      if (isApiError(answer)) setState((current) => ({ files: current.files, error: answer.error, loading: false }));
      else setState({ files: answer.files, error: null, loading: false });
    });
    return () => controller.abort();
  }, [manager, folder, refs, enabled, version, nonce]);

  const refresh = useMemo(() => () => setNonce((n) => n + 1), []);
  return { ...state, refresh };
}

/**
 * Where the admin can show a stored file: the local object address of a file uploaded in this
 * session, the session route for a repository file (it may exist only on the draft branch,
 * D-17), or the https address of a Blob file. Null for an empty or unsafe address.
 */
export function displayAddress(manager: UploadManager, src: string | undefined | null): string | null {
  const value = (src ?? '').trim();
  if (value === '') return null;
  const local = manager.previewOf(value);
  if (local) return local;
  if (/^\/media\/[^/]+\/[^/]+$/.test(value)) return manager.api.mediaFileHref(value);
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export function useDisplayAddress(src: string | undefined | null): string | null {
  const manager = useMediaManager();
  // A new upload's local address appears when the queue finishes it; re-render only then.
  useSyncExternalStore(manager.subscribe, manager.previewVersion, () => 0);
  return displayAddress(manager, src);
}
