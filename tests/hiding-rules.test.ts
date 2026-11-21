/**
 * The hiding rules at the unit level: copies of an emptied GPA or phone (D-14, Q-23), links that
 * lead to hidden pages (D-06), unsafe media addresses (D-29, D-45), links into the site's own
 * repository (D-22), empty blocks, and the dates behind "last updated". The build-level search for
 * traces is tests/build/hiding.test.ts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import rulesFile from '../content-rules.public.json';
import { blockHasContent } from '../lib/blocks';
import { loadValidContent, readContentDir } from '../lib/content';
import { isGpaFact } from '../lib/format';
import { newestDate } from '../lib/history';
import { makeLinkResolver } from '../lib/links';
import {
  compileRules,
  copyFindings,
  isGpaName,
  lintContent,
  pointsIntoRepository,
  siteHostsOf,
  sitePathOf,
  validateContent,
  type Finding,
  type RawContent,
} from '../lib/lint';
import { drawnFraction, isSafeMediaSrc, scaleSizes } from '../lib/media';
import { ProjectSchema, SiteSchema } from '../lib/schema';
import type { KnownBlock } from '../lib/types';

const rules = compileRules(rulesFile);
const SITE_HOSTS = siteHostsOf('https://amjadrehawi.com');

type Json = Record<string, any>;

function editedSeed(change: (site: Json, projects: Map<string, Json>) => void): RawContent {
  const raw: RawContent = structuredClone(readContentDir());
  const projects = new Map(raw.projects.map((p) => [(p.data as Json).slug as string, p.data as Json]));
  change(raw.site.data as Json, projects);
  return raw;
}

/** Every finding of the whole check on a copy of the seed after `change` edits it. */
function check(change: (site: Json, projects: Map<string, Json>) => void, siteRepository?: string): Finding[] {
  const { content, findings } = validateContent(editedSeed(change), { SiteSchema, ProjectSchema });
  if (!content) return findings;
  return lintContent(content, { rules, blocklist: [], siteHosts: SITE_HOSTS, siteRepository });
}

const errors = (findings: Finding[]) => findings.filter((f) => f.severity === 'error');

describe('copies of an emptied GPA or phone (D-14, Q-23)', () => {
  it('the seed as given has no finding', () => {
    expect(errors(check(() => {}))).toEqual([]);
  });

  it('refuse an empty GPA while the education line and the about fact still hold it', () => {
    const findings = errors(check((site) => (site.personal.gpa = ''))).filter((f) => f.rule === 'GPA-COPY');
    const paths = findings.map((f) => f.path);
    expect(paths).toContain('education[0].details');
    expect(paths.some((p) => /^about\.facts\[\d+\]\.value$/.test(p))).toBe(true);
  });

  it('accept an empty GPA once every copy is gone', () => {
    const findings = check((site) => {
      site.personal.gpa = '';
      site.education[0].details = 'University Honors Program. Honors thesis (in progress).';
      site.about.facts = site.about.facts.filter((f: Json) => !/gpa/i.test(f.label));
    });
    expect(errors(findings)).toEqual([]);
  });

  it('refuse a GPA row under another label once the GPA is empty', () => {
    const findings = errors(
      check((site) => {
        site.personal.gpa = '';
        site.education[0].details = '';
        site.about.facts = site.about.facts.filter((f: Json) => !/gpa/i.test(f.label));
        site.about.facts.push({ label: 'Cumulative GPA', value: '3.6' });
      }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ rule: 'GPA-COPY' }));
  });

  it('refuse an empty phone while a tel: link or the number remains', () => {
    const findings = errors(check((site) => (site.personal.phone = ''))).filter((f) => f.rule === 'PHONE-COPY');
    const paths = findings.map((f) => f.path);
    expect(paths.some((p) => /^socialLinks\[\d+\]\.url$/.test(p))).toBe(true);
    expect(paths.some((p) => /^socialLinks\[\d+\]\.label$/.test(p))).toBe(true);
  });

  it('refuse a tel: link in Markdown once the phone is empty', () => {
    const findings = errors(
      check((site, projects) => {
        site.personal.phone = '';
        site.socialLinks = site.socialLinks.filter((l: Json) => !String(l.url).startsWith('tel:'));
        projects.get('raven')!.blocks.push({ id: 'phone-md', type: 'text', md: '[Call](tel:+15550100100)' });
      }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ rule: 'PHONE-COPY', file: 'content/projects/raven.json' }));
  });

  it('stop the build too, since a copy in free text cannot hide itself', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd14-'));
    try {
      const raw = editedSeed((site) => (site.personal.gpa = ''));
      fs.mkdirSync(path.join(dir, 'projects'));
      fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(raw.site.data));
      for (const p of raw.projects) fs.writeFileSync(path.join(dir, 'projects', path.basename(p.file)), JSON.stringify(p.data));
      expect(() => loadValidContent(dir)).toThrow(/GPA/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('name the GPA the same way in the check and on the about page', () => {
    for (const label of ['Major GPA', 'major gpa', 'GPA', 'Cumulative GPA', 'Discipline', 'GPAs', '']) {
      expect(isGpaFact({ label }, { gpaLabel: 'Major GPA' })).toBe(isGpaName(label, 'Major GPA'));
    }
  });

  it('report nothing while both values are set', () => {
    const { content } = validateContent(readContentDir(), { SiteSchema, ProjectSchema });
    expect(copyFindings(content!)).toEqual([]);
  });
});

describe('links to pages that do not exist (D-06)', () => {
  const hideRaven = (site: Json, projects: Map<string, Json>) => {
    projects.get('raven')!.visible = false;
    site.stats.forEach((s: Json) => {
      if (s.proof === '/projects/raven') delete s.proof;
    });
    site.skills.groups.forEach((g: Json) =>
      g.items.forEach((i: Json) => {
        if (i.proof === 'raven') delete i.proof;
      }),
    );
  };

  it('warn for a nav item, a link row, Markdown, and an absolute address to a hidden project', () => {
    const findings = check((site, projects) => {
      hideRaven(site, projects);
      site.nav.push({ label: 'Raven', href: '/projects/raven' });
      site.now.push({ label: 'Absolute', href: 'https://www.amjadrehawi.com/projects/raven' });
      projects.get('moonlamp')!.blocks.push({ id: 'lr', type: 'linkRow', links: [{ label: 'Raven', url: '/projects/raven' }] });
      projects.get('moonlamp')!.blocks.push({ id: 'md', type: 'text', md: 'See [Raven](https://amjadrehawi.com/projects/raven#log).' });
    }).filter((f) => f.rule === 'INTERNAL-LINK');
    const paths = findings.map((f) => `${f.file} ${f.path}`);
    expect(paths.some((p) => /site\.json nav\[\d+\]\.href$/.test(p))).toBe(true);
    expect(paths.some((p) => /site\.json now\[\d+\]\.href$/.test(p))).toBe(true);
    expect(paths.some((p) => /moonlamp\.json blocks\[\d+\]\.links\[0\]\.url$/.test(p))).toBe(true);
    expect(paths.some((p) => /moonlamp\.json blocks\[\d+\]\.md$/.test(p))).toBe(true);
  });

  it('print such links as plain text, absolute or not', () => {
    const resolve = makeLinkResolver(new Set(['moonlamp']), { siteHosts: SITE_HOSTS });
    expect(resolve('/projects/raven')).toBeNull();
    expect(resolve('https://amjadrehawi.com/projects/raven')).toBeNull();
    expect(resolve('https://www.amjadrehawi.com/projects/raven#log')).toBeNull();
    expect(resolve('https://amjadrehawi.com/projects/moonlamp#log')).toEqual({ href: '/projects/moonlamp#log', external: false });
    expect(resolve('https://example.com/projects/raven')).toEqual({ href: 'https://example.com/projects/raven', external: true });
    expect(sitePathOf('http://amjadrehawi.com/about', SITE_HOSTS)).toBe('/about');
    expect(sitePathOf('https://amjadrehawi.com.evil.example/about', SITE_HOSTS)).toBeNull();
  });

  it('hide tel: links when the phone is empty, and links into the site repository', () => {
    const resolve = makeLinkResolver(new Set(), { phoneShown: false, siteRepository: 'Owner/Site' });
    expect(resolve('tel:+15550100100')).toBeNull();
    expect(resolve('mailto:someone@example.com')).toEqual({ href: 'mailto:someone@example.com', external: false });
    expect(resolve('https://github.com/owner/site/blob/main/README.md')).toBeNull();
    expect(resolve('https://github.com/Owner/Other')).toEqual({ href: 'https://github.com/Owner/Other', external: true });
    expect(resolve('javascript:alert(1)')).toBeNull();
    expect(resolve('//evil.example/x')).toBeNull();
  });
});

describe('media addresses (D-29, D-45)', () => {
  it('accept site paths and https, and nothing else', () => {
    for (const ok of ['/media/raven/a.webp', 'https://store.public.blob.vercel-storage.com/a.pdf']) expect(isSafeMediaSrc(ok)).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://example.com/a.png', '//evil.example/a.png', '/\\evil.example/a.png', ''])
      expect(isSafeMediaSrc(bad)).toBe(false);
  });

  it('fail the check for an unsafe media address or an embed off YouTube and Vimeo', () => {
    const findings = errors(
      check((_site, projects) => {
        const blocks = projects.get('moonlamp')!.blocks;
        blocks.push({ id: 'bad-img', type: 'image', media: { kind: 'image', src: 'javascript:alert(1)', alt: '' } });
        blocks.push({ id: 'bad-embed', type: 'video', media: { kind: 'embed', src: 'https://example.com/watch?v=x' } });
        blocks.push({ id: 'bad-file', type: 'file', label: 'x', src: 'data:text/plain,hi' });
      }),
    ).filter((f) => f.rule === 'MEDIA');
    expect(findings.map((f) => f.path)).toEqual(
      expect.arrayContaining([expect.stringMatching(/media\.src$/), expect.stringMatching(/\.src$/)]),
    );
    expect(findings.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the site's own repository (D-22)", () => {
  it('matches any page or raw file of the repository, and nothing else', () => {
    expect(pointsIntoRepository('https://github.com/AmjadRx/Projects', 'AmjadRx/Projects')).toBe(true);
    expect(pointsIntoRepository('https://github.com/amjadrx/projects/commit/abc', 'AmjadRx/Projects')).toBe(true);
    expect(pointsIntoRepository('https://raw.githubusercontent.com/AmjadRx/Projects/main/x', '"AmjadRx/Projects"')).toBe(true);
    expect(pointsIntoRepository('https://github.com/AmjadRx/MoonLight', 'AmjadRx/Projects')).toBe(false);
    expect(pointsIntoRepository('https://github.com/AmjadRx/Projects', undefined)).toBe(false);
  });

  it('fail the check for a project link into it when GITHUB_REPO is set', () => {
    const change = (_site: Json, projects: Map<string, Json>) => {
      projects.get('moonlamp')!.links.push({ label: 'Source', url: 'https://github.com/Owner/Site/tree/main' });
    };
    expect(errors(check(change, 'Owner/Site'))).toContainEqual(expect.objectContaining({ rule: 'OWN-REPOSITORY' }));
    expect(errors(check(change))).toEqual([]);
  });
});

describe('empty blocks leave no wrapper', () => {
  const cases: [KnownBlock, boolean][] = [
    [{ id: 'h', type: 'heading', text: '' }, false],
    [{ id: 'h', type: 'heading', text: 'Build' }, true],
    [{ id: 'c', type: 'callout', tone: 'note', md: '  ' }, false],
    [{ id: 'q', type: 'quote', text: '' }, false],
    [{ id: 'i', type: 'image', media: { kind: 'image', src: '' } }, false],
    [{ id: 'i', type: 'image', media: { kind: 'image', src: 'javascript:x' } }, false],
    [{ id: 'i', type: 'image', media: { kind: 'image', src: '/media/raven/build-01.webp' } }, true],
    [{ id: 'v', type: 'video', media: { kind: 'embed', src: 'https://example.com/v' } }, false],
    [{ id: 'g', type: 'gallery', items: [{ kind: 'image', src: '' }] }, false],
    [{ id: 'f', type: 'file', label: 'x', src: '' }, false],
    [{ id: 'r', type: 'repo', url: 'https://github.com/Owner/Site' }, false],
    [{ id: 't', type: 'twoCol', left: [{ id: 'h2', type: 'heading', text: '' }], right: [] }, false],
  ];
  it.each(cases)('%j has content: %s', (block, expected) => {
    expect(blockHasContent(block, 'Owner/Site')).toBe(expected);
  });
});

describe('"last updated"', () => {
  it('is known only when every file has a date', () => {
    const all = { 'content/site.json': '2026-11-05', 'content/projects/a.json': '2026-11-13' };
    expect(newestDate(all, ['content/site.json', 'content/projects/a.json'])).toBe('2026-11-13');
    expect(newestDate(all, ['content/site.json', 'content/projects/a.json', 'content/projects/b.json'])).toBeUndefined();
  });
});

describe('sizes for contained pictures', () => {
  it('scale every length and leave media conditions alone', () => {
    expect(scaleSizes('(min-width: 1280px) 380px, (min-width: 768px) 33vw, 50vw', 0.5)).toBe(
      '(min-width: 1280px) 190px, (min-width: 768px) 17vw, 25vw',
    );
    expect(scaleSizes('100vw', 1)).toBe('100vw');
    expect(scaleSizes('(min-width: 1024px) min(40vw, 28rem), 90vw', 0.5)).toBe('(min-width: 1024px) calc(min(40vw, 28rem) * 0.5), 45vw');
    expect(drawnFraction({ width: 1177, height: 2560 }, 4 / 3)).toBeCloseTo(0.3448, 3);
    expect(drawnFraction({ width: 1600, height: 900 }, 4 / 3)).toBe(1);
  });
});
