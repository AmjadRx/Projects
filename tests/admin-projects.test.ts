// @vitest-environment jsdom
// jsdom for the "Revert this file to published" flow at the end; the other tests are logic only.
import fs from 'node:fs';
import path from 'node:path';
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { projectFileOf, SITE_FILE, type ContentResponse } from '../lib/admin/contract';
import { BlockSchema, KNOWN_BLOCK_TYPES, ProjectSchema, type Block, type TwoColBlock } from '../lib/schema';
import type { Project, Site } from '../lib/types';
import { createAdminStore, pathOfEntry, textOf, type Doc } from '../components/admin/state/store';
import {
  BLOCK_TYPES,
  blockIdPrefix,
  blockIdSource,
  blockKeys,
  blockSummary,
  collectBlockIds,
  copyBlock,
  copySlug,
  duplicateProject,
  idLetters,
  insertBlock,
  isLastVisible,
  newBlock,
  newProject,
  newProjectSlug,
  prefixFromSlug,
  resolveEntry,
  setBlockAt,
  setBlockIn,
  setProjectIn,
  statusWords,
  withFields,
} from '../components/admin/projects/logic';
import {
  applyPatches,
  deleteProject,
  findSlugReferences,
  linksToSlug,
  planRemoval,
  removalPatches,
  renamePatches,
  renameProject,
  rewriteHref,
  rewriteMarkdown,
  unlinkMarkdown,
  type SlugReference,
} from '../components/admin/projects/references';
import { LAST_VISIBLE } from '../components/admin/projects/logic';
import { mediaFolderOf } from '../components/admin/projects/ProjectEditor';
import { renameMediaNote } from '../components/admin/projects/ReferencesDialog';
import { folderExists } from '../components/admin/media/services';
import { RevertFileButton } from '../components/admin/shell/RevertFile';
import { AdminProvider } from '../components/admin/state/hooks';
import { ConfirmProvider } from '../components/admin/ui/Confirm';

const ROOT = path.resolve(__dirname, '..');

function read(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function seedContent(): ContentResponse {
  const projectFiles = fs
    .readdirSync(path.join(ROOT, 'content/projects'))
    .sort()
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

function seedStore() {
  const store = createAdminStore(() => 0);
  store.load(seedContent());
  return store;
}

function seedDoc(): Doc {
  return seedStore().getState().doc as Doc;
}

function entryOf(doc: Doc, slug: string) {
  const entry = doc.projects.find((e) => e.data.slug === slug);
  if (!entry) throw new Error(`No seed project ${slug}`);
  return entry;
}

/** Every block in a list, two-column children included, outermost first. */
function allBlocks(blocks: readonly Block[]): Block[] {
  return blocks.flatMap((block) => {
    if (block.type !== 'twoCol') return [block];
    const two = block as TwoColBlock;
    return [block, ...allBlocks(two.left), ...allBlocks(two.right)];
  });
}

function nestedTwoCol(): TwoColBlock {
  return {
    id: 'rv-x',
    type: 'twoCol',
    left: [
      { id: 'rv-y', type: 'text', md: 'Left' },
      { id: 'rv-z', type: 'twoCol', left: [{ id: 'rv-aa', type: 'heading', text: 'Inner' }], right: [] },
    ],
    right: [{ id: 'rv-ab', type: 'linkRow', links: [{ label: 'Page', url: '/projects/raven#log' }] }],
  };
}

describe('new projects', () => {
  it('validate with ProjectSchema and start hidden and unfeatured with a unique slug', () => {
    const doc = seedDoc();
    const slugs = doc.projects.map((e) => e.data.slug);
    const project = newProject(slugs, slugs.length + 1);
    expect(ProjectSchema.safeParse(project).success).toBe(true);
    expect(project.visible).toBe(false);
    expect(project.featured).toBe(false);
    expect(project.slug).toBe('new-project-1');
    expect(slugs).not.toContain(project.slug);
    expect(project.cover).toEqual({ kind: 'image', src: '' });
    expect(project.blocks).toEqual([]);
  });

  it('number their slugs past the ones in use', () => {
    expect(newProjectSlug(['new-project-1', 'new-project-2', 'raven'])).toBe('new-project-3');
    expect(newProjectSlug(['new-project-2'])).toBe('new-project-1');
  });

  it('leave optional keys out of the stored text, and keep the seed key order when one is set', () => {
    const project = newProject([], 1);
    const text = textOf(project);
    for (const key of ['statusLabel', 'maturity', 'callouts', 'progress']) expect(text).not.toContain(`"${key}"`);
    const keys = Object.keys(JSON.parse(textOf({ ...project, statusLabel: 'Planned' })));
    expect(keys.indexOf('statusLabel')).toBe(keys.indexOf('status') + 1);
  });

  it('add to the store at the end, renumbered, and hidden', () => {
    const store = seedStore();
    const before = store.getState().doc as Doc;
    const key = store.addProject(newProject(before.projects.map((e) => e.data.slug), before.projects.length + 1));
    const after = store.getState().doc as Doc;
    const added = after.projects.find((e) => e.key === key);
    expect(added?.data.order).toBe(after.projects.length);
    expect(added?.loadedFile).toBeNull();
    expect(after.site).toBe(before.site);
  });
});

describe('duplicated projects', () => {
  it('validate with ProjectSchema for every seed project, hidden, unfeatured, with a unique slug and new block ids', () => {
    const doc = seedDoc();
    const slugs = doc.projects.map((e) => e.data.slug);
    for (const { data } of doc.projects) {
      const copy = duplicateProject(data, slugs);
      const parsed = ProjectSchema.safeParse(copy);
      expect(parsed.success, `${data.slug}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
      expect(slugs).not.toContain(copy.slug);
      expect(copy.slug).toBe(`${data.slug}-copy-1`);
      expect(copy.visible).toBe(false);
      expect(copy.featured).toBe(false);

      const originalIds = collectBlockIds(data.blocks);
      const copyIds = allBlocks(copy.blocks).map((b) => b.id as string);
      expect(new Set(copyIds).size).toBe(copyIds.length);
      for (const id of copyIds) expect(originalIds.has(id), `${data.slug}: ${id}`).toBe(false);

      // Everything else is copied as it was.
      const strip = (p: Project) => ({ ...p, slug: '', visible: false, featured: false, blocks: allBlocks(p.blocks).map((b) => ({ ...b, id: '' })) });
      expect(JSON.parse(textOf(strip(copy)))).toEqual(JSON.parse(textOf(strip(data))));
      // A deep copy: the source is untouched by edits to the copy.
      expect(copy.tags).not.toBe(data.tags);
    }
  });

  it('get a numbered slug that stays unique when copied again, and a copy of a copy counts on from the original', () => {
    expect(copySlug('raven', ['raven'])).toBe('raven-copy-1');
    expect(copySlug('raven', ['raven', 'raven-copy-1'])).toBe('raven-copy-2');
    expect(copySlug('raven-copy-1', ['raven', 'raven-copy-1'])).toBe('raven-copy-2');
    expect(copySlug('raven-copy', ['raven', 'raven-copy-1', 'raven-copy-2'])).toBe('raven-copy-3');
  });

  it('give two-column children new ids too', () => {
    const source = { ...(entryOf(seedDoc(), 'raven').data as Project), blocks: [nestedTwoCol()] };
    const copy = duplicateProject(source, ['raven']);
    const ids = allBlocks(copy.blocks).map((b) => b.id);
    expect(ids).toEqual(['rc-a', 'rc-b', 'rc-c', 'rc-d', 'rc-e']);
    expect(ProjectSchema.safeParse(copy).success).toBe(true);
  });
});

describe('blocks', () => {
  it('cover all 21 types of lib/schema.ts, and each new block validates', () => {
    expect(BLOCK_TYPES).toHaveLength(21);
    expect([...BLOCK_TYPES].sort()).toEqual([...KNOWN_BLOCK_TYPES].sort());
    for (const type of BLOCK_TYPES) {
      const block = newBlock(type, 'nb-a');
      const parsed = BlockSchema.safeParse(block);
      expect(parsed.success, `${type}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
      expect(block.type).toBe(type);
      expect(typeof blockSummary(block)).toBe('string');
    }
  });

  it('get ids in the project pattern, after the highest one in use', () => {
    const raven = entryOf(seedDoc(), 'raven').data;
    expect(blockIdPrefix(raven)).toBe('rv');
    const next = blockIdSource(raven);
    expect(next()).toBe('rv-k');
    expect(next()).toBe('rv-l');
    expect(prefixFromSlug('can-bus-diagnostic-tool')).toBe('cb');
    expect(prefixFromSlug('raven')).toBe('ra');
    expect(blockIdPrefix({ slug: 'smart-plant-care', blocks: [] })).toBe('sp');
    expect([1, 26, 27, 52, 53].map(idLetters)).toEqual(['a', 'z', 'aa', 'az', 'ba']);
    const crowded = blockIdSource({ slug: 'x', blocks: [{ id: 'x-a', type: 'text', md: '' }, { id: 'x-c', type: 'text', md: '' }] });
    expect(crowded()).toBe('x-d');
  });

  it('copy deeply with unique ids, recursively, none clashing with the project', () => {
    const raven = entryOf(seedDoc(), 'raven').data;
    const original = nestedTwoCol();
    const project = { ...raven, blocks: [...raven.blocks, original] };
    const next = blockIdSource(project);
    const copy = copyBlock(original, next);
    const before = collectBlockIds(project.blocks);
    const ids = allBlocks([copy]).map((b) => b.id as string);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(before.has(id), id).toBe(false);
    expect(BlockSchema.safeParse(copy).success).toBe(true);
    // Deep: changing the copy leaves the original alone.
    ((copy as TwoColBlock).left[0] as { md: string }).md = 'Changed';
    expect((original.left[0] as { md: string }).md).toBe('Left');
    // The whole project still has unique ids.
    const after = allBlocks(insertBlock(project.blocks, copy, project.blocks.length)).map((b) => b.id);
    expect(new Set(after).size).toBe(after.length);
  });

  it('keep a block without an id without one when copied', () => {
    const unknown = { type: 'sparkle', value: 1 } as Block;
    const copy = copyBlock(unknown, () => 'zz-a');
    expect(copy).toEqual(unknown);
    expect(copy).not.toBe(unknown);
    expect(blockSummary(unknown)).toBe('Kept as is');
  });

  it('give React keys that stay unique when ids repeat or are missing', () => {
    const keys = blockKeys([
      { id: 'a-a', type: 'text', md: '' },
      { id: 'a-b', type: 'text', md: '' },
      { id: 'a-b', type: 'text', md: '' },
      { type: 'sparkle' } as Block,
    ]);
    expect(keys).toEqual(['id:a-a', 'at:1', 'at:2', 'at:3']);
  });
});

describe('editing one block', () => {
  it('keeps every other block object identical', () => {
    const fsae = entryOf(seedDoc(), 'fsae-bronco-racing').data;
    const edited = setBlockIn(fsae, 'blocks[3]', { ...(fsae.blocks[3] as Block), heading: 'Changed' } as Block);
    expect(edited).not.toBe(fsae);
    expect(edited.blocks[3]).not.toBe(fsae.blocks[3]);
    fsae.blocks.forEach((block, i) => {
      if (i !== 3) expect(edited.blocks[i], `block ${i}`).toBe(block);
    });
    for (const key of Object.keys(fsae) as (keyof Project)[]) {
      if (key !== 'blocks') expect(edited[key], key).toBe(fsae[key]);
    }
  });

  it('keeps the siblings of a two-column child identical', () => {
    const raven = entryOf(seedDoc(), 'raven').data;
    const project = { ...raven, blocks: [...raven.blocks, nestedTwoCol()] };
    const at = project.blocks.length - 1;
    const edited = setBlockIn(project, `blocks[${at}].left[0]`, { id: 'rv-y', type: 'text', md: 'New' });
    const before = project.blocks[at] as TwoColBlock;
    const after = edited.blocks[at] as TwoColBlock;
    expect(after.left[0]).not.toBe(before.left[0]);
    expect(after.left[1]).toBe(before.left[1]);
    expect(after.right).toBe(before.right);
    project.blocks.slice(0, at).forEach((block, i) => expect(edited.blocks[i]).toBe(block));
  });

  it('makes no change when the block is the same, and through the store touches nothing else', () => {
    const list = entryOf(seedDoc(), 'raven').data.blocks;
    expect(setBlockAt(list, 0, list[0])).toBe(list);

    const store = seedStore();
    const doc = store.getState().doc as Doc;
    const raven = entryOf(doc, 'raven');
    store.editProject(raven.key, (p) => setBlockIn(p, 'blocks[0]', { ...(p.blocks[0] as Block), md: 'Edited' } as Block), { coalesce: 'x' });
    const after = store.getState().doc as Doc;
    expect(after.site).toBe(doc.site);
    after.projects.forEach((entry, i) => {
      if (entry.key === raven.key) {
        entry.data.blocks.slice(1).forEach((block, j) => expect(block).toBe(raven.data.blocks[j + 1]));
      } else {
        expect(entry).toBe(doc.projects[i]);
      }
    });
    expect(store.changes().writes.map((w) => w.path)).toEqual([projectFileOf('raven')]);
    store.undo();
    expect(store.changes().writes).toEqual([]);
  });

  it('puts a new optional key at its place in the schema order, and leaves existing keys where they are', () => {
    const plant = entryOf(seedDoc(), 'smart-plant-care').data;
    expect(Object.hasOwn(plant, 'maturity')).toBe(false);
    const withMaturity = setProjectIn(plant, 'maturity', { step: 2, label: 'Label' });
    const keys = Object.keys(withMaturity);
    expect(keys.indexOf('maturity')).toBe(keys.indexOf('statusLabel') + 1);
    expect(withMaturity.blocks).toBe(plant.blocks);
    const withSteps = setProjectIn(plant, 'progress.steps', [{ label: 'A', state: 'todo' }]);
    expect(Object.keys(withSteps).slice(-2)).toEqual(['progress', 'blocks']);
    // Clearing a key the project lacks changes nothing; an existing key keeps its position.
    expect(setProjectIn(plant, 'maturity', undefined)).toBe(plant);
    const raven = entryOf(seedDoc(), 'raven').data;
    expect(Object.keys(setProjectIn(raven, 'title', 'Other'))).toEqual(Object.keys(raven));
  });

  it('withFields keeps the object when nothing changes', () => {
    const block = { id: 'a-a', type: 'heading', text: 'Same' };
    expect(withFields(block, { text: 'Same' })).toBe(block);
    expect(withFields(block, { text: 'Other' })).toEqual({ id: 'a-a', type: 'heading', text: 'Other' });
  });
});

describe('visibility', () => {
  it('refuses to hide or delete the last visible project', () => {
    const projects = [
      { key: 'a', data: { visible: true } },
      { key: 'b', data: { visible: false } },
    ];
    expect(isLastVisible(projects, 'a')).toBe(true);
    expect(isLastVisible(projects, 'b')).toBe(false);
    expect(isLastVisible([...projects, { key: 'c', data: { visible: true } }], 'a')).toBe(false);
  });

  it('shows the status label, or the status in words', () => {
    expect(statusWords({ status: 'in-progress', statusLabel: '' })).toBe('In progress');
    expect(statusWords({ status: 'completed' })).toBe('Completed');
    expect(statusWords({ status: 'active', statusLabel: 'Stage 1 of 8' })).toBe('Stage 1 of 8');
  });
});

describe('the open project', () => {
  const projects = [
    { key: 'a', data: { slug: 'raven' } },
    { key: 'b', data: { slug: 'moonlamp' } },
  ];

  it('follows the hash when nothing is remembered, or the hash names another project', () => {
    expect(resolveEntry(projects, 'raven', null)?.key).toBe('a');
    expect(resolveEntry(projects, 'moonlamp', 'a')?.key).toBe('b');
    expect(resolveEntry(projects, 'nothing', null)).toBeUndefined();
  });

  it('stays on its project through a rename, an unfinished slug, and a slug two projects share', () => {
    const renamed = [{ key: 'a', data: { slug: 'raven-mk2' } }, projects[1]];
    expect(resolveEntry(renamed, 'raven', 'a')?.key).toBe('a');
    const typing = [{ key: 'a', data: { slug: 'raven-' } }, projects[1]];
    expect(resolveEntry(typing, 'raven', 'a')?.key).toBe('a');
    const shared = [{ key: 'a', data: { slug: 'moonlamp' } }, projects[1]];
    expect(resolveEntry(shared, 'moonlamp', 'a')?.key).toBe('a');
    expect(resolveEntry(shared, 'moonlamp', null)?.key).toBe('a');
  });

  it('lets go of a project that is gone', () => {
    expect(resolveEntry([projects[1]], 'raven', 'a')).toBeUndefined();
  });
});

/** The references the seed's site file holds for a slug, found by reading the JSON directly. */
function expectedSiteReferences(site: Site, slug: string): { path: string; kind: string }[] {
  const out: { path: string; kind: string }[] = [];
  site.nav.forEach((item, i) => {
    if (item.href === `/projects/${slug}`) out.push({ path: `nav[${i}].href`, kind: 'nav-link' });
  });
  site.now.forEach((item, i) => {
    if (item.href === `/projects/${slug}`) out.push({ path: `now[${i}].href`, kind: 'now-link' });
  });
  site.stats.forEach((stat, i) => {
    if (stat.proof === `/projects/${slug}`) out.push({ path: `stats[${i}].proof`, kind: 'stat-proof' });
  });
  site.skills.groups.forEach((group, g) =>
    group.items.forEach((item, i) => {
      if (item.proof === slug) out.push({ path: `skills.groups[${g}].items[${i}].proof`, kind: 'skill-proof' });
    }),
  );
  return out;
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

describe('references to a project', () => {
  it('finds every kind of reference the seed holds, for every project', () => {
    const doc = seedDoc();
    const kinds = new Set<string>();
    for (const { data } of doc.projects) {
      const found = findSlugReferences(doc, data.slug);
      const expected = expectedSiteReferences(doc.site, data.slug);
      expect(found.map(({ path, kind }) => ({ path, kind })).sort(byPath), data.slug).toEqual(expected.sort(byPath));
      for (const ref of found) {
        expect(ref.file).toBe(SITE_FILE);
        kinds.add(ref.kind);
      }
    }
    // The seed has skill proofs, stat proofs, and "Now" links (and no nav or Markdown links to projects).
    expect([...kinds].sort()).toEqual(['now-link', 'skill-proof', 'stat-proof']);
    const raven = findSlugReferences(doc, 'raven');
    expect(raven.filter((r) => r.kind === 'now-link').map((r) => r.path)).toEqual(['now[1].href']);
    expect(raven.filter((r) => r.kind === 'stat-proof')).toHaveLength(1);
    expect(raven.filter((r) => r.kind === 'skill-proof').length).toBeGreaterThan(0);
  });

  it('finds nav links, project and link-row links, Markdown links, and absolute links to this site', () => {
    const doc = seedDoc();
    const raven = entryOf(doc, 'raven');
    const fsae = entryOf(doc, 'fsae-bronco-racing');
    const site = {
      ...doc.site,
      nav: [...doc.site.nav, { label: 'Raven', href: '/projects/raven' }],
      about: { ...doc.site.about, paragraphs: ['See [the build](/projects/raven#log) and [another](/projects/ravenx).', ...doc.site.about.paragraphs] },
    };
    const fsaeData: Project = {
      ...fsae.data,
      links: [{ label: 'Raven', url: 'https://www.amjadrehawi.com/projects/raven?x=1' }, { label: 'Elsewhere', url: 'https://example.com/projects/raven' }],
      blocks: [...fsae.data.blocks, nestedTwoCol(), { id: 'fs-z', type: 'text', md: 'Compare with [Raven](</projects/raven> "Raven").' }],
    };
    const changed: Doc = {
      site,
      projects: doc.projects.map((e) => (e.key === fsae.key ? { ...e, data: fsaeData } : e)),
    };
    const found = findSlugReferences(changed, 'raven');
    const extra = found.filter((r) => !expectedSiteReferences(doc.site, 'raven').some((x) => x.path === r.path && r.file === SITE_FILE));
    const at = fsaeData.blocks.length - 2;
    expect(extra.map(({ file, path, kind }) => ({ file, path, kind }))).toEqual([
      { file: SITE_FILE, path: `nav[${doc.site.nav.length}].href`, kind: 'nav-link' },
      { file: SITE_FILE, path: 'about.paragraphs[0]', kind: 'markdown' },
      { file: projectFileOf('fsae-bronco-racing'), path: 'links[0].url', kind: 'link' },
      { file: projectFileOf('fsae-bronco-racing'), path: `blocks[${at}].right[0].links[0].url`, kind: 'link' },
      { file: projectFileOf('fsae-bronco-racing'), path: `blocks[${at + 1}].md`, kind: 'markdown' },
    ]);
    // A project being deleted takes its own links with it.
    expect(findSlugReferences(changed, 'raven', { exclude: fsae.key }).some((r) => r.file !== SITE_FILE)).toBe(false);
    expect(raven.key).not.toBe(fsae.key);
  });

  it('matches only the page itself', () => {
    expect(linksToSlug('/projects/raven', 'raven')).toBe(true);
    expect(linksToSlug(' /projects/raven/ ', 'raven')).toBe(true);
    expect(linksToSlug('/projects/raven#log', 'raven')).toBe(true);
    expect(linksToSlug('https://amjadrehawi.com/projects/raven', 'raven')).toBe(true);
    for (const other of ['/projects/raven-2', '/projects/ravenx', '/projects', 'https://example.com/projects/raven', '//projects/raven', 'raven']) {
      expect(linksToSlug(other, 'raven'), other).toBe(false);
    }
    expect(rewriteHref('https://www.amjadrehawi.com/projects/raven?x=1#y', 'raven', 'raven-mk2')).toBe('https://www.amjadrehawi.com/projects/raven-mk2?x=1#y');
    expect(rewriteMarkdown('[a](/projects/raven) and [b](/projects/ravenx)', 'raven', 'r2')).toBe('[a](/projects/r2) and [b](/projects/ravenx)');
    expect(unlinkMarkdown('See [the build](/projects/raven "t") and ![photo](/projects/raven).', 'raven')).toBe('See the build and ![photo](/projects/raven).');
  });

  it('rename every reference in one edit, leaving the files without one untouched', () => {
    const store = seedStore();
    const doc = store.getState().doc as Doc;
    const raven = entryOf(doc, 'raven');
    const refs = findSlugReferences(doc, 'raven');
    store.edit((d) => renameProject(d, raven.key, 'raven-mk2', renamePatches(refs, 'raven', 'raven-mk2')));
    const after = store.getState().doc as Doc;
    expect(findSlugReferences(after, 'raven')).toEqual([]);
    expect(findSlugReferences(after, 'raven-mk2').map((r) => r.path)).toEqual(refs.map((r) => r.path));
    const renamed = after.projects.find((e) => e.key === raven.key);
    expect(renamed?.data.slug).toBe('raven-mk2');
    after.projects.forEach((entry, i) => {
      if (entry.key !== raven.key) expect(entry).toBe(doc.projects[i]);
    });
    const changes = store.changes();
    expect(changes.writes.map((w) => w.path).sort()).toEqual([SITE_FILE, projectFileOf('raven-mk2')].sort());
    expect(changes.deletes).toEqual([projectFileOf('raven')]);
    // One undo step brings back the slug and every reference.
    store.undo();
    expect(store.getState().doc).toBe(doc);
  });

  it('remove every reference when a project is deleted, in one edit, and renumber the rest', () => {
    const store = seedStore();
    const doc = store.getState().doc as Doc;
    const site: Site = {
      ...doc.site,
      nav: [{ label: 'Raven', href: '/projects/raven' }, ...doc.site.nav, { label: 'Again', href: '/projects/raven#log' }],
      about: { ...doc.site.about, paragraphs: ['Read [the build](/projects/raven).', ...doc.site.about.paragraphs.slice(1)] },
    };
    store.editSite(() => site);
    const withNav = store.getState().doc as Doc;
    const raven = entryOf(withNav, 'raven');
    const refs: SlugReference[] = findSlugReferences(withNav, 'raven', { exclude: raven.key });
    store.edit((d) => deleteProject(d, raven.key, removalPatches(refs, 'raven')));
    const after = store.getState().doc as Doc;
    expect(after.projects.some((e) => e.key === raven.key)).toBe(false);
    expect(findSlugReferences(after, 'raven')).toEqual([]);
    expect(after.site.nav).toEqual(doc.site.nav);
    expect(after.site.about.paragraphs[0]).toBe('Read the build.');
    expect(after.site.now.find((item) => item.label.startsWith('Raven'))?.href).toBeUndefined();
    expect(after.projects.map((e) => e.data.order)).toEqual(after.projects.map((_, i) => i + 1));
    const parsedSite = JSON.parse(textOf(after.site)) as Site;
    expect(parsedSite.stats.every((s) => s.proof !== '/projects/raven')).toBe(true);
    expect(store.changes().deletes).toEqual([projectFileOf('raven')]);
    expect(pathOfEntry(after.projects[0])).not.toBe(projectFileOf('raven'));
  });

  it('applies nothing when there is nothing to change', () => {
    const doc = seedDoc();
    expect(applyPatches(doc, [])).toBe(doc);
  });
});

// ---------------------------------------------------------------------------------------------
// CLIENT-5: a renamed project keeps its media folder
// ---------------------------------------------------------------------------------------------

describe('a project\'s media folder', () => {
  it('stays the folder its files are in after a slug rename is saved', () => {
    const store = seedStore();
    const raven = entryOf(store.getState().doc as Doc, 'raven');
    store.editProject(raven.key, (p) => ({ ...p, cover: { kind: 'image', src: '/media/raven/cover.webp', alt: 'Raven' } }));
    expect(mediaFolderOf(entryOf(store.getState().doc as Doc, 'raven'))).toBe('raven');
    store.edit((doc) => renameProject(doc, raven.key, 'raven-evtol', []));
    const sent = store.changes();
    expect(sent.deletes).toEqual([projectFileOf('raven')]);
    store.saved(sent, { head: 'd'.repeat(40), commit: 'd'.repeat(40), warnings: [], preview: null, message: 'Saved.' });
    const after = entryOf(store.getState().doc as Doc, 'raven-evtol');
    expect(after.loadedFile).toBe(projectFileOf('raven-evtol'));
    expect(mediaFolderOf(after)).toBe('raven');
    // The library, Choose, and Upload may use that folder: saved content points into it.
    expect(folderExists(store.getState(), 'raven')).toBe(true);
  });

  it('is the slug for a project with no media yet, and the original\'s for a copy that uses its files', () => {
    const doc = seedDoc();
    const fresh = { key: 'new:1', loadedFile: null, data: newProject(doc.projects.map((e) => e.data.slug), 9) };
    expect(mediaFolderOf(fresh)).toBe(fresh.data.slug);
    const raven = entryOf(doc, 'raven');
    const copy = { key: 'new:2', loadedFile: null, data: { ...duplicateProject(raven.data, ['raven']), cover: { kind: 'image' as const, src: '/media/raven/a.webp' } } };
    expect(mediaFolderOf(copy)).toBe('raven');
  });

  it('is named in the rename\'s words, which say its files stay there and keep working', () => {
    expect(renameMediaNote('raven')).toBe(
      'Its media files stay in /media/raven/ and keep working: their addresses do not change, and the library, Choose, and Upload keep using that folder.',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// CLIENT-6: "Revert this file to published" for a project that is not published is a delete
// ---------------------------------------------------------------------------------------------

/** The seed plus raven-2, a copy of raven that is saved on the draft only, which the nav and a stat proof link. */
function twoProjects(options: { othersVisible?: boolean } = {}): ContentResponse {
  const content = seedContent();
  const raven = content.projects.find((p) => (p.data as Project).slug === 'raven')!;
  const second = structuredClone(raven);
  second.file = projectFileOf('raven-2');
  Object.assign(second.data as Project, { slug: 'raven-2', title: 'Raven two', order: 2, visible: true });
  const site = content.site.data as Site;
  return {
    ...content,
    site: {
      ...content.site,
      data: {
        ...site,
        nav: [...site.nav, { label: 'Raven two', href: '/projects/raven-2' }],
        stats: site.stats.map((stat, i) => (i === 0 ? { ...stat, proof: '/projects/raven-2' } : stat)),
      },
    },
    projects: [
      ...content.projects.map((p) => (options.othersVisible === false ? { ...p, data: { ...(p.data as Project), visible: false } } : p)),
      second,
    ],
  };
}

describe('removing a project', () => {
  it('lists the references to update, or refuses the last visible project', () => {
    const store = createAdminStore(() => 0);
    store.load(twoProjects());
    const doc = store.getState().doc as Doc;
    const plan = planRemoval(doc, entryOf(doc, 'raven-2').key);
    expect(plan && 'refs' in plan ? plan.refs.map((ref) => `${ref.kind} ${ref.path}`) : plan).toEqual([
      `nav-link nav[${doc.site.nav.length - 1}].href`,
      'stat-proof stats[0].proof',
    ]);
    expect(plan && 'patches' in plan ? plan.patches.map((patch) => patch?.op) : null).toEqual(['drop', 'unset']);
    const only = {
      ...doc,
      projects: doc.projects.map((e) => (e.data.slug === 'raven-2' ? e : { ...e, data: { ...e.data, visible: false } })),
    };
    expect(planRemoval(only, entryOf(only, 'raven-2').key)).toEqual({ refused: LAST_VISIBLE });
    expect(planRemoval(doc, 'no-such-key')).toBeNull();
  });
});

describe('"Revert this file to published" for a project that is not published', () => {
  const FILE = 'content/projects/raven-2.json';

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    if (typeof window.requestAnimationFrame !== 'function') {
      window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0);
    }
  });

  let unmount: (() => void) | null = null;
  afterEach(() => {
    unmount?.();
    unmount = null;
    vi.unstubAllGlobals();
  });

  async function revert(content: ContentResponse) {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(String(url));
      return { status: 200, text: async () => JSON.stringify({ ok: true, file: FILE, data: null }), headers: { get: () => null } };
    });
    const store = createAdminStore();
    store.load(content);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(h(AdminProvider, { store, children: h(ConfirmProvider, { children: h(RevertFileButton, { file: FILE }) }) }));
    unmount = () => {
      root.unmount();
      container.remove();
    };
    await new Promise((resolve) => setTimeout(resolve, 30));
    const press = (label: string) => {
      const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
      if (!found) throw new Error(`No button "${label}"`);
      found.click();
    };
    press('Revert this file to published');
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { store, container, press, requested };
  }

  it('lists the references like Delete, and removes the project with the chosen updates as one undo step', async () => {
    const { store, container, press, requested } = await revert(twoProjects());
    expect(requested).toEqual([`/api/content?ref=live&path=${encodeURIComponent(FILE)}`]);
    expect(container.textContent).toContain('Delete Raven two?');
    const count = store.getState().doc!.projects.length;

    const before = store.getState().doc as Doc;
    press('Delete and update 2 references');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = store.getState().doc as Doc;
    expect(after.projects.map((e) => e.data.slug)).not.toContain('raven-2');
    expect(after.projects).toHaveLength(count - 1);
    expect(findSlugReferences(after, 'raven-2')).toEqual([]);
    expect(after.site.nav).toEqual(before.site.nav.slice(0, -1));
    expect(after.site.stats[0].proof).toBeUndefined();
    expect(container.textContent).toContain('the project is removed, with 2 references updated');

    store.undo();
    expect(store.getState().doc).toBe(before);
  });

  it('is refused for the last visible project', async () => {
    const { store, container } = await revert(twoProjects({ othersVisible: false }));
    expect(container.textContent).toContain(`Not reverted. ${LAST_VISIBLE}`);
    expect(store.getState().doc!.projects.map((e) => e.data.slug)).toContain('raven-2');
    expect(store.getState().past).toHaveLength(0);
  });

  it('asks plainly when nothing points at the project, then removes it', async () => {
    const content = twoProjects();
    content.site = { ...content.site, data: seedContent().site.data };
    const { store, container, press } = await revert(content);
    expect(container.textContent).toContain('is not on the published site yet');
    press('Revert');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.getState().doc!.projects.map((e) => e.data.slug)).not.toContain('raven-2');
    expect(store.getState().doc!.projects.map((e) => e.data.order)).toEqual(store.getState().doc!.projects.map((_, i) => i + 1));
    expect(store.getState().past).toHaveLength(1);
  });
});
