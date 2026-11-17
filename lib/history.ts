/**
 * Dates of the last content commit for each file in content/ (docs/V3_PLAN.md D-09): REV on a
 * project page and "last updated" in the footer. scripts/content-dates.mjs writes them before
 * every build; in development they come from local git. A date that cannot be known is left
 * out, never guessed.
 */
import 'server-only';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type Dates = Record<string, string>;

let cache: Dates | null = null;

function fromManifest(): Dates | null {
  try {
    const file = path.join(process.cwd(), 'lib', 'generated', 'content-dates.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { files?: Dates };
    return parsed.files ?? null;
  } catch {
    return null;
  }
}

function fromGit(): Dates {
  const dates: Dates = {};
  try {
    const run = (args: string[]) =>
      execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (run(['rev-parse', '--is-shallow-repository']) !== 'false') return dates;
    const dir = path.join(process.cwd(), 'content', 'projects');
    const files = ['content/site.json', ...fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => `content/projects/${f}`)];
    for (const file of files) {
      const date = run(['log', '-1', '--format=%cs', '--', file]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates[file] = date;
    }
  } catch {
    // No git, or not a repository: the dates stay unknown.
  }
  return dates;
}

function dates(): Dates {
  if (cache) return cache;
  cache = fromManifest() ?? fromGit();
  return cache;
}

/** REV: the date of the last commit that changed this project's file. */
export function projectRevDate(slug: string): string | undefined {
  return dates()[`content/projects/${slug}.json`];
}

/**
 * "Last updated": the newest date among the site file and the given projects' files. It is
 * known only when every one of those files has a date: with one missing (a run of
 * scripts/content-dates.mjs that stopped partway, a file not yet committed) the newest date could
 * be that file's, so the footer leaves the date out rather than print an older one.
 */
export function lastContentUpdate(slugs: readonly string[]): string | undefined {
  return newestDate(dates(), ['content/site.json', ...slugs.map((s) => `content/projects/${s}.json`)]);
}

/** The newest of the files' dates, or undefined unless every file has one. Exported for tests. */
export function newestDate(all: Readonly<Dates>, files: readonly string[]): string | undefined {
  const known = files.map((file) => all[file]);
  if (known.length === 0 || known.some((d) => typeof d !== 'string')) return undefined;
  return (known as string[]).sort().at(-1);
}
