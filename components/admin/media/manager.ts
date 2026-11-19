/**
 * The upload queue (ARCHITECTURE.md 13A: many files at once, a progress bar per file, type
 * detection from the bytes, poster capture; docs/V3_PLAN.md D-23 to D-27, D-30, R-19). One queue
 * serves the media library and every field's Upload action. Each dropped group (a file and its
 * companions, such as a .gltf with its .bin) becomes an item that moves through these stages:
 *
 *   queued > preparing > (confirm) > checking > ready > (exists) > storing > done
 *
 * - preparing: `prepareUploads` (lib/admin/convert) detects the type from the bytes and converts
 *   the file in the browser (WebP photos, one compressed GLB, posters, waveforms, text).
 * - confirm: a warning that needs the owner's click (HEVC video, metadata that stays, text the
 *   check cannot read, a name that looks like a resume) holds the item until the owner answers.
 * - checking: /api/check reads the file's name, its words, and its part names; a hit refuses it.
 * - ready, storing: the parts go to the repository (one commit per request) or, above 4 MB, from
 *   the browser to Vercel Blob with a single-use token, then /api/upload/confirm checks the bytes.
 * - exists: a name already in the folder waits for Replace or Keep both.
 * - done, refused, failed, canceled: finished. Failed and canceled items can be retried.
 *
 * Preparation and checks run one item at a time, so a large drop never holds several decoded
 * videos or models at once. Storing runs beside the next preparation, one request at a time, and
 * repository parts of the items that are ready go together while they fit one request: one
 * commit for many photos instead of one each (R-19: GitHub limits content-creating calls).
 *
 * A field's upload carries its place (./targets.ts): the queue follows it through every edit, so
 * the item's target names the field where it is now, and when the file is stored the place puts
 * it in with one edit of the store's current state (one undo step), whether or not the field is
 * on the page. A place that was removed meanwhile leaves the item unplaced with a note
 * ("unplaced:<id>"). The library's target ("library:<folder>") registers its applier instead
 * (`register`), which rewrites references after a Replace.
 *
 * Browser code with no React; the components reach it through ./services.tsx. Everything that
 * talks to the network or loads a converter comes in through `MediaServices`, so a test page can
 * run the queue against a stand-in.
 */
import {
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
  type Finding,
  type MediaDeleteResponse,
  type MediaFoldersResponse,
  type MediaItem,
  type MediaListResponse,
  type MediaReferencesResponse,
  type MediaRenameResponse,
  type StatusResponse,
  type UploadResponse,
} from '@/lib/admin/contract';
import type { FileGroup, PreparedPart, PreparedUpload, PrepareUploads, UploadKind } from '@/lib/admin/convert/types';
import type { MediaRef } from '@/lib/types';
import { uploadBodySize, type CallOptions, type UploadFile, type UploadProgress } from '../state/api';
import {
  acceptRefusal,
  checkBodies,
  checkItemsFor,
  extensionOfName,
  freeName,
  freeNames,
  isRefusalCode,
  mediaRefFromUpload,
  planStorage,
  predictedName,
  replaceRefusal,
  resumeWarning,
  STAGE_WORDS,
  uniqueFindings,
  type Accept,
  type StoragePlan,
} from './logic';

// ---------------------------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------------------------

/** The routes the media library uses (the shapes of `api` in components/admin/state/api.ts). */
export interface MediaApi {
  status(options?: CallOptions): Promise<ApiResult<StatusResponse>>;
  check(body: CheckBody, options?: CallOptions): Promise<ApiResult<CheckResponse>>;
  uploadRepo(
    folder: string,
    files: readonly UploadFile[],
    replace: boolean,
    onProgress?: (progress: UploadProgress) => void,
    options?: CallOptions,
  ): Promise<ApiResult<UploadResponse>>;
  blobToken(body: BlobTokenBody, options?: CallOptions): Promise<ApiResult<BlobTokenResponse>>;
  blobConfirm(body: BlobConfirmBody, options?: CallOptions): Promise<ApiResult<BlobConfirmResponse>>;
  mediaList(folder: string, refs?: boolean, options?: CallOptions): Promise<ApiResult<MediaListResponse>>;
  mediaDelete(src: string, options?: CallOptions): Promise<ApiResult<MediaDeleteResponse>>;
  mediaRename(src: string, name: string, options?: CallOptions): Promise<ApiResult<MediaRenameResponse>>;
  mediaReferences(src: string, options?: CallOptions): Promise<ApiResult<MediaReferencesResponse>>;
  /** GET /api/upload?folders=1: every media folder, with the saved project that names it (or none). */
  mediaFolders(options?: CallOptions): Promise<ApiResult<MediaFoldersResponse>>;
  content(options?: CallOptions): Promise<ApiResult<ContentResponse>>;
  mediaFileHref(src: string): string;
}

/** The options of `put` from @vercel/blob/client that a browser upload uses. */
export interface BlobPutOptions {
  access: 'public';
  token: string;
  multipart: boolean;
  contentType: string;
  abortSignal: AbortSignal;
  onUploadProgress: (event: { loaded: number; total: number; percentage: number }) => void;
}

export interface MediaServices {
  api: MediaApi;
  /** Loads `prepareUploads` (a dynamic import, so no converter is in the admin's first load). */
  loadPrepare: () => Promise<PrepareUploads>;
  /** Loads `groupFiles`, which puts a model's companions with it. */
  loadGroup: () => Promise<(files: readonly File[]) => Promise<FileGroup[]>>;
  /** A browser upload to Vercel Blob (`put` from @vercel/blob/client, loaded when first used). */
  putBlob: (pathname: string, body: Blob, options: BlobPutOptions) => Promise<{ url: string }>;
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

export type ItemStage =
  | 'queued'
  | 'preparing'
  | 'confirm'
  | 'checking'
  | 'ready'
  | 'exists'
  | 'storing'
  | 'done'
  | 'refused'
  | 'failed'
  | 'canceled';

/** True once an item needs nothing more from the queue. */
export function isFinished(stage: ItemStage): boolean {
  return stage === 'done' || stage === 'refused' || stage === 'failed' || stage === 'canceled';
}

/** A stored upload: what the target receives. */
export interface StoredUpload {
  kind: UploadKind;
  mediaKind: MediaRef['kind'] | null;
  main: MediaItem;
  poster: MediaItem | null;
  /** The MediaRef it becomes (null for captions, office files, and other downloads). */
  ref: MediaRef | null;
}

export interface ApplyOutcome {
  applied: boolean;
  /** A sentence shown on the finished item: where the file went, or why it was not placed. */
  note?: string | null;
}

/** What a target does with a stored upload: a field sets itself, the library rewrites references after Replace. */
export type Applier = (result: StoredUpload, item: QueueItem) => ApplyOutcome;

/**
 * A target that moves: a field's place in the content (./targets.ts), followed through every edit
 * until its upload is stored.
 */
export interface MovingTarget {
  /** The target's name now, or null while it is gone (its block or row was removed). */
  name(): string | null;
  /** Calls `moved` whenever the name changes; returns the function that stops following. */
  follow(moved: (name: string | null) => void): () => void;
  /** Puts a stored upload in place. */
  apply: Applier;
}

/** The target of an item whose field was removed: no field shows it, and its folder's library does. */
export const UNPLACED = 'unplaced:';

export function isUnplaced(item: Pick<QueueItem, 'target'>): boolean {
  return item.target.startsWith(UNPLACED);
}

export interface QueueItem {
  readonly id: string;
  /**
   * Where the result goes: a field's place where it is now ("field:<scope>#<path>", "list:...",
   * "captions:...", "filepick:..."; see ./targets.ts), "unplaced:<id>" once that place is gone, or
   * "library:<folder>".
   */
  readonly target: string;
  readonly folder: string;
  /** The main file's name as dropped. */
  readonly name: string;
  /** The bytes dropped: the main file and its companions. */
  readonly size: number;
  readonly companions: number;
  readonly accept: Accept;
  /** The library file this upload replaces. */
  readonly replaceOf: MediaItem | null;
  kind: UploadKind | null;
  stage: ItemStage;
  /** The current step in plain words. */
  stageText: string;
  /** 0 to 1 within the current step, or null when not known. */
  fraction: number | null;
  warnings: PreparedUpload['warnings'];
  /** Content-check findings that refused the file. */
  findings: Finding[];
  /** Why the item was refused or failed, or what went wrong with its poster. */
  message: string | null;
  retryable: boolean;
  result: StoredUpload | null;
  applied: boolean;
  note: string | null;
  /** The size of the file to store, after conversion. */
  storedSize: number | null;
  meta: PreparedUpload['meta'] | null;
}

export interface AddOptions {
  /** The target's name: "library:<folder>", or a field's name when `place` is not given. */
  target: string;
  folder: string;
  accept: Accept;
  replaceOf?: MediaItem | null;
  /** A field's place: the items follow it, and it puts each stored file in place. */
  place?: MovingTarget | null;
}

interface Work {
  files: File[];
  next: 'prepare' | 'check' | 'store';
  prepared: PreparedUpload | null;
  /** A warning asks the owner before the file goes on (HEVC, unreadable text, a resume-like name). */
  asks: boolean;
  confirmed: boolean;
  /** The applier the item carries (a field's place), else the target's registered one. */
  apply: Applier | null;
  /** Stops following the field's place. */
  unfollow: (() => void) | null;
  plan: StoragePlan | null;
  /** Repository requests still to send for this item. */
  pendingRepo: PreparedPart[][];
  stored: { main: MediaItem | null; poster: MediaItem | null };
  /** Names chosen for "keep both" or Replace, by role. */
  names: { main: string; poster: string | null } | null;
  /** Overwrite a file of the same name (the owner chose Replace). */
  replace: boolean;
  /** Pick a free name without asking (a library Replace that becomes a new file). */
  autoRename: boolean;
  /** Send alone, not in a batch (after a batch failed, or with Replace). */
  solo: boolean;
  canceled: boolean;
  controller: AbortController | null;
  posterProblem: string | null;
  /** Name collisions the server reported after a free name was picked; the queue stops trying after a few. */
  collisions: number;
}

/** At most this many items share one repository request. */
const MAX_BATCH_ITEMS = 20;
/** Progress repaints at most this often. */
const PROGRESS_EMIT_MS = 100;
/** A finished item with nothing to read leaves the list after this long. */
const DONE_LINGER_MS = 6000;

const CHECK_REFUSED = 'The content check refused this file. Each finding names the rule and the part of the file it found.';

function detailOf(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'no reason was given';
  return clean.length > 200 ? `${clean.slice(0, 197)}...` : clean;
}

// ---------------------------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------------------------

export class UploadManager {
  readonly api: MediaApi;
  private readonly services: MediaServices;
  private items: QueueItem[] = [];
  private published: readonly QueueItem[] = [];
  private readonly work = new Map<string, Work>();
  private readonly listeners = new Set<() => void>();
  private readonly appliers = new Map<string, Applier>();
  private readonly commitListeners = new Set<(commit: string) => void>();
  private readonly folderNames = new Map<string, Promise<Set<string>>>();
  private readonly versions = new Map<string, number>();
  /** Local object addresses of files stored in this session, by their stored address (D-17). */
  private readonly previews = new Map<string, string>();
  private statusRequest: Promise<StatusResponse | null> | null = null;
  private prepareBusy = false;
  private storeBusy = false;
  private counter = 0;
  private microtask = false;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(services: MediaServices) {
    this.services = services;
    this.api = services.api;
  }

  // ---- subscription (useSyncExternalStore)

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): readonly QueueItem[] => this.published;

  private publish(): void {
    if (this.progressTimer !== null) {
      clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
    this.published = this.items;
    for (const listener of [...this.listeners]) listener();
  }

  /** Tells the subscribers after the current burst of changes. */
  private emit(): void {
    if (this.microtask) return;
    this.microtask = true;
    queueMicrotask(() => {
      this.microtask = false;
      this.publish();
    });
  }

  /** Progress changes repaint at most every PROGRESS_EMIT_MS. */
  private emitSoon(): void {
    if (this.progressTimer !== null || this.microtask) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      this.publish();
    }, PROGRESS_EMIT_MS);
  }

  private get(id: string): QueueItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  private patch(id: string, patch: Partial<QueueItem>, soon = false): void {
    let found = false;
    this.items = this.items.map((item) => {
      if (item.id !== id) return item;
      found = true;
      return { ...item, ...patch };
    });
    if (!found) return;
    if (soon) this.emitSoon();
    else this.emit();
  }

  // ---- folders: versions for the library list, names for collisions

  /** Changes whenever a file in the folder was stored, deleted, or renamed: the library lists it again. */
  version(folder: string): number {
    return this.versions.get(folder) ?? 0;
  }

  /** Marks a folder as changed (the library calls it after a delete or a rename). */
  invalidateFolder(folder: string): void {
    this.folderNames.delete(folder);
    this.versions.set(folder, this.version(folder) + 1);
    this.emit();
  }

  /** Lower-case names of the folder's repository files, listed once and kept up to date. */
  private namesOf(folder: string): Promise<Set<string>> {
    let names = this.folderNames.get(folder);
    if (!names) {
      names = this.api.mediaList(folder).then(
        (answer) => (isApiError(answer) ? new Set<string>() : new Set(answer.files.filter((f) => f.store === 'repo').map((f) => f.name.toLowerCase()))),
        () => new Set<string>(),
      );
      this.folderNames.set(folder, names);
    }
    return names;
  }

  // ---- storage status

  /** /api/status, asked once; null when it could not be read (the server then decides). */
  storageStatus(): Promise<StatusResponse | null> {
    if (!this.statusRequest) {
      const request = this.api.status({ quiet: true }).then(
        (answer) => {
          if (!isApiError(answer)) return answer;
          if (this.statusRequest === request) this.statusRequest = null;
          return null;
        },
        () => {
          if (this.statusRequest === request) this.statusRequest = null;
          return null;
        },
      );
      this.statusRequest = request;
    }
    return this.statusRequest;
  }

  async blobConfigured(): Promise<boolean | null> {
    const status = await this.storageStatus();
    return status ? status.storage.blob.configured : null;
  }

  // ---- local previews (D-17: a new upload shows at once, from a local object address)

  /** The local object address of a file stored in this session, or undefined. */
  previewOf(src: string): string | undefined {
    return this.previews.get(src);
  }

  /** Changes whenever a local preview is added, so thumbnails re-render only then. */
  readonly previewVersion = (): number => this.previewCount;

  private previewCount = 0;

  private setPreview(src: string, blob: Blob): void {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    const old = this.previews.get(src);
    if (old) URL.revokeObjectURL(old);
    this.previews.set(src, URL.createObjectURL(blob));
    this.previewCount += 1;
  }

  // ---- targets and commits

  /** Registers what a target does with its stored uploads; returns the unregister function. */
  register(target: string, applier: Applier): () => void {
    this.appliers.set(target, applier);
    return () => {
      if (this.appliers.get(target) === applier) this.appliers.delete(target);
    };
  }

  /** Listens for commits made by uploads, so the save bar can count unpublished commits. */
  onCommit(listener: (commit: string) => void): () => void {
    this.commitListeners.add(listener);
    return () => {
      this.commitListeners.delete(listener);
    };
  }

  /** Tells the commit listeners (the library also calls it after a delete or a rename). */
  noteCommit(commit: string | null | undefined): void {
    if (!commit) return;
    for (const listener of [...this.commitListeners]) listener(commit);
  }

  // ---- adding files

  /** Adds dropped files: each group (a file and its companions) becomes one item. */
  async add(files: readonly File[], options: AddOptions): Promise<void> {
    if (files.length === 0) return;
    let groups: FileGroup[];
    try {
      const group = await this.services.loadGroup();
      groups = await group(files);
    } catch {
      groups = files.map((main) => ({ main, companions: [] }));
    }
    const place = options.place ?? null;
    const added: QueueItem[] = [];
    for (const group of groups) {
      const id = `u${(this.counter += 1)}`;
      const all = [group.main, ...group.companions];
      this.work.set(id, {
        files: all,
        next: 'prepare',
        prepared: null,
        asks: false,
        confirmed: false,
        apply: place ? place.apply : null,
        unfollow: null,
        plan: null,
        pendingRepo: [],
        stored: { main: null, poster: null },
        names: null,
        replace: false,
        autoRename: false,
        solo: false,
        canceled: false,
        controller: null,
        posterProblem: null,
        collisions: 0,
      });
      added.push({
        id,
        target: place ? (place.name() ?? `${UNPLACED}${id}`) : options.target,
        folder: options.folder,
        name: group.main.name,
        size: all.reduce((sum, file) => sum + file.size, 0),
        companions: group.companions.length,
        accept: options.accept,
        replaceOf: options.replaceOf ?? null,
        kind: null,
        stage: 'queued',
        stageText: 'Waiting',
        fraction: null,
        warnings: [],
        findings: [],
        message: null,
        retryable: false,
        result: null,
        applied: false,
        note: null,
        storedSize: null,
        meta: null,
      });
    }
    this.items = [...this.items, ...added];
    if (place) {
      for (const item of added) {
        const work = this.work.get(item.id);
        if (work) work.unfollow = place.follow((name) => this.patch(item.id, { target: name ?? `${UNPLACED}${item.id}` }));
      }
    }
    this.emit();
    this.kick();
  }

  /** Stops following an item's place: it is placed, refused, or gone from the list. */
  private release(id: string): void {
    const work = this.work.get(id);
    if (!work?.unfollow) return;
    work.unfollow();
    work.unfollow = null;
  }

  private kick(): void {
    void this.prepareLoop();
    void this.storeLoop();
  }

  // ---- the owner's answers

  /** Stops an item. A running step is aborted; a stored Blob file stays (the library lists it as unused). */
  cancel(id: string): void {
    const item = this.get(id);
    const work = this.work.get(id);
    if (!item || !work || isFinished(item.stage)) return;
    work.canceled = true;
    if (work.controller) work.controller.abort();
    else this.markCanceled(id);
  }

  /** Starts a failed or canceled item again from the step it stopped at. */
  retry(id: string): void {
    const item = this.get(id);
    const work = this.work.get(id);
    if (!item || !work || (item.stage !== 'failed' && item.stage !== 'canceled')) return;
    if (work.files.length === 0 && !work.prepared) return;
    work.canceled = false;
    work.collisions = 0;
    this.patch(id, {
      stage: work.next === 'store' ? 'ready' : 'queued',
      stageText: 'Waiting',
      fraction: null,
      message: null,
      findings: [],
      retryable: false,
    });
    this.kick();
  }

  /** The owner accepted the warnings that needed a click. */
  confirm(id: string): void {
    const item = this.get(id);
    const work = this.work.get(id);
    if (!item || !work || item.stage !== 'confirm') return;
    work.confirmed = true;
    work.next = 'check';
    this.patch(id, { stage: 'queued', stageText: 'Waiting', fraction: null });
    this.kick();
  }

  /** A name collision: overwrite the file of the same name. */
  replace(id: string): void {
    const item = this.get(id);
    const work = this.work.get(id);
    if (!item || !work || item.stage !== 'exists') return;
    work.replace = true;
    work.solo = true;
    this.patch(id, { stage: 'ready', stageText: 'Waiting to upload', fraction: null, message: null });
    this.kick();
  }

  /** A name collision: store the new file under a free name (`photo-2.webp`). */
  async keepBoth(id: string): Promise<void> {
    const item = this.get(id);
    const work = this.work.get(id);
    if (!item || !work || item.stage !== 'exists' || !work.prepared) return;
    const main = work.prepared.parts.find((part) => part.role === 'main');
    const poster = work.prepared.parts.find((part) => part.role === 'poster') ?? null;
    if (!main) return;
    const taken = await this.namesOf(item.folder);
    work.names = freeNames(work.names?.main ?? main.name, work.names?.poster ?? poster?.name ?? null, taken);
    work.autoRename = true;
    this.patch(id, { stage: 'ready', stageText: 'Waiting to upload', fraction: null, message: null });
    this.kick();
  }

  /** The applier for an item: the one its field's place carries, else its target's registered one. */
  private applierOf(item: QueueItem): Applier | undefined {
    return this.work.get(item.id)?.apply ?? this.appliers.get(item.target);
  }

  /** Runs the applier again for a stored upload that was not placed ("Use this file"). */
  applyPending(id: string): void {
    const item = this.get(id);
    if (!item || item.stage !== 'done' || !item.result || item.applied) return;
    const applier = this.applierOf(item);
    if (!applier) return;
    const outcome = this.runApplier(applier, item.result, item);
    if (outcome.applied) this.release(id);
    this.patch(id, { applied: outcome.applied, note: outcome.note ?? null });
  }

  /** Removes a finished item from the list. */
  dismiss(id: string): void {
    const item = this.get(id);
    if (!item || !isFinished(item.stage)) return;
    this.release(id);
    this.items = this.items.filter((other) => other.id !== id);
    this.work.delete(id);
    this.emit();
  }

  /** Removes every finished item that `match` selects. */
  clearFinished(match: (item: QueueItem) => boolean): void {
    const gone = this.items.filter((item) => isFinished(item.stage) && match(item)).map((item) => item.id);
    if (gone.length === 0) return;
    for (const id of gone) {
      this.release(id);
      this.work.delete(id);
    }
    this.items = this.items.filter((item) => !gone.includes(item.id));
    this.emit();
  }

  // ---- endings

  private markCanceled(id: string): void {
    this.patch(id, { stage: 'canceled', stageText: 'Cancelled', fraction: null, message: null, retryable: true });
  }

  private refuse(id: string, message: string, findings: Finding[] = []): void {
    // A refused file cannot be tried again as it is, so its bytes are let go at once.
    const work = this.work.get(id);
    if (work) {
      work.files = [];
      if (work.prepared) work.prepared = { ...work.prepared, parts: [] };
      work.pendingRepo = [];
    }
    this.release(id);
    this.patch(id, { stage: 'refused', stageText: 'Refused', fraction: null, message, findings, retryable: false });
  }

  private fail(id: string, message: string, findings: Finding[] = []): void {
    this.patch(id, { stage: 'failed', stageText: 'Failed', fraction: null, message, findings, retryable: true });
  }

  /** An API error as a refusal (the file or the request as it is cannot pass) or a failure (try again). */
  private failFromApi(id: string, answer: ApiError): void {
    if (isRefusalCode(answer.code)) this.refuse(id, answer.error, answer.findings ?? []);
    else this.fail(id, answer.error, answer.findings ?? []);
  }

  // ---- preparation and the content check (one item at a time)

  private async prepareLoop(): Promise<void> {
    if (this.prepareBusy) return;
    this.prepareBusy = true;
    try {
      for (;;) {
        const item = this.items.find((candidate) => candidate.stage === 'queued');
        if (!item) break;
        await this.prepareOne(item.id);
      }
    } finally {
      this.prepareBusy = false;
    }
  }

  private async prepareOne(id: string): Promise<void> {
    const work = this.work.get(id);
    if (!work) return;
    const controller = new AbortController();
    work.controller = controller;
    const { signal } = controller;
    try {
      if (work.next === 'prepare') {
        this.patch(id, { stage: 'preparing', stageText: STAGE_WORDS.detect, fraction: null });
        const prepare = await this.services.loadPrepare();
        if (signal.aborted) throw signal.reason;
        const { prepared, failed } = await prepare(work.files, {
          signal,
          onProgress: (progress) => {
            this.patch(id, { stageText: STAGE_WORDS[progress.stage] ?? 'Preparing', fraction: progress.fraction ?? null }, true);
          },
        });
        if (signal.aborted) throw signal.reason;
        const upload = prepared[0];
        if (!upload) {
          this.fail(id, failed[0]?.message ?? 'This file could not be prepared for upload.');
          return;
        }
        const item = this.get(id);
        if (!item) return;
        work.prepared = upload;
        const main = upload.parts.find((part) => part.role === 'main');
        // D-22: no resume file is ever served, so a file named like one asks first.
        const resume = resumeWarning([item.name, main?.name ?? '']);
        const warnings = resume ? [...upload.warnings, resume] : upload.warnings;
        this.patch(id, { kind: upload.kind, warnings, meta: upload.meta, storedSize: main?.blob.size ?? null });
        const refusal = acceptRefusal(item.accept, upload) ?? (item.replaceOf ? replaceRefusal(item.replaceOf, upload) : null);
        if (refusal) {
          this.refuse(id, refusal);
          return;
        }
        work.next = 'check';
        work.asks = warnings.some((warning) => warning.confirm);
      }

      if (work.next === 'check') {
        // A question waits for its answer, after a Cancel and Retry too.
        if (work.asks && !work.confirmed) {
          this.patch(id, { stage: 'confirm', stageText: 'Waiting for your answer', fraction: null });
          return;
        }
        const item = this.get(id);
        const prepared = work.prepared;
        if (!item || !prepared) return;
        this.patch(id, { stage: 'checking', stageText: 'Running the content check', fraction: null });
        const findings: Finding[] = [];
        for (const body of checkBodies(item.name, checkItemsFor(item.name, prepared))) {
          const answer = await this.api.check(body, { signal });
          if (signal.aborted) throw signal.reason;
          if (isApiError(answer)) {
            this.failFromApi(id, answer);
            return;
          }
          findings.push(...answer.findings);
        }
        if (findings.length > 0) {
          this.refuse(id, CHECK_REFUSED, uniqueFindings(findings));
          return;
        }
        const decision = planStorage(prepared.parts, { blobConfigured: await this.blobConfigured() });
        if (signal.aborted) throw signal.reason;
        if (!decision.ok) {
          this.refuse(id, decision.message);
          return;
        }
        work.plan = decision.plan;
        work.pendingRepo = decision.plan.repo.map((chunk) => [...chunk]);
        this.planReplace(item, work);
        work.next = 'store';
        this.patch(id, { stage: 'ready', stageText: 'Waiting to upload', fraction: null });
        void this.storeLoop();
      }
    } catch (error) {
      if (signal.aborted || work.canceled) this.markCanceled(id);
      else this.fail(id, `This file could not be prepared for upload (${detailOf(error)}).`);
    } finally {
      if (work.controller === controller) work.controller = null;
    }
  }

  /**
   * A library Replace: a repository file of the same type is overwritten under its own name (its
   * address stays, so nothing in content changes); anything else becomes a new file, and the
   * library points the references at it.
   */
  private planReplace(item: QueueItem, work: Work): void {
    const old = item.replaceOf;
    const prepared = work.prepared;
    const plan = work.plan;
    if (!old || !prepared || !plan) return;
    const main = prepared.parts.find((part) => part.role === 'main');
    const poster = prepared.parts.find((part) => part.role === 'poster') ?? null;
    if (old.store === 'repo' && !plan.blob && main && extensionOfName(main.name) === extensionOfName(old.name)) {
      const base = old.name.slice(0, old.name.length - extensionOfName(old.name).length - 1);
      work.names = { main: old.name, poster: poster ? `${base}-poster.webp` : null };
      work.replace = true;
      work.solo = true;
    } else {
      work.autoRename = true;
    }
  }

  // ---- storing (one request at a time, beside the preparation)

  private async storeLoop(): Promise<void> {
    if (this.storeBusy) return;
    this.storeBusy = true;
    try {
      for (;;) {
        const item = this.items.find((candidate) => candidate.stage === 'ready');
        if (!item) break;
        const work = this.work.get(item.id);
        if (!work || !work.plan) {
          this.fail(item.id, 'This upload lost its prepared file. Add the file again.');
          continue;
        }
        if (work.plan.blob && !work.stored.main) await this.storeBlob(item.id);
        else await this.storeRepo(item.id);
      }
    } finally {
      this.storeBusy = false;
    }
  }

  /** The names this item's next repository request uses; false when its main name is taken and the owner must choose. */
  private resolveNames(item: QueueItem, work: Work, taken: Set<string>): boolean {
    const prepared = work.prepared;
    if (!prepared || work.pendingRepo.length === 0) return true;
    if (work.replace) return true;
    const main = prepared.parts.find((part) => part.role === 'main');
    const poster = prepared.parts.find((part) => part.role === 'poster') ?? null;
    if (!main) return true;
    const roles = new Set(work.pendingRepo[0].map((part) => part.role));
    let mainName = work.names?.main ?? main.name;
    let posterName = work.names?.poster ?? poster?.name ?? null;
    if (roles.has('main')) {
      const predicted = predictedName(mainName);
      if (predicted && taken.has(predicted.toLowerCase())) {
        if (!work.autoRename) {
          this.patch(item.id, {
            stage: 'exists',
            stageText: 'The name is taken',
            fraction: null,
            message: `A file named "${predicted}" is already in this folder. Replace it, or keep both and store the new file under a new name.`,
          });
          return false;
        }
        const free = freeNames(mainName, posterName, taken);
        mainName = free.main;
        posterName = free.poster;
        work.names = free;
      }
    }
    if (roles.has('poster') && posterName) {
      const predicted = predictedName(posterName);
      if (predicted && taken.has(predicted.toLowerCase())) {
        // A poster never asks: it is only ever this file's poster, so it takes a free name.
        work.names = { main: mainName, poster: freeName(posterName, taken) };
      }
    }
    return true;
  }

  private nameOfPart(work: Work, part: PreparedPart): string {
    if (part.role === 'main') return work.names?.main ?? part.name;
    return work.names?.poster ?? part.name;
  }

  /** One repository request: this item's next parts, and those of other ready items while they fit. */
  private async storeRepo(firstId: string): Promise<void> {
    const first = this.get(firstId);
    const firstWork = this.work.get(firstId);
    if (!first || !firstWork) return;
    if (firstWork.pendingRepo.length === 0) {
      this.finish(firstId);
      return;
    }
    const folder = first.folder;
    const taken = await this.namesOf(folder);

    const candidates =
      firstWork.solo || firstWork.replace
        ? [first]
        : this.items.filter((item) => {
            if (item.stage !== 'ready' || item.folder !== folder) return false;
            const work = this.work.get(item.id);
            return !!work && !work.solo && !work.replace && work.pendingRepo.length > 0 && !(work.plan?.blob && !work.stored.main);
          });

    const batch: string[] = [];
    let parts: { id: string; part: PreparedPart; name: string }[] = [];
    for (const item of candidates) {
      if (batch.length >= MAX_BATCH_ITEMS) break;
      const work = this.work.get(item.id);
      if (!work || this.get(item.id)?.stage !== 'ready') continue;
      if (!this.resolveNames(item, work, taken)) continue;
      const chunk = work.pendingRepo[0].map((part) => ({ id: item.id, part, name: this.nameOfPart(work, part) }));
      const trial = [...parts, ...chunk];
      if (batch.length > 0 && uploadBodySize(trial.map((entry) => ({ name: entry.name, blob: entry.part.blob }))) > MAX_REPO_UPLOAD_BODY_BYTES) continue;
      parts = trial;
      batch.push(item.id);
    }
    if (batch.length === 0) return;

    const controller = new AbortController();
    for (const id of batch) {
      const work = this.work.get(id);
      if (work) work.controller = controller;
      this.patch(id, { stage: 'storing', stageText: 'Uploading to the repository', fraction: 0 });
    }

    // Each item's share of the request body, so each gets its own progress bar.
    const ranges = new Map<string, { start: number; end: number }>();
    let offset = 1024;
    for (const entry of parts) {
      offset += 512 + entry.name.length * 2;
      const range = ranges.get(entry.id) ?? { start: offset, end: offset };
      range.end = offset + entry.part.blob.size;
      ranges.set(entry.id, range);
      offset += entry.part.blob.size;
    }
    const modelTotal = offset;
    const replace = batch.length === 1 && (this.work.get(batch[0])?.replace ?? false);

    const answer = await this.api.uploadRepo(
      folder,
      parts.map((entry) => ({ name: entry.name, blob: entry.part.blob })),
      replace,
      (progress) => {
        const scale = progress.total > 0 ? modelTotal / progress.total : 1;
        const loaded = progress.loaded * scale;
        for (const id of batch) {
          const range = ranges.get(id);
          if (!range) continue;
          const span = Math.max(1, range.end - range.start);
          this.patch(id, { fraction: Math.min(1, Math.max(0, (loaded - range.start) / span)) }, true);
        }
      },
      { signal: controller.signal },
    );

    for (const id of batch) {
      const work = this.work.get(id);
      if (work && work.controller === controller) work.controller = null;
    }

    if (controller.signal.aborted) {
      for (const id of batch) {
        const work = this.work.get(id);
        if (work?.canceled) this.markCanceled(id);
        else this.patch(id, { stage: 'ready', stageText: 'Waiting to upload', fraction: null });
      }
      return;
    }

    if (isApiError(answer)) {
      if (answer.code === 'exists') this.folderNames.delete(folder);
      if (batch.length > 1) {
        // Send each one alone, so the refusal lands on the file it is about.
        for (const id of batch) {
          const work = this.work.get(id);
          if (work) work.solo = true;
          this.patch(id, { stage: 'ready', stageText: 'Waiting to upload', fraction: null });
        }
        return;
      }
      const id = batch[0];
      const work = this.work.get(id);
      if (answer.code === 'exists' && work && !work.replace) {
        work.collisions += 1;
        if (work.autoRename && work.collisions < 3) {
          // The folder changed since it was listed: list it again and pick another free name.
          this.patch(id, { stage: 'ready', stageText: 'Waiting to upload', fraction: null });
          return;
        }
        if (work.autoRename) {
          this.failFromApi(id, answer);
          return;
        }
        this.patch(id, { stage: 'exists', stageText: 'The name is taken', fraction: null, message: answer.error });
        return;
      }
      if (work && work.stored.main) {
        // The file itself is stored (in Blob, or in an earlier request); only its poster failed.
        work.posterProblem = answer.error;
        work.pendingRepo = [];
        this.finish(id);
        return;
      }
      this.failFromApi(id, answer);
      return;
    }

    let k = 0;
    const stored: string[] = [];
    for (const id of batch) {
      const work = this.work.get(id);
      if (!work) continue;
      const chunk = work.pendingRepo.shift() ?? [];
      for (const part of chunk) {
        const file = answer.files[k];
        k += 1;
        if (!file) continue;
        stored.push(file.name.toLowerCase());
        if (part.role === 'main') work.stored.main = file;
        else work.stored.poster = file;
      }
      if (work.pendingRepo.length > 0) this.patch(id, { stage: 'ready', stageText: 'Uploading the poster', fraction: null });
      else this.finish(id);
    }
    for (const name of stored) taken.add(name);
    this.noteCommit(answer.commit);
    this.invalidateVersion(folder);
  }

  private invalidateVersion(folder: string): void {
    this.versions.set(folder, this.version(folder) + 1);
    this.emit();
  }

  /** The main file from the browser to Vercel Blob: a single-use token, the upload, then the server's check. */
  private async storeBlob(id: string): Promise<void> {
    const item = this.get(id);
    const work = this.work.get(id);
    const main = work?.plan?.blob;
    if (!item || !work || !main) return;
    const controller = new AbortController();
    work.controller = controller;
    const { signal } = controller;
    this.patch(id, { stage: 'storing', stageText: 'Uploading to Vercel Blob', fraction: 0 });
    try {
      const token = await this.api.blobToken({ folder: item.folder, name: main.name, size: main.blob.size, contentType: main.contentType }, { signal });
      if (signal.aborted) throw signal.reason;
      if (isApiError(token)) {
        this.failFromApi(id, token);
        return;
      }
      const put = await this.services.putBlob(token.pathname, main.blob, {
        access: 'public',
        token: token.clientToken,
        multipart: token.multipart,
        contentType: main.contentType,
        abortSignal: signal,
        onUploadProgress: (event) => {
          const fraction = event.total > 0 ? event.loaded / event.total : event.percentage / 100;
          this.patch(id, { fraction: Math.min(1, Math.max(0, fraction)) }, true);
        },
      });
      if (signal.aborted) throw signal.reason;
      this.patch(id, { stageText: 'Checking the stored file', fraction: null });
      const confirmed = await this.api.blobConfirm({ pathname: token.pathname, url: put.url, ticket: token.ticket }, { signal });
      if (signal.aborted) throw signal.reason;
      if (isApiError(confirmed)) {
        this.failFromApi(id, confirmed);
        return;
      }
      work.stored.main = confirmed.file;
      this.invalidateVersion(item.folder);
      if (work.pendingRepo.length > 0) this.patch(id, { stage: 'ready', stageText: 'Uploading the poster', fraction: null });
      else this.finish(id);
    } catch (error) {
      if (signal.aborted || work.canceled) this.markCanceled(id);
      else this.fail(id, `The upload to Vercel Blob did not finish (${detailOf(error)}). Try again.`);
    } finally {
      if (work.controller === controller) work.controller = null;
    }
  }

  private runApplier(applier: Applier, result: StoredUpload, item: QueueItem): ApplyOutcome {
    try {
      return applier(result, item);
    } catch (error) {
      return { applied: false, note: `The file is stored, but it could not be placed (${detailOf(error)}).` };
    }
  }

  /** Every part is stored: build the result, hand it to the target, and let the memory go. */
  private finish(id: string): void {
    const item = this.get(id);
    const work = this.work.get(id);
    const prepared = work?.prepared;
    const main = work?.stored.main;
    if (!item || !work || !prepared || !main) {
      if (item) this.fail(id, 'The upload finished without a stored file. Try again.');
      return;
    }
    const poster = work.stored.poster;
    const mainPart = prepared.parts.find((part) => part.role === 'main');
    const posterPart = prepared.parts.find((part) => part.role === 'poster');
    if (mainPart && prepared.mediaKind === 'image') this.setPreview(main.src, mainPart.blob);
    if (posterPart && poster) this.setPreview(poster.src, posterPart.blob);

    const result: StoredUpload = {
      kind: prepared.kind,
      mediaKind: prepared.mediaKind,
      main,
      poster,
      ref: mediaRefFromUpload(prepared, { main, poster }),
    };
    const applier = this.applierOf(item);
    let outcome: ApplyOutcome;
    if (applier) outcome = this.runApplier(applier, result, item);
    else if (item.target.startsWith('library:') && !item.replaceOf) outcome = { applied: true };
    else outcome = { applied: false, note: 'Stored in the media library. It was not placed, because its editor was closed: open it again and choose Use this file.' };
    if (outcome.applied) this.release(id);

    // The converted bytes are not needed any more; a retry is not offered for a stored file.
    work.prepared = { ...prepared, parts: [] };
    work.files = [];
    work.pendingRepo = [];

    const posterMessage = work.posterProblem ? `The file is stored, but its poster could not be stored (${work.posterProblem}).` : null;
    this.patch(id, {
      stage: 'done',
      stageText: main.store === 'blob' ? 'Stored in Vercel Blob' : 'Stored in the repository',
      fraction: 1,
      result,
      applied: outcome.applied,
      note: outcome.note ?? null,
      message: posterMessage,
      retryable: false,
    });

    const finished = this.get(id);
    if (finished && finished.applied && !finished.note && !finished.message && finished.warnings.length === 0) {
      setTimeout(() => this.dismiss(id), DONE_LINGER_MS);
    }
  }
}
