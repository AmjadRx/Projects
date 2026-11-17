/**
 * Typed loaders for content schema version 3. Every file in content/ is validated when it is
 * read, so a build with invalid content fails with the file and the field path
 * (docs/V3_PLAN.md D-05).
 */
import fs from 'node:fs';
import path from 'node:path';
import { copyFindings, formatPath, validateContent, type Finding, type RawContent, type ValidContent } from './lint';
import { ProjectSchema, SiteSchema } from './schema';
import type { Project, Site } from './types';

/**
 * The content folder. SITE_CONTENT_DIR points a build at a fixture folder instead; only the
 * hiding test (tests/build/hiding.test.ts) sets it.
 */
export const CONTENT_DIR = process.env.SITE_CONTENT_DIR
  ? path.resolve(process.env.SITE_CONTENT_DIR)
  : path.join(process.cwd(), 'content');

export class ContentError extends Error {
  readonly findings: Finding[];

  constructor(findings: Finding[]) {
    const lines = findings.map((f) => `${f.file}: ${f.path}: ${f.message}`);
    super(`Invalid content:\n${lines.join('\n')}`);
    this.name = 'ContentError';
    this.findings = findings;
  }
}

function readJson(file: string, label: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContentError([{ file: label, path: formatPath([]), rule: 'JSON', message, severity: 'error' }]);
  }
}

/** Reads content/site.json and every content/projects/*.json without validating them. */
export function readContentDir(dir: string = CONTENT_DIR): RawContent {
  const projectsDir = path.join(dir, 'projects');
  return {
    site: { file: 'content/site.json', data: readJson(path.join(dir, 'site.json'), 'content/site.json') },
    projects: fs
      .readdirSync(projectsDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => ({
        file: `content/projects/${name}`,
        data: readJson(path.join(projectsDir, name), `content/projects/${name}`),
      })),
  };
}

/** Reads and validates content/. Throws a ContentError that lists every invalid field. */
export function loadValidContent(dir: string = CONTENT_DIR): ValidContent {
  const { content, findings } = validateContent(readContentDir(dir), { SiteSchema, ProjectSchema });
  const errors = findings.filter((f) => f.severity === 'error');
  if (!content || errors.length > 0) throw new ContentError(errors);
  // An emptied GPA or phone with a copy left in free text would still publish the value, so the
  // build refuses it as the content check does (docs/V3_PLAN.md D-14, Q-23).
  const copies = copyFindings(content);
  if (copies.length > 0) throw new ContentError(copies);
  return content;
}

let cache: ValidContent | null = null;

function load(): ValidContent {
  if (process.env.NODE_ENV === 'development') return loadValidContent();
  cache ??= loadValidContent();
  return cache;
}

export function loadSite(): Site {
  return load().site;
}

/** Every project, hidden ones included, ordered by `order`. For the admin and the checks. */
export function loadAllProjects(): Project[] {
  return load().projects;
}

/** The projects the public site shows: visible ones only, ordered by `order`. */
export function loadPublicProjects(): Project[] {
  return load().projects.filter((p) => p.visible);
}

/** A visible project by slug. A hidden project is not found. */
export function loadProject(slug: string): Project | undefined {
  return loadPublicProjects().find((p) => p.slug === slug);
}
