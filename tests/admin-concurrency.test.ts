/**
 * Saves, Publish, and Discard while another window, a discard, or the published branch changes
 * the draft (Phase 6 review: CLIENT-1, CONTENT-1 to CONTENT-4). The real routes, the real store
 * and save flow, and the in-memory GitHub in ./admin-github-fake.ts; synthetic settings only. Every
 * assertion states the correct behavior.
 */
import { createHash } from 'node:crypto';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getContent } from '../app/api/content/route';
import { POST as discard } from '../app/api/discard/route';
import { GET as getPlan, POST as publish } from '../app/api/publish/route';
import { POST as saveRoute } from '../app/api/save/route';
import { IDLE_DEPLOY } from '../components/admin/shell/deploy';
import { DiscardDialog, discardLine } from '../components/admin/shell/DiscardDialog';
import { SaveBar, staleLine } from '../components/admin/shell/SaveBar';
import { runSave, type SaveDeps } from '../components/admin/shell/saveFlow';
import { AdminProvider } from '../components/admin/state/hooks';
import { createAdminStore, type AdminStore } from '../components/admin/state/store';
import { setIn } from '../components/admin/ui/paths';
import {
  serializeContent,
  textDigest,
  type ApiError,
  type ApiResult,
  type ContentResponse,
  type PublishPlan,
  type SaveBody,
  type SaveResponse,
} from '../lib/admin/contract';
import { checkContent } from '../lib/admin/server/content-check';
import { DEPLOY_MESSAGES, deployBlocksPublish, lookupDeploys } from '../lib/admin/server/deploy';
import { REPO_MESSAGES } from '../lib/admin/server/repo';
import { SAVE_MESSAGES } from '../lib/admin/server/save';
import { adminRequest, expectedFrom, FakeGitHub, installFakeGitHub, saveBodyFrom, stubAdminEnv, type FakeDeployment } from './admin-github-fake';

type Json = Record<string, any>;

const SITE = 'content/site.json';
const RAVEN = 'content/projects/raven.json';
const PALM = 'content/projects/palmsync.json';
const MOON = 'content/projects/moonlamp.json';
/** A project no stat or skill proof leads to, so removing it passes the content check. */
const PLANT = 'content/projects/smart-plant-care.json';
const MERGE = 'Merge main into draft';

let fake: FakeGitHub;

beforeEach(() => {
  stubAdminEnv();
  fake = installFakeGitHub();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function load(): Promise<ContentResponse> {
  const res = await getContent(adminRequest('GET', '/api/content'));
  expect(res.status).toBe(200);
  return (await res.json()) as ContentResponse;
}

function fileOf(content: ContentResponse, file: string): Json {
  const found = file === SITE ? content.site : content.projects.find((p) => p.file === file);
  return structuredClone(found!.data) as Json;
}

async function post(body: unknown): Promise<{ status: number; body: Json }> {
  const res = await saveRoute(adminRequest('POST', '/api/save', { body }));
  return { status: res.status, body: (await res.json()) as Json };
}

function draftJson(file: string): Json {
  return JSON.parse(fake.filesAt('draft').get(file)!) as Json;
}

/** Saves `note` onto a project's pitch from a fresh load, and returns the new draft head. */
async function saveNote(file: string, note: string): Promise<string> {
  const content = await load();
  const data = fileOf(content, file);
  data.pitch = `${data.pitch} ${note}`;
  const saved = await post(saveBodyFrom(content, [{ path: file, data }]));
  expect(saved.status).toBe(200);
  return saved.body.head as string;
}

async function plan(): Promise<PublishPlan> {
  const res = await getPlan(adminRequest('GET', '/api/publish'));
  expect(res.status).toBe(200);
  return (await res.json()) as PublishPlan;
}

/** The whole draft through the content check, as `npm run check:content` would run it. */
function draftErrors(): string[] {
  const files = [...fake.filesAt('draft')]
    .filter(([path]) => path === SITE || path.startsWith('content/projects/'))
    .map(([path, text]) => ({ path, data: JSON.parse(text) as unknown }));
  const mediaFiles = [...fake.filesAt('draft').keys()].filter((path) => path.startsWith('public/media/'));
  return checkContent(files, { mediaFiles }).errors.map((f) => `${f.file} ${f.path} ${f.rule}`);
}

// ---------------------------------------------------------------------------------------------
// CLIENT-1: a save never makes the editor's copies count as current when they are not
// ---------------------------------------------------------------------------------------------

async function loaded(): Promise<AdminStore> {
  const store = createAdminStore();
  store.load(await load());
  return store;
}

async function saveVia(body: SaveBody): Promise<ApiResult<SaveResponse>> {
  const res = await saveRoute(adminRequest('POST', '/api/save', { body }));
  return (await res.json()) as ApiResult<SaveResponse>;
}

function deps(store: AdminStore, conflicts: ApiError[] = []): SaveDeps {
  return { store, save: saveVia, reauthenticate: async () => false, onConflict: (error) => conflicts.push(error) };
}

describe('CLIENT-1: two windows, and a merge the editor never loaded', () => {
  it('a window that saved another file cannot later overwrite the edit the other window saved', async () => {
    const a = await loaded();
    const b = await loaded();

    a.editProject(RAVEN, (p) => ({ ...p, subtitle: `${p.subtitle} (window A)` }));
    expect(await runSave(deps(a))).toBe('saved');

    // Window B saves an unrelated file on the newer draft. Its copy of raven is not current, and
    // the store says so instead of treating it as loaded.
    b.editSite((site) => setIn(site, 'contact.body', `${site.contact.body} Window B note.`));
    expect(await runSave(deps(b))).toBe('saved');
    expect(b.getState().info).toMatchObject({ stale: [RAVEN], liveMerged: false });

    // Its later save of raven is refused, and window A's edit stays.
    const conflicts: ApiError[] = [];
    b.editProject(RAVEN, (p) => ({ ...p, pitch: `${p.pitch} Window B pitch.` }));
    expect(await runSave(deps(b, conflicts))).toBe('conflict');
    expect(conflicts).toEqual([expect.objectContaining({ code: 'conflict', files: [RAVEN], error: SAVE_MESSAGES.stale })]);
    expect(draftJson(RAVEN).subtitle).toMatch(/\(window A\)$/);
    expect(draftJson(RAVEN).pitch).not.toContain('Window B pitch.');

    // After a reload, window B holds window A's edit and saves its own on top of it.
    b.load(await load());
    expect(b.getState().info?.stale).toEqual([]);
    b.editProject(RAVEN, (p) => ({ ...p, pitch: `${p.pitch} Window B pitch.` }));
    expect(await runSave(deps(b))).toBe('saved');
    expect(draftJson(RAVEN)).toMatchObject({ subtitle: expect.stringMatching(/\(window A\)$/), pitch: expect.stringMatching(/Window B pitch\.$/) });
  });

  it('one window: files a save merged in from the published branch stay stale, and are never written back', async () => {
    const w = await loaded();
    w.editSite((site) => setIn(site, 'contact.body', `${site.contact.body} First.`));
    expect(await runSave(deps(w))).toBe('saved');

    const live = JSON.parse(fake.filesAt('main').get(RAVEN)!) as Json;
    live.subtitle = 'Changed on the live branch';
    fake.push('main', { [RAVEN]: serializeContent(live) }, 'content: fix raven on main');

    w.editSite((site) => setIn(site, 'contact.body', `${site.contact.body} Second.`));
    expect(await runSave(deps(w))).toBe('saved');
    expect(fake.log('draft')).toContain(MERGE);
    expect(w.getState().info).toMatchObject({ stale: [RAVEN], liveMerged: true });

    w.editProject(RAVEN, (p) => ({ ...p, pitch: `${p.pitch} More.` }));
    expect(await runSave(deps(w))).toBe('conflict');
    expect(draftJson(RAVEN).subtitle).toBe('Changed on the live branch');
  });

  it('the save answer names the merge and the files it changed', async () => {
    const first = await load();
    const raven = fileOf(first, RAVEN);
    raven.pitch = `${raven.pitch} Draft work.`;
    expect((await post(saveBodyFrom(first, [{ path: RAVEN, data: raven }]))).status).toBe(200);
    const tab = await load();
    const livePalm = fileOf(first, PALM);
    livePalm.subtitle = `${livePalm.subtitle} LIVE-CHANGE`;
    fake.push('main', { [PALM]: serializeContent(livePalm) });

    const moon = fileOf(tab, MOON);
    moon.subtitle = `${moon.subtitle} (draft)`;
    const saved = await post(saveBodyFrom(tab, [{ path: MOON, data: moon }]));
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ merged: true, moved: [PALM], changed: [MOON] });

    // The editor's palmsync is the copy from before the merge: a save of it is refused.
    const palm = fileOf(tab, PALM);
    palm.pitch = `${palm.pitch} Edited later.`;
    const later = await post({ ...saveBodyFrom(tab, [{ path: PALM, data: palm }]), base: saved.body.head });
    expect(later.status).toBe(409);
    expect(later.body).toMatchObject({ code: 'conflict', files: [PALM] });
    expect(draftJson(PALM).subtitle).toContain('LIVE-CHANGE');
  });

  it('words the save bar notice for stale files, with Reload only when nothing is unsaved', () => {
    expect(staleLine([RAVEN, SITE], true, 0)).toBe(
      '2 files changed on the draft after this editor loaded them (the published branch was merged into the draft): raven, the site file. ' +
        'Reload to see the new versions here.',
    );
    expect(staleLine([RAVEN], false, 3)).toBe(
      '1 file changed on the draft after this editor loaded it: raven. Save or undo your unsaved changes first, then reload to see the new versions here.',
    );
  });

  it('the save bar shows stale files with Reload while nothing is unsaved, and asks to save or undo first otherwise', async () => {
    const store = await loaded();
    const noop = () => undefined;
    const render = () =>
      renderToStaticMarkup(
        h(AdminProvider, {
          store,
          children: h(SaveBar, { deploy: IDLE_DEPLOY, sessionEnded: false, onSave: noop, onPublish: noop, onDiscard: noop, onSignIn: noop, onReload: noop }),
        }),
      );
    const reloadButton = /<button[^>]*>(?:(?!<\/button>).)*Reload<\/button>/;
    expect(render()).not.toContain('changed on the draft');
    store.noteStale([RAVEN]);
    let html = render();
    expect(html).toContain(staleLine([RAVEN], false, 0));
    expect(html).toMatch(reloadButton);
    store.editSite((site) => setIn(site, 'contact.body', `${site.contact.body} Unsaved.`));
    html = render();
    expect(html).toContain(staleLine([RAVEN], false, 1));
    expect(html).not.toMatch(reloadButton);
  });

  it('the store records moved files as stale, clears the files a save wrote, and forgets them on load', async () => {
    const content = await load();
    const store = createAdminStore();
    store.load(content);
    const sent = { writes: [{ path: SITE, data: content.site.data, text: serializeContent(content.site.data) }], deletes: [] };
    store.noteStale([SITE]);
    store.saved(sent, { head: 'b'.repeat(40), commit: 'b'.repeat(40), warnings: [], preview: null, message: 'Saved.', moved: [RAVEN, PALM] });
    expect(store.getState().info).toMatchObject({ stale: [PALM, RAVEN], liveMerged: false, draftAhead: 1 });
    store.saved({ writes: [], deletes: [] }, { head: 'c'.repeat(40), commit: null, warnings: [], preview: null, message: 'Saved.', moved: [MOON], merged: true });
    expect(store.getState().info).toMatchObject({ stale: [MOON, PALM, RAVEN], liveMerged: true, draftAhead: 2 });
    store.load(content);
    expect(store.getState().info).toMatchObject({ stale: [], liveMerged: false });
  });
});

// ---------------------------------------------------------------------------------------------
// The per-file check
// ---------------------------------------------------------------------------------------------

describe('the per-file check', () => {
  it('textDigest is the SHA-256 of the UTF-8 text', () => {
    const samples = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'b'.repeat(63), 'c'.repeat(64), 'd'.repeat(65), 'café 中 😀', 'x'.repeat(100_000)];
    for (const text of samples) expect(textDigest(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
  });

  it('treats a stored file in another layout (CRLF, a final newline) as the version the editor holds', async () => {
    const main = fake.refs.get('main')!;
    fake.refs.set('draft', main);
    const raw = fake.filesAt('main').get(RAVEN)!;
    fake.push('draft', { [RAVEN]: `${raw.replace(/\n/g, '\r\n')}\r\n` }, 'edited on GitHub');
    const content = await load();

    const palm = fileOf(content, PALM);
    palm.subtitle = `${palm.subtitle} (edited)`;
    const first = await post(saveBodyFrom(content, [{ path: PALM, data: palm }]));
    expect(first.status).toBe(200);
    expect(first.body.moved).toEqual([]);

    const raven = fileOf(content, RAVEN);
    raven.pitch = `${raven.pitch} Saved over the other layout.`;
    const second = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]));
    expect(second.status).toBe(200);
    expect(fake.filesAt('draft').get(RAVEN)).toBe(serializeContent(raven));
  });

  it('refuses to write a file removed on the draft meanwhile, or to create one that now exists', async () => {
    const tab = await load();
    const other = await load();
    expect((await post(saveBodyFrom(other, [], [PLANT]))).status).toBe(200);
    const fresh = fileOf(other, RAVEN);
    Object.assign(fresh, { slug: 'new-thing', visible: false, featured: false });
    expect((await post(saveBodyFrom(other, [{ path: 'content/projects/new-thing.json', data: fresh }]))).status).toBe(200);
    const head = fake.refs.get('draft');

    const plant = fileOf(tab, PLANT);
    plant.subtitle = `${plant.subtitle} (edited)`;
    let answer = await post(saveBodyFrom(tab, [{ path: PLANT, data: plant }]));
    expect(answer).toMatchObject({ status: 409, body: { code: 'conflict', files: [PLANT] } });

    const mine = fileOf(tab, RAVEN);
    Object.assign(mine, { slug: 'new-thing', visible: false, featured: false, title: 'Mine' });
    answer = await post(saveBodyFrom(tab, [{ path: 'content/projects/new-thing.json', data: mine }]));
    expect(answer).toMatchObject({ status: 409, body: { code: 'conflict', files: ['content/projects/new-thing.json'] } });
    expect(fake.refs.get('draft')).toBe(head);
  });

  it('refuses a save that does not say which version of a file it holds, before anything is read', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    const before = fake.calls.length;
    let answer = await post({ base: content.head, files: [{ path: RAVEN, data: raven }], deletes: [], expected: {} });
    expect(answer.status).toBe(400);
    expect(answer.body.findings).toEqual([expect.objectContaining({ file: RAVEN, rule: 'PATH', message: SAVE_MESSAGES.noExpected })]);
    answer = await post({ ...saveBodyFrom(content, [{ path: RAVEN, data: raven }]), expected: { ...expectedFrom(content), '../.env': null } });
    expect(answer.status).toBe(400);
    expect(answer.body.findings).toContainEqual(expect.objectContaining({ file: '../.env', rule: 'PATH' }));
    expect(fake.calls.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
// CONTENT-1: a discard is never undone by a window that loaded the discarded draft
// ---------------------------------------------------------------------------------------------

describe('CONTENT-1: saves from a window that loaded a discarded draft', () => {
  async function discardNow(): Promise<void> {
    const res = await discard(adminRequest('POST', '/api/discard', { body: { confirm: true, draftHead: fake.refs.get('draft') ?? null } }));
    expect(res.status).toBe(200);
  }

  async function discardedRaven(): Promise<ContentResponse> {
    const first = await load();
    const raven = fileOf(first, RAVEN);
    raven.pitch = `${raven.pitch} DISCARDED.`;
    expect((await post(saveBodyFrom(first, [{ path: RAVEN, data: raven }]))).status).toBe(200);
    const tab = await load();
    expect(fileOf(tab, RAVEN).pitch).toContain('DISCARDED.');
    await discardNow();
    expect(fake.refs.get('draft')).toBe(fake.refs.get('main'));
    return tab;
  }

  it('refuses the save of a discarded file with 409, and the discard stands', async () => {
    const tab = await discardedRaven();
    const live = fake.refs.get('main');
    const raven = fileOf(tab, RAVEN);
    raven.subtitle = `${raven.subtitle} (tab B)`;
    const answer = await post(saveBodyFrom(tab, [{ path: RAVEN, data: raven }]));
    expect(answer).toMatchObject({ status: 409, body: { code: 'conflict', files: [RAVEN], error: SAVE_MESSAGES.stale } });
    expect(fake.refs.get('draft')).toBe(live);
    expect(fake.filesAt('draft').get(RAVEN)).not.toContain('DISCARDED.');
  });

  it('refuses it as well when another save followed the discard', async () => {
    const tab = await discardedRaven();
    const kept = await saveNote(PALM, 'Saved after the discard.');
    const raven = fileOf(tab, RAVEN);
    raven.subtitle = `${raven.subtitle} (tab B)`;
    const answer = await post(saveBodyFrom(tab, [{ path: RAVEN, data: raven }]));
    expect(answer).toMatchObject({ status: 409, body: { code: 'conflict', files: [RAVEN] } });
    expect(fake.refs.get('draft')).toBe(kept);
    expect(fake.filesAt('draft').get(RAVEN)).not.toContain('DISCARDED.');
  });

  it('lets that window save a file the discard did not touch, and names the discarded file as moved', async () => {
    const tab = await discardedRaven();
    const palm = fileOf(tab, PALM);
    palm.subtitle = `${palm.subtitle} (tab B)`;
    const answer = await post(saveBodyFrom(tab, [{ path: PALM, data: palm }]));
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ changed: [PALM], moved: [RAVEN], merged: false });
    expect(fake.filesAt('draft').get(RAVEN)).not.toContain('DISCARDED.');
    expect(fake.filesAt('draft').get(PALM)).toBe(serializeContent(palm));
  });
});

// ---------------------------------------------------------------------------------------------
// CONTENT-4: a refused save leaves the draft as it was
// ---------------------------------------------------------------------------------------------

describe('CONTENT-4: refused saves write nothing', () => {
  /** A draft whose stat proof leads to moonlamp, and a live branch that then hides moonlamp. */
  async function proofToHiddenMoon(alsoOnLive: Record<string, string> = {}): Promise<{ before: string; tab: ContentResponse }> {
    const first = await load();
    const site = fileOf(first, SITE);
    site.stats[0].proof = '/projects/moonlamp';
    expect((await post(saveBodyFrom(first, [{ path: SITE, data: site }]))).status).toBe(200);
    const before = fake.refs.get('draft')!;
    const moon = fileOf(first, MOON);
    moon.visible = false;
    fake.push('main', { [MOON]: serializeContent(moon), ...alsoOnLive });
    return { before, tab: await load() };
  }

  it('a refused first save creates no draft branch', async () => {
    const content = await load();
    const raven = fileOf(content, RAVEN);
    raven.visible = false;
    const answer = await post(saveBodyFrom(content, [{ path: RAVEN, data: raven }]));
    expect(answer).toMatchObject({ status: 422, body: { code: 'content-check' } });
    expect(fake.refs.has('draft')).toBe(false);
    expect(fake.writes()).toEqual([]);
  });

  it('puts back a merge whose content the check refuses; the save after the fix lands on a new merge', async () => {
    const { before, tab } = await proofToHiddenMoon();
    const palm = fileOf(tab, PALM);
    palm.subtitle = `${palm.subtitle} (edited)`;
    const refused = await post(saveBodyFrom(tab, [{ path: PALM, data: palm }]));
    expect(refused.status).toBe(422);
    expect(refused.body.findings).toContainEqual(expect.objectContaining({ file: SITE, path: 'stats[0].proof', rule: 'PROOF' }));
    expect(fake.refs.get('draft')).toBe(before);
    expect(draftErrors()).toEqual([]);

    // The owner fixes the named field and saves again from the same editor.
    const site = fileOf(tab, SITE);
    site.stats[0].proof = '/projects/raven';
    const saved = await post(saveBodyFrom(tab, [{ path: SITE, data: site }, { path: PALM, data: palm }]));
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ merged: true, moved: [MOON] });
    expect(fake.log('draft')[1]).toBe(MERGE);
    expect(draftJson(MOON).visible).toBe(false);
    expect(draftJson(SITE).stats[0].proof).toBe('/projects/raven');
    expect(draftErrors()).toEqual([]);
  });

  it('puts back the merge of "Bring the draft up to date" (a save with no files) when the check refuses it', async () => {
    const { before, tab } = await proofToHiddenMoon();
    const refused = await post(saveBodyFrom(tab, []));
    expect(refused).toMatchObject({ status: 422, body: { code: 'content-check' } });
    expect(fake.refs.get('draft')).toBe(before);
    expect(draftErrors()).toEqual([]);
  });

  it('keeps a merge that changed a file the save writes when the merge passes the check, so a reload brings it in', async () => {
    await saveNote(RAVEN, 'Draft.');
    const tab = await load();
    const before = fake.refs.get('draft');
    const livePalm = JSON.parse(fake.filesAt('main').get(PALM)!) as Json;
    livePalm.pitch = `${livePalm.pitch} LIVE.`;
    fake.push('main', { [PALM]: serializeContent(livePalm) });

    const palm = fileOf(tab, PALM);
    palm.subtitle = `${palm.subtitle} (edited)`;
    const refused = await post(saveBodyFrom(tab, [{ path: PALM, data: palm }]));
    expect(refused).toMatchObject({ status: 409, body: { code: 'conflict', files: [PALM], error: SAVE_MESSAGES.mergedIn } });
    expect(fake.refs.get('draft')).not.toBe(before);
    expect(fake.log('draft')[0]).toBe(MERGE);
    expect(draftErrors()).toEqual([]);

    const reloaded = await load();
    expect(fileOf(reloaded, PALM).pitch).toContain('LIVE.');
    const again = fileOf(reloaded, PALM);
    again.subtitle = `${again.subtitle} (edited)`;
    expect((await post(saveBodyFrom(reloaded, [{ path: PALM, data: again }]))).status).toBe(200);
    expect(draftJson(PALM)).toMatchObject({ pitch: expect.stringContaining('LIVE.'), subtitle: expect.stringContaining('(edited)') });
  });

  it('puts back a merge that fails the check on its own even when it also changed a file the save writes', async () => {
    const livePalm = JSON.parse(fake.filesAt('main').get(PALM)!) as Json;
    livePalm.pitch = `${livePalm.pitch} LIVE.`;
    const { before, tab } = await proofToHiddenMoon({ [PALM]: serializeContent(livePalm) });

    // Only palmsync: the merged draft still fails, so this is the content check's refusal.
    const palm = fileOf(tab, PALM);
    palm.subtitle = `${palm.subtitle} (edited)`;
    const refused = await post(saveBodyFrom(tab, [{ path: PALM, data: palm }]));
    expect(refused.status).toBe(422);
    expect(refused.body.findings).toContainEqual(expect.objectContaining({ file: SITE, path: 'stats[0].proof', rule: 'PROOF' }));
    expect(fake.refs.get('draft')).toBe(before);

    // With the proof fixed too, the merge passes only with this save's other edit: save that first.
    const site = fileOf(tab, SITE);
    site.stats[0].proof = '/projects/raven';
    const asked = await post(saveBodyFrom(tab, [{ path: SITE, data: site }, { path: PALM, data: palm }]));
    expect(asked).toMatchObject({ status: 409, body: { code: 'conflict', files: [PALM], error: SAVE_MESSAGES.notMergedIn } });
    expect(fake.refs.get('draft')).toBe(before);

    const fixed = await post(saveBodyFrom(tab, [{ path: SITE, data: site }]));
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ merged: true, moved: [MOON, PALM] });
    expect(draftErrors()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// CONTENT-3: Discard drops only what the dialog showed
// ---------------------------------------------------------------------------------------------

describe('CONTENT-3: a discard carries the draft head it showed', () => {
  it('refuses a discard after a save the dialog did not show, and that save survives', async () => {
    await saveNote(RAVEN, 'Throw away.');
    const shown = await plan();
    expect(shown).toMatchObject({ draftHead: fake.refs.get('draft'), ahead: 1 });
    expect(discardLine(shown)).toBe(`1 saved commit not yet published, changing 1 file, is removed from the draft (now at commit ${shown.draftHead!.slice(0, 7)}).`);

    const kept = await saveNote(PALM, 'Keep me, saved in another window.');
    const before = fake.calls.length;
    let res = await discard(adminRequest('POST', '/api/discard', { body: { confirm: true, draftHead: shown.draftHead } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'conflict', error: REPO_MESSAGES.draftMoved });
    expect(fake.refs.get('draft')).toBe(kept);
    expect(fake.calls.slice(before).filter((call) => call.method !== 'GET')).toEqual([]);

    // Shown again, the owner confirms the draft as it is now.
    const again = await plan();
    expect(again).toMatchObject({ draftHead: kept, ahead: 2 });
    res = await discard(adminRequest('POST', '/api/discard', { body: { confirm: true, draftHead: again.draftHead } }));
    expect(res.status).toBe(200);
    expect(fake.refs.get('draft')).toBe(fake.refs.get('main'));
  });

  it('reads the draft once more just before the forced update', async () => {
    await saveNote(RAVEN, 'Throw away.');
    const shown = fake.refs.get('draft')!;
    let reads = 0;
    // A save lands between the route's own read and the reset's read.
    fake.overrides.set('GET /git/ref/heads/draft', () => {
      reads += 1;
      if (reads === 2) fake.push('draft', { [PALM]: '{"late": true}' }, 'content: update palmsync');
      return undefined;
    });
    const before = fake.calls.length;
    const res = await discard(adminRequest('POST', '/api/discard', { body: { confirm: true, draftHead: shown } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'conflict', error: REPO_MESSAGES.draftMoved });
    expect(reads).toBe(2);
    expect(fake.log('draft')[0]).toBe('content: update palmsync');
    expect(fake.calls.slice(before).filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('the dialog offers no discard until it has read the draft as it is now', async () => {
    const store = await loaded();
    const html = renderToStaticMarkup(h(AdminProvider, { store, children: h(DiscardDialog, { open: true, onClose: () => undefined, onDiscarded: () => undefined }) }));
    expect(html).toContain('Checking the draft.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Discard the draft<\/button>/);
  });

  it('says plainly when there is nothing to discard', () => {
    expect(discardLine({ draftHead: null, ahead: 0, files: [] })).toBe('The draft has no saved changes that are not published, so the branch stays as it is.');
  });
});

// ---------------------------------------------------------------------------------------------
// CONTENT-2: Publish waits for the draft head's own build
// ---------------------------------------------------------------------------------------------

function deployment(id: number, sha: string, state: string, url?: string): FakeDeployment {
  return {
    id,
    sha,
    environment: 'Preview',
    created_at: '2026-11-18T10:00:00Z',
    statuses: [{ state, created_at: '2026-11-18T10:01:00Z', ...(url ? { environment_url: url } : {}) }],
  };
}

describe('CONTENT-2: the publish gate', () => {
  beforeEach(() => {
    // GitHub's deployment records (Q-31), on the production deployment.
    stubAdminEnv({ VERCEL_TOKEN: '', VERCEL_PROJECT_ID: '', VERCEL_ENV: 'production' });
    fake.deployments = [];
  });

  it('refuses a head whose preview has not started, even after an older head failed', async () => {
    const failed = await saveNote(RAVEN, 'First.');
    fake.deployments = [deployment(1, failed, 'failure')];
    const head = await saveNote(RAVEN, 'Second.');
    const result = await plan();
    expect(result).toMatchObject({ draftHead: head, allowed: false, reasons: [DEPLOY_MESSAGES.notStarted], deployDetail: null });
    const live = fake.refs.get('main');
    const res = await publish(adminRequest('POST', '/api/publish', { body: { draftHead: head } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'not-allowed', error: DEPLOY_MESSAGES.notStarted });
    expect(fake.refs.get('main')).toBe(live);
  });

  it('after "Bring the draft up to date", waits for the merge head to build, then publishes it', async () => {
    const first = await saveNote(RAVEN, 'Draft.');
    fake.deployments = [deployment(1, first, 'success', 'https://site-first.vercel.app')];
    const livePalm = JSON.parse(fake.filesAt('main').get(PALM)!) as Json;
    livePalm.subtitle = `${livePalm.subtitle} (live)`;
    fake.push('main', { [PALM]: serializeContent(livePalm) });
    expect(await plan()).toMatchObject({ behind: 1, allowed: false });

    const merged = await post(saveBodyFrom(await load(), []));
    expect(merged.body).toMatchObject({ merged: true, commit: null });
    const head = merged.body.head as string;
    expect(await plan()).toMatchObject({ draftHead: head, behind: 0, allowed: false, reasons: [DEPLOY_MESSAGES.notStarted] });
    expect((await publish(adminRequest('POST', '/api/publish', { body: { draftHead: head } }))).status).toBe(403);

    fake.deployments.push(deployment(2, head, 'success', 'https://site-merged.vercel.app'));
    expect(await plan()).toMatchObject({ allowed: true, reasons: [], deploy: { state: 'ready', sha: head } });
    expect((await publish(adminRequest('POST', '/api/publish', { body: { draftHead: head } }))).status).toBe(200);
    expect(fake.refs.get('main')).toBe(head);
  });

  it('refuses a canceled build of the head like a failed one', async () => {
    stubAdminEnv({ VERCEL_ENV: 'production' });
    const head = await saveNote(RAVEN, 'Canceled.');
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input instanceof Request ? input.url : input).startsWith('https://api.vercel.com/')) return fake.fetch(input, init);
      const deployments = [{ url: 'site-c.vercel.app', created: 2, readyState: 'CANCELED', target: null, meta: { githubCommitSha: head, githubCommitRef: 'draft' } }];
      return new Response(JSON.stringify({ deployments }), { status: 200 });
    });
    expect(await plan()).toMatchObject({ allowed: false, reasons: [DEPLOY_MESSAGES.buildCanceled], deploy: { state: 'canceled', sha: head } });
    expect((await publish(adminRequest('POST', '/api/publish', { body: { draftHead: head } }))).status).toBe(403);
    expect(deployBlocksPublish({ state: 'canceled', url: null, sha: head, createdAt: null }, head)).toBe(DEPLOY_MESSAGES.buildCanceled);
  });

  it('publishes without the build only when deploy state cannot be read, and the plan says so', async () => {
    fake.deployments = null;
    const head = await saveNote(RAVEN, 'Unknown build.');
    const result = await plan();
    expect(result).toMatchObject({ allowed: true, reasons: [], deploy: null, deployDetail: DEPLOY_MESSAGES.unread(DEPLOY_MESSAGES.githubCannotRead) });
    expect((await publish(adminRequest('POST', '/api/publish', { body: { draftHead: head } }))).status).toBe(200);
  });

  it('Vercel: a head missing from a full list is not known; missing from a shorter one, it has not started', async () => {
    const head = 'a'.repeat(40);
    const settings = { token: 'SYNTHETICvercelTOKEN', projectId: 'prj_SYNTHETIC', teamId: null };
    const listOf = (count: number) => async () =>
      new Response(
        JSON.stringify({
          deployments: Array.from({ length: count }, (_, i) => ({
            url: `site-${i}.vercel.app`,
            created: 100 - i,
            readyState: 'READY',
            meta: { githubCommitSha: String(i % 10).repeat(40), githubCommitRef: 'other' },
          })),
        }),
        { status: 200 },
      );
    const heads = { live: 'b'.repeat(40), draft: head };
    const full = await lookupDeploys({ heads, liveBranch: 'main', draftBranch: 'draft', only: 'draft', fetch: listOf(10), vercel: settings });
    expect(full).toMatchObject({ source: 'vercel', draft: null, draftUnknown: DEPLOY_MESSAGES.beyondVercelList });
    expect(deployBlocksPublish(full.draft, head, full.draftUnknown === null)).toBeNull();
    const short = await lookupDeploys({ heads, liveBranch: 'main', draftBranch: 'draft', only: 'draft', fetch: listOf(3), vercel: settings });
    expect(short).toMatchObject({ source: 'vercel', draft: null, draftUnknown: null });
    expect(deployBlocksPublish(short.draft, head, short.draftUnknown === null)).toBe(DEPLOY_MESSAGES.notStarted);
  });
});
