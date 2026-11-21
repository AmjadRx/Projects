/**
 * Small formatting helpers shared by pages, metadata, and JSON-LD. Each one prints content
 * exactly as stored and prints nothing at all when the content is empty: an empty field leaves
 * no trace (ARCHITECTURE.md section 4 rules).
 */
import type { Project, Site, Stat } from './types';

/** True for a string with at least one visible character. */
export function hasText(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The GPA, always as its label, a space, and its value ("Major GPA 3.65"). Returns '' when
 * either part is empty, so no component can print the value without its label, or the label
 * without its value (docs/V3_PLAN.md D-08).
 */
export function gpaText(personal: Pick<Site['personal'], 'gpa' | 'gpaLabel'>): string {
  if (!hasText(personal.gpa) || !hasText(personal.gpaLabel)) return '';
  return `${personal.gpaLabel.trim()} ${personal.gpa.trim()}`;
}

/**
 * A fact row that repeats the GPA prints through the GPA helper, so emptying `personal.gpa` hides
 * it too (docs/V3_PLAN.md D-08, D-14). A row is the GPA when its label is the GPA label or holds
 * the word "GPA", so renaming the label can never leave a stored copy printing on its own. The
 * same test is `isGpaName` in lib/lint.ts, which the content check uses.
 */
export function isGpaFact(fact: { label: string }, personal: Pick<Site['personal'], 'gpaLabel'>): boolean {
  const name = fact.label.trim().toLowerCase();
  if (name === '') return false;
  return name === personal.gpaLabel.trim().toLowerCase() || /\bgpa\b/.test(name);
}

/** "in-progress" to "In progress": the seed's own word in sentence case (docs/V3_PLAN.md D-15). */
export function sentenceCase(value: string): string {
  const words = value.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The status words a project shows: its label, or its status value in sentence case. */
export function statusText(project: Pick<Project, 'status' | 'statusLabel'>): string {
  return hasText(project.statusLabel) ? project.statusLabel : sentenceCase(project.status);
}

/** A readout as one text run: prefix, value, and suffix exactly as stored ("~50%", "504 V"). */
export function statText(stat: Pick<Stat, 'prefix' | 'value' | 'suffix'>): string {
  return `${stat.prefix ?? ''}${stat.value}${stat.suffix ?? ''}`;
}

/** The comma-separated domains of a project, trimmed, in their stored spelling. */
export function projectDomains(project: Pick<Project, 'domain'>): string[] {
  return project.domain
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
}

/** A key for grouping domains without regard to case (docs/V3_PLAN.md D-58). */
export function domainKey(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A sortable key from a log date of any precision ("2026-08-13", "2026-07", "2026"). */
export function dateSortKey(date: string): string {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(date.trim());
  if (!match) return '';
  return `${match[1]}-${match[2] ?? '00'}-${match[3] ?? '00'}`;
}

/** A link target opens in this tab unless it leaves the site. */
export function isExternalUrl(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
