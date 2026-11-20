/**
 * Content fixtures for the SEO tests (metadata, JSON-LD, the sitemap, the Open Graph images): a
 * copy of content/ in a temporary folder, changed the way an owner could in the admin. The seed
 * itself is never changed. Every marker below appears nowhere in the seed, so finding one in an
 * output is a leak.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

/** The hidden project: visible: false, with a marker in every field a page or an image could show. */
export const HIDDEN = {
  slug: 'hidden-seo-fixture-qv4',
  title: 'Vexillary Fixture Qv4',
  subtitle: 'Subtitle marker ptarmigan',
  role: 'Role marker zibeline',
  timeframe: 'Dates marker octember',
  statusLabel: 'Status marker quiddity',
  maturity: 'Maturity marker sesquipedal',
  pitch: 'Pitch marker quodlibet.',
  domain: 'Domainmarker',
  callout: 'Callout marker',
  log: 'Log marker gallimaufry',
} as const;

export const HIDDEN_MARKERS: readonly string[] = [
  HIDDEN.slug,
  HIDDEN.title,
  HIDDEN.subtitle,
  HIDDEN.role,
  HIDDEN.timeframe,
  HIDDEN.statusLabel,
  HIDDEN.maturity,
  HIDDEN.pitch,
  HIDDEN.domain,
  HIDDEN.callout,
  HIDDEN.log,
];

/** The visible project whose optional fields the fixture empties. */
export const EMPTIED_SLUG = 'moonlamp';

type Json = Record<string, any>;

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function hiddenProject(): Json {
  return {
    slug: HIDDEN.slug,
    visible: false,
    title: HIDDEN.title,
    subtitle: HIDDEN.subtitle,
    role: HIDDEN.role,
    timeframe: HIDDEN.timeframe,
    status: 'active',
    statusLabel: HIDDEN.statusLabel,
    maturity: { step: 4, label: HIDDEN.maturity },
    featured: true,
    order: 0,
    domain: HIDDEN.domain,
    tags: ['Tagmarker'],
    cover: { kind: 'image', src: '/media/site/img-7657.jpeg', alt: '' },
    links: [],
    callouts: [{ label: HIDDEN.callout, value: '7 units' }],
    pitch: HIDDEN.pitch,
    highlights: ['Highlight marker'],
    blocks: [{ id: 'fx-log', type: 'log', entries: [{ date: '2099-01-01', title: HIDDEN.log, md: 'Entry.' }] }],
  };
}

/**
 * Writes a fixture content folder and returns its path (for SITE_CONTENT_DIR):
 * - always the hidden project;
 * - with `emptied`, also every optional field a share card, the metadata, or the JSON-LD reads
 *   left empty: the GPA and the phone with their copies removed (the content check refuses an
 *   emptied GPA while a copy remains), the sub-tagline, the school, the photo, the site
 *   description, and the moonlamp project's subtitle, role, dates, status label, maturity, pitch,
 *   and cover.
 */
export function makeSeoFixture({ emptied }: { emptied: boolean }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-fixture-'));
  fs.cpSync(path.join(ROOT, 'content'), dir, { recursive: true });
  writeJson(path.join(dir, 'projects', `${HIDDEN.slug}.json`), hiddenProject());
  if (!emptied) return dir;

  const siteFile = path.join(dir, 'site.json');
  const site = readJson(siteFile);
  site.personal.gpa = '';
  site.personal.phone = '';
  site.education = site.education.map((entry: Json) => ({
    ...entry,
    details: String(entry.details)
      .split('. ')
      .filter((sentence) => !sentence.includes('GPA'))
      .join('. '),
  }));
  site.about.facts = site.about.facts.filter((fact: Json) => !String(fact.label).includes('GPA'));
  site.socialLinks = site.socialLinks.filter((link: Json) => !String(link.url).startsWith('tel:'));
  site.personal.subTagline = '';
  site.personal.school = '';
  site.personal.photo = { kind: 'image', src: '', alt: '' };
  site.seo.description = '';
  writeJson(siteFile, site);

  const projectFile = path.join(dir, 'projects', `${EMPTIED_SLUG}.json`);
  const project = readJson(projectFile);
  Object.assign(project, { subtitle: '', role: '', timeframe: '', statusLabel: '', pitch: '' });
  // A maturity needs its label (the schema), so emptying it in the admin removes the scale.
  delete project.maturity;
  project.cover = { kind: 'image', src: '', alt: '' };
  writeJson(projectFile, project);
  return dir;
}

/** Every string in a value, deeply (for searching metadata and JSON-LD objects). */
export function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value instanceof URL) return [value.href];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

/** True when every "3.65" in the strings is the labelled GPA, "Major GPA 3.65". */
export function gpaOnlyLabelled(strings: readonly string[]): boolean {
  return strings.every((s) => s.split('3.65').length === s.split('Major GPA 3.65').length);
}
