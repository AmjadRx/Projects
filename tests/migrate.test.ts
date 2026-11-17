import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ProjectSchema, SiteSchema } from '../lib/schema';
import { migrateProject, migrateSite } from '../scripts/migrate-v2-to-v3.mjs';

// A minimal schema version 2 site and project, with neutral placeholder words.
const v2Site = {
  schemaVersion: 2,
  settings: { themeDefault: 'dark', heroMode: 'scene3d', showAvailabilityBadge: true },
  personal: {
    name: 'Name',
    tagline: 'Tagline',
    subTagline: 'Sub tagline',
    location: 'City',
    email: 'name@example.com',
    phone: '',
    availability: 'Availability line',
    gpa: '',
    graduation: 'Year',
    school: 'School',
    degree: 'Degree',
  },
  socialLinks: [],
  nav: [{ label: 'Projects', href: '/projects' }],
  stats: [{ label: 'Label', value: '1' }],
  thesis: { kicker: '', headline: 'Headline', body: 'Body', pillars: [] },
  about: { heading: 'Heading', paragraphs: ['Paragraph'], facts: [] },
  skills: { groups: [{ title: 'Group', tier: 'deep', items: ['First skill', 'Second skill'] }] },
  experience: [],
  honors: [],
  education: [],
  contact: { heading: 'Heading', body: 'Body' },
};

const v2Project = {
  slug: 'sample-project',
  title: 'Sample',
  subtitle: 'Subtitle',
  role: 'Role',
  timeframe: 'Dates',
  status: 'active',
  featured: false,
  order: 1,
  domain: 'Domain',
  tags: [],
  cover: { kind: 'image', src: '' },
  links: [],
  pitch: 'Pitch',
  highlights: [],
  blocks: [{ id: 'a', type: 'text', md: 'Text' }],
};

describe('migrate-v2-to-v3', () => {
  it('turns a v2 site into a valid version 3 site', () => {
    const site = migrateSite(v2Site);
    expect(SiteSchema.safeParse(site).error?.issues ?? []).toEqual([]);
    const parsed = SiteSchema.parse(site);
    expect(parsed.settings.heroMode).toBe('drawing');
    expect(parsed.settings.background).toBe('sky');
    expect(parsed.personal.gpaLabel).toBe('Major GPA');
    expect(parsed.skills.groups[0].items).toEqual([{ label: 'First skill' }, { label: 'Second skill' }]);
    expect(Object.keys(site)[0]).toBe('schemaVersion');
  });

  it('keeps the media hero mode', () => {
    const site = migrateSite({ ...v2Site, settings: { ...v2Site.settings, heroMode: 'media' } });
    expect(SiteSchema.parse(site).settings.heroMode).toBe('media');
  });

  it('turns a v2 project into a valid, visible version 3 project', () => {
    const project = migrateProject(v2Project);
    expect(ProjectSchema.safeParse(project).error?.issues ?? []).toEqual([]);
    expect(project.visible).toBe(true);
    expect(Object.keys(project).slice(0, 2)).toEqual(['slug', 'visible']);
  });

  it('never changes its input', () => {
    const before = JSON.stringify(v2Site);
    migrateSite(v2Site);
    expect(JSON.stringify(v2Site)).toBe(before);
  });

  describe('from the command line', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
    afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

    it('writes a validated version 3 folder and leaves the input alone', () => {
      const input = path.join(work, 'v2');
      fs.mkdirSync(path.join(input, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(input, 'site.json'), JSON.stringify(v2Site));
      fs.writeFileSync(path.join(input, 'projects', 'sample-project.json'), JSON.stringify(v2Project));
      const output = path.join(work, 'v3');
      const result = spawnSync(
        process.execPath,
        ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/migrate-v2-to-v3.mjs', input, output],
        { encoding: 'utf8' },
      );
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(path.join(output, 'site.json'), 'utf8')).schemaVersion).toBe(3);
      expect(JSON.parse(fs.readFileSync(path.join(input, 'site.json'), 'utf8')).schemaVersion).toBe(2);
    });
  });
});
