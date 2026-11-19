/**
 * Where a field lives in the admin (ARCHITECTURE.md 7.2: "the admin scrolls to the field").
 *
 * Every input in the admin carries the DOM id `fieldId(file, path)`, where `path` is the field
 * path the content check reports (`formatPath` in lib/lint.ts: "stats[2].proof",
 * "blocks[3].items[1].alt"). Containers of list rows carry the id of the row's path ("stats[2]"),
 * so a finding on a field that is not an input (a composed string, a whole row) still lands on
 * its row. `locate` turns a finding into the tab, the project, and the candidate ids to try, most
 * specific first.
 *
 * Browser-safe: no imports beyond the contract.
 */
import { SITE_FILE, slugOfProjectFile } from './contract';

export type TabId =
  | 'settings'
  | 'personal'
  | 'socials'
  | 'nav'
  | 'stats'
  | 'thesis'
  | 'about'
  | 'projects'
  | 'skills'
  | 'experience'
  | 'honorsEdu'
  | 'contact';

/** The twelve tabs of the v2 admin, kept (ARCHITECTURE.md 7), in their order. */
export const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'personal', label: 'Personal' },
  { id: 'socials', label: 'Social links' },
  { id: 'nav', label: 'Navigation' },
  { id: 'stats', label: 'Stats' },
  { id: 'thesis', label: 'Thesis' },
  { id: 'about', label: 'About' },
  { id: 'projects', label: 'Projects' },
  { id: 'skills', label: 'Skills' },
  { id: 'experience', label: 'Experience' },
  { id: 'honorsEdu', label: 'Honors and education' },
  { id: 'contact', label: 'Contact' },
];

/**
 * Which tab edits each top-level key of content/site.json. `now` sits with Personal (the home
 * page's "Now" list), `seo` and `schemaVersion` with Settings.
 */
export const SITE_KEY_TAB: Readonly<Record<string, TabId>> = {
  schemaVersion: 'settings',
  settings: 'settings',
  seo: 'settings',
  personal: 'personal',
  now: 'personal',
  socialLinks: 'socials',
  nav: 'nav',
  stats: 'stats',
  thesis: 'thesis',
  about: 'about',
  skills: 'skills',
  experience: 'experience',
  honors: 'honorsEdu',
  education: 'honorsEdu',
  contact: 'contact',
};

/** A DOM id for a field: deterministic, valid in HTML and CSS selectors, one per file and path. */
export function fieldId(file: string, path: string): string {
  const raw = `${file}#${path}`;
  return `f-${raw.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;
}

/**
 * The field paths to try for a finding's path, most specific first: the path itself, then each
 * parent ("blocks[3].items[1].alt", "blocks[3].items[1]", "blocks[3].items", "blocks[3]",
 * "blocks"). A composed path ("personal.gpaLabel + personal.gpa (as printed)",
 * "stats[2] (as printed)") starts from its first field.
 */
export function candidatePaths(path: string): string[] {
  let first = path.replace(/\s*\(as printed\)\s*$/, '').split(' + ')[0]?.trim() ?? '';
  if (first === '' || first === '(root)' || first === '(path)') return [];
  const out: string[] = [];
  while (first !== '') {
    out.push(first);
    const cut = Math.max(first.lastIndexOf('.'), first.lastIndexOf('['));
    if (cut <= 0) break;
    first = first.slice(0, cut);
  }
  return out;
}

/** The first segment of a field path: "personal" in "personal.gpa", "blocks" in "blocks[3].md". */
export function rootKeyOf(path: string): string {
  return /^[^.[\s]+/.exec(path)?.[0] ?? '';
}

/**
 * The block indexes a project field path passes through, outermost first, with the column of a
 * two-column block: "blocks[2].left[0].md" gives [{ index: 2 }, { index: 0, column: 'left' }].
 * The block editor expands each of them before the admin scrolls.
 */
export function blockTrail(path: string): { index: number; column?: 'left' | 'right' }[] {
  const out: { index: number; column?: 'left' | 'right' }[] = [];
  const re = /(?:^|\.)(blocks|left|right)\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    const key = match[1];
    const index = Number(match[2]);
    out.push(key === 'blocks' ? { index } : { index, column: key as 'left' | 'right' });
  }
  return out;
}

export interface Location {
  tab: TabId;
  /** The project to open, for a project file. */
  slug?: string;
  /** DOM ids to try in order. */
  ids: string[];
  /** For project files: blocks to expand on the way. */
  blocks: { index: number; column?: 'left' | 'right' }[];
}

/** Where to take the owner for a finding on `file` at `path`, or null for a file the admin does not edit. */
export function locate(file: string, path: string): Location | null {
  const paths = candidatePaths(path);
  if (file === SITE_FILE) {
    const tab = SITE_KEY_TAB[rootKeyOf(paths[0] ?? '')] ?? 'settings';
    return { tab, ids: paths.map((p) => fieldId(file, p)), blocks: [] };
  }
  const slug = slugOfProjectFile(file);
  if (slug) {
    return { tab: 'projects', slug, ids: paths.map((p) => fieldId(file, p)), blocks: blockTrail(paths[0] ?? '') };
  }
  return null;
}
