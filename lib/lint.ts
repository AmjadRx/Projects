/**
 * The content check (ARCHITECTURE.md sections 7 and 12).
 *
 * Public patterns come from content-rules.public.json. Private terms come from the server-only
 * CONTENT_BLOCKLIST variable: a hit names the file, the field, and the entry number, never the
 * term, and nothing in this module logs or returns the variable's value.
 *
 * The check runs over string values only, never over keys or raw JSON text, and also over each
 * composed string as the site prints it (a GPA label with its value, a stat's prefix, value,
 * suffix, and label, a fact's or a callout's label with its value), because some rules can only
 * fire on the composed text.
 *
 * This module has no runtime imports, so Node can load it directly for scripts/check-content.mjs.
 */
import type { Content, Project, Site } from './types';

export interface PublicRule {
  id: string;
  pattern: string;
  message: string;
}

export interface RulesFile {
  version: number;
  date?: string;
  note?: string;
  flags: string;
  rules: PublicRule[];
}

export interface CompiledRule {
  id: string;
  message: string;
  re: RegExp;
}

/** One private term, kept only as a compiled pattern and its position in the variable. */
export interface BlocklistEntry {
  index: number;
  re: RegExp;
}

export interface Finding {
  /** The file, relative to the repository root, such as "content/site.json". */
  file: string;
  /** The field path inside the file ("stats[2].proof"), or "line 12" for Markdown. */
  path: string;
  /** A public rule id, or BLOCKLIST, PROOF, SCHEMA, SLUG, JSON, MEDIA, INTERNAL-LINK. */
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface CheckOptions {
  rules: CompiledRule[];
  blocklist: BlocklistEntry[];
}

// ---------------------------------------------------------------------------------------------
// Rules and terms
// ---------------------------------------------------------------------------------------------

export function compileRules(file: RulesFile): CompiledRule[] {
  return file.rules.map((rule) => ({
    id: rule.id,
    message: rule.message,
    re: new RegExp(rule.pattern, file.flags),
  }));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses CONTENT_BLOCKLIST: entries separated by a vertical bar, matched as whole words without
 * regard to case; an entry that starts with "cs:" is matched with exact case. Blank entries are
 * dropped, so a stray bar never blocks every save.
 */
export function parseBlocklist(raw: string | undefined): BlocklistEntry[] {
  if (!raw) return [];
  const entries: BlocklistEntry[] = [];
  raw.split('|').forEach((part, i) => {
    const trimmed = part.trim();
    const caseSensitive = trimmed.startsWith('cs:');
    const term = (caseSensitive ? trimmed.slice(3) : trimmed).trim();
    if (term === '') return;
    const source = `(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`;
    entries.push({ index: i + 1, re: new RegExp(source, caseSensitive ? 'u' : 'iu') });
  });
  return entries;
}

/**
 * A missing CONTENT_BLOCKLIST fails the check in CI and on Vercel (fail closed) and is only a
 * warning on the owner's own machine.
 */
export function missingBlocklistIsError(env: Record<string, string | undefined>): boolean {
  return Boolean(env.CI) || Boolean(env.VERCEL);
}

/** The rules a piece of text trips. Blocklist hits carry the entry number, never the term. */
export function checkText(
  text: string,
  rules: CompiledRule[],
  blocklist: BlocklistEntry[],
): { rule: string; message: string }[] {
  const hits: { rule: string; message: string }[] = [];
  for (const rule of rules) {
    if (rule.re.test(text)) hits.push({ rule: rule.id, message: rule.message });
  }
  for (const entry of blocklist) {
    if (entry.re.test(text)) {
      hits.push({ rule: 'BLOCKLIST', message: `Matches private term ${entry.index} in CONTENT_BLOCKLIST.` });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// Walking content
// ---------------------------------------------------------------------------------------------

export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out === '' ? String(segment) : `.${String(segment)}`;
  }
  return out === '' ? '(root)' : out;
}

/** Every string value in a JSON value, with its field path. Keys are never included. */
export function stringValues(value: unknown, path: PropertyKey[] = []): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path: formatPath(path), text: value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => stringValues(item, [...path, i]));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => stringValues(item, [...path, key]));
  }
  return [];
}

/** The strings the site composes from more than one field, as it will print them. */
function composedSiteStrings(site: Site): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  if (site.personal.gpa.trim() !== '') {
    out.push({
      path: 'personal.gpaLabel + personal.gpa (as printed)',
      text: `${site.personal.gpaLabel} ${site.personal.gpa}`.trim(),
    });
  }
  site.stats.forEach((stat, i) => {
    out.push({
      path: `stats[${i}] (as printed)`,
      text: `${stat.prefix ?? ''}${stat.value}${stat.suffix ?? ''} ${stat.label}`,
    });
  });
  site.about.facts.forEach((fact, i) => {
    out.push({ path: `about.facts[${i}] (as printed)`, text: `${fact.label} ${fact.value}` });
  });
  return out;
}

function composedProjectStrings(project: Project): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  (project.callouts ?? []).forEach((c, i) => {
    out.push({ path: `callouts[${i}] (as printed)`, text: `${c.label} ${c.value}` });
  });
  project.blocks.forEach((block, b) => {
    if (block.type === 'model3d' && Array.isArray(block.callouts)) {
      (block.callouts as { label: string; value: string }[]).forEach((c, i) => {
        out.push({ path: `blocks[${b}].callouts[${i}] (as printed)`, text: `${c.label} ${c.value}` });
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Proofs and internal links
// ---------------------------------------------------------------------------------------------

/** The public routes that exist apart from project pages (ARCHITECTURE.md section 5). */
export const STATIC_ROUTES: readonly string[] = ['/', '/about', '/experience', '/projects', '/log', '/contact'];

/** True when an internal path names a page the site renders. Hidden projects do not count. */
export function resolvesToPage(href: string, visibleSlugs: ReadonlySet<string>): boolean {
  if (!href.startsWith('/')) return false;
  const pathname = href.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (STATIC_ROUTES.includes(pathname)) return true;
  const match = /^\/projects\/([a-z0-9-]+)$/.exec(pathname);
  return match !== null && visibleSlugs.has(match[1]);
}

function proofFindings(site: Site, visibleSlugs: ReadonlySet<string>, siteFile: string): Finding[] {
  const out: Finding[] = [];
  site.stats.forEach((stat, i) => {
    if (stat.proof === undefined) return;
    if (!resolvesToPage(stat.proof, visibleSlugs)) {
      out.push({
        file: siteFile,
        path: `stats[${i}].proof`,
        rule: 'PROOF',
        message: 'A stat proof must be a site path to a visible page.',
        severity: 'error',
      });
    }
  });
  site.skills.groups.forEach((group, g) => {
    group.items.forEach((item, i) => {
      if (item.proof === undefined) return;
      if (!visibleSlugs.has(item.proof)) {
        out.push({
          file: siteFile,
          path: `skills.groups[${g}].items[${i}].proof`,
          rule: 'PROOF',
          message: 'A skill proof must be the slug of a visible project.',
          severity: 'error',
        });
      }
    });
  });
  return out;
}

/** Internal links that lead nowhere are warnings (ARCHITECTURE.md section 7, guard rails). */
function internalLinkWarnings(
  site: Site,
  projects: { file: string; project: Project }[],
  visibleSlugs: ReadonlySet<string>,
  siteFile: string,
): Finding[] {
  const out: Finding[] = [];
  const warn = (file: string, path: string) =>
    out.push({ file, path, rule: 'INTERNAL-LINK', message: 'This internal link leads to no page.', severity: 'warning' });
  site.nav.forEach((item, i) => {
    if (item.href.startsWith('/') && !resolvesToPage(item.href, visibleSlugs)) warn(siteFile, `nav[${i}].href`);
  });
  site.now.forEach((item, i) => {
    if (item.href?.startsWith('/') && !resolvesToPage(item.href, visibleSlugs)) warn(siteFile, `now[${i}].href`);
  });
  for (const { file, project } of projects) {
    project.links.forEach((link, i) => {
      if (link.url.startsWith('/') && !resolvesToPage(link.url, visibleSlugs)) warn(file, `links[${i}].url`);
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validation and the whole check
// ---------------------------------------------------------------------------------------------

/** The part of a zod schema this module needs, so it can stay free of runtime imports. */
export interface Parser<T> {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
}

export interface RawContent {
  site: { file: string; data: unknown };
  projects: { file: string; data: unknown }[];
}

export interface ValidContent extends Content {
  siteFile: string;
  projectFiles: { file: string; project: Project }[];
}

/**
 * Validates the site file and every project file with schema version 3. A project's slug must
 * match its file name and be unique. Returns the parsed content only when nothing failed.
 */
export function validateContent(
  raw: RawContent,
  schemas: { SiteSchema: Parser<Site>; ProjectSchema: Parser<Project> },
): { content?: ValidContent; findings: Finding[] } {
  const findings: Finding[] = [];
  const schemaFindings = (file: string, issues: readonly { path: readonly PropertyKey[]; message: string }[]) => {
    for (const issue of issues) {
      findings.push({ file, path: formatPath(issue.path), rule: 'SCHEMA', message: issue.message, severity: 'error' });
    }
  };

  const siteResult = schemas.SiteSchema.safeParse(raw.site.data);
  if (!siteResult.success) schemaFindings(raw.site.file, siteResult.error.issues);

  const projectFiles: { file: string; project: Project }[] = [];
  const seen = new Map<string, string>();
  for (const { file, data } of raw.projects) {
    const result = schemas.ProjectSchema.safeParse(data);
    if (!result.success) {
      schemaFindings(file, result.error.issues);
      continue;
    }
    const project = result.data;
    const baseName = file.split('/').pop()?.replace(/\.json$/, '');
    if (project.slug !== baseName) {
      findings.push({
        file,
        path: 'slug',
        rule: 'SLUG',
        message: `The slug must match the file name ("${baseName}").`,
        severity: 'error',
      });
    }
    const earlier = seen.get(project.slug);
    if (earlier !== undefined) {
      findings.push({ file, path: 'slug', rule: 'SLUG', message: `The slug is also used by ${earlier}.`, severity: 'error' });
    }
    seen.set(project.slug, file);
    projectFiles.push({ file, project });
  }

  if (!siteResult.success || findings.length > 0) return { findings };
  projectFiles.sort((a, b) => a.project.order - b.project.order);
  return {
    content: {
      site: siteResult.data,
      projects: projectFiles.map((p) => p.project),
      siteFile: raw.site.file,
      projectFiles,
    },
    findings,
  };
}

/** Runs the public rules, the private terms, the proofs, and the link warnings over content. */
export function lintContent(content: ValidContent, options: CheckOptions): Finding[] {
  const findings: Finding[] = [];
  const visibleSlugs = new Set(content.projects.filter((p) => p.visible).map((p) => p.slug));

  const scan = (file: string, strings: { path: string; text: string }[]) => {
    for (const { path, text } of strings) {
      for (const hit of checkText(text, options.rules, options.blocklist)) {
        findings.push({ file, path, rule: hit.rule, message: hit.message, severity: 'error' });
      }
    }
  };

  scan(content.siteFile, stringValues(content.site));
  scan(content.siteFile, composedSiteStrings(content.site));
  for (const { file, project } of content.projectFiles) {
    scan(file, stringValues(project));
    scan(file, composedProjectStrings(project));
  }

  findings.push(...proofFindings(content.site, visibleSlugs, content.siteFile));
  findings.push(...internalLinkWarnings(content.site, content.projectFiles, visibleSlugs, content.siteFile));
  return findings;
}

/** Runs the public rules and the private terms over a Markdown file, line by line. */
export function lintMarkdown(file: string, text: string, options: CheckOptions): Finding[] {
  const findings: Finding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const hit of checkText(line, options.rules, options.blocklist)) {
      findings.push({ file, path: `line ${i + 1}`, rule: hit.rule, message: hit.message, severity: 'error' });
    }
  });
  return findings;
}
