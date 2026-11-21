import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import rulesFile from '../content-rules.public.json';
import { loadAllProjects, loadProject, loadPublicProjects, loadSite, readContentDir } from '../lib/content';
import { compileRules, lintContent, validateContent } from '../lib/lint';
import { ProjectSchema, SiteSchema } from '../lib/schema';

const CONTENT = path.resolve('content');
const projectFiles = fs.readdirSync(path.join(CONTENT, 'projects')).filter((f) => f.endsWith('.json'));

function underscoreKeys(value: unknown, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => underscoreKeys(item, `${at}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(key.startsWith('_') ? [`${at}.${key}`] : []),
    ...underscoreKeys(item, `${at}.${key}`),
  ]);
}

describe('the seed in content/', () => {
  it('site.json validates against schema version 3', () => {
    const result = SiteSchema.safeParse(JSON.parse(fs.readFileSync(path.join(CONTENT, 'site.json'), 'utf8')));
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it.each(projectFiles)('projects/%s validates against schema version 3', (file) => {
    const result = ProjectSchema.safeParse(JSON.parse(fs.readFileSync(path.join(CONTENT, 'projects', file), 'utf8')));
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('carries no key that starts with an underscore', () => {
    const files = ['site.json', ...projectFiles.map((f) => `projects/${f}`)];
    for (const file of files) {
      expect(underscoreKeys(JSON.parse(fs.readFileSync(path.join(CONTENT, file), 'utf8'))), file).toEqual([]);
    }
  });

  it('passes the whole check: slugs match file names, proofs resolve, and no public rule fires', () => {
    const { content, findings } = validateContent(readContentDir(), { SiteSchema, ProjectSchema });
    expect(findings).toEqual([]);
    const errors = lintContent(content!, { rules: compileRules(rulesFile), blocklist: [] }).filter(
      (f) => f.severity === 'error',
    );
    expect(errors).toEqual([]);
  });

  it('loads through the typed loaders, ordered, with hidden projects left out of the public list', () => {
    const site = loadSite();
    expect(site.schemaVersion).toBe(3);
    expect(site.settings.heroModel?.kind).toBe('model');
    const all = loadAllProjects();
    expect(all.map((p) => p.order)).toEqual([...all.map((p) => p.order)].sort((a, b) => a - b));
    expect(loadPublicProjects().every((p) => p.visible)).toBe(true);
    expect(loadProject('raven')?.title).toBe('Raven');
    expect(loadProject('no-such-project')).toBeUndefined();
  });
});
