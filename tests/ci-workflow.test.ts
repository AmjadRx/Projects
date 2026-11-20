/**
 * The CI workflow (.github/workflows/ci.yml), read with a YAML parser (js-yaml, which ESLint brings
 * into node_modules): when it runs and what it runs, that every action is pinned to a commit, that
 * the build reaches the Lighthouse and end-to-end jobs, and that each secret reaches only the steps
 * that need it and is never printed (CLAUDE.md, Secrets; ARCHITECTURE.md 11 and 12).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string | number | boolean>;
  env?: Record<string, string>;
}

interface Job {
  name?: string;
  'runs-on': string;
  needs?: string | string[];
  'timeout-minutes'?: number;
  strategy?: { 'fail-fast'?: boolean; matrix: Record<string, string[]> };
  env?: Record<string, string>;
  permissions?: unknown;
  steps: Step[];
}

interface Workflow {
  name: string;
  on: Record<string, { branches?: string[] } | null>;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  env: Record<string, string>;
  jobs: Record<string, Job>;
}

const require = createRequire(import.meta.url);
// js-yaml 4's load() builds plain data only (its default schema has no code or object types).
const yaml = require('js-yaml') as { load(text: string): unknown };

const root = path.resolve(__dirname, '..');
const text = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const workflow = yaml.load(text) as Workflow;
const jobs = workflow.jobs;
const allSteps = Object.values(jobs).flatMap((job) => job.steps);
const runs = (job: string) => jobs[job].steps.flatMap((step) => (step.run ? [step.run.trim()] : []));
const uses = (job: string) => jobs[job].steps.flatMap((step) => (step.uses ? [step.uses.split('@')[0]] : []));

describe('the CI workflow', () => {
  it('is YAML GitHub can read: every job runs steps on a runner, and every step runs or uses one thing', () => {
    expect(workflow.name).toBe('CI');
    expect(Object.keys(jobs)).toEqual(['checks', 'build', 'lighthouse', 'e2e', 'secret-scan']);
    for (const job of Object.values(jobs)) {
      expect(job['runs-on']).toBe('ubuntu-24.04');
      expect(job['timeout-minutes']).toBeGreaterThan(0);
      expect(job.steps.length).toBeGreaterThan(0);
      for (const step of job.steps) expect(Boolean(step.run) !== Boolean(step.uses)).toBe(true);
    }
    for (const job of Object.values(jobs)) {
      for (const need of [job.needs ?? []].flat()) expect(Object.keys(jobs)).toContain(need);
    }
  });

  it('runs on pushes to v3 and pull requests to main, never on a push to main, and never deploys', () => {
    expect(workflow.on).toEqual({ push: { branches: ['v3'] }, pull_request: { branches: ['main'] } });
    for (const step of allSteps) {
      expect(step.run ?? '').not.toMatch(/\bvercel\b|npm publish|git push/i);
      expect(step.uses ?? '').not.toMatch(/vercel|deploy|pages/i);
    }
    expect(text).not.toMatch(/^\s+environment:/m);
  });

  it('reads the repository and nothing more, and cancels a run a newer push replaces', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(jobs)) expect(job.permissions).toBeUndefined();
    expect(workflow.concurrency['cancel-in-progress']).toBe(true);
    expect(workflow.concurrency.group).toContain('github.ref');
    for (const step of allSteps.filter((s) => s.uses?.startsWith('actions/checkout@'))) {
      expect(step.with?.['persist-credentials']).toBe(false);
    }
  });

  it('pins every action to a full commit SHA, with its version written beside it', () => {
    const lines = text.split(/\r?\n/).filter((line) => /^\s*-?\s*uses:/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    expect(text).not.toMatch(/actions\/cache@/);
  });

  it('uses Node 24.x, as Vercel builds the site, and keeps Motion+ out of the Actions cache', () => {
    expect(workflow.env.NODE_VERSION).toBe('24.x');
    const setups = allSteps.filter((step) => step.uses?.startsWith('actions/setup-node@'));
    expect(setups).toHaveLength(Object.keys(jobs).length - 1);
    for (const step of setups) {
      expect(step.with).toEqual({ 'node-version': '${{ env.NODE_VERSION }}', 'package-manager-cache': false });
    }
  });
});

describe('what each job runs', () => {
  it('checks: the lockfile before installing, then lint (tests too), types, unit tests, and the content check', () => {
    expect(runs('checks').filter((run) => run.startsWith('npm'))).toEqual([
      'npm run check:lockfile',
      'npm ci',
      'npm run lint',
      'npm run lint:tests',
      'npm run type-check',
      'npm test',
      'npm run check:content',
    ]);
  });

  it('build: the whole history, the build with its checks, the build passed on, then the build tests', () => {
    const checkout = jobs.build.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(runs('build').filter((run) => /^(npm|tar)/.test(run))).toEqual([
      'npm ci',
      'npm run build',
      'tar -cf "$RUNNER_TEMP/next-build.tar" --exclude=.next/cache .next',
      'npm run test:build',
    ]);
    const upload = jobs.build.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.with).toMatchObject({ name: 'next-build', path: '${{ runner.temp }}/next-build.tar', 'if-no-files-found': 'error' });
    const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(scripts.postbuild).toContain('check:sky -- --build');
    expect(scripts.postbuild).toContain('check:secrets -- --build');
    expect(scripts['lint:tests']).toBe('next lint --dir tests');
    expect(scripts.lighthouse).toBe('node scripts/lighthouse-ci.mjs');
  });

  it('lighthouse: each form factor and theme on that build, every one reported even when another fails', () => {
    const job = jobs.lighthouse;
    expect(job.needs).toBe('build');
    expect(job.strategy).toEqual({ 'fail-fast': false, matrix: { 'form-factor': ['mobile', 'desktop'], theme: ['blueprint', 'whiteprint'] } });
    expect(uses('lighthouse')).toEqual([
      'actions/checkout',
      'actions/setup-node',
      'actions/download-artifact',
      'actions/upload-artifact',
    ]);
    expect(runs('lighthouse')).toContain('tar -xf "$RUNNER_TEMP/next-build/next-build.tar"');
    expect(runs('lighthouse')).toContain('node scripts/copy-vendor.mjs');
    expect(runs('lighthouse')).toContain('npm run lighthouse -- --form-factor ${{ matrix.form-factor }} --theme ${{ matrix.theme }}');
    const upload = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.if).toBe('${{ !cancelled() }}');
    expect(upload?.with).toMatchObject({
      name: 'lighthouse-${{ matrix.form-factor }}-${{ matrix.theme }}',
      path: '.lighthouseci/reports/${{ matrix.form-factor }}-${{ matrix.theme }}/',
      'include-hidden-files': true,
    });
  });

  it('e2e: npm run test:e2e on the same build, results kept only when a test fails', () => {
    expect(jobs.e2e.needs).toBe('build');
    expect(runs('e2e')).toContain('npm run test:e2e');
    expect(runs('e2e')).toContain('tar -xf "$RUNNER_TEMP/next-build/next-build.tar"');
    const upload = jobs.e2e.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.if).toBe('${{ failure() }}');
  });

  it('secret-scan: gitleaks 8.30.1, checked against its SHA-256, redacting what it finds', () => {
    const script = runs('secret-scan').join('\n');
    expect(script).toContain('releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz');
    expect(script).toMatch(/[0-9a-f]{64} {2}\$RUNNER_TEMP\/gitleaks\.tar\.gz" \| sha256sum --check --strict -/);
    expect(script).toContain('gitleaks" git --redact');
    const checkout = jobs['secret-scan'].steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
  });
});

describe('secrets', () => {
  const SECRETS = ['MOTION_TOKEN', 'CONTENT_BLOCKLIST'];
  const expressions = [...text.matchAll(/\$\{\{([^}]*)\}\}/g)].map((m) => m[1].trim());

  it('are only the two the owner sets, read whole into an env entry or tested for being set', () => {
    for (const expression of expressions.filter((e) => e.includes('secrets.'))) {
      expect(expression).toMatch(/^secrets\.(MOTION_TOKEN|CONTENT_BLOCKLIST)( != '')?$/);
    }
    for (const line of text.split(/\r?\n/).filter((l) => l.includes('secrets.') && !/^\s*#/.test(l))) {
      expect(line).toMatch(/^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+( != '')? \}\}$/);
    }
    expect(workflow.env).not.toHaveProperty('MOTION_TOKEN');
    for (const job of Object.values(jobs)) expect(job.env).toBeUndefined();
  });

  it('reach only the steps that need them', () => {
    const need: Record<string, string[]> = {
      MOTION_TOKEN: ['npm ci', 'npm run check:lockfile', 'npm run build'],
      CONTENT_BLOCKLIST: ['npm run check:content', 'npm run build'],
    };
    for (const step of allSteps) {
      for (const [name, value] of Object.entries(step.env ?? {})) {
        if (!/secrets\.[A-Z_]+ \}\}$/.test(value)) continue;
        expect(SECRETS).toContain(name);
        expect(value).toBe(`\${{ secrets.${name} }}`);
        expect(need[name]).toContain(step.run?.trim());
      }
    }
    const lighthouse = jobs.lighthouse.steps.find((step) => step.run?.startsWith('npm run lighthouse'));
    expect(lighthouse?.env).toBeUndefined();
  });

  it('are never expanded in a script, so no step can print one', () => {
    for (const step of allSteps) {
      expect(step.run ?? '').not.toMatch(/\$\{?(MOTION_TOKEN|CONTENT_BLOCKLIST)\b/);
      expect(step.run ?? '').not.toContain('secrets.');
    }
  });

  it('are checked by name before a job uses them, so a missing one fails with a plain message', () => {
    for (const id of ['checks', 'build', 'lighthouse', 'e2e']) {
      const check = jobs[id].steps.find((step) => step.name === 'Check that the secrets this job needs are set');
      expect(check?.env?.HAS_MOTION_TOKEN).toBe("${{ secrets.MOTION_TOKEN != '' }}");
      expect(check?.run).toContain('::error::The Actions secret MOTION_TOKEN is not set');
    }
    for (const id of ['checks', 'build']) {
      const check = jobs[id].steps.find((step) => step.name === 'Check that the secrets this job needs are set');
      expect(check?.env?.HAS_CONTENT_BLOCKLIST).toBe("${{ secrets.CONTENT_BLOCKLIST != '' }}");
    }
  });
});
