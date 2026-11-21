/**
 * The guard rails (ARCHITECTURE.md 7.4; docs/V3_PLAN.md D-22), computed in the browser over the
 * working copy while the owner edits. Nothing here blocks a save: the server's content check on
 * /api/save is the authority. This list tells the owner earlier.
 *
 * Warnings (they never block a save):
 * - ALT-TEXT: a photo (an image MediaRef with a file) without alt text, anywhere;
 * - DESCRIPTION: a 3D model or a document without its short description (`alt`);
 * - COVER: a project without a cover;
 * - HIGHLIGHT: an empty highlight;
 * - RESUME-FILE: a media file whose name looks like a resume (no resume file is ever served);
 * - LINKEDIN-LABEL: a social link to LinkedIn that is not labelled exactly "LinkedIn";
 * - AVAILABILITY: an availability line that differs from the documented one;
 * - LINK-KIND: a link that is not a site path, an in-page anchor, an https address, mailto:, or
 *   tel: (the site prints such a link as plain text; an http address is asked to become https);
 * - PROOF and INTERNAL-LINK: a proof or an internal link that leads to no visible page (from
 *   lib/lint.ts).
 *
 * Errors (the save would be refused; reported early): the public rules of
 * content-rules.public.json, an emptied GPA or phone that still has a copy (GPA-COPY,
 * PHONE-COPY), a media address that is not a site path or https (MEDIA), and a file that fails
 * schema version 3 (SCHEMA, SLUG). Findings from `validateContent` and `lintContent` in
 * lib/lint.ts keep the severity lib/lint.ts gives them; they run here with the public rules only,
 * because the private terms (CONTENT_BLOCKLIST) never reach the browser.
 *
 * Pure and browser-safe. `computeWarnings` is memoized by the identity of the document, which
 * the store replaces on every edit and keeps otherwise.
 */
import rulesFile from '@/content-rules.public.json';
import { SITE_FILE, type Finding } from '@/lib/admin/contract';
import { compileRules, lintContent, stringValues, validateContent, type CompiledRule, type RulesFile } from '@/lib/lint';
import { fileNameOf } from '@/lib/media';
import { MEDIA_KINDS, ProjectSchema, SiteSchema } from '@/lib/schema';
import type { Project } from '@/lib/types';
import { pathOfEntry, type Doc } from './store';

/** The guard-rail rule ids this module adds to those of lib/lint.ts. */
export const WARNING_RULES = [
  'ALT-TEXT',
  'DESCRIPTION',
  'COVER',
  'HIGHLIGHT',
  'RESUME-FILE',
  'LINKEDIN-LABEL',
  'AVAILABILITY',
  'LINK-KIND',
] as const;

/**
 * The documented availability line (CONTENT_RULES.md section 3; CLAUDE.md, "Site content").
 * `personal.availability` should read exactly this; it changes only with a new handoff.
 */
export const DOCUMENTED_AVAILABILITY = 'Available: Full-time, June 2027';

let compiled: CompiledRule[] | null = null;
function publicRules(): CompiledRule[] {
  compiled ??= compileRules(rulesFile as RulesFile);
  return compiled;
}

const KINDS = new Set<string>(MEDIA_KINDS);

/** A file name that reads as a resume or CV: "resume.pdf", "Amjad_CV.docx", "curriculum-vitae.pdf". */
const RESUME_NAME = /(?:^|[^a-z0-9])(?:r[eé]sum[eé]s?|cvs?|curriculum[\s_.-]*vitae)(?:[^a-z0-9]|$)/i;

/** True when an address's file name looks like a resume or a CV. */
export function looksLikeResume(src: string): boolean {
  const value = src.trim();
  if (value === '') return false;
  const name = fileNameOf(value).replace(/\.[a-z0-9]{1,5}$/i, '');
  return RESUME_NAME.test(name);
}

/** True for an address on LinkedIn. */
export function isLinkedInUrl(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return host === 'linkedin.com' || host.endsWith('.linkedin.com') || host === 'lnkd.in';
  } catch {
    return false;
  }
}

/**
 * Why a link address is not one of the allowed kinds (CONTENT_RULES.md section 4, as far as a
 * machine can tell): null for a site path, an in-page anchor, an https address, mailto:, or tel:,
 * and for an empty address (no link). lib/links.ts prints anything else as plain text, except an
 * http address, which it links but which should be https.
 */
export function linkKindIssue(href: string): string | null {
  const value = href.trim();
  if (value === '' || value.startsWith('#')) return null;
  if (value.startsWith('/')) return value.startsWith('//') || value.startsWith('/\\') ? 'The site prints this link as plain text. Use a site path that starts with a single /.' : null;
  if (/^mailto:\S+@\S+$/i.test(value) || /^tel:\+?[0-9().\s-]{3,}$/i.test(value)) return null;
  if (/^http:\/\//i.test(value)) return 'This link uses http. Use its https address.';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname !== '') return null;
  } catch {
    // Not an address at all ("www.example.com" without https://, a word).
  }
  return 'The site prints this link as plain text. Use a site path (/...), an https address, mailto:, or tel:.';
}

/** A Markdown link's address: the part in parentheses after "]" (the same notation as lib/lint.ts). */
const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)/g;

/** LINK-KIND: link fields (`href`, `url`) and the links inside Markdown, in one file. */
function linkKindWarnings(file: string, data: unknown): Finding[] {
  const out: Finding[] = [];
  for (const { path, text } of stringValues(data)) {
    const addresses = /(?:^|\.)(?:href|url)$/.test(path) ? [text] : [];
    for (const match of text.matchAll(MARKDOWN_LINK)) addresses.push(match[1]);
    for (const href of addresses) {
      const issue = linkKindIssue(href);
      if (issue) {
        out.push(warn(file, path, 'LINK-KIND', issue));
        break;
      }
    }
  }
  return out;
}

function warn(file: string, path: string, rule: (typeof WARNING_RULES)[number], message: string): Finding {
  return { file, path, rule, message, severity: 'warning' };
}

function child(path: string, key: string | number): string {
  return typeof key === 'number' ? `${path}[${key}]` : path === '' ? key : `${path}.${key}`;
}

/** Visits every object in a JSON value with its field path. */
function walkObjects(value: unknown, path: string, visit: (node: Record<string, unknown>, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkObjects(item, child(path, i), visit));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  visit(node, path);
  for (const [key, item] of Object.entries(node)) {
    if (item !== null && typeof item === 'object') walkObjects(item, child(path, key), visit);
  }
}

/** The media warnings of one file: alt text, descriptions, and resume-like names. */
function mediaWarnings(file: string, data: unknown): Finding[] {
  const out: Finding[] = [];
  walkObjects(data, '', (node, path) => {
    const src = typeof node.src === 'string' ? node.src : null;
    if (src === null) return;
    // The seed's hero model has no `kind`; a hero model is always a model (docs/V3_PLAN.md D-03).
    const kind = typeof node.kind === 'string' ? node.kind : path === 'settings.heroModel' ? 'model' : null;
    const isMedia = kind !== null && KINDS.has(kind);
    const isFileBlock = node.type === 'file';
    if (!isMedia && !isFileBlock) return;
    if (src.trim() === '') return;
    if (isMedia) {
      const alt = typeof node.alt === 'string' ? node.alt.trim() : '';
      if (kind === 'image' && alt === '') {
        out.push(warn(file, child(path, 'alt'), 'ALT-TEXT', 'This photo has no alt text. Describe what it shows for people who cannot see it.'));
      } else if ((kind === 'model' || kind === 'document') && alt === '') {
        const what = kind === 'model' ? 'This 3D model' : 'This document';
        out.push(warn(file, child(path, 'alt'), 'DESCRIPTION', `${what} has no short description. Say what it is in one sentence.`));
      }
    }
    if (kind !== 'embed' && looksLikeResume(src)) {
      out.push(
        warn(file, child(path, 'src'), 'RESUME-FILE', 'This file name looks like a resume. The site never serves a resume file; the resume request opens an email instead.'),
      );
    }
  });
  return out;
}

function siteWarnings(site: Doc['site']): Finding[] {
  const out = mediaWarnings(SITE_FILE, site);
  const availability = typeof site.personal?.availability === 'string' ? site.personal.availability.trim() : '';
  if (availability !== '' && availability !== DOCUMENTED_AVAILABILITY) {
    out.push(warn(SITE_FILE, 'personal.availability', 'AVAILABILITY', `This differs from the documented availability line: ${DOCUMENTED_AVAILABILITY}`));
  }
  const links = Array.isArray(site.socialLinks) ? site.socialLinks : [];
  links.forEach((link, i) => {
    if (typeof link?.url !== 'string' || !isLinkedInUrl(link.url)) return;
    if ((link.label ?? '').trim() !== 'LinkedIn') {
      out.push(warn(SITE_FILE, `socialLinks[${i}].label`, 'LINKEDIN-LABEL', 'A link to LinkedIn is labelled exactly "LinkedIn".'));
    }
  });
  out.push(...linkKindWarnings(SITE_FILE, site));
  return out;
}

function projectWarnings(file: string, project: Project): Finding[] {
  const out: Finding[] = [];
  const cover = project.cover as { src?: unknown } | undefined;
  if (typeof cover?.src !== 'string' || cover.src.trim() === '') {
    out.push(warn(file, 'cover', 'COVER', 'This project has no cover. Its card shows a placeholder until you add one.'));
  }
  (Array.isArray(project.highlights) ? project.highlights : []).forEach((text, i) => {
    if (typeof text !== 'string' || text.trim() === '') {
      out.push(warn(file, `highlights[${i}]`, 'HIGHLIGHT', 'This highlight is empty. Write it or remove it.'));
    }
  });
  out.push(...mediaWarnings(file, project));
  out.push(...linkKindWarnings(file, project));
  return out;
}

// One file's own warnings depend only on that file's data, so they are kept per object.
const fileCache = new WeakMap<object, Finding[]>();

function cachedFile(data: object, compute: () => Finding[]): Finding[] {
  const hit = fileCache.get(data);
  if (hit) return hit;
  const found = compute();
  fileCache.set(data, found);
  return found;
}

/** The content check's findings over the whole working copy (public rules only). */
function checkFindings(doc: Doc): Finding[] {
  const { content, findings } = validateContent(
    {
      site: { file: SITE_FILE, data: doc.site },
      projects: doc.projects.map((entry) => ({ file: pathOfEntry(entry), data: entry.data })),
    },
    { SiteSchema, ProjectSchema },
  );
  if (!content) return findings;
  return lintContent(content, { rules: publicRules(), blocklist: [] });
}

const docCache = new WeakMap<Doc, Finding[]>();

/**
 * Every warning and early error for the working copy: errors first, then warnings, each in file
 * order (the site file, then the projects in display order).
 */
export function computeWarnings(doc: Doc): Finding[] {
  const hit = docCache.get(doc);
  if (hit) return hit;
  const files = [SITE_FILE, ...doc.projects.map((entry) => pathOfEntry(entry))];
  const own = [
    ...cachedFile(doc.site, () => siteWarnings(doc.site)),
    ...doc.projects.flatMap((entry) => cachedFile(entry.data, () => projectWarnings(pathOfEntry(entry), entry.data))),
  ];
  const all = [...checkFindings(doc), ...own];
  const order = (f: Finding) => {
    const i = files.indexOf(f.file);
    return i === -1 ? files.length : i;
  };
  const sorted = all
    .map((finding, i) => ({ finding, i }))
    .sort((a, b) => {
      const severity = (a.finding.severity === 'error' ? 0 : 1) - (b.finding.severity === 'error' ? 0 : 1);
      if (severity !== 0) return severity;
      const file = order(a.finding) - order(b.finding);
      return file !== 0 ? file : a.i - b.i;
    })
    .map(({ finding }) => finding);
  docCache.set(doc, sorted);
  return sorted;
}

/** How many findings each file has, in file order, for the panel's filter. */
export function countByFile(findings: readonly Finding[]): { file: string; errors: number; warnings: number }[] {
  const counts = new Map<string, { file: string; errors: number; warnings: number }>();
  for (const f of findings) {
    const entry = counts.get(f.file) ?? { file: f.file, errors: 0, warnings: 0 };
    if (f.severity === 'error') entry.errors += 1;
    else entry.warnings += 1;
    counts.set(f.file, entry);
  }
  return [...counts.values()];
}
