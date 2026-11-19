'use client';

/**
 * The media components' test page (`/dev-media`, development only). It renders MediaField,
 * MediaListField, FilePickField, and MediaLibraryPanel on a small stand-in project, with the
 * real upload queue and the real in-browser conversion (lib/admin/convert), but every route
 * answered by an in-memory stand-in: nothing reaches the server, the repository, public/, or
 * content/. Playwright drives it with setInputFiles and reads `window.__media`.
 *
 * window.__media:
 *   calls()          every route call: { route, detail }
 *   files()          the stand-in library: MediaItems
 *   doc()            the editor's working copy
 *   past()           how many undo steps there are
 *   setBlob(on)      Vercel Blob connected or not (starts a fresh queue)
 *   setDelay(ms)     how long each stand-in upload takes (with progress)
 *   setLiveRefs(src, refs)  references from the "published site" for a file
 *   blobClient()     loads @vercel/blob/client the way the admin does and reports `typeof put`
 *   save()           stores the working copy as the stand-in's saved draft (the editor is clean after)
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  isApiError,
  SITE_FILE,
  type ApiError,
  type ContentResponse,
  type ErrorCode,
  type Finding,
  type MediaItem,
  type Reference,
  type StatusResponse,
} from '@/lib/admin/contract';
import { sanitizeFileName } from '@/lib/storage/rules';
import type { MediaRef, Project, Site } from '@/lib/types';
import { UndoRedo } from '../../shell/UndoRedo';
import { AdminProvider, FileScope, useAdmin, useAdminStore } from '../../state/hooks';
import type { Doc } from '../../state/store';
import { ConfirmProvider } from '../../ui/Confirm';
import { FilePickField, MediaField, MediaLibraryPanel, MediaListField } from '..';
import { findLocalReferences, replaceInDoc } from '../logic';
import type { BlobPutOptions, MediaApi, MediaServices } from '../manager';
import { MediaProvider, realMediaApi, realMediaServices } from '../services';

const PROJECT_FILE = 'content/projects/harness.json';
const BLOB_HOST = 'harness.public.blob.vercel-storage.com';
const TEST_TERM = 'harness-blocked-term';

function initialContent(): ContentResponse {
  const site = {
    settings: { heroModel: { src: '', alt: '' } },
    about: { headshot: { kind: 'image', src: '', alt: '' } },
  } as unknown as Site;
  const project = {
    slug: 'harness',
    order: 1,
    cover: { kind: 'image', src: '', alt: '' },
    blocks: [
      { id: 'g1', type: 'gallery', items: [] },
      { id: 'v1', type: 'video', media: { kind: 'video', src: '', alt: '' } },
      { id: 'f1', type: 'file', label: 'Download', src: '' },
    ],
  } as unknown as Project;
  return {
    ok: true,
    source: 'github',
    ref: 'draft',
    head: 'a'.repeat(40),
    liveHead: 'b'.repeat(40),
    draftExists: true,
    draftAhead: 0,
    liveBranch: 'main',
    draftBranch: 'draft',
    site: { file: SITE_FILE, data: site },
    projects: [{ file: PROJECT_FILE, data: project }],
    findings: [],
    preview: null,
  };
}

function hex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

function failure(code: ErrorCode, error: string, extra: Partial<ApiError> = {}): ApiError {
  return { ok: false, code, error, ...extra };
}

/** Waits `ms` in steps, reporting progress; rejects when the signal aborts. */
function wait(ms: number, signal?: AbortSignal, onTick?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const steps = 5;
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      onTick?.(step / steps);
      if (step >= steps) {
        clearInterval(timer);
        resolve();
      }
    }, Math.max(1, ms / steps));
    signal?.addEventListener(
      'abort',
      () => {
        clearInterval(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

interface Stored {
  item: MediaItem;
  blob: Blob;
}

/** The stand-in server: an in-memory library and "saved draft". */
class Backend {
  readonly files = new Map<string, Stored>();
  readonly calls: { route: string; detail: unknown }[] = [];
  readonly liveRefs = new Map<string, Reference[]>();
  private readonly pendingBlobs = new Map<string, Blob>();
  blobConfigured = true;
  delayMs = 400;
  saved: ContentResponse = initialContent();

  log(route: string, detail: unknown = null): void {
    this.calls.push({ route, detail });
  }

  savedDoc(): Doc {
    return {
      site: this.saved.site.data as Site,
      projects: this.saved.projects.map((p) => ({ key: p.file, loadedFile: p.file, data: p.data as Project })),
    };
  }

  draftRefs(src: string): Reference[] {
    return findLocalReferences(this.savedDoc(), src);
  }

  put(store: 'repo' | 'blob', folder: string, name: string, blob: Blob, src?: string): MediaItem {
    const address = src ?? `/media/${folder}/${name}`;
    const old = this.files.get(address);
    if (old) URL.revokeObjectURL(old.item.previewSrc);
    const item: MediaItem = {
      store,
      folder,
      name,
      src: address,
      previewSrc: URL.createObjectURL(blob),
      downloadHref: address,
      size: blob.size,
      contentType: blob.type || undefined,
    };
    this.files.set(address, { item, blob });
    return item;
  }

  repoName(folder: string, name: string): Stored | undefined {
    const lower = name.toLowerCase();
    return [...this.files.values()].find((f) => f.item.store === 'repo' && f.item.folder === folder && f.item.name.toLowerCase() === lower);
  }

  holdBlob(url: string, blob: Blob): void {
    this.pendingBlobs.set(url, blob);
  }

  takeBlob(url: string): Blob | undefined {
    const blob = this.pendingBlobs.get(url);
    this.pendingBlobs.delete(url);
    return blob;
  }
}

function fakeApi(b: Backend): MediaApi {
  return {
    async status() {
      b.log('status');
      return {
        ok: true,
        storage: {
          repo: { target: 'github', problem: null },
          blob: { configured: b.blobConfigured, host: b.blobConfigured ? BLOB_HOST : null },
          limits: { repoMaxBytes: 4_000_000, blobMaxBytes: 500_000_000 },
        },
      } as unknown as StatusResponse;
    },
    async check(body) {
      b.log('check', { source: body.source, labels: body.items.map((i) => i.label) });
      await wait(60);
      const findings: Finding[] = body.items
        .filter((i) => i.text.toLowerCase().includes(TEST_TERM))
        .map((i) => ({ file: body.source, path: i.label, rule: 'HARNESS-TERM', message: 'The test page refuses its test term.', severity: 'error' }));
      return { ok: true, findings };
    },
    async uploadRepo(folder, files, replace, onProgress, options = {}) {
      const names = files.map((f) => sanitizeFileName(f.name).name);
      b.log('uploadRepo', { folder, replace, names, sizes: files.map((f) => f.blob.size) });
      if (!replace) {
        const taken = names.find((n) => b.repoName(folder, n));
        if (taken) return failure('exists', `A file named "${taken}" is already in this folder. Choose Replace to overwrite it, or rename the file.`);
      }
      const total = files.reduce((sum, f) => sum + f.blob.size, 0) || 1;
      try {
        await wait(b.delayMs, options.signal, (fraction) => onProgress?.({ loaded: fraction * total, total, fraction }));
      } catch {
        return failure('server', 'The upload was cancelled.');
      }
      const stored = files.map((f, i) => b.put('repo', folder, names[i], f.blob));
      return { ok: true, files: stored, commit: hex(40) };
    },
    async blobToken(body) {
      b.log('blobToken', body);
      if (!b.blobConfigured) return failure('not-configured', 'Vercel Blob is not set up here (the test page).', { missing: ['BLOB_READ_WRITE_TOKEN'] });
      const clean = sanitizeFileName(body.name);
      const pathname = `media/${body.folder}/${clean.base}-${hex(12)}.${clean.ext}`;
      return { ok: true, pathname, clientToken: 'test-page-token', ticket: JSON.stringify({ pathname, size: body.size }), multipart: false };
    },
    async blobConfirm(body) {
      b.log('blobConfirm', { pathname: body.pathname });
      const blob = b.takeBlob(body.url);
      if (!blob) return failure('invalid-file', 'The uploaded file is not in Vercel Blob. Upload it again.');
      const [, folder, name] = body.pathname.split('/');
      return { ok: true, file: b.put('blob', folder, name, blob, body.url) };
    },
    async mediaList(folder, refs = false) {
      b.log('mediaList', { folder, refs });
      await wait(30);
      const files = [...b.files.values()]
        .filter((f) => f.item.folder === folder)
        .map((f) => ({ ...f.item, ...(refs ? { refs: { draft: b.draftRefs(f.item.src).length, live: b.liveRefs.get(f.item.src)?.length ?? 0 } } : {}) }))
        .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
      return { ok: true, folder, files };
    },
    async mediaReferences(src) {
      b.log('mediaReferences', { src });
      return { ok: true, src, draft: b.draftRefs(src), live: b.liveRefs.get(src) ?? [] };
    },
    async mediaFolders() {
      b.log('mediaFolders');
      const counts = new Map<string, number>();
      for (const { item } of b.files.values()) counts.set(item.folder, (counts.get(item.folder) ?? 0) + 1);
      const owners = new Set(['site', ...b.saved.projects.map((p) => (p.data as Project).slug)]);
      const folders = [...counts].map(([folder, files]) => ({ folder, owner: owners.has(folder) ? folder : null, files }));
      return { ok: true, folders: folders.sort((x, y) => (x.folder < y.folder ? -1 : x.folder > y.folder ? 1 : 0)) };
    },
    async mediaDelete(src) {
      b.log('mediaDelete', { src });
      const file = b.files.get(src);
      if (!file) return failure('bad-request', 'This file is not in the media library.');
      const references = { draft: b.draftRefs(src), live: b.liveRefs.get(src) ?? [] };
      if (references.draft.length > 0 || (file.item.store === 'blob' && references.live.length > 0)) {
        return failure('referenced', 'This file is still used. Remove it from these fields first.', { references });
      }
      b.files.delete(src);
      return { ok: true, commit: file.item.store === 'repo' ? hex(40) : null };
    },
    async mediaRename(src, name) {
      b.log('mediaRename', { src, name });
      const file = b.files.get(src);
      if (!file) return failure('bad-request', 'This file is not in the media library.');
      const ext = file.item.name.slice(file.item.name.lastIndexOf('.') + 1);
      const base = name.replace(new RegExp(`\\.${ext}$`, 'i'), '');
      const clean = sanitizeFileName(`${base}.${ext}`);
      let next: MediaItem;
      if (file.item.store === 'repo') {
        if (b.repoName(file.item.folder, clean.name) && clean.name !== file.item.name) return failure('exists', `A file named "${clean.name}" is already in this folder.`);
        b.files.delete(src);
        next = b.put('repo', file.item.folder, clean.name, file.blob);
      } else {
        const stored = `${clean.base}-${hex(12)}.${clean.ext}`;
        next = b.put('blob', file.item.folder, stored, file.blob, `https://${BLOB_HOST}/media/${file.item.folder}/${stored}`);
      }
      const rewrote: string[] = [];
      if (b.draftRefs(src).length > 0) {
        const before = b.savedDoc();
        const after = replaceInDoc(before, src, { src: next.src, store: next.store });
        if (after.site !== before.site) rewrote.push(SITE_FILE);
        after.projects.forEach((p, i) => {
          if (p.data !== before.projects[i].data) rewrote.push(p.key);
        });
        b.saved = {
          ...b.saved,
          head: hex(40),
          site: { file: SITE_FILE, data: after.site },
          projects: after.projects.map((p) => ({ file: p.key, data: p.data })),
        };
      }
      return { ok: true, file: next, rewrote, commit: hex(40) };
    },
    async content() {
      b.log('content');
      return JSON.parse(JSON.stringify(b.saved)) as ContentResponse;
    },
    mediaFileHref(src) {
      return b.files.get(src)?.item.previewSrc ?? '';
    },
  };
}

function fakePut(b: Backend): MediaServices['putBlob'] {
  return async (pathname: string, body: Blob, options: BlobPutOptions) => {
    b.log('putBlob', { pathname, size: body.size, contentType: options.contentType });
    await wait(b.delayMs, options.abortSignal, (fraction) => options.onUploadProgress({ loaded: fraction * body.size, total: body.size, percentage: fraction * 100 }));
    const url = `https://${BLOB_HOST}/${pathname}`;
    b.holdBlob(url, body);
    return { url };
  };
}

declare global {
  interface Window {
    __media?: {
      calls: () => { route: string; detail: unknown }[];
      files: () => MediaItem[];
      doc: () => Doc | null;
      past: () => number;
      setBlob: (on: boolean) => void;
      setDelay: (ms: number) => void;
      setLiveRefs: (src: string, refs: Reference[]) => void;
      blobClient: () => Promise<string>;
      save: () => void;
    };
  }
}

function Loader({ content, children }: { content: ContentResponse; children: ReactNode }) {
  const store = useAdminStore();
  const phase = useAdmin((s) => s.phase);
  useEffect(() => {
    store.load(JSON.parse(JSON.stringify(content)) as ContentResponse);
    // Loads once; the stand-in's later content is read through the content route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  return phase === 'ready' ? <>{children}</> : <p>Loading</p>;
}

function Bridge({ backend, setBlob }: { backend: Backend; setBlob: (on: boolean) => void }) {
  const store = useAdminStore();
  useEffect(() => {
    window.__media = {
      calls: () => backend.calls,
      files: () => [...backend.files.values()].map((f) => f.item),
      doc: () => store.getState().doc,
      past: () => store.getState().past.length,
      setBlob,
      setDelay: (ms) => {
        backend.delayMs = ms;
      },
      setLiveRefs: (src, refs) => {
        backend.liveRefs.set(src, refs);
      },
      blobClient: async () => typeof (await import('@vercel/blob/client')).put,
      save: () => {
        const state = store.getState();
        if (!state.doc) return;
        const changes = store.changes();
        const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
        backend.saved = {
          ...backend.saved,
          head: hex(40),
          site: { file: SITE_FILE, data: copy(state.doc.site) },
          projects: state.doc.projects.map((entry) => ({ file: entry.key, data: copy(entry.data) })),
        };
        store.saved(changes, { head: backend.saved.head, commit: hex(40), warnings: [], preview: null, message: 'Saved on the test page.' });
      },
    };
    return () => {
      delete window.__media;
    };
  }, [backend, setBlob, store]);
  return null;
}

function ProjectFields() {
  const store = useAdminStore();
  const project = useAdmin((s) => s.doc?.projects[0]?.data);
  if (!project) return null;
  const key = PROJECT_FILE;
  const blocks = project.blocks as unknown as [{ items: MediaRef[] }, { media: MediaRef }, { src: string }];
  const setBlock = (index: number, patch: Record<string, unknown>, edit?: { coalesce?: string }) =>
    store.editProject(key, (p) => ({ ...p, blocks: p.blocks.map((block, i) => (i === index ? ({ ...block, ...patch } as typeof block) : block)) }), edit);
  return (
    <FileScope file={PROJECT_FILE}>
      <MediaField
        path="cover"
        label="Cover"
        value={project.cover}
        onChange={(next, edit) => next && store.editProject(key, (p) => ({ ...p, cover: next }), edit)}
        folder="harness"
        accept={['image', 'video', 'model']}
        focal
        caption
        clearable
      />
      <MediaListField
        path="blocks[0].items"
        label="Gallery items"
        value={blocks[0].items}
        onChange={(items, edit) => setBlock(0, { items }, edit)}
        folder="harness"
        accept={['image', 'video', 'model']}
      />
      <MediaField
        path="blocks[1].media"
        label="Video block"
        value={blocks[1].media}
        onChange={(next, edit) => next && setBlock(1, { media: next }, edit)}
        folder="harness"
        accept={['video', 'embed']}
        caption
        clearable
      />
      <FilePickField path="blocks[2].src" label="File block address" value={blocks[2].src} onChange={(src, edit) => setBlock(2, { src }, edit)} folder="harness" />
      <MediaLibraryPanel folder="harness" title="Test project library" />
    </FileScope>
  );
}

function SiteFields() {
  const store = useAdminStore();
  const headshot = useAdmin((s) => (s.doc?.site as unknown as { about: { headshot?: MediaRef } } | undefined)?.about.headshot);
  return (
    <FileScope file={SITE_FILE}>
      <MediaField
        path="about.headshot"
        label="Headshot"
        value={headshot}
        onChange={(next, edit) =>
          store.editSite((site) => {
            const about = { ...(site as unknown as { about: Record<string, unknown> }).about };
            if (next) about.headshot = next;
            else delete about.headshot;
            return { ...site, about } as unknown as Site;
          }, edit)
        }
        folder="site"
        accept={['image']}
        focal
        removable
      />
    </FileScope>
  );
}

function DocView() {
  const doc = useAdmin((s) => s.doc);
  const draftAhead = useAdmin((s) => s.info?.draftAhead ?? 0);
  return (
    <details>
      <summary>Working copy (draft commits counted: {draftAhead})</summary>
      <pre data-testid="doc" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
        {JSON.stringify({ site: doc?.site, project: doc?.projects[0]?.data }, null, 2)}
      </pre>
    </details>
  );
}

/**
 * `/dev-media?real=<folder>`: one folder's library and its project's cover against the real
 * routes (sign in first), for checking the list, the reference counts, and the previews the
 * server streams. The test that opens it answers every write itself.
 */
function RealFolder({ folder }: { folder: string }) {
  const store = useAdminStore();
  const phase = useAdmin((s) => s.phase);
  const loadError = useAdmin((s) => s.loadError);
  const cover = useAdmin((s) => s.doc?.projects.find((entry) => entry.data.slug === folder)?.data.cover);
  const key = useAdmin((s) => s.doc?.projects.find((entry) => entry.data.slug === folder)?.key ?? null);
  useEffect(() => {
    store.begin();
    void realMediaApi.content().then((answer) => {
      if (isApiError(answer)) store.fail(answer.error);
      else store.load(answer);
    });
  }, [store]);
  if (phase === 'error') return <p>The content could not be loaded: {loadError}</p>;
  if (phase !== 'ready') return <p>Loading the content</p>;
  return (
    <FileScope file={`content/projects/${folder}.json`}>
      {key && cover ? (
        <MediaField
          path="cover"
          label="Cover (real routes)"
          value={cover}
          onChange={(next, edit) => next && store.editProject(key, (p) => ({ ...p, cover: next }), edit)}
          folder={folder}
          accept={['image', 'video', 'model']}
          focal
          clearable
        />
      ) : null}
      <MediaLibraryPanel folder={folder} title={`Library of ${folder} (real routes)`} />
    </FileScope>
  );
}

export function RealHarness({ folder }: { folder: string }) {
  return (
    <div className="adm">
      <AdminProvider>
        <ConfirmProvider>
          <main className="adm-panel" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 960 }}>
            <h1 className="adm-panelhead__title">Media components on the real routes (test page)</h1>
            <UndoRedo />
            <RealFolder folder={folder} />
          </main>
        </ConfirmProvider>
      </AdminProvider>
    </div>
  );
}

export default function MediaHarness() {
  const backend = useMemo(() => new Backend(), []);
  const [blob, setBlob] = useState(true);
  const services = useMemo<MediaServices>(() => {
    backend.blobConfigured = blob;
    return { ...realMediaServices(), api: fakeApi(backend), putBlob: fakePut(backend) };
  }, [backend, blob]);

  return (
    <div className="adm">
      <AdminProvider>
        <ConfirmProvider>
          <Loader content={backend.saved}>
            <Bridge backend={backend} setBlob={setBlob} />
            <main className="adm-panel" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 960 }}>
              <h1 className="adm-panelhead__title">Media components (test page)</h1>
              <p className="adm-muted">Every route here is answered in the browser. Vercel Blob: {blob ? 'connected' : 'not connected'}.</p>
              <UndoRedo />
              <MediaProvider key={blob ? 'blob' : 'no-blob'} services={services}>
                <ProjectFields />
                <SiteFields />
              </MediaProvider>
              <DocView />
            </main>
          </Loader>
        </ConfirmProvider>
      </AdminProvider>
    </div>
  );
}
