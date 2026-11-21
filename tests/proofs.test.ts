import { describe, expect, it } from 'vitest';
import rulesFile from '../content-rules.public.json';
import { readContentDir } from '../lib/content';
import { compileRules, lintContent, validateContent, type Finding, type RawContent } from '../lib/lint';
import { ProjectSchema, SiteSchema } from '../lib/schema';

const rules = compileRules(rulesFile);

type Json = Record<string, any>;

/** Runs the whole check on a copy of the seed after `change` edits it. */
function check(change: (site: Json, projects: Map<string, Json>) => void): Finding[] {
  const raw: RawContent = structuredClone(readContentDir());
  const projects = new Map(raw.projects.map((p) => [(p.data as Json).slug as string, p.data as Json]));
  change(raw.site.data as Json, projects);
  const { content, findings } = validateContent(raw, { SiteSchema, ProjectSchema });
  if (!content) return findings;
  return lintContent(content, { rules, blocklist: [] }).filter((f) => f.severity === 'error');
}

describe('proofs', () => {
  it('pass for the seed as given', () => {
    expect(check(() => {})).toEqual([]);
  });

  it('fail when a stat proof leads to no page', () => {
    const findings = check((site) => {
      site.stats[0].proof = '/projects/no-such-project';
    });
    expect(findings).toContainEqual(expect.objectContaining({ rule: 'PROOF', path: 'stats[0].proof' }));
  });

  it('fail when a stat proof is not a site path', () => {
    const findings = check((site) => {
      site.stats[0].proof = 'https://example.com/elsewhere';
    });
    expect(findings).toContainEqual(expect.objectContaining({ rule: 'PROOF', path: 'stats[0].proof' }));
  });

  it('fail when a skill proof names no project', () => {
    const findings = check((site) => {
      site.skills.groups[0].items[0].proof = 'no-such-project';
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: 'PROOF', path: 'skills.groups[0].items[0].proof' }),
    );
  });

  it('fail when they point to a hidden project', () => {
    const findings = check((site, projects) => {
      projects.get('raven')!.visible = false;
    });
    const paths = findings.filter((f) => f.rule === 'PROOF').map((f) => f.path);
    expect(paths).toContain('stats[3].proof');
    expect(paths.some((p) => p.startsWith('skills.groups['))).toBe(true);
  });
});

describe('composed strings', () => {
  it('catch a GPA printed with the wrong label', () => {
    const findings = check((site) => {
      site.personal.gpaLabel = 'GPA';
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: 'GPA-LABEL', path: 'personal.gpaLabel + personal.gpa (as printed)' }),
    );
  });

  it('refuse a GPA without a label', () => {
    const findings = check((site) => {
      site.personal.gpaLabel = '';
    });
    expect(findings).toContainEqual(expect.objectContaining({ rule: 'SCHEMA', path: 'personal.gpaLabel' }));
  });
});

describe('slugs', () => {
  it('must match the file name', () => {
    const findings = check((site, projects) => {
      projects.get('raven')!.slug = 'raven-two';
    });
    expect(findings).toContainEqual(expect.objectContaining({ rule: 'SLUG', file: 'content/projects/raven.json' }));
  });
});
