/**
 * Where stored content refers to a media file (ARCHITECTURE.md 13A: "Deleting a media file checks
 * for content that still refers to it"; docs/V3_PLAN.md D-25, D-27). Server only.
 *
 * The rules are the ones the browser uses too, in lib/admin/references.ts: a string field refers to
 * a file when its whole value is the file's address (with or without a query or a fragment, or as
 * an absolute address on this site's own host, www included), or when the address appears as a
 * whole address anywhere in its text. Every string field counts, because the site renders Markdown
 * links from more fields than a fixed list could name (a bullets item, a text block, a pitch). Keys
 * are never read.
 *
 * This module applies those rules to content files as stored, for delete, rename, and the
 * library's counts, on the draft and on the published branch alike: a file that is not valid JSON
 * is searched as text, so a broken file can never hide a reference, and a rewrite keeps the stored
 * format (`serializeContent`) and leaves every other file untouched.
 */
import 'server-only';
import { envValue, type Env } from '@/lib/storage/shared';
import { serializeContent, type Reference } from '../contract';
import { countReferencePaths, mentions, referencePaths, rewriteData, siteHosts } from '../references';

export { mentions };

/** A content file as stored. */
export interface ContentFile {
  path: string;
  text: string;
}

/**
 * The host names that mean this site: NEXT_PUBLIC_SITE_URL when it is an http(s) address, the
 * default production address otherwise, each with and without "www." (as the site itself and the
 * save's content check read it).
 */
export function siteHostsFor(env: Env = process.env): string[] {
  const configured = envValue(env, 'NEXT_PUBLIC_SITE_URL');
  return siteHosts(/^https?:\/\//i.test(configured) ? configured : '');
}

function parsed(file: ContentFile): { ok: true; data: unknown } | { ok: false } {
  try {
    return { ok: true, data: JSON.parse(file.text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Every field in `files` that refers to `src`. A file that is not valid JSON is searched as text,
 * and a hit is reported with the path "(file)".
 */
export function findReferences(files: readonly ContentFile[], src: string, hosts: readonly string[] = siteHostsFor()): Reference[] {
  const out: Reference[] = [];
  if (src === '') return out;
  for (const file of files) {
    const read = parsed(file);
    if (!read.ok) {
      if (mentions(file.text, src)) out.push({ file: file.path, path: '(file)' });
      continue;
    }
    for (const path of referencePaths(read.data, src, hosts)) out.push({ file: file.path, path });
  }
  return out;
}

/** How many fields refer to each address, for the media list (a broken file counts once). */
export function countReferences(
  files: readonly ContentFile[],
  srcs: readonly string[],
  hosts: readonly string[] = siteHostsFor(),
): Map<string, number> {
  const counts = new Map<string, number>(srcs.map((src) => [src, 0]));
  if (srcs.length === 0) return counts;
  for (const file of files) {
    const read = parsed(file);
    if (!read.ok) {
      for (const src of srcs) if (src !== '' && mentions(file.text, src)) counts.set(src, (counts.get(src) ?? 0) + 1);
      continue;
    }
    countReferencePaths(read.data, srcs, counts, hosts);
  }
  return counts;
}

export class UnreadableContentError extends Error {
  readonly file: string;
  constructor(file: string) {
    super(`${file} is not valid JSON.`);
    this.name = 'UnreadableContentError';
    this.file = file;
  }
}

/**
 * The content files whose references to `from` now point at `to`, serialized as content is stored
 * (`serializeContent`). A field whose whole value is the address keeps its query, fragment, and
 * host. Files without a reference are left out, so they never change. Throws
 * UnreadableContentError for a file that is not valid JSON but mentions `from`, since it cannot be
 * rewritten safely.
 */
export function rewriteReferences(
  files: readonly ContentFile[],
  from: string,
  to: string,
  hosts: readonly string[] = siteHostsFor(),
): ContentFile[] {
  const changed: ContentFile[] = [];
  if (from === '') return changed;
  for (const file of files) {
    const read = parsed(file);
    if (!read.ok) {
      if (mentions(file.text, from)) throw new UnreadableContentError(file.path);
      continue;
    }
    const { data, count } = rewriteData(read.data, from, to, hosts);
    if (count > 0) changed.push({ path: file.path, text: serializeContent(data) });
  }
  return changed;
}
