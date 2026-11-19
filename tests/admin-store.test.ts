import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isContentPath, projectFileOf, serializeContent, SITE_FILE, slugOfProjectFile, type ContentResponse } from '../lib/admin/contract';
import { blockTrail, candidatePaths, fieldId, locate } from '../lib/admin/locate';
import { createAdminStore, isDirty } from '../components/admin/state/store';

const ROOT = path.resolve(__dirname, '..');

function seedContent(): ContentResponse {
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const projectFiles = fs.readdirSync(path.join(ROOT, 'content/projects')).map((name) => `content/projects/${name}`);
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

describe('content paths', () => {
  it('allow only the site file and project files', () => {
    expect(isContentPath('content/site.json')).toBe(true);
    expect(isContentPath('content/projects/raven.json')).toBe(true);
    for (const bad of [
      'content/../.env',
      '../content/site.json',
      'content/projects/../site.json',
      'content/projects/Raven.json',
      'content/projects/raven.json.bak',
      'public/media/raven/a.json',
      'content/other.json',
      '/content/site.json',
      'content/projects/-x.json',
      'content\\projects\\raven.json',
    ]) {
      expect(isContentPath(bad), bad).toBe(false);
    }
    expect(slugOfProjectFile(projectFileOf('fsae-bronco-racing'))).toBe('fsae-bronco-racing');
  });

  it('serialize every seed file to its stored bytes', () => {
    const content = seedContent();
    for (const { file, data } of [content.site, ...content.projects]) {
      expect(serializeContent(data), file).toBe(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    }
  });
});

describe('locate', () => {
  it('walks from a field to its parents', () => {
    expect(candidatePaths('blocks[3].items[1].alt')).toEqual(['blocks[3].items[1].alt', 'blocks[3].items[1]', 'blocks[3].items', 'blocks[3]', 'blocks']);
    expect(candidatePaths('personal.gpaLabel + personal.gpa (as printed)')).toEqual(['personal.gpaLabel', 'personal']);
    expect(candidatePaths('stats[2] (as printed)')).toEqual(['stats[2]', 'stats']);
    expect(candidatePaths('(path)')).toEqual([]);
  });

  it('finds the tab, the project, and the blocks to open', () => {
    expect(locate(SITE_FILE, 'now[1].href')?.tab).toBe('personal');
    expect(locate(SITE_FILE, 'seo.title')?.tab).toBe('settings');
    expect(locate(SITE_FILE, 'education[0].school')?.tab).toBe('honorsEdu');
    const project = locate('content/projects/raven.json', 'blocks[2].left[0].md');
    expect(project).toMatchObject({ tab: 'projects', slug: 'raven' });
    expect(blockTrail('blocks[2].left[0].md')).toEqual([{ index: 2 }, { index: 0, column: 'left' }]);
    expect(project?.ids[0]).toBe(fieldId('content/projects/raven.json', 'blocks[2].left[0].md'));
  });

  it('makes ids that are safe in a selector', () => {
    expect(fieldId(SITE_FILE, 'stats[2].proof')).toMatch(/^f-[A-Za-z0-9_-]+$/);
  });
});

describe('the admin store', () => {
  it('loads clean, gets dirty on an edit, and is clean again after undo', () => {
    const store = createAdminStore();
    store.load(seedContent());
    const s = () => store.getState();
    expect(isDirty(s().doc, s().info)).toBe(false);
    store.editSite((site) => ({ ...site, personal: { ...site.personal, location: 'Elsewhere' } }));
    expect(store.changes().writes.map((w) => w.path)).toEqual([SITE_FILE]);
    store.undo();
    expect(isDirty(s().doc, s().info)).toBe(false);
    store.redo();
    expect(isDirty(s().doc, s().info)).toBe(true);
  });

  it('coalesces typing in one field into one undo step', () => {
    let t = 0;
    const store = createAdminStore(() => t);
    store.load(seedContent());
    for (const text of ['A', 'Ab', 'Abc']) {
      t += 100;
      store.editSite((site) => ({ ...site, personal: { ...site.personal, tagline: text } }), { coalesce: 'tagline' });
    }
    expect(store.getState().past.length).toBe(1);
    t += 5000;
    store.editSite((site) => ({ ...site, personal: { ...site.personal, tagline: 'Abcd' } }), { coalesce: 'tagline' });
    expect(store.getState().past.length).toBe(2);
  });

  it('reports a renamed project as a write and a delete, and records exactly what was sent', () => {
    const store = createAdminStore();
    store.load(seedContent());
    const raven = store.getState().doc!.projects.find((p) => p.data.slug === 'raven')!;
    store.editProject(raven.key, (p) => ({ ...p, slug: 'raven-2' }));
    const sent = store.changes();
    expect(sent.writes.map((w) => w.path)).toEqual(['content/projects/raven-2.json']);
    expect(sent.deletes).toEqual(['content/projects/raven.json']);
    // Typing continues while the save is in flight.
    store.editProject(raven.key, (p) => ({ ...p, title: 'Raven, renamed' }));
    store.saved(sent, { head: null, commit: null, warnings: [], preview: null, message: 'Saved' });
    const after = store.changes();
    expect(after.deletes).toEqual([]);
    expect(after.writes.map((w) => w.path)).toEqual(['content/projects/raven-2.json']);
  });

  it('moves projects and renumbers only the ones whose order changes', () => {
    const store = createAdminStore();
    store.load(seedContent());
    const before = store.getState().doc!.projects.map((p) => p.data.slug);
    store.moveProject(0, 1);
    const after = store.getState().doc!.projects;
    expect(after.map((p) => p.data.slug)).toEqual([before[1], before[0], ...before.slice(2)]);
    expect(store.changes().writes.length).toBe(2);
  });
});
