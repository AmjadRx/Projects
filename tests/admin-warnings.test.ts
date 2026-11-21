/**
 * The admin's guard-rail warnings over the working copy (components/admin/state/warnings.ts), and
 * the pure helpers every editor uses to change it (components/admin/ui/paths.ts and list.ts).
 * The seed is read from content/ and never written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectFileOf, serializeContent, SITE_FILE, type ContentResponse, type Finding } from '../lib/admin/contract';
import { createAdminStore, isDirty, type AdminStore, type Doc } from '../components/admin/state/store';
import {
  computeWarnings,
  countByFile,
  DOCUMENTED_AVAILABILITY,
  isLinkedInUrl,
  linkKindIssue,
  looksLikeResume,
} from '../components/admin/state/warnings';
import { childPath, getIn, joinPath, parsePath, pathWithin, setIn, updateIn } from '../components/admin/ui/paths';
import { deepCopy, dropIndex, duplicateItem, insertItem, moveItem, removeItem, replaceItem } from '../components/admin/ui/list';

const ROOT = path.resolve(__dirname, '..');

function seedContent(): ContentResponse {
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const projectFiles = fs
    .readdirSync(path.join(ROOT, 'content/projects'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => `content/projects/${name}`);
  return {
    ok: true,
    source: 'disk',
    ref: null,
    head: null,
    liveHead: null,
    draftExists: false,
    draftAhead: 0,
    liveBranch: null,
    draftBranch: null,
    site: { file: SITE_FILE, data: read(SITE_FILE) },
    projects: projectFiles.map((file) => ({ file, data: read(file) })),
    findings: [],
    preview: null,
  };
}

function seedStore(): AdminStore {
  const store = createAdminStore();
  store.begin();
  store.load(seedContent());
  return store;
}

function docOf(store: AdminStore): Doc {
  const doc = store.getState().doc;
  if (!doc) throw new Error('no document');
  return doc;
}

/** Photos with a file in a JSON value, counted without the module under test. */
function photosWithFiles(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((n: number, item) => n + photosWithFiles(item), 0);
  if (value === null || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const own = record.kind === 'image' && typeof record.src === 'string' && record.src.trim() !== '' ? 1 : 0;
  return own + Object.values(record).reduce((n: number, item) => n + photosWithFiles(item), 0);
}

function find(findings: Finding[], rule: string, file: string, at: string): Finding | undefined {
  return findings.find((f) => f.rule === rule && f.file === file && f.path === at);
}

const RAVEN = projectFileOf('raven');

describe('warnings over the seed', () => {
  it('report no errors, a missing alt text for every photo, and the five projects without a cover', () => {
    const store = seedStore();
    const doc = docOf(store);
    const findings = computeWarnings(doc);

    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(new Set(findings.map((f) => f.rule))).toEqual(new Set(['ALT-TEXT', 'COVER']));

    // Every seed photo has an empty alt (CLAUDE.md): one warning per photo with a file.
    const photos = photosWithFiles(doc.site) + doc.projects.reduce((n, entry) => n + photosWithFiles(entry.data), 0);
    expect(photos).toBeGreaterThan(10);
    expect(findings.filter((f) => f.rule === 'ALT-TEXT')).toHaveLength(photos);
    expect(find(findings, 'ALT-TEXT', SITE_FILE, 'personal.photo.alt')).toBeDefined();
    expect(find(findings, 'ALT-TEXT', RAVEN, 'cover.alt')).toBeDefined();

    const covers = findings.filter((f) => f.rule === 'COVER').map((f) => f.file);
    expect(covers.sort()).toEqual(
      ['can-bus-diagnostic-tool', 'dbvf-senior-design', 'moonlamp', 'pipelined-cpu-verilog', 'stm32-embedded-projects'].map(projectFileOf),
    );
    expect(findings.every((f) => f.path !== '' && f.message.length > 10)).toBe(true);
  });

  it('come in file order: the site file first, then the projects as they are listed', () => {
    const doc = docOf(seedStore());
    const files = [SITE_FILE, ...doc.projects.map((entry) => projectFileOf(entry.data.slug))];
    const order = computeWarnings(doc).map((f) => files.indexOf(f.file));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('are memoized by document identity', () => {
    const store = seedStore();
    const before = docOf(store);
    const first = computeWarnings(before);
    expect(computeWarnings(before)).toBe(first);
    store.editSite((site) => setIn(site, 'personal.tagline', 'Changed for the test.'));
    const after = computeWarnings(docOf(store));
    expect(after).not.toBe(first);
    store.undo();
    expect(docOf(store)).toBe(before);
    expect(computeWarnings(docOf(store))).toBe(first);
  });

  it('count by file', () => {
    const counts = countByFile(computeWarnings(docOf(seedStore())));
    expect(counts[0].file).toBe(SITE_FILE);
    const raven = counts.find((c) => c.file === RAVEN);
    expect(raven?.errors).toBe(0);
    expect(raven?.warnings).toBeGreaterThan(0);
  });
});

describe('warnings after edits', () => {
  const ravenKey = RAVEN;

  it('flag an empty highlight, and drop a photo warning once it has alt text', () => {
    const store = seedStore();
    store.editProject(ravenKey, (p) => setIn(setIn(p, 'highlights[0]', '   '), 'cover.alt', 'The Raven testbed on the bench.'));
    const findings = computeWarnings(docOf(store));
    expect(find(findings, 'HIGHLIGHT', RAVEN, 'highlights[0]')).toMatchObject({ severity: 'warning' });
    expect(find(findings, 'ALT-TEXT', RAVEN, 'cover.alt')).toBeUndefined();
  });

  it('flag a file name that looks like a resume, and a model or document without a description', () => {
    const store = seedStore();
    store.editProject(ravenKey, (p) => setIn(p, 'cover.src', '/media/raven/Amjad_Rehawi_Resume.pdf'));
    store.editProject(ravenKey, (p) =>
      setIn(p, 'blocks', [
        ...p.blocks,
        { id: 'test-model', type: 'model3d', media: { kind: 'model', src: '/media/raven/frame.glb', alt: '' } },
        { id: 'test-doc', type: 'document', media: { kind: 'document', src: '/media/raven/notes.pdf', alt: ' ' } },
        { id: 'test-file', type: 'file', label: 'Download', src: '/media/raven/cv.pdf' },
      ]),
    );
    const findings = computeWarnings(docOf(store));
    const blocks = docOf(store).projects.find((e) => e.key === ravenKey)!.data.blocks.length;
    expect(find(findings, 'RESUME-FILE', RAVEN, 'cover.src')).toBeDefined();
    expect(find(findings, 'DESCRIPTION', RAVEN, `blocks[${blocks - 3}].media.alt`)).toBeDefined();
    expect(find(findings, 'DESCRIPTION', RAVEN, `blocks[${blocks - 2}].media.alt`)).toBeDefined();
    expect(find(findings, 'RESUME-FILE', RAVEN, `blocks[${blocks - 1}].src`)).toBeDefined();
  });

  it('flag a LinkedIn link with another label', () => {
    const store = seedStore();
    const i = docOf(store).site.socialLinks.findIndex((l) => isLinkedInUrl(l.url));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(find(computeWarnings(docOf(store)), 'LINKEDIN-LABEL', SITE_FILE, `socialLinks[${i}].label`)).toBeUndefined();
    store.editSite((site) => setIn(site, `socialLinks[${i}].label`, 'My profile'));
    expect(find(computeWarnings(docOf(store)), 'LINKEDIN-LABEL', SITE_FILE, `socialLinks[${i}].label`)).toMatchObject({ severity: 'warning' });
  });

  it('flag an availability line that differs from the documented one', () => {
    const store = seedStore();
    expect(docOf(store).site.personal.availability).toBe(DOCUMENTED_AVAILABILITY);
    store.editSite((site) => setIn(site, 'personal.availability', 'Available: Full-time, May 2027'));
    expect(find(computeWarnings(docOf(store)), 'AVAILABILITY', SITE_FILE, 'personal.availability')).toMatchObject({ severity: 'warning' });
    store.editSite((site) => setIn(site, 'personal.availability', ''));
    expect(computeWarnings(docOf(store)).some((f) => f.rule === 'AVAILABILITY')).toBe(false);
  });

  it('flag links outside the allowed kinds, in link fields and in Markdown', () => {
    const store = seedStore();
    const nav = docOf(store).site.nav.length;
    store.editSite((site) => setIn(site, `nav[${nav}]`, { label: 'Elsewhere', href: 'www.example.com' }));
    store.editSite((site) => setIn(site, 'thesis.body', 'Read [the notes](javascript:alert(1)) first.'));
    store.editProject(ravenKey, (p) => setIn(p, `links[${p.links.length}]`, { label: 'Old page', url: 'http://example.com/old' }));
    const findings = computeWarnings(docOf(store));
    expect(find(findings, 'LINK-KIND', SITE_FILE, `nav[${nav}].href`)?.message).toContain('plain text');
    expect(find(findings, 'LINK-KIND', SITE_FILE, 'thesis.body')).toMatchObject({ severity: 'warning' });
    const links = docOf(store).projects.find((e) => e.key === ravenKey)!.data.links.length;
    expect(find(findings, 'LINK-KIND', RAVEN, `links[${links - 1}].url`)?.message).toContain('https');
  });

  it('flag a broken internal link and a proof to a hidden project', () => {
    const store = seedStore();
    const nav = docOf(store).site.nav.length;
    store.editSite((site) => setIn(site, `nav[${nav}]`, { label: 'Old page', href: '/old-page' }));
    store.editProject(ravenKey, (p) => ({ ...p, visible: false }));
    const findings = computeWarnings(docOf(store));
    expect(find(findings, 'INTERNAL-LINK', SITE_FILE, `nav[${nav}].href`)).toMatchObject({ severity: 'warning' });
    const stat = docOf(store).site.stats.findIndex((s) => s.proof === '/projects/raven');
    expect(find(findings, 'PROOF', SITE_FILE, `stats[${stat}].proof`)).toBeDefined();
  });

  it('report a public-rule hit and a schema problem as errors, ahead of the warnings', () => {
    const store = seedStore();
    store.editSite((site) => setIn(site, 'thesis.body', 'a patented charger design'));
    let findings = computeWarnings(docOf(store));
    expect(find(findings, 'IP-CLAIM', SITE_FILE, 'thesis.body')).toMatchObject({ severity: 'error' });
    expect(findings[0].severity).toBe('error');

    store.editProject(ravenKey, (p) => ({ ...p, title: '' }));
    findings = computeWarnings(docOf(store));
    expect(find(findings, 'SCHEMA', RAVEN, 'title')).toMatchObject({ severity: 'error' });
    // The guard rails still run while a file fails the schema.
    expect(findings.some((f) => f.rule === 'ALT-TEXT')).toBe(true);
  });
});

describe('resume names and LinkedIn addresses', () => {
  it('recognize resume and CV file names, and nothing else', () => {
    for (const yes of ['resume.pdf', '/media/site/Amjad_Rehawi_Resume.pdf', 'my-cv.docx', '/media/x/CV.pdf', 'Curriculum-Vitae.pdf', 'résumé 2026.pdf']) {
      expect(looksLikeResume(yes), yes).toBe(true);
    }
    for (const no of ['', 'presume.png', '/media/raven/img-7657.jpeg', 'cv2-board.jpg', 'curve.png', 'cvt-motor.jpg']) {
      expect(looksLikeResume(no), no).toBe(false);
    }
  });

  it('recognize LinkedIn hosts only', () => {
    expect(isLinkedInUrl('https://www.linkedin.com/in/someone/')).toBe(true);
    expect(isLinkedInUrl('https://linkedin.com')).toBe(true);
    expect(isLinkedInUrl('https://lnkd.in/abc')).toBe(true);
    expect(isLinkedInUrl('https://notlinkedin.com/in/x')).toBe(false);
    expect(isLinkedInUrl('linkedin')).toBe(false);
  });

  it('accept the allowed kinds of link address, and say what is wrong with the rest', () => {
    for (const ok of ['', '/projects/raven', '/projects/raven#log', '#top', 'https://github.com/someone', 'mailto:someone@example.com', 'tel:+15550100']) {
      expect(linkKindIssue(ok), ok).toBeNull();
    }
    expect(linkKindIssue('http://example.com')).toContain('https');
    for (const bad of ['www.example.com', 'javascript:alert(1)', '//example.com/x', 'ftp://example.com/file', 'projects/raven', 'mailto:']) {
      expect(linkKindIssue(bad), bad).toContain('plain text');
    }
  });
});

describe('field paths', () => {
  it('parse and join the notation the content check uses', () => {
    expect(parsePath('blocks[3].items[1].alt')).toEqual(['blocks', 3, 'items', 1, 'alt']);
    expect(parsePath('')).toEqual([]);
    expect(joinPath(['stats', 2, 'proof'])).toBe('stats[2].proof');
    expect(joinPath(parsePath('skills.groups[0].items[4].proof'))).toBe('skills.groups[0].items[4].proof');
    expect(childPath('stats', 2)).toBe('stats[2]');
    expect(childPath('stats[2]', 'label')).toBe('stats[2].label');
    expect(childPath('', 'seo')).toBe('seo');
  });

  it('tell when a path lies inside another, on segment boundaries', () => {
    expect(pathWithin('blocks[3].md', 'blocks[3]')).toBe(true);
    expect(pathWithin('blocks[3]', 'blocks[3]')).toBe(true);
    expect(pathWithin('blocks[30].md', 'blocks[3]')).toBe(false);
    expect(pathWithin('personalx', 'personal')).toBe(false);
    expect(pathWithin('anything', '')).toBe(true);
  });

  it('read values, missing steps as undefined', () => {
    const site = docOf(seedStore()).site;
    expect(getIn(site, 'personal.name')).toBe(site.personal.name);
    expect(getIn(site, 'stats[0].value')).toBe(site.stats[0].value);
    expect(getIn(site, 'nope.deeper[2]')).toBeUndefined();
  });

  it('write immutably: new objects only along the path, the same root for an equal value', () => {
    const site = docOf(seedStore()).site;
    const next = setIn(site, 'stats[1].label', 'New label');
    expect(next).not.toBe(site);
    expect(next.stats).not.toBe(site.stats);
    expect(next.stats[1]).not.toBe(site.stats[1]);
    expect(next.stats[0]).toBe(site.stats[0]);
    expect(next.personal).toBe(site.personal);
    expect(next.stats[1].label).toBe('New label');
    expect(site.stats[1].label).not.toBe('New label');
    expect(setIn(site, 'stats[1].label', site.stats[1].label)).toBe(site);
    expect(updateIn(site, 'stats', (stats: unknown[]) => stats)).toBe(site);
  });

  it('keep key order, and keep a key in place when it is set to undefined', () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(Object.keys(setIn(obj, 'b', 9))).toEqual(['a', 'b', 'c']);
    const cleared = setIn(obj, 'b', undefined);
    expect(JSON.stringify(cleared)).toBe('{"a":1,"c":3}');
    expect(Object.keys(setIn(cleared, 'b', 5))).toEqual(['a', 'b', 'c']);
    expect(setIn(obj, 'missing', undefined)).toBe(obj);
    expect(setIn({}, 'x.y[0]', 'z')).toEqual({ x: { y: ['z'] } });
    expect(() => setIn({ list: [1] }, 'list[3]', 2)).toThrow(RangeError);
  });

  it('leave a file clean after an edit and its reverse', () => {
    const store = seedStore();
    const name = docOf(store).site.personal.name;
    store.editSite((site) => setIn(site, 'personal.name', 'Someone else'));
    expect(isDirty(store.getState().doc, store.getState().info)).toBe(true);
    store.editSite((site) => setIn(site, 'personal.name', name));
    expect(isDirty(store.getState().doc, store.getState().info)).toBe(false);
    expect(serializeContent(docOf(store).site)).toBe(fs.readFileSync(path.join(ROOT, SITE_FILE), 'utf8'));
  });
});

describe('list operations', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('move, insert, remove, and replace without touching the original', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(list, 1, 9)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 7, 0)).toBe(list);
    expect(insertItem(list, 'x', 1)).toEqual(['a', 'x', 'b', 'c', 'd']);
    expect(insertItem(list, 'x')).toEqual(['a', 'b', 'c', 'd', 'x']);
    expect(removeItem(list, 2)).toEqual(['a', 'b', 'd']);
    expect(removeItem(list, 9)).toBe(list);
    expect(replaceItem(list, 1, 'B')).toEqual(['a', 'B', 'c', 'd']);
    expect(replaceItem(list, 1, 'b')).toBe(list);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('duplicate with a deep copy, or with the caller clone', () => {
    const rows = [{ label: 'One', tags: ['x'] }];
    const copied = duplicateItem(rows, 0);
    expect(copied).toHaveLength(2);
    expect(copied[1]).toEqual(rows[0]);
    expect(copied[1]).not.toBe(rows[0]);
    expect(copied[1].tags).not.toBe(rows[0].tags);
    const blocks = [{ id: 'b1', type: 'text' }];
    expect(duplicateItem(blocks, 0, (b) => ({ ...b, id: 'b2' }))[1].id).toBe('b2');
    expect(deepCopy(undefined)).toBeUndefined();
  });

  it('work out where a dragged row lands', () => {
    // Dropping row 0 before row 3 puts it at index 2; dropping row 3 before row 0 puts it at 0.
    expect(dropIndex(0, 3)).toBe(2);
    expect(dropIndex(3, 0)).toBe(0);
    expect(dropIndex(1, 4)).toBe(3);
    expect(moveItem(list, 0, dropIndex(0, 3))).toEqual(['b', 'c', 'a', 'd']);
  });
});
