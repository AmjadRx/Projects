/**
 * Where content refers to a media file: the one set of rules for the server (delete, rename, the
 * library's counts: lib/admin/server/references.ts) and the browser (the working copy:
 * components/admin/media/logic.ts). ARCHITECTURE.md 13A ("Deleting a media file checks for content
 * that still refers to it"); docs/V3_PLAN.md D-25, D-27. Browser-safe: no server imports.
 *
 * A string field refers to a file when:
 * - its whole value is the file's address, after trimming, dropping a query or a fragment
 *   ("/media/raven/report.pdf#page=3", Blob's "?download=1"), and reading an absolute address on
 *   this site's own host as its path ("https://amjadrehawi.com/media/raven/a.webp"); or
 * - the address appears anywhere inside its text as a whole address. Any string field may carry a
 *   Markdown link (bullets items, text blocks, pitches, highlights), so every field is searched;
 *   a field that only names the file in passing also counts, which can only make a delete wait,
 *   never break a page.
 *
 * "Whole address" means no file-name character continues it, so "/media/raven/a.webp" is not
 * found in "/media/raven/a.webp2", and a sentence may end right after it. Keys are never read.
 */
import { DEFAULT_SITE_URL, formatPath, siteHostsOf, sitePathOf, stringValues } from '@/lib/lint';

/** The host names that mean this site, from NEXT_PUBLIC_SITE_URL (inlined in the browser) or the default. */
export function siteHosts(siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string[] {
  return siteHostsOf(siteUrl && siteUrl.trim() !== '' ? siteUrl : DEFAULT_SITE_URL);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The address, where no file-name character continues it (a final "." before a space is fine). */
function addressPattern(src: string, flags = ''): RegExp {
  return new RegExp(`${escapeRegExp(src)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, flags);
}

/** True when `text` contains the address `src` as a whole address. */
export function mentions(text: string, src: string): boolean {
  return src !== '' && text.includes(src) && addressPattern(src).test(text);
}

/**
 * The pattern that replaces `from` inside text. When the new address is absolute (a Blob address),
 * an own-host absolute form of `from` ("https://amjadrehawi.com/media/raven/a.webp") is replaced
 * whole, so the host is not left in front of the new address.
 */
function replacePattern(from: string, to: string, hosts: readonly string[]): RegExp {
  const tail = `${escapeRegExp(from)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`;
  if (!/^https?:\/\//i.test(to) || !from.startsWith('/') || hosts.length === 0) return new RegExp(tail, 'g');
  return new RegExp(`(?:https?:\\/\\/(?:${hosts.map(escapeRegExp).join('|')}))?${tail}`, 'g');
}

/**
 * The address a whole field value names: trimmed, without a query or a fragment, and, for an
 * absolute address on this site's host, its path.
 */
export function addressOf(value: string, hosts: readonly string[] = siteHosts()): string {
  const bare = value.trim().replace(/[?#].*$/, '');
  if (!/^https?:\/\//i.test(bare)) return bare;
  return sitePathOf(bare, hosts) ?? bare;
}

/** True when a string field with this value refers to `src`. */
export function refersTo(value: string, src: string, hosts: readonly string[] = siteHosts()): boolean {
  if (src === '') return false;
  return addressOf(value, hosts) === src || mentions(value, src);
}

/** The field paths inside one content value that refer to `src` ("cover.src", "blocks[3].items[1]"). */
export function referencePaths(data: unknown, src: string, hosts: readonly string[] = siteHosts()): string[] {
  if (src === '') return [];
  return stringValues(data)
    .filter(({ text }) => refersTo(text, src, hosts))
    .map(({ path }) => path);
}

/** Adds, for each address in `srcs`, how many fields of `data` refer to it. */
export function countReferencePaths(
  data: unknown,
  srcs: readonly string[],
  counts: Map<string, number>,
  hosts: readonly string[] = siteHosts(),
): void {
  if (srcs.length === 0) return;
  const exact = new Set(srcs);
  for (const { text } of stringValues(data)) {
    const address = addressOf(text, hosts);
    for (const src of srcs) {
      if (src === '') continue;
      if ((exact.has(address) && address === src) || mentions(text, src)) counts.set(src, (counts.get(src) ?? 0) + 1);
    }
  }
}

/** Sets an own property, so a key such as "__proto__" stays data. */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * `data` with every reference to `from` pointing at `to`, and how many fields changed. A field
 * whose whole value is the address keeps its query or fragment ("/media/raven/a.pdf#page=3"
 * becomes "/media/raven/b.pdf#page=3") and its own host; inside text, each whole occurrence is
 * replaced, so an absolute link on the site's host keeps its host. Untouched objects are kept as
 * they are, so an unchanged file serializes to its stored text.
 */
export function rewriteData<T>(
  data: T,
  from: string,
  to: string,
  hosts: readonly string[] = siteHosts(),
): { data: T; count: number } {
  let count = 0;
  const visit = (value: unknown, path: PropertyKey[]): unknown => {
    if (typeof value === 'string') {
      if (!refersTo(value, from, hosts)) return value;
      count += 1;
      if (mentions(value, from)) return value.replace(replacePattern(from, to, hosts), () => to);
      // The whole value names the file through another form of the address (an absolute address
      // on this host whose path is `from`): keep everything around the path.
      const trimmed = value.trim();
      const at = trimmed.indexOf(from);
      return at === -1 ? to : `${trimmed.slice(0, at)}${to}${trimmed.slice(at + from.length)}`;
    }
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item, i) => {
        const out = visit(item, [...path, i]);
        if (out !== item) changed = true;
        return out;
      });
      return changed ? next : value;
    }
    if (value !== null && typeof value === 'object') {
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const next = visit(item, [...path, key]);
        if (next !== item) changed = true;
        define(out, key, next);
      }
      return changed ? out : value;
    }
    return value;
  };
  const next = visit(data, []) as T;
  return { data: next, count };
}

export { formatPath };
