// @vitest-environment jsdom
/**
 * Where a field's upload lands (components/admin/media/targets.ts; the Phase 6 review's CLIENT-2,
 * CLIENT-4, and CLIENT-7). The real block editor, list editor, Experience tab, and media library
 * render in jsdom with stand-in routes whose repository upload can be held, and every upload goes
 * through the real file inputs:
 *
 * - an upload lands in the field it was started from after its block or row moved, after a slug
 *   rename, and after its tab closed; a field removed meanwhile gets nothing;
 * - several uploads that finish in one repository request all land (a gallery, two blocks, a
 *   video and its captions);
 * - a file named like a resume waits for the owner's answer before it is stored.
 */
import { createElement as h, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ContentResponse, MediaItem, UploadResponse } from '../lib/admin/contract';
import type { PreparedUpload } from '../lib/admin/convert/types';
import { MediaLibraryPanel } from '../components/admin/media';
import { RESUME_QUESTION } from '../components/admin/media/logic';
import { isUnplaced, type MediaApi, type MediaServices, type UploadManager } from '../components/admin/media/manager';
import { MediaProvider, useMediaManager } from '../components/admin/media/services';
import { PLACE_GONE } from '../components/admin/media/targets';
import { BlockEditor } from '../components/admin/projects/BlockEditor';
import { ProjectsPanel } from '../components/admin/projects';
import { AdminProvider, FileScope } from '../components/admin/state/hooks';
import { createAdminStore, type AdminStore } from '../components/admin/state/store';
import { ExperienceTab } from '../components/admin/tabs/ExperienceTab';
import { ConfirmProvider } from '../components/admin/ui/Confirm';

const RAVEN = 'content/projects/raven.json';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  if (typeof window.requestAnimationFrame !== 'function') {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0);
    window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = () => undefined;
  window.scrollBy = () => undefined;
});

// ---------------------------------------------------------------------------------------------
// Stand-ins
// ---------------------------------------------------------------------------------------------

function project(blocks: unknown[], slug = 'raven', order = 1) {
  return {
    slug,
    visible: true,
    title: slug === 'raven' ? 'Raven' : slug,
    subtitle: '',
    role: '',
    timeframe: '',
    status: 'in-progress',
    featured: false,
    order,
    domain: '',
    tags: [],
    cover: { kind: 'image', src: '' },
    links: [],
    pitch: '',
    highlights: [],
    blocks,
  };
}

function content(blocks: unknown[], site: Record<string, unknown> = { schemaVersion: 3 }): ContentResponse {
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
    site: { file: 'content/site.json', data: site },
    projects: [{ file: RAVEN, data: project(blocks) }],
    findings: [],
    preview: null,
  };
}

function loaded(blocks: unknown[], site?: Record<string, unknown>): AdminStore {
  const store = createAdminStore();
  store.load(content(blocks, site));
  return store;
}

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open = () => undefined as void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

interface Call {
  folder: string;
  names: string[];
  gate: Gate;
}

/** What the converter makes of each test file: photos become WebP; videos, captions, and PDFs stay as they are. */
function prepared(file: File): PreparedUpload {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const base = file.name.slice(0, file.name.lastIndexOf('.'));
  const blob = new Blob([new Uint8Array(1000)]);
  const original = { name: file.name, size: file.size, type: file.type };
  if (ext === 'mp4') {
    return { kind: 'video', mediaKind: 'video', original, parts: [{ role: 'main', name: file.name, blob, contentType: 'video/mp4' }], meta: {}, warnings: [] };
  }
  if (ext === 'vtt') {
    return { kind: 'captions', mediaKind: null, original, parts: [{ role: 'main', name: file.name, blob, contentType: 'text/vtt' }], meta: { text: 'WEBVTT' }, warnings: [] };
  }
  if (ext === 'pdf') {
    return { kind: 'document', mediaKind: 'document', original, parts: [{ role: 'main', name: file.name, blob, contentType: 'application/pdf' }], meta: {}, warnings: [] };
  }
  return { kind: 'image', mediaKind: 'image', original, parts: [{ role: 'main', name: `${base}.webp`, blob, contentType: 'image/webp' }], meta: {}, warnings: [] };
}

/** Stand-in routes; the repository upload waits while `hold(callIndex)` is true, until the test opens its gate. */
function services(options: { hold?: (call: number) => boolean; files?: Record<string, MediaItem[]> } = {}) {
  const calls: Call[] = [];
  const unused = async () => ({ ok: false as const, code: 'server' as const, error: 'Not used here.' });
  const api: MediaApi = {
    status: async () =>
      ({
        ok: true,
        storage: { repo: { target: 'github', problem: null }, blob: { configured: true, host: null }, limits: { repoMaxBytes: 4_000_000, blobMaxBytes: 500_000_000 } },
      }) as never,
    check: async () => ({ ok: true, findings: [] }),
    uploadRepo: async (folder, files) => {
      const call: Call = { folder, names: files.map((f) => f.name), gate: gate() };
      const index = calls.length;
      calls.push(call);
      if (options.hold?.(index)) await call.gate.promise;
      const answer: UploadResponse = {
        ok: true,
        files: files.map((f): MediaItem => ({ store: 'repo', folder, name: f.name, src: `/media/${folder}/${f.name}`, previewSrc: '', downloadHref: '' })),
        commit: 'c'.repeat(40),
      };
      return answer;
    },
    blobToken: unused,
    blobConfirm: unused,
    mediaList: async (folder) => ({ ok: true, folder, files: options.files?.[folder] ?? [] }),
    mediaDelete: async () => ({ ok: true, commit: null }),
    mediaRename: unused,
    mediaReferences: async (src) => ({ ok: true, src, draft: [], live: [] }),
    mediaFolders: async () => ({ ok: true, folders: [] }),
    content: unused,
    mediaFileHref: (src) => `/api/upload/file?src=${encodeURIComponent(src)}`,
  };
  const media: MediaServices = {
    api,
    loadGroup: async () => async (files) => files.map((main) => ({ main, companions: [] })),
    loadPrepare: async () => async (files) => ({ prepared: [prepared(files[0])], failed: [] }),
    putBlob: async () => ({ url: 'https://example.invalid/unused' }),
  };
  return { media, calls };
}

// ---------------------------------------------------------------------------------------------
// Rendering and driving the page
// ---------------------------------------------------------------------------------------------

const tick = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, what: string, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`);
    await tick(10);
  }
}

function Grab({ onManager }: { onManager: (manager: UploadManager) => void }) {
  const manager = useMediaManager();
  useEffect(() => onManager(manager), [manager, onManager]);
  return null;
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  window.location.hash = '';
});

function mount(store: AdminStore, media: MediaServices, page: ReactNode) {
  let manager: UploadManager | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const grab = (m: UploadManager) => {
    manager = m;
  };
  const tree = (child: ReactNode) =>
    h(AdminProvider, {
      store,
      children: h(ConfirmProvider, { children: h(MediaProvider, { services: media, children: [h(Grab, { key: 'grab', onManager: grab }), h('div', { key: 'page' }, child)] }) }),
    });
  root.render(tree(page));
  cleanup = () => {
    root.unmount();
    container.remove();
  };
  return {
    container,
    manager: () => {
      if (!manager) throw new Error('The queue is not on the page yet.');
      return manager;
    },
    /** Shows another page in place of this one, keeping the queue (a tab switch). */
    show: (child: ReactNode) => root.render(tree(child)),
  };
}

function photo(name: string, type = 'image/jpeg'): File {
  return new File([new Uint8Array(2000)], name, { type });
}

/** Hands files to a file input, as choosing them in the browser's dialog does. */
function choose(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found;
}

function input(root: ParentNode, label: string): HTMLInputElement {
  const found = root.querySelector<HTMLInputElement>(`input[type="file"][aria-label="${label}"]`);
  if (!found) throw new Error(`No file input "${label}"`);
  return found;
}

/** The list row a tool button belongs to. */
function rowOf(container: ParentNode, toolLabel: string): HTMLElement {
  const row = button(container, toolLabel).closest('li');
  if (!row) throw new Error(`No row around "${toolLabel}"`);
  return row;
}

function blocksOf(store: AdminStore): Record<string, unknown>[] {
  return store.getState().doc!.projects[0].data.blocks as unknown as Record<string, unknown>[];
}

function blockById(store: AdminStore, id: string): Record<string, unknown> {
  const block = blocksOf(store).find((b) => b.id === id);
  if (!block) throw new Error(`No block ${id}`);
  return block;
}

const allDone = (m: UploadManager) => m.getSnapshot().length > 0 && m.getSnapshot().every((item) => item.stage === 'done');

async function expandAll(container: HTMLElement): Promise<void> {
  await tick(50);
  button(container, 'Expand all').click();
  await tick(50);
}

const blockEditor = h(FileScope, { file: RAVEN, children: h(BlockEditor, { entryKey: RAVEN, folder: 'raven' }) });

// ---------------------------------------------------------------------------------------------
// CLIENT-2: an upload belongs to its field, not to a position
// ---------------------------------------------------------------------------------------------

describe('an upload lands in the field it was started from', () => {
  it('after its block was moved, and the block that took its old position keeps its file, alt text, and caption', async () => {
    const store = loaded([
      { id: 'rv-a', type: 'image', media: { kind: 'image', src: '/media/raven/a.webp', alt: 'Block A photo' } },
      { id: 'rv-b', type: 'image', media: { kind: 'image', src: '/media/raven/b.webp', alt: 'Block B photo', caption: 'B caption' } },
    ]);
    const { media, calls } = services({ hold: () => true });
    const page = mount(store, media, blockEditor);
    await expandAll(page.container);

    choose(input(rowOf(page.container, 'Move Image block 1 down'), 'Upload a file for Image'), [photo('new.jpg')]);
    await until(() => calls.length === 1, 'the upload request');
    button(page.container, 'Move Image block 1 down').click();
    await tick(50);
    expect(blocksOf(store).map((b) => b.id)).toEqual(['rv-b', 'rv-a']);

    calls[0].gate.open();
    await until(() => allDone(page.manager()), 'the upload to finish');
    await tick(50);

    expect(blockById(store, 'rv-a').media).toEqual({ kind: 'image', src: '/media/raven/new.webp', alt: '', store: 'repo' });
    expect(blockById(store, 'rv-b').media).toEqual({ kind: 'image', src: '/media/raven/b.webp', alt: 'Block B photo', caption: 'B caption' });
    const [item] = page.manager().getSnapshot();
    expect(item.applied).toBe(true);
    expect(item.note).toBeNull();
    // The block's field shows its own upload where the block is now.
    expect(rowOf(page.container, 'Move Image block 2 up').textContent).toContain('new.webp');

    // The placed file is one undo step of its own.
    store.undo();
    expect(blockById(store, 'rv-a').media).toEqual({ kind: 'image', src: '/media/raven/a.webp', alt: 'Block A photo' });
    expect(blocksOf(store).map((b) => b.id)).toEqual(['rv-b', 'rv-a']);
  });

  it('after a block was added above it, and while its block is closed', async () => {
    const store = loaded([{ id: 'rv-a', type: 'image', media: { kind: 'image', src: '/media/raven/a.webp', alt: 'A' } }]);
    const { media, calls } = services({ hold: () => true });
    const page = mount(store, media, blockEditor);
    await expandAll(page.container);

    choose(input(page.container, 'Upload a file for Image'), [photo('new.jpg')]);
    await until(() => calls.length === 1, 'the upload request');
    // A text block goes in above it, and every block closes.
    store.editProject(RAVEN, (p) => ({ ...p, blocks: [{ id: 'rv-z', type: 'text', md: 'Above' }, ...p.blocks] }));
    button(page.container, 'Collapse all').click();
    await tick(50);

    calls[0].gate.open();
    await until(() => allDone(page.manager()), 'the upload to finish');
    expect(blockById(store, 'rv-z')).toEqual({ id: 'rv-z', type: 'text', md: 'Above' });
    expect((blockById(store, 'rv-a').media as { src: string }).src).toBe('/media/raven/new.webp');
    expect(page.manager().getSnapshot()[0].applied).toBe(true);
  });

  it('in a gallery row without an id, after the rows were reordered', async () => {
    const store = loaded([
      {
        id: 'rv-g',
        type: 'gallery',
        items: [
          { kind: 'image', src: '/media/raven/x.webp', alt: 'X' },
          { kind: 'image', src: '/media/raven/y.webp', alt: 'Y' },
        ],
      },
    ]);
    const { media, calls } = services({ hold: () => true });
    const page = mount(store, media, blockEditor);
    await expandAll(page.container);

    choose(input(page.container, 'Upload a file for Item 2'), [photo('y2.jpg')]);
    await until(() => calls.length === 1, 'the upload request');
    button(page.container, 'Move y.webp up').click();
    await tick(50);
    calls[0].gate.open();
    await until(() => allDone(page.manager()), 'the upload to finish');

    expect(blockById(store, 'rv-g').items).toEqual([
      { kind: 'image', src: '/media/raven/y2.webp', alt: '', store: 'repo' },
      { kind: 'image', src: '/media/raven/x.webp', alt: 'X' },
    ]);
  });

  it('after the project was renamed, and its field still shows the upload', async () => {
    const store = loaded([{ id: 'rv-a', type: 'image', media: { kind: 'image', src: '/media/raven/a.webp', alt: 'A' } }]);
    const { media, calls } = services({ hold: () => true });
    window.location.hash = '#tab=projects&project=raven';
    const page = mount(store, media, h(ProjectsPanel));
    await expandAll(page.container);

    choose(input(page.container, 'Upload a file for Image'), [photo('new.jpg')]);
    await until(() => calls.length === 1, 'the upload request');
    const slug = page.container.querySelector<HTMLInputElement>('input[id$="slug"]');
    expect(slug).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(slug, 'raven-evtol');
    slug!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(30);
    button(page.container, 'Rename').click();
    await tick(80);
    expect(store.getState().doc!.projects[0].data.slug).toBe('raven-evtol');

    calls[0].gate.open();
    await until(() => allDone(page.manager()), 'the upload to finish');
    await tick(80);
    expect((blockById(store, 'rv-a').media as { src: string }).src).toBe('/media/raven/new.webp');
    expect(page.manager().getSnapshot()[0].applied).toBe(true);
    // The upload's folder is the project's own (/media/raven/), where its files already are.
    expect(calls[0].folder).toBe('raven');
  });

  it('nowhere when its block was deleted, and no other field takes it', async () => {
    const store = loaded([
      { id: 'rv-a', type: 'image', media: { kind: 'image', src: '/media/raven/a.webp', alt: 'A' } },
      { id: 'rv-b', type: 'image', media: { kind: 'image', src: '/media/raven/b.webp', alt: 'B', caption: 'B caption' } },
    ]);
    const { media, calls } = services({ hold: () => true });
    const page = mount(store, media, blockEditor);
    await expandAll(page.container);

    choose(input(rowOf(page.container, 'Move Image block 1 down'), 'Upload a file for Image'), [photo('new.jpg')]);
    await until(() => calls.length === 1, 'the upload request');
    store.editProject(RAVEN, (p) => ({ ...p, blocks: p.blocks.slice(1) }));
    await tick(50);

    calls[0].gate.open();
    await until(() => allDone(page.manager()), 'the upload to finish');
    await tick(50);
    expect(blocksOf(store)).toEqual([{ id: 'rv-b', type: 'image', media: { kind: 'image', src: '/media/raven/b.webp', alt: 'B', caption: 'B caption' } }]);
    const [item] = page.manager().getSnapshot();
    expect(item.applied).toBe(false);
    expect(item.note).toBe(PLACE_GONE);
    expect(isUnplaced(item)).toBe(true);
    // The block that now holds position 0 does not offer it.
    expect(page.container.textContent).not.toContain('Use this file');
  });

  it('in its block again when Undo brought the block back before the file was stored', async () => {
    const store = loaded([
      { id: 'rv-a', type: 'image', media: { kind: 'image', src: '/media/raven/a.webp', alt: 'A' } },
      { id: 'rv-b', type: 'image', media: { kind: 'image', src: '/media/raven/b.webp', alt: 'B' } },
    ]);
    const { media, calls } = services({ hold: () => true });
    const page = mount(store, media, blockEditor);
    await expandAll(page.container);

    choose(input(rowOf(page.container, 'Move Image block 1 down'), 'Upload a file for Image'), [photo('new.jpg')]);
    await until(() => calls.length === 1, 'the upload request');
    store.editProject(RAVEN, (p) => ({ ...p, blocks: p.blocks.slice(1) }));
    await tick(30);
    store.undo();
    await tick(30);

    calls[0].gate.open();
    await until(() => allDone(page.manager()), 'the upload to finish');
    expect((blockById(store, 'rv-a').media as { src: string }).src).toBe('/media/raven/new.webp');
    expect((blockById(store, 'rv-b').media as { src: string }).src).toBe('/media/raven/b.webp');
  });

  it('on its Experience role after the roles were reordered and the tab was closed', async () => {
    const roles = [
      { company: 'Acme', role: 'Engineer', location: '', dates: '', bullets: [] },
      { company: 'Beta', role: 'Intern', location: '', dates: '', bullets: [], logo: { kind: 'image', src: '/media/site/beta.webp', alt: 'Beta logo' } },
    ];
    const store = loaded([], { schemaVersion: 3, experience: roles });
    const { media, calls } = services({ hold: () => true });
    const page = mount(store, media, h(ExperienceTab));
    await tick(50);

    choose(input(rowOf(page.container, 'Move Intern, Beta up'), 'Upload a file for Logo'), [photo('beta-new.png', 'image/png')]);
    await until(() => calls.length === 1, 'the upload request');
    button(page.container, 'Move Intern, Beta up').click();
    await tick(50);
    page.show(h('p', null, 'Another tab'));
    await tick(50);

    calls[0].gate.open();
    await until(() => allDone(page.manager()), 'the upload to finish');
    const experience = (store.getState().doc!.site as unknown as { experience: { company: string; logo?: unknown }[] }).experience;
    expect(experience.map((role) => role.company)).toEqual(['Beta', 'Acme']);
    expect(experience[0].logo).toEqual({ kind: 'image', src: '/media/site/beta-new.webp', alt: '', store: 'repo' });
    expect(experience[1]).not.toHaveProperty('logo');
    expect(calls[0].folder).toBe('site');
  });
});

// ---------------------------------------------------------------------------------------------
// The project editor's media library
// ---------------------------------------------------------------------------------------------

describe('the project editor\'s media library', () => {
  it('is one h3 under its section\'s h2, over the folder the project\'s files are in', async () => {
    const store = loaded([{ id: 'rv-a', type: 'image', media: { kind: 'image', src: '/media/raven/a.webp', alt: 'A' } }]);
    const listed: MediaItem = { store: 'repo', folder: 'raven', name: 'a.webp', src: '/media/raven/a.webp', previewSrc: '', downloadHref: '', refs: { draft: 1, live: 0 } };
    const { media } = services({ files: { raven: [listed] } });
    window.location.hash = '#tab=projects&project=raven';
    const page = mount(store, media, h(ProjectsPanel));
    await tick(50);
    button(page.container, 'Show the media library').click();
    await until(() => page.container.querySelector('li[data-src="/media/raven/a.webp"]') !== null, 'the library');
    const headings = [...page.container.querySelectorAll('h2, h3')].map((el) => `${el.tagName} ${el.textContent}`);
    const at = headings.indexOf('H2 Media library');
    expect(at).toBeGreaterThan(-1);
    expect(headings.slice(at + 1)).toEqual(['H3 Media for Raven']);
  });
});

// ---------------------------------------------------------------------------------------------
// CLIENT-4: uploads stored in one request all land
// ---------------------------------------------------------------------------------------------

describe('uploads that finish in one repository request', () => {
  it('all go into the gallery they were dropped on, in order', async () => {
    const store = loaded([{ id: 'rv-g', type: 'gallery', items: [] }]);
    // The first request waits until photos two and three are ready, so those two go up together.
    const { media, calls } = services({ hold: (call) => call === 0 });
    const page = mount(store, media, blockEditor);
    await expandAll(page.container);

    choose(input(page.container, 'Upload files for Gallery items'), [photo('one.jpg'), photo('two.jpg'), photo('three.jpg')]);
    await until(() => calls.length === 1, 'the first request');
    await until(() => page.manager().getSnapshot().filter((item) => item.stage === 'ready').length === 2, 'photos two and three ready');
    calls[0].gate.open();
    await until(() => allDone(page.manager()), 'all three stored');

    expect(calls.map((call) => call.names)).toEqual([['one.webp'], ['two.webp', 'three.webp']]);
    expect((blockById(store, 'rv-g').items as { src: string }[]).map((item) => item.src)).toEqual([
      '/media/raven/one.webp',
      '/media/raven/two.webp',
      '/media/raven/three.webp',
    ]);
    expect(page.manager().getSnapshot().every((item) => item.applied && item.note === null)).toBe(true);
    // Each file is its own undo step.
    store.undo();
    expect((blockById(store, 'rv-g').items as unknown[]).length).toBe(2);
  });

  it('go into two blocks of one list, and neither writes the other back', async () => {
    const store = loaded([
      { id: 'rv-a', type: 'image', media: { kind: 'image', src: '/media/raven/a.webp', alt: 'A' } },
      { id: 'rv-b', type: 'image', media: { kind: 'image', src: '/media/raven/b.webp', alt: 'B' } },
      { id: 'rv-c', type: 'image', media: { kind: 'image', src: '/media/raven/c.webp', alt: 'C' } },
    ]);
    const { media, calls } = services({ hold: (call) => call === 0 });
    const page = mount(store, media, blockEditor);
    await expandAll(page.container);

    choose(input(rowOf(page.container, 'Move Image block 3 up'), 'Upload a file for Image'), [photo('c2.jpg')]);
    await until(() => calls.length === 1, 'the first request');
    choose(input(rowOf(page.container, 'Move Image block 1 down'), 'Upload a file for Image'), [photo('a2.jpg')]);
    choose(input(rowOf(page.container, 'Move Image block 2 down'), 'Upload a file for Image'), [photo('b2.jpg')]);
    await until(() => page.manager().getSnapshot().filter((item) => item.stage === 'ready').length === 2, 'A and B ready');
    calls[0].gate.open();
    await until(() => allDone(page.manager()), 'all stored');

    expect(calls.map((call) => call.names)).toEqual([['c2.webp'], ['a2.webp', 'b2.webp']]);
    expect(blocksOf(store).map((block) => (block.media as { src: string }).src)).toEqual([
      '/media/raven/a2.webp',
      '/media/raven/b2.webp',
      '/media/raven/c2.webp',
    ]);
  });

  it('keep a new video and its new captions together', async () => {
    const store = loaded([{ id: 'rv-v', type: 'video', media: { kind: 'video', src: '/media/raven/old.mp4', alt: 'Old clip' } }]);
    const { media, calls } = services({ hold: (call) => call === 0 });
    const page = mount(store, media, blockEditor);
    await expandAll(page.container);

    // An earlier upload occupies the first request, so the video and its captions go up together.
    choose(input(page.container, 'Upload a file for Video'), [photo('first.mp4', 'video/mp4')]);
    await until(() => calls.length === 1, 'the first request');
    choose(input(page.container, 'Upload a file for Video'), [photo('clip.mp4', 'video/mp4')]);
    choose(input(page.container, 'Upload captions for Video'), [new File(['WEBVTT'], 'clip.vtt', { type: 'text/vtt' })]);
    await until(() => page.manager().getSnapshot().filter((item) => item.stage === 'ready').length === 2, 'the video and its captions ready');
    calls[0].gate.open();
    await until(() => allDone(page.manager()), 'all stored');

    expect(calls[1].names).toEqual(['clip.mp4', 'clip.vtt']);
    expect(blockById(store, 'rv-v').media).toEqual({ kind: 'video', src: '/media/raven/clip.mp4', alt: '', store: 'repo', captions: '/media/raven/clip.vtt' });
  });
});

// ---------------------------------------------------------------------------------------------
// CLIENT-4: list and block updates build on the store's current state
// ---------------------------------------------------------------------------------------------

/**
 * Calls a text box's change handler the way React does when the owner types, but outside a browser
 * event, so React renders only after the current task: two calls in a row are one burst of changes
 * built on the same render, as when several things finish at once.
 */
function change(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const key = Object.keys(field).find((name) => name.startsWith('__reactProps$'));
  const props = key ? (field as unknown as Record<string, { onChange?: (event: unknown) => void }>)[key] : undefined;
  if (!props?.onChange) throw new Error('No change handler on this text box');
  props.onChange({ target: { value }, currentTarget: { value } });
}

function textBox<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`No ${selector}`);
  return found;
}

describe('two changes before the next render', () => {
  it('to two rows of a list both stay', async () => {
    const roles = [
      { company: 'Acme', role: 'Engineer', location: '', dates: '', bullets: [] },
      { company: 'Beta', role: 'Intern', location: '', dates: '', bullets: [] },
    ];
    const store = loaded([], { schemaVersion: 3, experience: roles });
    const { media } = services();
    const page = mount(store, media, h(ExperienceTab));
    await tick(50);

    change(textBox(page.container, 'input[id$="experience_5b0_5d_2ecompany"]'), 'Acme Aero');
    change(textBox(page.container, 'input[id$="experience_5b1_5d_2ecompany"]'), 'Beta Labs');
    await tick(50);
    const experience = (store.getState().doc!.site as unknown as { experience: { company: string }[] }).experience;
    expect(experience.map((role) => role.company)).toEqual(['Acme Aero', 'Beta Labs']);
  });

  it('to two blocks of one list both stay', async () => {
    const store = loaded([
      { id: 'rv-a', type: 'text', md: 'A' },
      { id: 'rv-b', type: 'text', md: 'B' },
    ]);
    const { media } = services();
    const page = mount(store, media, blockEditor);
    await expandAll(page.container);

    change(textBox(rowOf(page.container, 'Move Text block 1 down'), 'textarea'), 'A edited');
    change(textBox(rowOf(page.container, 'Move Text block 2 up'), 'textarea'), 'B edited');
    await tick(50);
    expect(blocksOf(store).map((block) => block.md)).toEqual(['A edited', 'B edited']);
  });

  it('to both columns of a two-column block both stay', async () => {
    const store = loaded([
      { id: 'rv-t', type: 'twoCol', left: [{ id: 'rv-l', type: 'text', md: 'L' }], right: [{ id: 'rv-r', type: 'text', md: 'R' }] },
    ]);
    const { media } = services();
    const page = mount(store, media, blockEditor);
    await expandAll(page.container);

    const [left, right] = [...page.container.querySelectorAll<HTMLTextAreaElement>('textarea')];
    change(left, 'L edited');
    change(right, 'R edited');
    await tick(50);
    expect(blockById(store, 'rv-t')).toEqual({
      id: 'rv-t',
      type: 'twoCol',
      left: [{ id: 'rv-l', type: 'text', md: 'L edited' }],
      right: [{ id: 'rv-r', type: 'text', md: 'R edited' }],
    });
  });
});

// ---------------------------------------------------------------------------------------------
// CLIENT-7: a file named like a resume asks first
// ---------------------------------------------------------------------------------------------

describe('a file whose name looks like a resume', () => {
  it('waits for the owner before it is stored, after a Cancel and Retry too, and the library marks such a file', async () => {
    const store = loaded([]);
    const listed: MediaItem = { store: 'repo', folder: 'site', name: 'old-resume.pdf', src: '/media/site/old-resume.pdf', previewSrc: '', downloadHref: '', refs: { draft: 0, live: 0 } };
    const { media, calls } = services({ files: { site: [listed] } });
    const page = mount(store, media, h(MediaLibraryPanel, { folder: 'site', title: 'Site media' }));
    await until(() => page.container.textContent?.includes('old-resume.pdf') ?? false, 'the listed file');
    const card = page.container.querySelector('li[data-src="/media/site/old-resume.pdf"]');
    expect(card?.textContent).toContain('Looks like a resume');

    choose(input(page.container, 'Files to add to Site media'), [photo('Amjad_Rehawi_Resume.pdf', 'application/pdf')]);
    await until(() => page.manager().getSnapshot()[0]?.stage === 'confirm', 'the question');
    const [asking] = page.manager().getSnapshot();
    expect(asking.warnings).toContainEqual({ code: 'resume-name', message: RESUME_QUESTION, confirm: true });
    expect(page.container.textContent).toContain(RESUME_QUESTION);
    await tick(50);
    expect(calls).toHaveLength(0);

    page.manager().cancel(asking.id);
    page.manager().retry(asking.id);
    await until(() => page.manager().getSnapshot()[0]?.stage === 'confirm', 'the question again');
    expect(calls).toHaveLength(0);

    button(page.container, 'Upload anyway').click();
    await until(() => allDone(page.manager()), 'the upload');
    expect(calls.map((call) => call.names)).toEqual([['Amjad_Rehawi_Resume.pdf']]);
  });

  it('asks nothing for an ordinary name', async () => {
    const store = loaded([]);
    const { media, calls } = services();
    const page = mount(store, media, h(MediaLibraryPanel, { folder: 'site', title: 'Site media' }));
    await tick(50);
    choose(input(page.container, 'Files to add to Site media'), [photo('report.pdf', 'application/pdf'), photo('present.jpg')]);
    await until(() => allDone(page.manager()) && page.manager().getSnapshot().length === 2, 'the uploads');
    expect(page.manager().getSnapshot().every((item) => item.warnings.length === 0)).toBe(true);
    expect(calls.flatMap((call) => call.names).sort()).toEqual(['present.webp', 'report.pdf']);
  });
});
