/**
 * The CI workflow (.github/workflows/ci.yml), read with a YAML parser (js-yaml, which ESLint brings
 * into node_modules): when it runs and what it runs, that every action is pinned to a commit, that
 * the build reaches the Lighthouse and end-to-end jobs as soon as it is packed, and that each secret
 * reaches only the steps that need it and is never printed (CLAUDE.md, Secrets; ARCHITECTURE.md 11
 * and 12).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface Step {
  id?: string;
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
const step = (job: string, name: string) => jobs[job].steps.find((s) => s.name === name);
const serveScript = path.join(root, 'tests', 'e2e', 'serve.mjs');

describe('the CI workflow', () => {
  it('is YAML GitHub can read: every job runs steps on a runner, and every step runs or uses one thing', () => {
    expect(workflow.name).toBe('CI');
    expect(Object.keys(jobs)).toEqual(['checks', 'build', 'build-tests', 'lighthouse', 'e2e', 'secret-scan']);
    for (const job of Object.values(jobs)) {
      expect(job['runs-on']).toBe('ubuntu-24.04');
      expect(job['timeout-minutes']).toBeGreaterThan(0);
      expect(job.steps.length).toBeGreaterThan(0);
      for (const s of job.steps) expect(Boolean(s.run) !== Boolean(s.uses)).toBe(true);
    }
    for (const job of Object.values(jobs)) {
      for (const need of [job.needs ?? []].flat()) expect(Object.keys(jobs)).toContain(need);
    }
  });

  it('uses in each expression only contexts GitHub provides there, and steps.<id> only for an earlier step of the job', () => {
    const contexts = /^(!?cancelled\(\)|failure\(\)|github\.[\w.]+|env\.[A-Z_]+|runner\.temp|matrix\.[\w-]+|secrets\.[A-Z_]+( != '')?)$/;
    const expressionsIn = (value: unknown): string[] =>
      [...JSON.stringify(value ?? '').matchAll(/\$\{\{\s*(.*?)\s*\}\}/g)].map((m) => m[1].replace(/\\"/g, '"'));
    // The workflow's own env may not read env, matrix, runner, or steps (they do not exist there yet).
    for (const expression of expressionsIn(workflow.env)) expect(expression).toMatch(/^(github|secrets)\./);
    for (const [id, job] of Object.entries(jobs)) {
      const matrix = Object.keys(job.strategy?.matrix ?? {});
      for (const expression of expressionsIn(job.name)) expect(expression).toMatch(/^matrix\./);
      const earlier = new Set<string>();
      for (const s of job.steps) {
        for (const expression of expressionsIn({ if: s.if, with: s.with, env: s.env, run: s.run })) {
          for (const part of expression.split(/\s*&&\s*/)) {
            const step = /^steps\.([\w-]+)\.outcome == 'success'$/.exec(part);
            if (step) {
              expect(earlier.has(step[1]), `${id}: steps.${step[1]} names no earlier step of this job`).toBe(true);
              continue;
            }
            expect(part, `${id}: ${expression}`).toMatch(contexts);
            const name = /^matrix\.([\w-]+)$/.exec(part)?.[1];
            if (name) expect(matrix, `${id}: ${expression}`).toContain(name);
          }
        }
        if (s.id) earlier.add(s.id);
      }
    }
  });

  it('runs on pushes to v3 and pull requests to main, never on a push to main, and never deploys', () => {
    expect(workflow.on).toEqual({ push: { branches: ['v3'] }, pull_request: { branches: ['main'] } });
    for (const s of allSteps) {
      expect(s.run ?? '').not.toMatch(/\bvercel\b|npm publish|git push/i);
      expect(s.uses ?? '').not.toMatch(/vercel|deploy|pages/i);
    }
    expect(text).not.toMatch(/^\s+environment:/m);
  });

  it('reads the repository and nothing more, and cancels a run a newer push replaces', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(jobs)) expect(job.permissions).toBeUndefined();
    expect(workflow.concurrency['cancel-in-progress']).toBe(true);
    expect(workflow.concurrency.group).toContain('github.ref');
    for (const s of allSteps.filter((x) => x.uses?.startsWith('actions/checkout@'))) {
      expect(s.with?.['persist-credentials']).toBe(false);
    }
  });

  it('pins every action to a full commit SHA, with its version written beside it', () => {
    const lines = text.split(/\r?\n/).filter((line) => /^\s*-?\s*uses:/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    expect(text).not.toMatch(/actions\/cache@/);
  });

  it('uses Node 24.x in every job, as Vercel builds the site, and keeps Motion+ out of the Actions cache', () => {
    expect(workflow.env.NODE_VERSION).toBe('24.x');
    const setups = allSteps.filter((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(setups).toHaveLength(Object.keys(jobs).length);
    for (const s of setups) {
      expect(s.with).toEqual({ 'node-version': '${{ env.NODE_VERSION }}', 'package-manager-cache': false });
    }
  });

  it('measures the build as soon as it is packed: the build tests run in a job of their own beside it', () => {
    expect(jobs.lighthouse.needs).toBe('build');
    expect(jobs.e2e.needs).toBe('build');
    for (const id of ['checks', 'build', 'build-tests', 'secret-scan']) expect(jobs[id].needs).toBeUndefined();
    expect(runs('build')).not.toContain('npm run test:build');
    expect(runs('build').at(-1)).toMatch(/^tar -cf /);
    expect(uses('build').at(-1)).toBe('actions/upload-artifact');
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

  it('build: the whole history, the build with its checks, and the build passed on', () => {
    const checkout = jobs.build.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(runs('build').filter((run) => /^(npm|tar)/.test(run))).toEqual([
      'npm ci',
      'npm run build',
      'tar -cf "$RUNNER_TEMP/next-build.tar" --exclude=.next/cache .next',
    ]);
    const upload = jobs.build.steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.with).toMatchObject({ name: 'next-build', path: '${{ runner.temp }}/next-build.tar', 'if-no-files-found': 'error' });
    const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(scripts.postbuild).toContain('check:sky -- --build');
    expect(scripts.postbuild).toContain('check:secrets -- --build');
    expect(scripts['lint:tests']).toBe('next lint --dir tests');
    expect(scripts.lighthouse).toBe('node scripts/lighthouse-ci.mjs');
  });

  it('build-tests: the whole history, the files prebuild makes, then the two build tests', () => {
    const checkout = jobs['build-tests'].steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(runs('build-tests').filter((run) => /^(npm|node)/.test(run))).toEqual([
      'npm ci',
      'node scripts/copy-vendor.mjs && node scripts/content-dates.mjs',
      'npm run test:build',
    ]);
    const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(scripts.prebuild).toContain('node scripts/copy-vendor.mjs && node scripts/content-dates.mjs');
    expect(scripts['test:build']).toBe('vitest run --config vitest.build.config.mts');
    // The build tests run next build themselves and start no npm script, so they need no secret.
    const files = fs.readdirSync(path.join(root, 'tests', 'build'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, 'tests', 'build', file), 'utf8');
      expect(source).not.toMatch(/\b(execFileSync|execSync|spawnSync|spawn|exec|execFile)\(\s*['"`]npm/);
      expect(source).toContain("[path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build']");
    }
  });

  it('lighthouse: each form factor and theme on that build, every one reported even when another fails', () => {
    const job = jobs.lighthouse;
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
    expect(runs('lighthouse').join('\n')).toContain('echo "CHROME_PATH=$chrome" >> "$GITHUB_ENV"');
    const upload = job.steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.if).toBe('${{ !cancelled() }}');
    expect(upload?.with).toMatchObject({
      name: 'lighthouse-${{ matrix.form-factor }}-${{ matrix.theme }}',
      path: '.lighthouseci/reports/${{ matrix.form-factor }}-${{ matrix.theme }}/',
      'include-hidden-files': true,
    });
  });

  it('e2e: npm run test:e2e on the downloaded build, served as it is, results kept only when a test fails', () => {
    expect(runs('e2e')).toContain('tar -xf "$RUNNER_TEMP/next-build/next-build.tar"');
    expect(runs('e2e')).toContain('node scripts/copy-vendor.mjs');
    const tests = step('e2e', 'End-to-end tests');
    expect(tests?.run).toBe('npm run test:e2e');
    // tests/e2e/serve.mjs serves the build in .next with next start instead of building again,
    // which would need both secrets.
    expect(tests?.env).toEqual({ E2E_REUSE_BUILD: '1', E2E_DIST_DIR: '.next' });
    const upload = jobs.e2e.steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.if).toBe('${{ failure() }}');
  });

  it.skipIf(!fs.existsSync(serveScript))('e2e: the suite\'s server reads the two names the job sets (once the suite is merged)', () => {
    const source = fs.readFileSync(serveScript, 'utf8');
    expect(source).toContain("process.env.E2E_REUSE_BUILD === '1'");
    expect(source).toContain('process.env.E2E_DIST_DIR');
    // serve.mjs takes a tsconfig.json entry for the folder as left by a stopped build unless it is
    // committed; .next's entry is.
    expect(JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8')).include).toContain('.next/types/**/*.ts');
  });

  it('secret-scan: gitleaks 8.30.1, checked against its SHA-256, redacting what it finds, over the branch\'s commits', () => {
    const script = runs('secret-scan').join('\n');
    expect(script).toContain('releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz');
    expect(script).toMatch(/[0-9a-f]{64} {2}\$RUNNER_TEMP\/gitleaks\.tar\.gz" \| sha256sum --check --strict -/);
    expect(script).toContain('"$RUNNER_TEMP/gitleaks" git --redact --verbose --no-banner --log-opts="$SCAN_RANGE" .');
    const checkout = jobs['secret-scan'].steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    const range = jobs['secret-scan'].steps.find((s) => s.id === 'range');
    expect(range?.run).toContain('range="$BASE_SHA..$HEAD_SHA"');
    expect(range?.run).toContain('range="origin/main..$GITHUB_SHA"');
    expect(range?.run).toContain('echo "SCAN_RANGE=$range" >> "$GITHUB_ENV"');
    expect(range?.run).toContain('echo "MESSAGE_RANGE=$messages" >> "$GITHUB_ENV"');
  });

  it('secret-scan: no commit message on the branch holds an em dash or an en dash (D-78), and only the branch\'s count', () => {
    const range = jobs['secret-scan'].steps.find((s) => s.id === 'range');
    // The same commits as the scan; without main to compare with, this commit alone, since the v2
    // commits under v3 hold messages from before the rule.
    expect(range?.run?.match(/messages="\$range"/g)).toHaveLength(2);
    expect(range?.run).toContain('messages="$GITHUB_SHA^!"');
    const check = step('secret-scan', 'Commit messages without an em dash or an en dash (D-78)');
    expect(check?.run).toBe('node scripts/check-commit-messages.mjs "$MESSAGE_RANGE"');
    expect(check?.if).toBe("${{ !cancelled() && steps.range.outcome == 'success' }}");
    expect(fs.existsSync(path.join(root, 'scripts', 'check-commit-messages.mjs'))).toBe(true);
  });
});

describe('secrets', () => {
  const SECRETS = ['MOTION_TOKEN', 'CONTENT_BLOCKLIST'];
  const expressions = [...text.matchAll(/\$\{\{([^}]*)\}\}/g)].map((m) => m[1].trim());

  it('are only the two the owner sets, read whole into a step\'s env entry or tested for being set', () => {
    for (const expression of expressions.filter((e) => e.includes('secrets.'))) {
      expect(expression).toMatch(/^secrets\.(MOTION_TOKEN|CONTENT_BLOCKLIST)( != '')?$/);
    }
    for (const line of text.split(/\r?\n/).filter((l) => l.includes('secrets.') && !/^\s*#/.test(l))) {
      expect(line).toMatch(/^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+( != '')? \}\}$/);
    }
    // Neither the workflow nor a job hands a secret to every step.
    for (const value of Object.values(workflow.env)) expect(String(value)).not.toContain('secrets.');
    for (const job of Object.values(jobs)) expect(job.env).toBeUndefined();
  });

  it('reach only the steps that need them', () => {
    const need: Record<string, string[]> = {
      MOTION_TOKEN: ['npm ci', 'npm run check:lockfile', 'npm run build'],
      CONTENT_BLOCKLIST: ['npm run check:content', 'npm run build'],
    };
    for (const s of allSteps) {
      for (const [name, value] of Object.entries(s.env ?? {})) {
        if (!/secrets\.[A-Z_]+ \}\}$/.test(value)) continue;
        expect(SECRETS).toContain(name);
        expect(value).toBe(`\${{ secrets.${name} }}`);
        expect(need[name]).toContain(s.run?.trim());
      }
    }
    for (const id of ['lighthouse', 'e2e', 'build-tests']) {
      const measuring = jobs[id].steps.filter((s) => /npm run (lighthouse|test:e2e|test:build)/.test(s.run ?? ''));
      expect(measuring).toHaveLength(1);
      expect(JSON.stringify(measuring[0].env ?? {})).not.toContain('secrets.');
    }
  });

  it('are never expanded in a script, so no step can print one', () => {
    for (const s of allSteps) {
      expect(s.run ?? '').not.toMatch(/\$\{?(MOTION_TOKEN|CONTENT_BLOCKLIST)\b/);
      expect(s.run ?? '').not.toContain('secrets.');
    }
  });

  it('are checked by name before a job uses them, so a missing one fails with a plain message', () => {
    for (const id of ['checks', 'build', 'build-tests', 'lighthouse', 'e2e']) {
      const check = step(id, 'Check that the secrets this job needs are set');
      expect(check?.env?.HAS_MOTION_TOKEN).toBe("${{ secrets.MOTION_TOKEN != '' }}");
      expect(check?.run).toContain('::error::The Actions secret MOTION_TOKEN is not set');
    }
    for (const id of ['checks', 'build']) {
      const check = step(id, 'Check that the secrets this job needs are set');
      expect(check?.env?.HAS_CONTENT_BLOCKLIST).toBe("${{ secrets.CONTENT_BLOCKLIST != '' }}");
    }
    expect(step('secret-scan', 'Check that the secrets this job needs are set')).toBeUndefined();
  });
});
