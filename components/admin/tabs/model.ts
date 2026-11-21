/**
 * The site tabs' pure logic, with no React: how an edit changes content/site.json. The tab
 * components call these, and tests/admin-site-tabs.test.ts runs them over the seed.
 *
 * Two rules hold everywhere (docs/V3_PLAN.md D-18):
 * - An edit returns new objects only along its path and keeps every other object, key, and key
 *   position; an unedited field keeps its value, empty strings and absent optional keys included.
 * - An edit that changes nothing returns the very same object, so it makes no undo step and
 *   leaves the file clean.
 */
import { statText } from '@/lib/format';
import { DEFAULT_SITE_URL, resolvesToPage, siteHostsOf, sitePathOf, STATIC_ROUTES } from '@/lib/lint';
import type { MediaRef, Site, SkillGroup, SocialLink, Stat } from '@/lib/types';
import { detectIcon } from '@/lib/utils';
import { insertItem, removeItem } from '../ui/list';
import { getIn, parsePath, setIn } from '../ui/paths';

/** The media folder of every file the site tabs pick (ARCHITECTURE.md 13A: one site library). */
export const SITE_MEDIA_FOLDER = 'site';

// ---------------------------------------------------------------------------------------------
// Optional text fields
// ---------------------------------------------------------------------------------------------

/**
 * What an optional text field (a stat's prefix or suffix, a Now item's link) stores after the
 * owner typed `text`. Text stays text. An emptied field keeps "" when the stored file has the key,
 * so a saved empty string survives, and leaves the key out when the stored file never had it, so
 * typing and then clearing gives the file back unchanged.
 */
export function optionalText(text: string, storedHasKey: boolean): string | undefined {
  if (text !== '') return text;
  return storedHasKey ? '' : undefined;
}

/**
 * `obj` with its optional text `key` set from what the owner typed (see `optionalText`). An absent
 * key stays absent; a key set to undefined keeps its place and JSON leaves it out (ui/paths.ts).
 */
export function withOptionalText<T extends object>(obj: T, key: string, text: string, storedHasKey: boolean): T {
  return setIn(obj, [key], optionalText(text, storedHasKey));
}

let storedCache: { text: string; data: unknown } | null = null;

/** The stored text of content/site.json (as loaded or last saved), parsed once per text. */
export function storedSiteOf(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  if (storedCache === null || storedCache.text !== text) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    storedCache = { text, data };
  }
  return storedCache.data;
}

/** True when the key at `path` ("stats[2].prefix") holds a value in `root`. */
export function hasKeyAt(root: unknown, path: string): boolean {
  const segments = parsePath(path);
  const key = segments[segments.length - 1];
  if (typeof key !== 'string') return false;
  const parent = getIn(root, segments.slice(0, -1));
  if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) return false;
  return Object.prototype.hasOwnProperty.call(parent, key) && (parent as Record<string, unknown>)[key] !== undefined;
}

/**
 * True when the stored site file has the key at `path`. Rows are matched by position, so a row
 * moved in this session is compared with the row stored at its new position; the only effect is
 * whether an emptied optional field stores "" or nothing, which the site prints the same way.
 */
export function storedHasKey(storedText: string | undefined, path: string): boolean {
  return hasKeyAt(storedSiteOf(storedText), path);
}

// ---------------------------------------------------------------------------------------------
// Proofs and page links
// ---------------------------------------------------------------------------------------------

/**
 * A proof picked from a list. "" (None) removes the key: a proof is a reference, and an empty one
 * would be reported as a proof that leads nowhere (lib/lint.ts).
 */
export function withProof<T extends { proof?: string }>(item: T, proof: string): T {
  return setIn(item, ['proof'], proof === '' ? undefined : proof);
}

/** What the pickers need to know about a project. */
export interface ProjectSummary {
  slug: string;
  title: string;
  visible: boolean;
}

export interface Choice {
  value: string;
  label: string;
}

/** Plain names for the site's own routes (lib/lint.ts STATIC_ROUTES), for the page pickers. */
export const PAGE_NAMES: Readonly<Record<string, string>> = {
  '/': 'Home',
  '/about': 'About',
  '/experience': 'Experience',
  '/projects': 'Projects',
  '/log': 'Log',
  '/contact': 'Contact',
};

export interface PageChoices {
  pages: Choice[];
  /** Visible projects only, in display order: a hidden project's page does not exist. */
  projects: Choice[];
  visible: ReadonlySet<string>;
}

/** The pages a link or a stat proof can point at: the site's routes and every visible project. */
export function pageChoices(projects: readonly ProjectSummary[]): PageChoices {
  const shown = projects.filter((p) => p.visible && p.slug !== '');
  return {
    pages: STATIC_ROUTES.map((route) => ({ value: route, label: `${PAGE_NAMES[route] ?? route} (${route})` })),
    projects: shown.map((p) => ({ value: `/projects/${p.slug}`, label: `${p.title.trim() || p.slug} (/projects/${p.slug})` })),
    visible: new Set(shown.map((p) => p.slug)),
  };
}

/** The projects a skill proof can name (by slug): visible projects only, in display order. */
export function projectChoices(projects: readonly ProjectSummary[]): Choice[] {
  return projects.filter((p) => p.visible && p.slug !== '').map((p) => ({ value: p.slug, label: p.title.trim() || p.slug }));
}

const SITE_HOSTS = siteHostsOf(DEFAULT_SITE_URL);

/**
 * Why an internal link leads nowhere, or null: a site path (or an address on this site's own host)
 * that names no visible page. The site prints such a link as plain text (lib/links.ts); the same
 * check runs in the warning list. Files under /media/ and every other kind of address pass here.
 */
export function linkIssue(href: string, visible: ReadonlySet<string>): string | null {
  const value = href.trim();
  const internal = value.startsWith('/') ? value : sitePathOf(value, SITE_HOSTS);
  if (internal === null || internal.startsWith('//') || internal.startsWith('/media/')) return null;
  return resolvesToPage(internal, visible) ? null : 'No visible page has this address, so the site prints it as plain text.';
}

// ---------------------------------------------------------------------------------------------
// Social links
// ---------------------------------------------------------------------------------------------

/** The icon names a social link can carry: every name detectIcon (lib/utils.ts) gives. */
export const SOCIAL_ICONS = ['mail', 'phone', 'linkedin', 'github', 'calendar', 'video', 'youtube', 'x', 'instagram', 'devpost', 'file', 'globe'] as const;

/** The icon select's value for "follow the address". */
export const AUTO_ICON = 'auto';

/** True when a link's icon follows its address: it is empty or what the address gives. */
export function iconIsAutomatic(link: Pick<SocialLink, 'icon' | 'url'>): boolean {
  return link.icon.trim() === '' || link.icon === detectIcon(link.url);
}

/** The icon select's value for a link: "auto" while the icon follows the address. */
export function iconChoiceOf(link: Pick<SocialLink, 'icon' | 'url'>): string {
  return iconIsAutomatic(link) ? AUTO_ICON : link.icon;
}

/** A new address. The icon follows it, as in v2, unless the owner picked another icon. */
export function withSocialUrl(link: SocialLink, url: string): SocialLink {
  if (url === link.url) return link;
  const icon = iconIsAutomatic(link) ? detectIcon(url) : link.icon;
  return { ...link, url, icon };
}

/** An icon picked in the select; "auto" takes the address's icon again. */
export function withSocialIcon(link: SocialLink, choice: string): SocialLink {
  const icon = choice === AUTO_ICON ? detectIcon(link.url) : choice;
  return icon === link.icon ? link : { ...link, icon };
}

/** `base`, else `base-2`, `base-3`, and so on: the first id no other link uses. */
export function uniqueId(base: string, taken: readonly string[]): string {
  const root = base.trim() === '' ? 'link' : base.trim();
  if (!taken.includes(root)) return root;
  for (let n = 2; ; n += 1) {
    const id = `${root}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

/** A new social link: shown in the footer and on the contact page once it has a label and an address. */
export function newSocialLink(taken: readonly string[]): SocialLink {
  return { id: uniqueId('link', taken), label: '', url: '', icon: 'globe', showInNav: false, showInFooter: true, showInContact: true };
}

/** Why a link's id needs attention, or null: the site keys links by id, so each needs its own. */
export function socialIdIssue(links: readonly SocialLink[], index: number): string | null {
  const id = links[index]?.id.trim() ?? '';
  if (id === '') return 'Give this link an id, such as its name in lowercase.';
  const twins = links.filter((link) => link.id.trim() === id).length;
  return twins > 1 ? 'Another link has this id. Each link needs its own.' : null;
}

// ---------------------------------------------------------------------------------------------
// Printed forms, for the editors' previews
// ---------------------------------------------------------------------------------------------

/** A readout as the site prints it: prefix, value, and suffix as one run, then the label. */
export function printedStat(stat: Pick<Stat, 'prefix' | 'value' | 'suffix' | 'label'>): string {
  return `${statText(stat)} ${stat.label}`.trim();
}

/** Why the GPA label needs a value, or null (the schema's rule, docs/V3_PLAN.md D-08 and Q-23). */
export function gpaLabelIssue(personal: Pick<Site['personal'], 'gpa' | 'gpaLabel'>): string | null {
  return personal.gpa.trim() !== '' && personal.gpaLabel.trim() === ''
    ? 'Required while a GPA is set: the site never prints the GPA without its label.'
    : null;
}

// ---------------------------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------------------------

export const SKILL_TIERS = [
  { value: 'deep', label: 'Deep' },
  { value: 'strong', label: 'Strong' },
  { value: 'familiar', label: 'Familiar' },
] as const satisfies readonly { value: SkillGroup['tier']; label: string }[];

/**
 * Moves one skill item to the end of another group, as it is: the item keeps its object, label,
 * and proof (labels are never split or joined, D-21). The same array when nothing moves.
 */
export function moveSkillItem(groups: readonly SkillGroup[], group: number, item: number, toGroup: number): SkillGroup[] {
  const source = groups[group];
  const target = groups[toGroup];
  if (!source || !target || group === toGroup || item < 0 || item >= source.items.length) return groups as SkillGroup[];
  const moved = source.items[item];
  const next = groups.slice();
  next[group] = { ...source, items: removeItem(source.items, item) };
  next[toGroup] = { ...target, items: insertItem(target.items, moved) };
  return next;
}

// ---------------------------------------------------------------------------------------------
// Contact: the resume request
// ---------------------------------------------------------------------------------------------

type Contact = Site['contact'];

/**
 * Turns the resume request button on or off. The object is created only when the owner turns it
 * on (with empty words for the owner to write); turning it off keeps the words. Turning it on and
 * off again with nothing written gives the file back as it was.
 */
export function withResumeEnabled(contact: Contact, enabled: boolean, storedHasRequest: boolean): Contact {
  const current = contact.resumeRequest;
  if (!current) return enabled ? { ...contact, resumeRequest: { enabled: true, label: '', subject: '', body: '' } } : contact;
  const blank = current.label === '' && current.subject === '' && current.body === '';
  if (!enabled && !storedHasRequest && blank) return setIn(contact, ['resumeRequest'], undefined);
  return current.enabled === enabled ? contact : { ...contact, resumeRequest: { ...current, enabled } };
}

// ---------------------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------------------

/**
 * The hero model as the media field shows it. The seed's has no `kind`, and a hero model is always
 * a model (docs/V3_PLAN.md D-03); the stored object is left as it is until the owner edits it.
 */
export function heroModelValue(ref: MediaRef | undefined): MediaRef | undefined {
  if (!ref || (ref as Partial<MediaRef>).kind) return ref;
  // `kind` first, as in every other MediaRef; set again in case the object carries it as undefined.
  const shown: MediaRef = Object.assign({ kind: 'model' as const }, ref);
  if (!shown.kind) shown.kind = 'model';
  return shown;
}
