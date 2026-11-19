/**
 * The site tabs' logic (components/admin/tabs/model.ts), without rendering anything: every edit a
 * tab makes keeps untouched fields, keys, and empty strings, and an edit with the value a field
 * already shows changes nothing (docs/V3_PLAN.md D-18). The skills round trip is D-21's test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeContent, SITE_FILE, type ContentResponse } from '../lib/admin/contract';
import { formatPath } from '../lib/lint';
import type { Site, SocialLink } from '../lib/types';
import { createAdminStore, type AdminStore } from '../components/admin/state/store';
import { replaceItem } from '../components/admin/ui/list';
import { getIn, setIn } from '../components/admin/ui/paths';
import {
  AUTO_ICON,
  gpaLabelIssue,
  hasKeyAt,
  heroModelValue,
  iconChoiceOf,
  iconIsAutomatic,
  linkIssue,
  moveSkillItem,
  newSocialLink,
  optionalText,
  pageChoices,
  printedStat,
  projectChoices,
  socialIdIssue,
  storedHasKey,
  storedSiteOf,
  uniqueId,
  withOptionalText,
  withProof,
  withResumeEnabled,
  withSocialIcon,
  withSocialUrl,
  type ProjectSummary,
} from '../components/admin/tabs/model';

const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const SEED_TEXT = fs.readFileSync(path.join(ROOT, SITE_FILE), 'utf8');

function seedContent(): ContentResponse {
  const projectFiles = fs.readdirSync(path.join(ROOT, 'content/projects')).map((name) => `content/projects/${name}`);
  return {
    ok: true,
    source: 'disk',
    ref: null,
    head: null,
    liveHead: null,
    draftExists: false,
    draftAhead: 0,
    liveBranch: null,
    draftBranch: null,
    site: { file: SITE_FILE, data: read(SITE_FILE) },
    projects: projectFiles.map((file) => ({ file, data: read(file) })),
    findings: [],
    preview: null,
  };
}

function loadedStore(): AdminStore {
  const store = createAdminStore();
  store.load(seedContent());
  return store;
}

function siteOf(store: AdminStore): Site {
  const site = store.getState().doc?.site;
  if (!site) throw new Error('not loaded');
  return site;
}

/** Whether the store's stored site file has a key: what the tabs ask through useStoredHas. */
function storedHas(store: AdminStore, at: string): boolean {
  return storedHasKey(store.getState().info?.stored[SITE_FILE], at);
}

const PROJECTS: ProjectSummary[] = [
  { slug: 'raven', title: 'Raven', visible: true },
  { slug: 'secret-thing', title: 'Secret', visible: false },
  { slug: 'palmsync', title: 'PalmSync', visible: true },
];

describe('optional text fields', () => {
  it('keep text, keep "" only where the stored file had the key, and stay absent otherwise', () => {
    expect(optionalText('~', false)).toBe('~');
    expect(optionalText('', true)).toBe('');
    expect(optionalText('', false)).toBeUndefined();
  });

  it('change nothing when the value is the one shown', () => {
    const seed = read(SITE_FILE) as Site;
    for (const [i, stat] of seed.stats.entries()) {
      for (const key of ['prefix', 'suffix'] as const) {
        const has = hasKeyAt(seed, `stats[${i}].${key}`);
        expect(withOptionalText(stat, key, stat[key] ?? '', has)).toBe(stat);
      }
    }
    const blankKept = { label: 'x', href: '' };
    expect(withOptionalText(blankKept, 'href', '', true)).toBe(blankKept);
  });

  it('give the stored text back after typing and clearing a field the file never had', () => {
    const stat = { value: '8', label: 'Stages' };
    const typed = withOptionalText(stat, 'prefix', '~', false);
    expect(typed).toEqual({ value: '8', label: 'Stages', prefix: '~' });
    const cleared = withOptionalText(typed, 'prefix', '', false);
    expect(serializeContent(cleared)).toBe(serializeContent(stat));
    // An emptied key the stored file has keeps its place and its empty string.
    const withSuffix = { value: '504', suffix: ' V', label: 'Max' };
    expect(serializeContent(withOptionalText(withSuffix, 'suffix', '', true))).toBe(serializeContent({ value: '504', suffix: '', label: 'Max' }));
  });

  it('read the stored file by path, once per text', () => {
    expect(storedHasKey(SEED_TEXT, 'stats[2].prefix')).toBe(true);
    expect(storedHasKey(SEED_TEXT, 'stats[0].prefix')).toBe(false);
    expect(storedHasKey(SEED_TEXT, 'now[0].href')).toBe(true);
    expect(storedHasKey(SEED_TEXT, 'now[3].href')).toBe(false);
    expect(storedHasKey(SEED_TEXT, 'contact.resumeRequest')).toBe(true);
    expect(storedHasKey(SEED_TEXT, 'seo.ogImage')).toBe(false);
    expect(storedHasKey(SEED_TEXT, 'stats[9].prefix')).toBe(false);
    expect(storedHasKey(SEED_TEXT, 'stats[0]')).toBe(false);
    expect(storedHasKey('{ not json', 'stats')).toBe(false);
    expect(storedHasKey(undefined, 'stats')).toBe(false);
    expect(storedSiteOf(SEED_TEXT)).toBe(storedSiteOf(SEED_TEXT));
  });
});

describe('proofs and page links', () => {
  it('a proof picked as None removes the key; the same proof changes nothing', () => {
    const item = { label: 'Python', proof: 'can-bus-diagnostic-tool' };
    expect(withProof(item, 'can-bus-diagnostic-tool')).toBe(item);
    expect(serializeContent(withProof(item, ''))).toBe(serializeContent({ label: 'Python' }));
    const bare: { label: string; proof?: string } = { label: 'Git' };
    expect(withProof(bare, '')).toBe(bare);
    expect(withProof(bare, 'raven')).toEqual({ label: 'Git', proof: 'raven' });
  });

  it('list the site routes and visible projects only', () => {
    const choices = pageChoices(PROJECTS);
    expect(choices.pages.map((c) => c.value)).toEqual(['/', '/about', '/experience', '/projects', '/log', '/contact']);
    expect(choices.projects.map((c) => c.value)).toEqual(['/projects/raven', '/projects/palmsync']);
    expect(choices.projects[0].label).toBe('Raven (/projects/raven)');
    expect([...choices.visible]).toEqual(['raven', 'palmsync']);
    expect(projectChoices(PROJECTS)).toEqual([
      { value: 'raven', label: 'Raven' },
      { value: 'palmsync', label: 'PalmSync' },
    ]);
  });

  it('flag an internal link that leads to no visible page', () => {
    const { visible } = pageChoices(PROJECTS);
    expect(linkIssue('/projects/raven', visible)).toBeNull();
    expect(linkIssue('/about#facts', visible)).toBeNull();
    expect(linkIssue('/media/site/a.webp', visible)).toBeNull();
    expect(linkIssue('https://github.com/AmjadRx', visible)).toBeNull();
    expect(linkIssue('', visible)).toBeNull();
    expect(linkIssue('/projects/secret-thing', visible)).toMatch(/plain text/);
    expect(linkIssue('/nowhere', visible)).toMatch(/plain text/);
    expect(linkIssue('https://amjadrehawi.com/projects/secret-thing', visible)).toMatch(/plain text/);
  });

  it('print a readout and require the GPA label as the site does', () => {
    const seed = read(SITE_FILE) as Site;
    expect(printedStat(seed.stats[2])).toBe('~50% Measured gain in thermal-measurement accuracy');
    expect(printedStat(seed.stats[0])).toBe('504 V Max pack voltage, BR2 design');
    expect(printedStat({ value: '', label: '' })).toBe('');
    expect(gpaLabelIssue({ gpa: '3.65', gpaLabel: 'Major GPA' })).toBeNull();
    expect(gpaLabelIssue({ gpa: '', gpaLabel: '' })).toBeNull();
    expect(gpaLabelIssue({ gpa: '3.65', gpaLabel: ' ' })).toMatch(/Required/);
  });
});

describe('social links', () => {
  const seedLinks = (read(SITE_FILE) as Site).socialLinks;

  it('treat every seed icon as following its address', () => {
    for (const link of seedLinks) {
      expect(iconIsAutomatic(link), link.id).toBe(true);
      expect(iconChoiceOf(link)).toBe(AUTO_ICON);
      expect(withSocialIcon(link, iconChoiceOf(link))).toBe(link);
      expect(withSocialUrl(link, link.url)).toBe(link);
    }
  });

  it('update the icon with the address unless the owner picked one', () => {
    const linkedin = seedLinks.find((l) => l.id === 'linkedin') as SocialLink;
    const moved = withSocialUrl(linkedin, 'https://github.com/AmjadRx');
    expect(moved.icon).toBe('github');
    expect(Object.keys(moved)).toEqual(Object.keys(linkedin));
    const picked = withSocialIcon(linkedin, 'globe');
    expect(picked.icon).toBe('globe');
    expect(iconChoiceOf(picked)).toBe('globe');
    expect(withSocialUrl(picked, 'https://github.com/AmjadRx').icon).toBe('globe');
    expect(withSocialIcon(picked, AUTO_ICON).icon).toBe('linkedin');
  });

  it('give new and duplicated links ids no other link uses', () => {
    const ids = seedLinks.map((l) => l.id);
    expect(uniqueId('link', ids)).toBe('link');
    expect(uniqueId('linkedin', ids)).toBe('linkedin-2');
    expect(uniqueId('linkedin', [...ids, 'linkedin-2'])).toBe('linkedin-3');
    expect(uniqueId(' ', ids)).toBe('link');
    const fresh = newSocialLink(ids);
    expect(Object.keys(fresh)).toEqual(Object.keys(seedLinks[0]));
    expect(fresh.id).toBe('link');
    expect(socialIdIssue(seedLinks, 0)).toBeNull();
    expect(socialIdIssue([...seedLinks, { ...seedLinks[0] }], 0)).toMatch(/Another link/);
    expect(socialIdIssue([{ ...seedLinks[0], id: '' }], 0)).toMatch(/Give this link an id/);
  });
});

describe('skills (D-21)', () => {
  it('keep one item per label, commas and proofs included, through a load and a save', () => {
    const store = loadedStore();
    const groups = siteOf(store).skills.groups;
    const labels = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels.filter((label) => label.includes(','))).toHaveLength(10);
    expect(labels).toContain('STM32 (L476), STM32CubeIDE');

    groups.forEach((group, g) => {
      group.items.forEach((_, i) => {
        const at = `skills.groups[${g}].items`;
        store.editSite((site) => rowEdit(site, at, i, (item: { label: string; proof?: string }) => setIn(item, ['label'], item.label)));
        store.editSite((site) => rowEdit(site, at, i, (item: { label: string; proof?: string }) => withProof(item, item.proof ?? '')));
      });
    });
    expect(store.changes()).toEqual({ writes: [], deletes: [] });
    expect(store.getState().past).toHaveLength(0);
    expect(serializeContent(siteOf(store).skills)).toBe(serializeContent((read(SITE_FILE) as Site).skills));
  });

  it('move an item to another group as it is, in one undo step', () => {
    const store = loadedStore();
    const before = siteOf(store).skills.groups;
    const item = before[2].items[1];
    store.editSite((site) => setIn(site, 'skills.groups', moveSkillItem(site.skills.groups, 2, 1, 6)));
    const after = siteOf(store).skills.groups;
    expect(after[2].items).not.toContain(item);
    expect(after[6].items[after[6].items.length - 1]).toBe(item);
    expect(after[2].items).toHaveLength(before[2].items.length - 1);
    expect(after[0]).toBe(before[0]);
    expect(store.changes().writes.map((w) => w.path)).toEqual([SITE_FILE]);
    store.undo();
    expect(store.changes()).toEqual({ writes: [], deletes: [] });
    expect(moveSkillItem(before, 2, 1, 2)).toBe(before);
    expect(moveSkillItem(before, 2, 99, 6)).toBe(before);
    expect(moveSkillItem(before, 2, 1, 99)).toBe(before);
  });
});

describe('the resume request', () => {
  it('is created only when turned on, keeps its words when turned off, and leaves no trace when turned on and off again', () => {
    const seed = read(SITE_FILE) as Site;
    expect(withResumeEnabled(seed.contact, true, true)).toBe(seed.contact);
    const off = withResumeEnabled(seed.contact, false, true);
    expect(off.resumeRequest).toEqual({ ...seed.contact.resumeRequest, enabled: false });
    expect(Object.keys(off)).toEqual(Object.keys(seed.contact));

    const none = { heading: 'Hi', body: 'Text' };
    expect(withResumeEnabled(none, false, false)).toBe(none);
    const on = withResumeEnabled(none, true, false);
    expect(on.resumeRequest).toEqual({ enabled: true, label: '', subject: '', body: '' });
    expect(serializeContent(withResumeEnabled(on, false, false))).toBe(serializeContent(none));
    const written = setIn(on, 'resumeRequest.label', 'Ask');
    expect(withResumeEnabled(written, false, false).resumeRequest).toEqual({ enabled: false, label: 'Ask', subject: '', body: '' });
  });
});

describe('the hero model', () => {
  it('is shown as a model without changing the stored object, which has no kind', () => {
    const stored = (read(SITE_FILE) as Site).settings.heroModel as unknown as { src: string; alt: string };
    expect('kind' in stored).toBe(false);
    const shown = heroModelValue(stored as never);
    expect(shown).toEqual({ kind: 'model', src: '', alt: '' });
    expect(Object.keys(shown ?? {})[0]).toBe('kind');
    expect('kind' in stored).toBe(false);
    const model = { kind: 'model' as const, src: '/media/site/raven.glb' };
    expect(heroModelValue(model)).toBe(model);
    expect(heroModelValue(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// Every tab's edits, applied with the values the tab shows, change nothing
// ---------------------------------------------------------------------------------------------

/** What ListEditor does with a row's `update`: replace the row, keep the list when it is the same row. */
function rowEdit<T>(site: Site, listPath: string, index: number, recipe: (item: T) => T): Site {
  const list = getIn(site, listPath) as T[];
  return setIn(site, listPath, replaceItem(list, index, recipe(list[index])));
}

interface NoOpRun {
  store: AdminStore;
  visited: Set<string>;
}

function noOpRun(): NoOpRun {
  return { store: loadedStore(), visited: new Set() };
}

/** A plain field, as useSiteBinding writes it. */
function field(run: NoOpRun, at: string): void {
  run.visited.add(at);
  run.store.editSite((site) => setIn(site, at, getIn(site, at)));
}

/** Each named key of each row of a list, as a row's inputs write them. */
function rows<T extends object>(run: NoOpRun, listPath: string, keys: readonly string[], extra?: (item: T, rowPath: string) => T) {
  const list = getIn(siteOf(run.store), listPath) as T[];
  list.forEach((_, i) => {
    const rowPath = `${listPath}[${i}]`;
    for (const key of keys) {
      run.visited.add(`${rowPath}.${key}`);
      run.store.editSite((site) => rowEdit<T>(site, listPath, i, (item) => setIn(item, [key], (item as Record<string, unknown>)[key])));
    }
    if (extra) run.store.editSite((site) => rowEdit<T>(site, listPath, i, (item) => extra(item, rowPath)));
  });
}

/** A list of strings (paragraphs, bullets), as TextRows writes it. */
function strings(run: NoOpRun, listPath: string): void {
  const list = getIn(siteOf(run.store), listPath) as string[];
  list.forEach((_, i) => {
    run.visited.add(`${listPath}[${i}]`);
    run.store.editSite((site) => rowEdit<string>(site, listPath, i, (text) => text));
  });
}

const TAB_NO_OPS: Record<string, (run: NoOpRun) => void> = {
  settings(run) {
    for (const at of ['settings.themeDefault', 'settings.background', 'settings.heroMode', 'settings.heroModel', 'settings.heroMedia']) field(run, at);
    for (const at of ['settings.showAvailabilityBadge', 'seo.title', 'seo.description', 'seo.ogImage']) field(run, at);
  },
  personal(run) {
    for (const key of ['name', 'tagline', 'subTagline', 'location', 'email', 'phone', 'availability', 'gpa', 'gpaLabel', 'graduation', 'school', 'degree', 'photo']) {
      field(run, `personal.${key}`);
    }
    rows<Site['now'][number]>(run, 'now', ['label'], (item, rowPath) => {
      run.visited.add(`${rowPath}.href`);
      return withOptionalText(item, 'href', item.href ?? '', storedHas(run.store, `${rowPath}.href`));
    });
  },
  socials(run) {
    rows<SocialLink>(run, 'socialLinks', ['id', 'label', 'showInNav', 'showInFooter', 'showInContact'], (link, rowPath) => {
      run.visited.add(`${rowPath}.url`).add(`${rowPath}.icon`);
      return withSocialIcon(withSocialUrl(link, link.url), iconChoiceOf(link));
    });
  },
  nav(run) {
    rows(run, 'nav', ['label', 'href']);
  },
  stats(run) {
    rows<Site['stats'][number]>(run, 'stats', ['value', 'label'], (stat, rowPath) => {
      run.visited.add(`${rowPath}.prefix`).add(`${rowPath}.suffix`).add(`${rowPath}.proof`);
      let next = withOptionalText(stat, 'prefix', stat.prefix ?? '', storedHas(run.store, `${rowPath}.prefix`));
      next = withOptionalText(next, 'suffix', next.suffix ?? '', storedHas(run.store, `${rowPath}.suffix`));
      return withProof(next, next.proof ?? '');
    });
  },
  thesis(run) {
    for (const at of ['thesis.kicker', 'thesis.headline', 'thesis.body']) field(run, at);
    rows(run, 'thesis.pillars', ['k', 'title', 'desc']);
  },
  about(run) {
    field(run, 'about.heading');
    strings(run, 'about.paragraphs');
    rows(run, 'about.facts', ['label', 'value']);
    field(run, 'about.headshot');
  },
  skills(run) {
    rows(run, 'skills.groups', ['title', 'tier']);
    siteOf(run.store).skills.groups.forEach((_, g) => {
      rows<{ label: string; proof?: string }>(run, `skills.groups[${g}].items`, ['label'], (item, rowPath) => {
        run.visited.add(`${rowPath}.proof`);
        return withProof(item, item.proof ?? '');
      });
    });
  },
  experience(run) {
    rows<Site['experience'][number]>(run, 'experience', ['company', 'role', 'location', 'dates'], (role, rowPath) => {
      run.visited.add(`${rowPath}.logo`);
      return setIn(role, ['logo'], role.logo);
    });
    siteOf(run.store).experience.forEach((_, i) => strings(run, `experience[${i}].bullets`));
  },
  honorsEdu(run) {
    rows(run, 'honors', ['title', 'year', 'note']);
    rows(run, 'education', ['school', 'degree', 'details', 'dates']);
  },
  contact(run) {
    field(run, 'contact.heading');
    field(run, 'contact.body');
    run.visited.add('contact.resumeRequest.enabled');
    run.store.editSite((site) =>
      setIn(site, 'contact', withResumeEnabled(site.contact, site.contact.resumeRequest?.enabled ?? false, storedHas(run.store, 'contact.resumeRequest'))),
    );
    for (const key of ['label', 'subject', 'body']) field(run, `contact.resumeRequest.${key}`);
  },
};

/** Every string, boolean, and number in a value, with its field path (lib/lint.ts formatPath). */
function leafPaths(value: unknown, at: PropertyKey[] = []): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => leafPaths(item, [...at, i]));
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => leafPaths(item, [...at, key]));
  return [formatPath(at)];
}

describe('every site tab', () => {
  it('changes nothing when each field is written with the value it shows', () => {
    for (const [tab, apply] of Object.entries(TAB_NO_OPS)) {
      const run = noOpRun();
      apply(run);
      expect(run.store.changes(), tab).toEqual({ writes: [], deletes: [] });
      expect(run.store.getState().past, tab).toHaveLength(0);
      expect(serializeContent(siteOf(run.store)), tab).toBe(SEED_TEXT);
    }
  });

  it('covers every field of content/site.json between them', () => {
    const run = noOpRun();
    for (const apply of Object.values(TAB_NO_OPS)) apply(run);
    const visited = [...run.visited];
    // A MediaRef is edited whole by the media field, so a visited field covers what lies inside it.
    const covered = (leaf: string) => visited.some((v) => leaf === v || leaf.startsWith(`${v}.`) || leaf.startsWith(`${v}[`));
    const missing = leafPaths(read(SITE_FILE)).filter((leaf) => leaf !== 'schemaVersion' && !covered(leaf));
    expect(missing).toEqual([]);
  });

  it('typing into an optional field and clearing it leaves the file clean', () => {
    const store = loadedStore();
    const edit = (text: string) =>
      store.editSite((site) => rowEdit<Site['stats'][number]>(site, 'stats', 3, (stat) => withOptionalText(stat, 'prefix', text, storedHas(store, 'stats[3].prefix'))));
    edit('~');
    expect(store.changes().writes).toHaveLength(1);
    edit('');
    expect(store.changes()).toEqual({ writes: [], deletes: [] });

    // A key the stored file has keeps its place with "" when cleared: the file changes, the key stays.
    store.editSite((site) => rowEdit<Site['stats'][number]>(site, 'stats', 2, (stat) => withOptionalText(stat, 'prefix', '', storedHas(store, 'stats[2].prefix'))));
    const stat = siteOf(store).stats[2];
    expect(Object.keys(stat)).toEqual(['prefix', 'value', 'suffix', 'label', 'proof']);
    expect(stat.prefix).toBe('');
    store.undo();
    expect(store.changes()).toEqual({ writes: [], deletes: [] });
  });
});
