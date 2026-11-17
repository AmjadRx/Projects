/**
 * One-time helper: converts a schema version 2 content folder to schema version 3, so the admin
 * can also open old drafts (ARCHITECTURE.md section 4). Launch content comes from the seed, not
 * from this script.
 *
 * Changes made: schemaVersion becomes 3; the hero mode "scene3d" becomes "drawing"; the site
 * gains `background` ("sky"), empty `seo` fields, `gpaLabel` ("Major GPA", the only GPA label
 * CONTENT_RULES.md allows), and an empty `now` list; each skill item becomes `{ label }`; each
 * project gains `visible: true`. Nothing else is touched, and no wording is written.
 *
 * Usage: node scripts/migrate-v2-to-v3.mjs <v2 content folder> <new output folder>
 * The output folder must not exist yet. The input folder is never changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE_KEY_ORDER = [
  'schemaVersion',
  'settings',
  'seo',
  'personal',
  'socialLinks',
  'nav',
  'now',
  'stats',
  'thesis',
  'about',
  'skills',
  'experience',
  'honors',
  'education',
  'contact',
];

function ordered(object, order) {
  const out = {};
  for (const key of order) if (key in object) out[key] = object[key];
  for (const key of Object.keys(object)) if (!(key in out)) out[key] = object[key];
  return out;
}

/** Converts a v2 site object to schema version 3. */
export function migrateSite(v2) {
  const site = structuredClone(v2);
  site.schemaVersion = 3;
  const heroMode = site.settings?.heroMode;
  site.settings = {
    ...site.settings,
    heroMode: heroMode === 'media' || heroMode === 'model' || heroMode === 'drawing' ? heroMode : 'drawing',
    background: site.settings?.background ?? 'sky',
  };
  site.seo ??= { title: '', description: '' };
  site.personal = { ...site.personal, gpaLabel: site.personal?.gpaLabel ?? 'Major GPA' };
  site.now ??= [];
  site.skills = {
    ...site.skills,
    groups: (site.skills?.groups ?? []).map((group) => ({
      ...group,
      items: (group.items ?? []).map((item) => (typeof item === 'string' ? { label: item } : item)),
    })),
  };
  return ordered(site, SITE_KEY_ORDER);
}

/** Converts a v2 project object to schema version 3. */
export function migrateProject(v2) {
  const { slug, ...rest } = structuredClone(v2);
  return { slug, visible: v2.visible ?? true, ...rest };
}

async function main() {
  const [inputArg, outputArg] = process.argv.slice(2);
  if (!inputArg || !outputArg) {
    console.error('Usage: node scripts/migrate-v2-to-v3.mjs <v2 content folder> <new output folder>');
    process.exit(2);
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(`This script needs Node 22.18 or newer to load lib/schema.ts (this is ${process.versions.node}).`);
    process.exit(1);
  }
  const input = path.resolve(inputArg);
  const output = path.resolve(outputArg);
  if (fs.existsSync(output)) {
    console.error(`The output folder already exists: ${output}. Choose a new one.`);
    process.exit(2);
  }
  const { ProjectSchema, SiteSchema } = await import('../lib/schema.ts');

  const problems = [];
  const write = (relativeFile, data, schema) => {
    const result = schema.safeParse(data);
    if (!result.success) {
      for (const issue of result.error.issues) problems.push(`${relativeFile}: ${issue.path.join('.')}: ${issue.message}`);
    }
    const target = path.join(output, relativeFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  };

  const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  write('site.json', migrateSite(readJson(path.join(input, 'site.json'))), SiteSchema);
  const projectsDir = path.join(input, 'projects');
  const names = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir).filter((n) => n.endsWith('.json')) : [];
  for (const name of names) write(`projects/${name}`, migrateProject(readJson(path.join(projectsDir, name))), ProjectSchema);

  console.log(`Migrated site.json and ${names.length} project files to ${output}.`);
  if (problems.length > 0) {
    console.log('These fields still need attention before the content validates:');
    for (const problem of problems) console.log(`  ${problem}`);
    process.exit(1);
  }
  console.log('Every migrated file validates against schema version 3.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
