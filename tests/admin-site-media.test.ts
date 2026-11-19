// @vitest-environment jsdom
/**
 * The site's media library on the Settings tab (ARCHITECTURE.md 13A: "one library per project plus
 * a site library"; docs/V3_PLAN.md D-27; the Phase 6 review's CLIENT-3), and the site's media
 * fields' undo steps. The real Settings tab renders in jsdom with stand-in media routes:
 *
 * - "Show the media library" shows the site folder's library, with "Not used anywhere";
 * - "Other folders" lists the folders no saved project names (GET /api/upload?folders=1), and each
 *   opens in its own library, where its files can be deleted;
 * - choosing a file and then typing its alt text are two undo steps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement as h, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SITE_FILE, type ApiResult, type ContentResponse, type MediaFoldersResponse, type MediaItem } from '../lib/admin/contract';
import { fieldId } from '../lib/admin/locate';
import type { MediaApi, MediaServices } from '../components/admin/media/manager';
import { MediaProvider } from '../components/admin/media/services';
import { otherFolders } from '../components/admin/media/Folders';
import { AdminProvider } from '../components/admin/state/hooks';
import { createAdminStore, type AdminStore } from '../components/admin/state/store';
import { SettingsTab } from '../components/admin/tabs/SettingsTab';
import { ConfirmProvider } from '../components/admin/ui/Confirm';

const ROOT = path.resolve(__dirname, '..');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  if (typeof window.requestAnimationFrame !== 'function') {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0);
    window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = () => undefined;
});

function seedStore(): AdminStore {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, SITE_FILE), 'utf8')) as unknown;
  const content: ContentResponse = {
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
    projects: [],
    findings: [],
    preview: null,
  };
  const store = createAdminStore();
  store.load(content);
  return store;
}

function file(folder: string, name: string, refs: { draft: number; live: number }): MediaItem {
  const src = `/media/${folder}/${name}`;
  return { store: 'repo', folder, name, src, previewSrc: '', downloadHref: src, refs };
}

const FOLDERS: MediaFoldersResponse['folders'] = [
  { folder: 'site', owner: 'site', files: 2 },
  { folder: 'raven', owner: 'raven', files: 5 },
  { folder: 'old-raven', owner: null, files: 1 },
  { folder: 'gone', owner: null, files: 3 },
];

function services(folders: () => Promise<ApiResult<MediaFoldersResponse>>) {
  const deleted: string[] = [];
  const listed: Record<string, MediaItem[]> = {
    site: [file('site', 'headshot.webp', { draft: 1, live: 1 }), file('site', 'left-over.webp', { draft: 0, live: 0 })],
    'old-raven': [file('old-raven', 'x.webp', { draft: 0, live: 0 })],
  };
  const unused = async () => ({ ok: false as const, code: 'server' as const, error: 'Not used here.' });
  const api: MediaApi = {
    status: async () =>
      ({
        ok: true,
        storage: { repo: { target: 'github', problem: null }, blob: { configured: true, host: null }, limits: { repoMaxBytes: 4_000_000, blobMaxBytes: 500_000_000 } },
      }) as never,
    check: async () => ({ ok: true, findings: [] }),
    uploadRepo: unused,
    blobToken: unused,
    blobConfirm: unused,
    mediaList: async (folder) => ({ ok: true, folder, files: (listed[folder] ?? []).filter((item) => !deleted.includes(item.src)) }),
    mediaDelete: async (src) => {
      deleted.push(src);
      return { ok: true, commit: 'c'.repeat(40) };
    },
    mediaRename: unused,
    mediaReferences: async (src) => ({ ok: true, src, draft: [], live: [] }),
    mediaFolders: folders,
    content: unused,
    mediaFileHref: (src) => `/api/upload/file?src=${encodeURIComponent(src)}`,
  };
  const media: MediaServices = {
    api,
    loadGroup: async () => async (files) => files.map((main) => ({ main, companions: [] })),
    loadPrepare: async () => async () => ({ prepared: [], failed: [] }),
    putBlob: async () => ({ url: 'https://example.invalid/unused' }),
  };
  return { media, deleted };
}

const tick = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, what: string, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`);
    await tick(10);
  }
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
});

function mount(store: AdminStore, media: MediaServices, page: ReactNode): HTMLElement {
  // The connection-status panel asks the real route; it gets a plain "not found".
  vi.stubGlobal('fetch', async () => ({ status: 404, text: async () => '', headers: { get: () => null } }));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(h(AdminProvider, { store, children: h(ConfirmProvider, { children: h(MediaProvider, { services: media, children: page }) }) }));
  cleanup = () => {
    root.unmount();
    container.remove();
  };
  return container;
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found;
}

function section(root: ParentNode, heading: string): HTMLElement {
  const title = [...root.querySelectorAll('h2, h3')].find((el) => el.textContent?.trim() === heading);
  const found = title?.closest('section');
  if (!found) throw new Error(`No section "${heading}"`);
  return found as HTMLElement;
}

/** Calls a text box's change handler the way React does when the owner types. */
function change(field: HTMLInputElement, value: string): void {
  const key = Object.keys(field).find((name) => name.startsWith('__reactProps$'));
  const props = key ? (field as unknown as Record<string, { onChange?: (event: unknown) => void }>)[key] : undefined;
  if (!props?.onChange) throw new Error('No change handler on this text box');
  props.onChange({ target: { value }, currentTarget: { value } });
}

describe('the site media library on the Settings tab (CLIENT-3)', () => {
  it('shows the site folder\'s files, the files nothing uses, and the folders of renamed or deleted projects', async () => {
    const { media, deleted } = services(async () => ({ ok: true, folders: FOLDERS }));
    const container = mount(seedStore(), media, h(SettingsTab));
    await tick(50);
    const mediaSection = section(container, 'Media');
    expect(mediaSection.querySelector('h2')?.textContent).toBe('Media');
    expect(container.textContent).not.toContain('Site media');

    button(mediaSection, 'Show the media library').click();
    await until(() => container.querySelector('li[data-src="/media/site/left-over.webp"]') !== null, 'the site files');
    const site = section(container, 'Site media');
    expect(site.querySelector('h3')?.textContent).toBe('Site media');
    expect([...site.querySelectorAll('li[data-src]')].map((li) => li.getAttribute('data-src'))).toEqual(['/media/site/headshot.webp', '/media/site/left-over.webp']);
    // "Not used anywhere" (D-27) finds the file nothing uses.
    const filter = site.querySelector<HTMLSelectElement>('select')!;
    expect([...filter.options].map((option) => option.textContent)).toEqual(['All files (2)', 'Not used anywhere (1)']);

    await until(() => container.textContent?.includes('/media/gone/') ?? false, 'the other folders');
    const others = section(container, 'Other folders');
    expect(others.querySelector('h3')?.textContent).toBe('Other folders');
    expect([...others.querySelectorAll('li')].map((li) => li.querySelector('span')?.textContent)).toEqual(['/media/gone/', '/media/old-raven/']);
    expect(others.textContent).toContain('3 files.');
    expect(others.textContent).toContain('1 file.');
    expect(others.textContent).not.toContain('/media/raven/');

    button(others, 'Open old-raven').click();
    await until(() => container.querySelector('li[data-src="/media/old-raven/x.webp"]') !== null, 'the folder\'s files');
    const folder = section(container, 'Folder old-raven');
    expect(folder.querySelector('h3')?.textContent).toBe('Folder old-raven');
    expect(folder.textContent).toContain('Not used anywhere');
    button(folder, 'Delete x.webp').click();
    await until(() => [...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Delete' && b.closest('dialog')), 'the question');
    [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete' && b.closest('dialog'))!.click();
    await until(() => deleted.length === 1, 'the delete');
    expect(deleted).toEqual(['/media/old-raven/x.webp']);
  });

  it('says so when the folders cannot be listed, and the site library still works', async () => {
    const { media } = services(async () => ({ ok: false, code: 'bad-request', error: 'This media folder does not exist.' }));
    const container = mount(seedStore(), media, h(SettingsTab));
    await tick(50);
    button(section(container, 'Media'), 'Show the media library').click();
    await until(() => container.textContent?.includes('The folders could not be listed') ?? false, 'the notice');
    expect(section(container, 'Other folders').textContent).toContain('This media folder does not exist.');
    await until(() => container.querySelector('li[data-src="/media/site/headshot.webp"]') !== null, 'the site files');
  });

  it('lists only the folders no saved project names, in name order', () => {
    expect(otherFolders(FOLDERS).map((f) => f.folder)).toEqual(['gone', 'old-raven']);
  });
});

describe('a site media field', () => {
  it('makes choosing a file and typing its alt text two undo steps', async () => {
    const store = seedStore();
    const { media } = services(async () => ({ ok: true, folders: [] }));
    const container = mount(store, media, h(SettingsTab));
    await tick(50);
    const og = container.querySelector<HTMLElement>(`#${fieldId(SITE_FILE, 'seo.ogImage')}`)!;
    const before = (store.getState().doc!.site as unknown as { seo: Record<string, unknown> }).seo.ogImage;

    button(og, 'Choose').click();
    await until(() => container.querySelector('dialog input[type="radio"]') !== null, 'the picker');
    const pick = [...container.querySelectorAll<HTMLInputElement>('dialog input[type="radio"]')].find((input) =>
      input.closest('label')?.textContent?.includes('left-over.webp'),
    )!;
    pick.click();
    await tick(20);
    button(container, 'Use this file').click();
    await tick(30);
    const chosen = { kind: 'image', src: '/media/site/left-over.webp', alt: '', store: 'repo' };
    const seo = () => (store.getState().doc!.site as unknown as { seo: { ogImage?: Record<string, unknown> } }).seo;
    expect(seo().ogImage).toEqual(chosen);
    const steps = store.getState().past.length;

    change(container.querySelector<HTMLInputElement>(`#${fieldId(SITE_FILE, 'seo.ogImage.alt')}`)!, 'The site');
    await tick(20);
    expect(seo().ogImage).toEqual({ ...chosen, alt: 'The site' });
    expect(store.getState().past.length).toBe(steps + 1);

    store.undo();
    expect(seo().ogImage).toEqual(chosen);
    store.undo();
    expect(seo().ogImage).toEqual(before);
  });
});
