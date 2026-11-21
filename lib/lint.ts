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
  /** Host names that mean this site, so an absolute link to it is checked like a site path. */
  siteHosts?: readonly string[];
  /** This site's own repository ("Owner/Name", from GITHUB_REPO), which content never links (D-22). */
  siteRepository?: string;
}

/** The production address (ARCHITECTURE.md 1). NEXT_PUBLIC_SITE_URL overrides it. */
export const DEFAULT_SITE_URL = 'https://amjadrehawi.com';

/** The host names that mean this site: the configured host, with and without "www.". */
export function siteHostsOf(siteUrl: string): string[] {
  try {
    const host = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, '');
    return host ? [host, `www.${host}`] : [];
  } catch {
    return [];
  }
}

/** An absolute address on this site's own host as a site path ("/projects/raven#log"), or null. */
export function sitePathOf(href: string, siteHosts: readonly string[]): string | null {
  const value = href.trim();
  if (!/^https?:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!siteHosts.includes(url.hostname.toLowerCase())) return null;
  return `${url.pathname || '/'}${url.search}${url.hash}`;
}

/**
 * True when an address points anywhere into the given GitHub repository ("Owner/Name"): its page,
 * any file or commit in it, or its raw files. Content never links this site's own repository
 * (docs/V3_PLAN.md D-22).
 */
export function pointsIntoRepository(href: string, repository: string | undefined): boolean {
  const own = (repository ?? '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim()
    .replace(/\.git$/i, '')
    .toLowerCase();
  if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/.test(own)) return false;
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (!['github.com', 'www.github.com', 'raw.githubusercontent.com'].includes(host)) return false;
  const [owner = '', name = ''] = url.pathname.split('/').filter(Boolean);
  return `${owner}/${name.replace(/\.git$/i, '')}`.toLowerCase() === own;
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

/** A Markdown link's address: the part in parentheses after "]". */
const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)/g;

/** Every link address in a file: link fields (`href`, `url`) and the links inside Markdown. */
function linkAddresses(value: unknown): { path: string; href: string }[] {
  const out: { path: string; href: string }[] = [];
  for (const { path, text } of stringValues(value)) {
    if (/(?:^|\.)(?:href|url)$/.test(path)) out.push({ path, href: text.trim() });
    for (const match of text.matchAll(MARKDOWN_LINK)) out.push({ path, href: match[1] });
  }
  return out;
}

/**
 * Internal links that lead nowhere are warnings (ARCHITECTURE.md section 7, guard rails): nav
 * items, now items, project links, link rows, and links inside Markdown, including absolute links
 * to this site's own host. The site prints such a link as plain text (lib/links.ts), so a hidden
 * project leaves no trace; the warning tells the owner before they save.
 */
function internalLinkWarnings(content: ValidContent, visibleSlugs: ReadonlySet<string>, siteHosts: readonly string[]): Finding[] {
  const out: Finding[] = [];
  const files = [
    { file: content.siteFile, value: content.site as unknown },
    ...content.projectFiles.map(({ file, project }) => ({ file, value: project as unknown })),
  ];
  for (const { file, value } of files) {
    for (const { path, href } of linkAddresses(value)) {
      const internal = href.startsWith('/') ? href : sitePathOf(href, siteHosts);
      if (internal === null || internal.startsWith('/media/')) continue;
      if (path.endsWith('.proof')) continue;
      if (!resolvesToPage(internal, visibleSlugs)) {
        out.push({ file, path, rule: 'INTERNAL-LINK', message: 'This internal link leads to no page.', severity: 'warning' });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Copies of the GPA and the phone (docs/V3_PLAN.md D-14 and Q-23)
// ---------------------------------------------------------------------------------------------

/** "GPA" followed closely by a number ("Major GPA 3.65", "GPA: 3.7"), or a number before it. */
const GPA_MENTION = /\bGPA\b[^\d\n]{0,12}\d|\d\.\d{1,3}\b[^\d\n]{0,12}\bGPA\b/i;
/** A North American phone number written with separators: "(530) 407-6321", "+1 530.407.6321". */
const PHONE_NUMBER = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const TEL_LINK = /\btel:/i;

/** True when a label names the GPA: the configured GPA label, or any label with the word "GPA". */
export function isGpaName(label: string, gpaLabel: string): boolean {
  const name = label.trim().toLowerCase();
  if (name === '') return false;
  return name === gpaLabel.trim().toLowerCase() || /\bgpa\b/.test(name);
}

function mentionsGpa(text: string, gpaLabel: string): boolean {
  if (GPA_MENTION.test(text)) return true;
  const label = gpaLabel.trim().toLowerCase();
  if (label === '') return false;
  const lower = text.toLowerCase();
  for (let at = lower.indexOf(label); at !== -1; at = lower.indexOf(label, at + 1)) {
    if (/^[^\d\n]{0,12}\d/.test(text.slice(at + label.length))) return true;
  }
  return false;
}

/** Every object with a string `label` and a string `value` (facts, stats, callouts, spec rows). */
function labelledValues(value: unknown, path: PropertyKey[] = []): { path: string; label: string; value: string }[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => labelledValues(item, [...path, i]));
  if (value === null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const own =
    typeof record.label === 'string' && typeof record.value === 'string'
      ? [{ path: formatPath([...path, 'value']), label: record.label, value: record.value }]
      : [];
  return [...own, ...Object.entries(record).flatMap(([key, item]) => labelledValues(item, [...path, key]))];
}

/**
 * D-14 and Q-23: a save that empties `personal.gpa` or `personal.phone` is refused while a copy
 * of the value remains anywhere in the content (an about fact, an education line, a contact
 * link, a Markdown link), because a copy in free text cannot hide itself. The build runs this
 * too (lib/content.ts), so an emptied value never reaches a deployed page.
 */
export function copyFindings(content: ValidContent): Finding[] {
  const out: Finding[] = [];
  const { personal } = content.site;
  const gpaEmpty = personal.gpa.trim() === '';
  const phoneEmpty = personal.phone.trim() === '';
  if (!gpaEmpty && !phoneEmpty) return out;
  const files = [
    { file: content.siteFile, value: content.site as unknown },
    ...content.projectFiles.map(({ file, project }) => ({ file, value: project as unknown })),
  ];
  for (const { file, value } of files) {
    for (const { path, text } of stringValues(value)) {
      if (gpaEmpty && mentionsGpa(text, personal.gpaLabel)) {
        out.push({ file, path, rule: 'GPA-COPY', message: 'personal.gpa is empty, but this field still states a GPA (D-14).', severity: 'error' });
      }
      if (phoneEmpty && (TEL_LINK.test(text) || PHONE_NUMBER.test(text))) {
        out.push({
          file,
          path,
          rule: 'PHONE-COPY',
          message: 'personal.phone is empty, but this field still holds a phone number or a tel: link (D-14).',
          severity: 'error',
        });
      }
    }
    if (!gpaEmpty) continue;
    for (const pair of labelledValues(value)) {
      if (isGpaName(pair.label, personal.gpaLabel) && pair.value.trim() !== '' && !mentionsGpa(pair.value, personal.gpaLabel)) {
        out.push({ file, path: pair.path, rule: 'GPA-COPY', message: 'personal.gpa is empty, but this GPA row still holds a value (D-14).', severity: 'error' });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Media addresses and links to this repository
// ---------------------------------------------------------------------------------------------

const MEDIA_KIND_NAMES = new Set(['image', 'video', 'embed', 'model', 'document', 'audio']);
const EMBED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
]);

/** The same rule as isSafeMediaSrc in lib/media.ts: a site path or an https address. */
function isSafeAddress(src: string): boolean {
  const value = src.trim();
  if (value.startsWith('/')) return !value.startsWith('//') && !value.startsWith('/\\');
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function embedHostOk(src: string): boolean {
  try {
    const url = new URL(src.trim());
    return url.protocol === 'https:' && EMBED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Media addresses must be a site path or an https address (docs/V3_PLAN.md D-29), and an embed
 * must be a YouTube or Vimeo address (D-45). The site renders nothing for any other address.
 */
function mediaAddressFindings(file: string, value: unknown, path: PropertyKey[] = []): Finding[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => mediaAddressFindings(file, item, [...path, i]));
  if (value === null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const out: Finding[] = [];
  const check = (key: string, embed = false) => {
    const raw = record[key];
    if (typeof raw !== 'string' || raw.trim() === '') return;
    const ok = embed ? embedHostOk(raw) : isSafeAddress(raw);
    if (!ok) {
      out.push({
        file,
        path: formatPath([...path, key]),
        rule: 'MEDIA',
        message: embed
          ? 'An embed must be an https YouTube or Vimeo address (D-45).'
          : 'A media address must be a site path (/media/...) or an https address (D-29).',
        severity: 'error',
      });
    }
  };
  const isMediaRef = typeof record.kind === 'string' && MEDIA_KIND_NAMES.has(record.kind) && typeof record.src === 'string';
  if (isMediaRef) {
    check('src', record.kind === 'embed');
    check('poster');
    check('captions');
  } else if (record.type === 'file') {
    check('src');
  }
  for (const [key, item] of Object.entries(record)) out.push(...mediaAddressFindings(file, item, [...path, key]));
  return out;
}

/** Links into this site's own repository fail the check (docs/V3_PLAN.md D-22). */
function repositoryLinkFindings(file: string, value: unknown, repository: string | undefined): Finding[] {
  if (!repository) return [];
  const out: Finding[] = [];
  for (const { path, text } of stringValues(value)) {
    for (const match of text.matchAll(/https?:\/\/[^\s)<>"']+/gi)) {
      if (pointsIntoRepository(match[0], repository)) {
        out.push({ file, path, rule: 'OWN-REPOSITORY', message: "This links the site's own repository, which is never linked (D-22).", severity: 'error' });
        break;
      }
    }
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
  findings.push(...copyFindings(content));
  const files = [
    { file: content.siteFile, value: content.site as unknown },
    ...content.projectFiles.map(({ file, project }) => ({ file, value: project as unknown })),
  ];
  for (const { file, value } of files) {
    findings.push(...mediaAddressFindings(file, value));
    findings.push(...repositoryLinkFindings(file, value, options.siteRepository));
  }
  findings.push(...internalLinkWarnings(content, visibleSlugs, options.siteHosts ?? siteHostsOf(DEFAULT_SITE_URL)));
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
