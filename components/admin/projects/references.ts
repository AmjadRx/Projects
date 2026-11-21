/**
 * Where content refers to a project, for renaming its slug and for deleting it (docs/V3_PLAN.md
 * D-21: "Renaming a slug or deleting a project first lists every reference to update (proofs, nav
 * and now links, Markdown links)", and offers to update them in the same edit).
 *
 * A reference is one string field that points at the project's page or slug:
 * - skill proofs (`skills.groups[g].items[i].proof`, a slug),
 * - stat proofs (`stats[i].proof`, a site path),
 * - navigation and "Now" links (`nav[i].href`, `now[i].href`),
 * - any other link field (`url` or `href`: project links, link rows, social links),
 * - Markdown links inside any text (`[words](/projects/<slug>)`).
 *
 * Site paths count with an anchor or a query ("/projects/raven#log"), and so do absolute links to
 * this site's own host, as lib/lint.ts counts them for its internal-link warning.
 *
 * Pure and browser-safe. A rename rewrites each reference to the new slug; a delete removes each
 * one (a proof loses its value, a link item leaves its list, a Markdown link keeps its words).
 * `applyPatches` writes every change with `setIn`, so untouched files keep their identity.
 */
import { DEFAULT_SITE_URL, siteHostsOf, sitePathOf, stringValues } from '@/lib/lint';
import { SITE_FILE } from '@/lib/admin/contract';
import type { Project, Site } from '@/lib/types';
import { pathOfEntry, renumber, type Doc } from '../state/store';
import { parsePath, setIn, updateIn, type PathSegment } from '../ui/paths';
import { removeItem } from '../ui/list';
import { isLastVisible, LAST_VISIBLE } from './logic';

export type ReferenceKind = 'skill-proof' | 'stat-proof' | 'nav-link' | 'now-link' | 'link' | 'markdown';

export interface SlugReference {
  /** The entry key of the project that holds it, or null for content/site.json. */
  key: string | null;
  /** The file it is in: content/site.json or the project's file. */
  file: string;
  /** The field path, as the content check writes it. */
  path: string;
  kind: ReferenceKind;
  /** The field's text now. */
  text: string;
}

/** Plain names for each kind, for the dialog that lists them. */
export const REFERENCE_KIND_LABELS: Readonly<Record<ReferenceKind, string>> = {
  'skill-proof': 'Skill proof',
  'stat-proof': 'Stat proof',
  'nav-link': 'Navigation link',
  'now-link': '"Now" link',
  link: 'Link',
  markdown: 'Link in text',
};

/** The host names of this site, for absolute links to it. */
export const SITE_HOSTS: readonly string[] = siteHostsOf(DEFAULT_SITE_URL);

/** A Markdown link's address, after "](", the same notation lib/lint.ts reads. */
const MARKDOWN_HREF = /(\]\(\s*<?)([^)\s>]+)/g;
/** A whole Markdown link: [words](address "title"). */
const MARKDOWN_LINK = /\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
const LINK_FIELD = /(?:^|\.)(?:href|url)$/;
const SKILL_PROOF = /^skills\.groups\[\d+\]\.items\[\d+\]\.proof$/;
const STAT_PROOF = /^stats\[\d+\]\.proof$/;
const NAV_LINK = /^nav\[\d+\]\.href$/;
const NOW_LINK = /^now\[\d+\]\.href$/;
/** A link field whose whole list item is the link: nav items, social links, project links, link rows. */
const LINK_ITEM = /^(?:nav|socialLinks|links|.*\.links)\[\d+\]\.(?:href|url)$/;

/** True when an address leads to this project's page: "/projects/<slug>", with or without "#..." or "?...". */
export function linksToSlug(href: string, slug: string, hosts: readonly string[] = SITE_HOSTS): boolean {
  if (slug === '') return false;
  const value = href.trim();
  const path = value.startsWith('/') ? value : sitePathOf(value, hosts);
  if (path === null) return false;
  const page = `/projects/${slug}`;
  if (!path.startsWith(page)) return false;
  const rest = path.slice(page.length);
  return rest === '' || /^[/?#]/.test(rest);
}

/** The address with the project's slug replaced, everything around it (host, anchor, query) kept. */
export function rewriteHref(href: string, from: string, to: string, hosts: readonly string[] = SITE_HOSTS): string {
  if (!linksToSlug(href, from, hosts)) return href;
  const page = `/projects/${from}`;
  const at = href.indexOf(page);
  if (at === -1) return href;
  return `${href.slice(0, at)}/projects/${to}${href.slice(at + page.length)}`;
}

/** True when the text holds a Markdown link to the project's page. */
export function markdownLinksTo(text: string, slug: string, hosts: readonly string[] = SITE_HOSTS): boolean {
  for (const match of text.matchAll(MARKDOWN_HREF)) {
    if (linksToSlug(match[2], slug, hosts)) return true;
  }
  return false;
}

/** The text with every Markdown link to the project's page pointed at the new slug. */
export function rewriteMarkdown(text: string, from: string, to: string, hosts: readonly string[] = SITE_HOSTS): string {
  return text.replace(MARKDOWN_HREF, (match: string, before: string, href: string) =>
    linksToSlug(href, from, hosts) ? `${before}${rewriteHref(href, from, to, hosts)}` : match,
  );
}

/** The text with every Markdown link to the project's page turned into its words alone. Images are left. */
export function unlinkMarkdown(text: string, slug: string, hosts: readonly string[] = SITE_HOSTS): string {
  return text.replace(MARKDOWN_LINK, (match: string, words: string, href: string, offset: number, whole: string) =>
    linksToSlug(href, slug, hosts) && whole[offset - 1] !== '!' ? words : match,
  );
}

function kindOf(path: string, text: string, slug: string, isSite: boolean, hosts: readonly string[]): ReferenceKind | null {
  if (isSite && SKILL_PROOF.test(path)) return text.trim() === slug ? 'skill-proof' : null;
  if (isSite && STAT_PROOF.test(path)) return linksToSlug(text, slug, hosts) ? 'stat-proof' : null;
  if (LINK_FIELD.test(path)) {
    if (!linksToSlug(text, slug, hosts)) return null;
    if (isSite && NAV_LINK.test(path)) return 'nav-link';
    if (isSite && NOW_LINK.test(path)) return 'now-link';
    return 'link';
  }
  return markdownLinksTo(text, slug, hosts) ? 'markdown' : null;
}

function scan(out: SlugReference[], data: unknown, file: string, key: string | null, slug: string, hosts: readonly string[]): void {
  for (const { path, text } of stringValues(data)) {
    const kind = kindOf(path, text, slug, key === null, hosts);
    if (kind) out.push({ key, file, path, kind, text });
  }
}

export interface FindOptions {
  /** Leave out this project's own fields (a project being deleted takes its links with it). */
  exclude?: string;
  hosts?: readonly string[];
}

/** Every field in the site and the projects that refers to `slug`, in file order. */
export function findSlugReferences(doc: Doc, slug: string, options: FindOptions = {}): SlugReference[] {
  const hosts = options.hosts ?? SITE_HOSTS;
  const out: SlugReference[] = [];
  if (slug === '') return out;
  scan(out, doc.site, SITE_FILE, null, slug, hosts);
  for (const entry of doc.projects) {
    if (entry.key === options.exclude) continue;
    scan(out, entry.data, pathOfEntry(entry), entry.key, slug, hosts);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------

/** One change to one file: set a string, remove a key, or remove a list item. */
export type Patch =
  | { key: string | null; path: string; op: 'set'; value: string }
  | { key: string | null; path: string; op: 'unset' }
  | { key: string | null; path: string; op: 'drop' };

/** What a rename does to each reference: it points at the new slug. */
export function renamePatches(refs: readonly SlugReference[], from: string, to: string, hosts: readonly string[] = SITE_HOSTS): Patch[] {
  return refs.map((ref) => {
    const value =
      ref.kind === 'skill-proof' ? to : ref.kind === 'markdown' ? rewriteMarkdown(ref.text, from, to, hosts) : rewriteHref(ref.text, from, to, hosts);
    return { key: ref.key, path: ref.path, op: 'set', value };
  });
}

/** The parent of a field path ("nav[2]" for "nav[2].href"). */
function parentPath(path: string): string {
  const cut = path.lastIndexOf('.');
  return cut === -1 ? path : path.slice(0, cut);
}

/**
 * What deleting the project does to a reference, or null when it is left as is (a link field that
 * is not a list item, such as a repository card's address).
 */
export function removalPatch(ref: SlugReference, slug: string, hosts: readonly string[] = SITE_HOSTS): Patch | null {
  switch (ref.kind) {
    case 'skill-proof':
    case 'stat-proof':
    case 'now-link':
      return { key: ref.key, path: ref.path, op: 'unset' };
    case 'nav-link':
      return { key: ref.key, path: parentPath(ref.path), op: 'drop' };
    case 'markdown': {
      const value = unlinkMarkdown(ref.text, slug, hosts);
      return value === ref.text ? null : { key: ref.key, path: ref.path, op: 'set', value };
    }
    case 'link':
      return LINK_ITEM.test(ref.path) ? { key: ref.key, path: parentPath(ref.path), op: 'drop' } : null;
  }
}

export function removalPatches(refs: readonly SlugReference[], slug: string, hosts: readonly string[] = SITE_HOSTS): Patch[] {
  return refs.map((ref) => removalPatch(ref, slug, hosts)).filter((patch): patch is Patch => patch !== null);
}

/** What happens to a reference, in words, for the dialog. */
export function describePatch(ref: SlugReference, patch: Patch | null): string {
  if (patch === null) return 'Left as is.';
  if (patch.op === 'set') return `Becomes: ${patch.value}`;
  if (patch.op === 'unset') {
    if (ref.kind === 'now-link') return 'The item stays, without its link.';
    return 'The proof is removed.';
  }
  if (ref.kind === 'nav-link') return 'The item is removed from the navigation.';
  return 'The link is removed from its list.';
}

function dropItem<T>(root: T, path: string): T {
  const segments = parsePath(path);
  const index = segments.pop();
  if (typeof index !== 'number') return root;
  return updateIn(root, segments, (list: unknown) => (Array.isArray(list) ? removeItem(list, index) : list));
}

function compareDrops(a: Patch, b: Patch): number {
  // Higher indexes first within one list, so the earlier positions stay valid.
  const pa: PathSegment[] = parsePath(a.path);
  const pb: PathSegment[] = parsePath(b.path);
  const parentA = JSON.stringify([a.key, pa.slice(0, -1)]);
  const parentB = JSON.stringify([b.key, pb.slice(0, -1)]);
  if (parentA !== parentB) return parentA < parentB ? -1 : 1;
  return Number(pb[pb.length - 1]) - Number(pa[pa.length - 1]);
}

/**
 * Applies patches to the working copy. Sets and removals of a key come first, then list items are
 * removed from the highest index down. A file no patch touches keeps its identity.
 */
export function applyPatches(doc: Doc, patches: readonly Patch[]): Doc {
  let site: Site = doc.site;
  const projects = new Map<string, Project>();
  const read = (key: string): Project | undefined => projects.get(key) ?? doc.projects.find((e) => e.key === key)?.data;
  const write = (patch: Patch, change: <T>(root: T) => T) => {
    if (patch.key === null) {
      site = change(site);
      return;
    }
    const current = read(patch.key);
    if (current !== undefined) projects.set(patch.key, change(current));
  };

  for (const patch of patches) {
    if (patch.op === 'set') write(patch, (root) => setIn(root, patch.path, patch.value));
    else if (patch.op === 'unset') write(patch, (root) => setIn(root, patch.path, undefined));
  }
  for (const patch of patches.filter((p) => p.op === 'drop').sort(compareDrops)) {
    write(patch, (root) => dropItem(root, patch.path));
  }

  let changedProjects = false;
  const list = doc.projects.map((entry) => {
    const data = projects.get(entry.key);
    if (data === undefined || data === entry.data) return entry;
    changedProjects = true;
    return { ...entry, data };
  });
  if (site === doc.site && !changedProjects) return doc;
  return { site, projects: changedProjects ? list : doc.projects };
}

/** The rename as one edit: the project's new slug and the reference updates together. */
export function renameProject(doc: Doc, key: string, slug: string, patches: readonly Patch[]): Doc {
  const next = applyPatches(doc, patches);
  return {
    ...next,
    projects: next.projects.map((entry) => (entry.key === key ? { ...entry, data: setIn(entry.data, 'slug', slug) } : entry)),
  };
}

/** The delete as one edit: the project leaves the list (which is renumbered), with the reference updates. */
export function deleteProject(doc: Doc, key: string, patches: readonly Patch[]): Doc {
  const next = applyPatches(doc, patches);
  return { ...next, projects: renumber(next.projects.filter((entry) => entry.key !== key)) };
}

/** What removing a project needs: the references to list and their updates, or why it is refused. */
export type RemovalPlan =
  | { refused: string }
  | { key: string; slug: string; title: string; refs: SlugReference[]; patches: (Patch | null)[] };

/**
 * The first step of every way a project leaves the editor (Delete in the project list, and
 * "Revert this file to published" for a project that is not published): refused when it is the
 * last visible project (D-06); otherwise every reference to it, and what each one becomes (D-21).
 * Null when no project has this key.
 */
export function planRemoval(doc: Doc, key: string, hosts: readonly string[] = SITE_HOSTS): RemovalPlan | null {
  const entry = doc.projects.find((e) => e.key === key);
  if (!entry) return null;
  if (isLastVisible(doc.projects, key)) return { refused: LAST_VISIBLE };
  const slug = entry.data.slug;
  const refs = findSlugReferences(doc, slug, { exclude: key, hosts });
  return { key, slug, title: entry.data.title, refs, patches: refs.map((ref) => removalPatch(ref, slug, hosts)) };
}
