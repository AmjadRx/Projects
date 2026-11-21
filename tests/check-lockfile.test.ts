/** The lockfile check (scripts/check-lockfile.mjs, plan R-08), on fixture folders with synthetic values. */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script with no type declarations.
import { checkLockfile, reportLines } from '../scripts/check-lockfile.mjs';
// @ts-expect-error: a plain .mjs script with no type declarations.
import { SECRET_VARIABLES, scanEnvironment } from '../scripts/check-secrets.mjs';

type Finding = { rule: string; file: string; where: string; message: string };
type Result = { findings: Finding[]; notes: string[]; stats: Record<string, unknown> };
type Files = Record<string, string | Buffer>;
type Env = Record<string, string>;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'scripts', 'check-lockfile.mjs');
/** Git fixtures and runs of the command can take longer than the default 5 seconds. */
const SLOW = 60_000;

// Synthetic values -------------------------------------------------------------------------------
// Every value is random and built at run time, so this file holds no credential and no text with a
// credential's shape. Hosts use the reserved .example domain.

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A random run that starts with a letter, holds a digit, and never holds "eyJ" (the start of a JSON
 * Web Token). From the default alphabet it also mixes upper and lower case.
 */
function random(length: number, alphabet = ALNUM): string {
  for (;;) {
    const out = Array.from(crypto.randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join('');
    const cases = alphabet !== ALNUM || (/[a-z]/.test(out) && /[A-Z]/.test(out));
    if (/^[A-Za-z]/.test(out) && /\d/.test(out) && cases && !out.includes('eyJ')) return out;
  }
}

/** Stands for a Motion+ token: what must never reach a committed file. */
const TOKEN = random(40);
/** MOTION_TOKEN where the check runs, in none of the files. */
const OTHER = random(32);
/** A password made of short runs, so that it never looks like a token itself. */
const PASS = [random(10), random(10)].join('-');
/** Too short to look like a token. */
const PIECE = random(12);
const LOWER = random(36, 'abcdefghijklmnopqrstuvwxyz0123456789');
/** Lower-case letters only: no digit, so no token-like test catches it. */
const LETTERS = Array.from(crypto.randomBytes(26), (byte) => 'abcdefghijklmnopqrstuvwxyz'[byte % 26]).join('');
const MIXED31 = random(31);
const UUID = crypto.randomUUID();
const NPM_TOKEN = ['npm', random(36)].join('_');
const GITHUB_TOKEN = ['ghp', random(36)].join('_');
const JWT = [`eyJ${random(20)}`, `eyJ${random(12)}`, random(20)].join('.');
/** A value with a slash, so that its URL-encoded form differs from it. */
const SECRET = [random(12), random(12)].join('/');
const SYNTHETIC = [TOKEN, OTHER, PASS, PIECE, LOWER, LETTERS, MIXED31, UUID, NPM_TOKEN, GITHUB_TOKEN, JWT, SECRET];

/** No output may hold a synthetic value or an 8-character piece of one, in any case, as written or percent-decoded. */
function expectNothingSecret(output: string) {
  const decoded = output.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => Buffer.from(run.replace(/%/g, ''), 'hex').toString('latin1'));
  const texts = [output.toLowerCase(), decoded.toLowerCase()];
  const leaked = SYNTHETIC.some((value) => {
    const lower = value.toLowerCase();
    for (let i = 0; i + 8 <= lower.length; i += 1) if (texts.some((text) => text.includes(lower.slice(i, i + 8)))) return true;
    return false;
  });
  expect(leaked, 'the output holds a piece of a synthetic value').toBe(false);
}

const percent = (text: string) => Array.from(Buffer.from(text), (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
const base64 = (text: string) => Buffer.from(text).toString('base64');

// Fixtures --------------------------------------------------------------------------------------

const made: string[] = [];

function fixture(files: Files): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-lockfile-'));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

const hasGit = spawnSync('git', ['--version']).status === 0;

function git(root: string, args: string[], input?: string | Buffer): string {
  const run = spawnSync('git', args, { cwd: root, input });
  expect(run.status).toBe(0);
  return run.stdout.toString().trim();
}

/** A fixture git tracks every file of. */
function repository(files: Files): string {
  const root = fixture(files);
  git(root, ['init', '-q']);
  git(root, ['add', '-f', '-A']);
  return root;
}

/** MOTION_TOKEN set to a value that is in no file, as it is wherever npm installs Motion+. */
const ENV: Env = { MOTION_TOKEN: OTHER };

/** Runs every rule in this process, with only the given secret variables set. */
function check(root: string, env: Env = ENV) {
  const result = checkLockfile(root, env) as Result;
  const output = (reportLines(result) as string[]).join('\n');
  expectNothingSecret(output);
  return {
    result,
    output,
    rules: [...new Set(result.findings.map((f) => f.rule))].sort(),
    /** Each finding as "<file> <where> <rule>: <message>". */
    lines: result.findings.map((f) => `${f.file} ${f.where} ${f.rule}: ${f.message}`),
  };
}

/** The messages of one rule's findings at a `where` that starts with the given text. */
const messagesAt = (result: Result, rule: string, where: string) => result.findings.filter((f) => f.rule === rule && f.where.startsWith(where)).map((f) => f.message);

/** Variables the command must not inherit: every secret variable, and the others these tests set. */
const SCRUBBED = [...(SECRET_VARIABLES as string[]), 'MOTIONPLUS_KEY'];

/** Runs the command. Its environment loses every secret variable and gains `extra`. */
function cli(args: string[], extra: Env = {}, base: NodeJS.ProcessEnv = process.env) {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of SCRUBBED) delete env[name];
  const run = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...env, ...extra },
  });
  const output = `${run.stdout}${run.stderr}`;
  expectNothingSecret(output);
  return { status: run.status, output };
}

/** The environment with only Node's own folder on the path, so git cannot be found. */
const nodeOnly: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(nodeOnly)) if (key.toUpperCase() === 'PATH') delete nodeOnly[key];
nodeOnly.PATH = path.dirname(process.execPath);
const gitHidden = spawnSync('git', ['--version'], { env: nodeOnly }).status !== 0;

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const lineOf = (text: string, needle: string) => text.split('\n').findIndex((line) => line.includes(needle)) + 1;
/** An integrity as npm writes one (sha512 in base64), from a made-up digest. */
const integrity = (seed: number) => `sha512-${Buffer.alloc(64, seed).toString('base64')}`;

const MOTION_HOST = 'registry.motion.example';
const REFERENCE = ['$', '{MOTION_TOKEN}'].join('');
const PRIVATE = ['PRI', 'VATE'].join('');
const NPMRC = `@motionplus:registry=https://${MOTION_HOST}/\n//${MOTION_HOST}/:_authToken=${REFERENCE}\n`;
const LEFT_PAD = 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz';
const MOTION_PLUS = `https://${MOTION_HOST}/@motionplus/core/-/core-2.0.0.tgz`;
const MOTION_ENTRY = { name: '@motionplus/core', version: '2.0.0', resolved: MOTION_PLUS, integrity: integrity(2) };

const PACKAGE = json({
  name: 'fixture',
  version: '1.0.0',
  dependencies: { 'left-pad': '1.3.0', 'motion-plus': 'npm:@motionplus/core@2.0.0' },
});

/** A registry package as npm locks it: <registry>/<name>/-/<name>-<version>.tgz, with an integrity. */
const fromNpm = (name: string, version: string, seed = 3) => ({
  version,
  resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`,
  integrity: integrity(seed),
});

/** A lockfileVersion 3 file: a registry package, Motion+ under its alias, and a workspace link. */
function lockV3(extra: Record<string, unknown> = {}, rootEntry: Record<string, unknown> = {}) {
  return json({
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', version: '1.0.0', dependencies: { 'left-pad': '1.3.0', 'motion-plus': 'npm:@motionplus/core@2.0.0' }, ...rootEntry },
      'node_modules/left-pad': { ...fromNpm('left-pad', '1.3.0', 1), funding: { url: 'https://pay.example/left-pad?sponsor=1' } },
      'node_modules/motion-plus': MOTION_ENTRY,
      'node_modules/local-thing': { resolved: 'packages/local-thing', link: true },
      'packages/local-thing': { name: 'local-thing', version: '0.1.0' },
      ...extra,
    },
  });
}

/** The legacy tree of lockfileVersion 1 (and 2), where a "version" can be an address. */
const LEGACY = {
  'left-pad': { version: '1.3.0', resolved: LEFT_PAD, integrity: integrity(1) },
  'motion-plus': {
    version: 'npm:@motionplus/core@2.0.0',
    resolved: MOTION_PLUS,
    integrity: integrity(2),
    dependencies: { nested: { version: '1.0.0', resolved: 'https://registry.npmjs.org/nested/-/nested-1.0.0.tgz', integrity: integrity(4) } },
  },
  'local-thing': { version: 'file:packages/local-thing' },
};

const lockV1 = (dependencies: Record<string, unknown>) => json({ name: 'fixture', version: '1.0.0', lockfileVersion: 1, requires: true, dependencies });

const NOT_SET = 'and it is not set where this check runs (or is shorter than 6 characters), so its value cannot be searched for; set it wherever npm or this check runs';
const LITERAL = (word: string) => `a key naming ${word} must hold exactly one \${NAME} reference and nothing else; this one holds a literal value`;
const LOOKS_LIKE_A_TOKEN = 'text that looks like a token (a long mix of letters and digits, or a UUID)';
const IN_THIS_FILE = (name: string) => `the value of ${name} is in this file`;

// Tests -----------------------------------------------------------------------------------------

describe('the lockfile check on the real repository', () => {
  it(
    'passes with a synthetic value in every secret variable, in this process and as the command',
    () => {
      const env: Env = Object.fromEntries((SECRET_VARIABLES as string[]).map((name) => [name, random(32)]));
      SYNTHETIC.push(...Object.values(env));
      expect(check(REPO, env).result.findings).toEqual([]);
      const run = cli([], env);
      expect(run.output).toMatch(/^check:lockfile: .*: 0 errors$/m);
      expect(run.status).toBe(0);
    },
    SLOW,
  );
});

describe('the honest Motion+ setup', () => {
  it.skipIf(!hasGit)(
    'passes: one scope registry line, one auth line reading MOTION_TOKEN, and Motion+ from that registry, in lockfileVersion 1, 2, and 3',
    () => {
      expect(check(repository({ 'package.json': PACKAGE, 'package-lock.json': lockV3(), '.npmrc': NPMRC })).result.findings).toEqual([]);
      expect(check(fixture({ 'package-lock.json': lockV1(LEGACY), '.npmrc': NPMRC })).result.findings).toEqual([]);
      const v2 = { ...JSON.parse(lockV3()), lockfileVersion: 2, dependencies: LEGACY };
      expect(check(fixture({ 'npm-shrinkwrap.json': json(v2), '.npmrc': NPMRC })).result.findings).toEqual([]);
    },
    SLOW,
  );

  it('passes a registry with a path and a port, a %2f scope slash, ${NAME?}, and comments npm drops (H3, FP1)', () => {
    const npmrc = [
      '# Motion+ comes from its own registry, with the token from the environment.',
      `# //${MOTION_HOST}/tokens/npm/:_authToken=${REFERENCE}`,
      `@motionplus:registry=https://${MOTION_HOST.toUpperCase()}:443/tokens/npm`,
      `//${MOTION_HOST}/tokens/npm/:_authToken=${['$', '{MOTION_TOKEN?}'].join('')} # read from the environment`,
      `//${MOTION_HOST}/tokens/npm/:always-auth=true ; a path that holds the word token`,
      'save-exact # a setting with no value, which npm reads as true',
      '',
    ].join('\n');
    const lock = lockV3({ 'node_modules/motion-plus': { ...MOTION_ENTRY, resolved: `https://${MOTION_HOST}/tokens/npm/@motionplus%2fcore/-/core-2.0.0.tgz` } });
    expect(check(fixture({ '.npmrc': npmrc, 'package.json': PACKAGE, 'package-lock.json': lock })).result.findings).toEqual([]);
  });

  it('fails closed when MOTION_TOKEN is not set where the check runs, since its value could not be searched for (X5)', () => {
    const files = { '.npmrc': NPMRC, 'package.json': PACKAGE, 'package-lock.json': lockV3() };
    expect(check(fixture(files), {}).lines).toEqual([`.npmrc line 2 TOKEN-VALUE: this auth line reads MOTION_TOKEN, ${NOT_SET}`]);
    expect(check(fixture({ 'package.json': PACKAGE }), {}).lines).toEqual([`package.json (file) TOKEN-VALUE: Motion+ is a dependency here, so npm needs MOTION_TOKEN, ${NOT_SET}`]);
    expect(check(fixture(files), { MOTION_TOKEN: 'short' }).rules).toEqual(['TOKEN-VALUE']);
  });
});

describe('LOCK-SOURCE', () => {
  it('fails credentials, a query string, a fragment, plain http, and a host the package may not come from, naming only the part', () => {
    const entry = (resolved: string) => ({ version: '1.0.0', resolved, integrity: integrity(5) });
    const root = fixture({
      '.npmrc': NPMRC,
      'package-lock.json': lockV3({
        'node_modules/a': entry(`https://user:${PASS}@registry.npmjs.org/a/-/a-1.0.0.tgz`),
        'node_modules/b': entry(`https://registry.npmjs.org/b/-/b-1.0.0.tgz?token=${SECRET}`),
        'node_modules/c': entry(`https://registry.npmjs.org/c/-/c-1.0.0.tgz#${SECRET}`),
        'node_modules/d': entry('http://registry.npmjs.org/d/-/d-1.0.0.tgz'),
        'node_modules/e': entry(`https://${MOTION_HOST}/e/-/e-1.0.0.tgz`),
        'node_modules/@motionplus/f': entry('https://registry.npmjs.org/@motionplus/f/-/f-1.0.0.tgz'),
        'node_modules/g': entry('git+ssh://git@github.com/someone/g.git#0123abc'),
        'node_modules/h': entry('someone/h#0123abc'),
        // F07: a tarball host other than the registry .npmrc gives the scope, such as a CDN.
        'node_modules/@motionplus/i': entry('https://cdn.motion.example/@motionplus/i/-/i-1.0.0.tgz'),
      }),
    });
    const { result, rules } = check(root);
    expect(rules).toEqual(['LOCK-SOURCE']);
    const message = (key: string) => messagesAt(result, 'LOCK-SOURCE', `packages["node_modules/${key}"].resolved`).join(' | ');
    const SCOPE = 'where this package may only come from the registry .npmrc gives @motionplus';
    expect(message('a')).toBe('"resolved" address: a username, a password');
    expect(message('b')).toBe('"resolved" address: a query string');
    expect(message('c')).toBe('"resolved" address: a fragment');
    expect(message('d')).toBe('"resolved" address: not https (http)');
    expect(message('e')).toBe('"resolved" address: the host of the registry .npmrc gives @motionplus, where this package may only come from registry.npmjs.org');
    expect(message('@motionplus/f')).toBe(`"resolved" address: host registry.npmjs.org, ${SCOPE}`);
    expect(message('g')).toBe('"resolved" address: not https (git+ssh), a username, a fragment, host github.com, where this package may only come from registry.npmjs.org');
    expect(message('h')).toBe('"resolved" address: not an https address');
    expect(message('@motionplus/i')).toBe(`"resolved" address: a host that is not approved, ${SCOPE}`);
    expect(result.findings).toHaveLength(9);
    expect(result.findings.every((f) => f.file === 'package-lock.json' && /\(line \d+\)$/.test(f.where))).toBe(true);
  });

  it('pins the path: a registry package comes only from <registry>/<name>/-/<name>-<version>.tgz, so no part of its address carries a token (L01, L02, V04, V05)', () => {
    const lock = lockV3({
      'node_modules/left-pad': { ...fromNpm('left-pad', '1.3.0'), resolved: `https://registry.npmjs.org/${TOKEN}/left-pad/-/left-pad-1.3.0.tgz` },
      'node_modules/motion-plus': { ...MOTION_ENTRY, resolved: `https://${MOTION_HOST}/download/${TOKEN}/core-2.0.0.tgz` },
      'node_modules/b': { ...fromNpm('b', '1.0.0'), resolved: `https://registry.npmjs.org/b/${TOKEN}/b-1.0.0.tgz` },
      'node_modules/@motionplus/dom': { ...fromNpm('@motionplus/dom', '2.0.0'), resolved: `https://${MOTION_HOST}/@motionplus/dom/${TOKEN}/dom-2.0.0.tgz` },
    });
    const { result, rules } = check(fixture({ '.npmrc': NPMRC, 'package-lock.json': lock }));
    expect(rules).toEqual(['LOCK-SOURCE']);
    expect(result.findings.map((f) => f.where.replace(/ \(line \d+\)$/, ''))).toEqual([
      'packages["node_modules/left-pad"].resolved',
      'packages["node_modules/motion-plus"].resolved',
      'packages["node_modules/b"].resolved',
      'packages["node_modules/@motionplus/dom"].resolved',
    ]);
    expect(result.findings.every((f) => f.message.includes('a path other than the one'))).toBe(true);
  });

  it('fails a token in the registry path .npmrc gives, whether written there or read from the environment (probe4, B8, X1)', () => {
    const fromEnvironment = check(
      fixture({
        '.npmrc': `@motionplus:registry=https://dl.motion.example/${REFERENCE}/motion/plus/npm/\n//dl.motion.example/:_authToken=${REFERENCE}\n`,
        'package-lock.json': lockV3({ 'node_modules/motion-plus': { ...MOTION_ENTRY, resolved: `https://dl.motion.example/${TOKEN}/motion/plus/npm/@motionplus/core/-/core-2.0.0.tgz` } }),
      }),
    );
    expect(fromEnvironment.lines).toContain(
      '.npmrc line 1 NPMRC-AUTH: a ${...} reference inside a longer value: npm expands it anywhere, so a split one can rebuild a literal; a reference may only stand alone',
    );
    expect(messagesAt(fromEnvironment.result, 'LOCK-SOURCE', 'packages["node_modules/motion-plus"].resolved')).toHaveLength(1);
    const written = check(
      fixture({
        '.npmrc': `@motionplus:registry=https://${MOTION_HOST}/${TOKEN}/\n//${MOTION_HOST}/:_authToken=${REFERENCE}\n`,
        'package-lock.json': lockV3({ 'node_modules/motion-plus': { ...MOTION_ENTRY, resolved: `https://${MOTION_HOST}/${TOKEN}/@motionplus/core/-/core-2.0.0.tgz` } }),
      }),
    );
    expect(written.lines).toContain(`.npmrc line 1 TOKEN-SHAPE: ${LOOKS_LIKE_A_TOKEN}`);
  });

  it('fails a default registry other than registry.npmjs.org, and a registry package without an integrity (E5, E6, L07)', () => {
    const mirror = `${NPMRC}registry=https://npm-mirror.example/\n//npm-mirror.example/:_authToken=${REFERENCE}\n`;
    const lock = lockV3({ 'node_modules/left-pad': { version: '1.3.0', resolved: LEFT_PAD } });
    expect(check(fixture({ '.npmrc': mirror, 'package-lock.json': lock })).lines).toEqual([
      `package-lock.json packages["node_modules/left-pad"].resolved (line ${lineOf(lock, LEFT_PAD)}) LOCK-SOURCE: "resolved" address: no integrity, so npm would install whatever the address sends`,
      '.npmrc line 3 NPMRC-AUTH: the default registry may only be https://registry.npmjs.org/: another would serve every public package, and receive any token set for its host',
      '.npmrc line 4 NPMRC-AUTH: a key naming _authtoken for a host no "@scope:registry" line names; npm would send the value there',
    ]);
    // E6: npm fetches an entry with no "resolved" from the default registry, so the .npmrc fails.
    expect(check(fixture({ '.npmrc': mirror, 'package-lock.json': lockV3({ 'node_modules/left-pad': { version: '1.3.0' } }) })).rules).toEqual(['NPMRC-AUTH']);
  });

  it('holds a folder of a scope .npmrc gives a registry to that scope, whatever name, case, or slash its entry uses (L04, L04b, E2, C17, C18)', () => {
    const npmrc = `${NPMRC}@other:registry=https://other.example/\n`;
    const v3 = check(
      fixture({
        '.npmrc': npmrc,
        'package-lock.json': lockV3({
          'node_modules/@motionplus/core': { name: 'left-pad', version: '2.0.0', resolved: 'https://registry.npmjs.org/@motionplus/core/-/core-2.0.0.tgz', integrity: integrity(6) },
          'node_modules/@motionplus/dom': { name: '@other/dom', version: '2.0.0', resolved: 'https://other.example/@other/dom/-/dom-2.0.0.tgz', integrity: integrity(7) },
          'node_modules/@MOTIONPLUS/upper': fromNpm('@MOTIONPLUS/upper', '2.0.0'),
          'node_modules\\@motionplus\\slash': fromNpm('@motionplus/slash', '2.0.0'),
        }),
      }),
    );
    expect(v3.rules).toEqual(['LOCK-SOURCE']);
    expect([...new Set(v3.result.findings.map((f) => f.where.replace(/\]\.resolved/, ']').replace(/ \(line \d+\)$/, '')))]).toEqual([
      'packages["node_modules/@motionplus/core"]',
      'packages["node_modules/@motionplus/dom"]',
      'packages["node_modules/@MOTIONPLUS/upper"]',
      'packages["node_modules\\\\@motionplus\\\\slash"]',
    ]);
    expect(messagesAt(v3.result, 'LOCK-SOURCE', 'packages["node_modules/@motionplus/dom"]')).toEqual([
      'the folder is in @motionplus, a scope .npmrc gives a registry, but it holds a package of another scope or of none',
    ]);
    const v1 = check(
      fixture({
        '.npmrc': npmrc,
        'package-lock.json': lockV1({ '@motionplus/core': { version: 'npm:left-pad@1.3.0', resolved: 'https://registry.npmjs.org/@motionplus/core/-/core-2.0.0.tgz', integrity: integrity(8) } }),
      }),
    );
    expect(v1.result.findings.map((f) => f.where.replace(/ \(line \d+\)$/, ''))).toEqual(['dependencies["@motionplus/core"]', 'dependencies["@motionplus/core"].resolved']);
  });

  it('reads the specs and local sources npm copies into a lockfile (L05, L05b, L06, L06b, L08, L09)', () => {
    const query = `https://cdn.example/x.tgz?token=${TOKEN}`;
    const v3 = check(
      fixture({
        '.npmrc': NPMRC,
        'package-lock.json': lockV3(
          {
            'node_modules/x': { version: `npm:x@${query}` },
            'node_modules/y': { ...fromNpm('y', '1.0.0'), peerDependencies: { z: query } },
            'node_modules/local': { resolved: `packages/local?token=${TOKEN}`, link: true },
            'node_modules/vend': { version: '1.0.0', resolved: `file:vendor/vend.tgz?token=${TOKEN}` },
          },
          { optionalDependencies: { w: query } },
        ),
      }),
    );
    expect(v3.rules).toEqual(['LOCK-SOURCE']);
    expect(v3.result.findings.map((f) => f.where.replace(/ \(line \d+\)$/, ''))).toEqual([
      'packages[""].optionalDependencies.w',
      'packages["node_modules/x"].version',
      'packages["node_modules/y"].peerDependencies.z',
      'packages["node_modules/local"].resolved',
      'packages["node_modules/vend"].resolved',
    ]);
    expect(v3.result.findings.every((f) => f.message.includes('a query string'))).toBe(true);
    const v1 = check(fixture({ '.npmrc': NPMRC, 'package-lock.json': lockV1({ ...LEGACY, x: { version: `npm:x@${query}` }, y: { ...fromNpm('y', '1.0.0'), requires: { z: query } } }) }));
    expect(v1.result.findings.map((f) => `${f.rule} ${f.where.replace(/ \(line \d+\)$/, '')}`)).toEqual(['LOCK-SOURCE dependencies.x.version', 'LOCK-SOURCE dependencies.y.requires.z']);
  });

  it('reads the legacy tree, where a version can itself be an address', () => {
    const root = fixture({
      '.npmrc': NPMRC,
      'package-lock.json': lockV1({
        ...LEGACY,
        tarball: { version: `https://cdn.example/t.tgz?sig=${SECRET}` },
        hosted: { version: 'github:someone/hosted#0123abc', from: 'github:someone/hosted' },
      }),
    });
    expect(check(root).result.findings.map((f) => `${f.rule} ${f.where.replace(/ \(line \d+\)$/, '')}`)).toEqual([
      'LOCK-SOURCE dependencies.tarball.version',
      'LOCK-SOURCE dependencies.hosted.version',
    ]);
  });

  it('holds Motion+ to registry.npmjs.org when no .npmrc gives its scope a registry', () => {
    const { result } = check(fixture({ 'package-lock.json': lockV3() }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].where).toMatch(/^packages\["node_modules\/motion-plus"\]\.resolved/);
  });

  it('sees a repeated key that JSON.parse would drop, and fails a lockfile it cannot read', () => {
    const repeated = lockV3().replace(`"resolved": "${LEFT_PAD}",`, `"resolved": "https://user:${PASS}@registry.npmjs.org/left-pad.tgz",\n      "resolved": "${LEFT_PAD}",`);
    expect(check(fixture({ '.npmrc': NPMRC, 'package-lock.json': repeated })).rules).toEqual(['LOCK-SOURCE']);
    const broken = check(fixture({ 'package-lock.json': `{ "lockfileVersion": 3, "x": "${NPM_TOKEN}" ` }));
    expect(broken.result.findings.map((f) => `${f.rule} ${f.where}`)).toEqual(['LOCK-SOURCE (file)', 'TOKEN-SHAPE line 1']);
  });

  it('never prints a host, a scheme, or a key that could hold a secret (X01 to X03, O2, O2c, O3, O3b, O3c)', () => {
    const local = { version: '1.0.0', resolved: 'http://registry.npmjs.org/x.tgz' };
    const root = fixture({
      '.npmrc': `@motionplus:registry=https://${OTHER}.motion.example/\n`,
      'package-lock.json': lockV3({
        'node_modules/q1': { ...fromNpm('q1', '1.0.0'), resolved: `https://${OTHER}.evil.example/q.tgz` },
        'node_modules/q2': { ...fromNpm('q2', '1.0.0'), resolved: `https://${percent(MIXED31)}.evil.example/q.tgz` },
        'node_modules/q3': { ...fromNpm('q3', '1.0.0'), resolved: `${PIECE}:q` },
        [`node_modules/${percent(TOKEN)}`]: local,
        [`node_modules/${base64(TOKEN)}`]: local,
        [`node_modules/${LOWER}`]: local,
      }),
    });
    const { result, output } = check(root, { MOTION_TOKEN: OTHER, SESSION_SECRET: MIXED31, VERCEL_TOKEN: PIECE, ADMIN_PASSWORD: TOKEN });
    expect(messagesAt(result, 'LOCK-SOURCE', 'packages["node_modules/q1"]')[0]).toContain('a host that is not approved, where this package may only come from registry.npmjs.org');
    expect(messagesAt(result, 'LOCK-SOURCE', 'packages["node_modules/q2"]')[0]).toContain('a host that is not approved');
    expect(messagesAt(result, 'LOCK-SOURCE', 'packages["node_modules/q3"]')[0]).toContain('not https (another scheme)');
    expect(messagesAt(result, 'LOCK-SOURCE', 'packages["node_modules/motion-plus"]')[0]).toBe(
      '"resolved" address: a host that is not approved, where this package may only come from the registry .npmrc gives @motionplus',
    );
    expect(output.split('\n').filter((line) => line.includes('packages[(a key not shown)].resolved'))).toHaveLength(3);
  });
});

describe('PKG-SPEC', () => {
  it('passes ranges, tags, npm: aliases, local paths, and plain git references', () => {
    const root = fixture({
      'package.json': json({
        dependencies: {
          'left-pad': '^1.3.0',
          'motion-plus': 'npm:@motionplus/core@2.0.0',
          tagged: 'latest',
          local: 'file:../local',
          ranged: 'git+https://github.com/someone/ranged.git#semver:>=1.2.0 <2',
          tag: 'github:someone/tag#v1.2.3',
          commit: 'someone/commit#0123456789abcdef0123456789abcdef01234567',
          sub: 'github:someone/mono#main::path:packages/sub',
        },
        overrides: { 'left-pad': { '.': '1.3.0', inner: '$left-pad' }, 'other@1.0.0': '1.0.1' },
      }),
    });
    expect(check(root).result.findings).toEqual([]);
  });

  it('fails a username, a password, a query string, or a token-bearing fragment, in any dependency field or override', () => {
    const root = fixture({
      'package.json': json({
        dependencies: { creds: `git+https://user:${PASS}@github.com/someone/creds.git` },
        devDependencies: { query: `https://cdn.example/query.tgz?auth=${SECRET}` },
        optionalDependencies: { fragment: `github:someone/fragment#access_token=${SECRET}` },
        peerDependencies: { random: `someone/random#${TOKEN}`, alias: `npm:@scope/alias@https://${PASS}@cdn.example/a.tgz` },
        overrides: { outer: { inner: `https://user:${PASS}@cdn.example/inner.tgz` }, [`keyed@https://user:${PASS}@cdn.example/k.tgz`]: '1.0.0' },
      }),
    });
    const { result, rules } = check(root);
    expect(rules).toEqual(['PKG-SPEC']);
    const at = (where: string) => messagesAt(result, 'PKG-SPEC', where).join(' | ');
    expect(at('dependencies.creds')).toBe('the spec holds a username, a password');
    expect(at('devDependencies.query')).toBe('the spec holds a query string');
    expect(at('optionalDependencies.fragment')).toBe('the spec holds a fragment that is not a plain git reference (it may hold a token)');
    expect(at('peerDependencies.random')).toBe('the spec holds a fragment that is not a plain git reference (it may hold a token)');
    expect(at('peerDependencies.alias')).toBe('the spec holds a username');
    expect(at('overrides.outer.inner')).toBe('the spec holds a username, a password');
    expect(at('overrides (a key')).toBe('the spec in this key holds a username, a password');
    expect(result.findings).toHaveLength(7);
  });

  it('reads userinfo after any run of slashes or backslashes, as a URL parser does (P01 to P03b)', () => {
    const root = fixture({
      'package.json': json({
        dependencies: { p1: `https:///user:${PASS}@cdn.example/x.tgz`, p2: `https:\\\\user:${PASS}@cdn.example/x.tgz`, p3: `https:/user:${PASS}@cdn.example/x.tgz` },
        homepage: `https:/user:${PASS}@cdn.example/`,
        funding: { url: `https:\\\\user:${PASS}@cdn.example/` },
      }),
    });
    const { result, rules } = check(root);
    expect(rules).toEqual(['PKG-SPEC']);
    for (const key of ['p1', 'p2', 'p3']) expect(messagesAt(result, 'PKG-SPEC', `dependencies.${key}`)).toEqual(['the spec holds a username, a password']);
    for (const where of ['homepage', 'funding.url']) {
      expect(messagesAt(result, 'PKG-SPEC', where)).toEqual(['a string that holds an address with a password, or with a username other than git']);
    }
  });

  it('reads the whole of an override key, at any depth (P04)', () => {
    const root = fixture({
      'package.json': json({
        overrides: { [`https://user:${PASS}@cdn.example/x.tgz`]: '1.0.0', outer: { [`git+https://user:${PASS}@github.com/someone/x.git`]: '1.0.0' } },
      }),
    });
    expect(check(root).result.findings.map((f) => `${f.where.replace(/ line \d+\)$/, ')')}: ${f.message}`)).toEqual([
      'overrides (a key,): the spec in this key holds a username, a password',
      'overrides.outer (a key,): the spec in this key holds a username, a password',
    ]);
  });

  it('fails closed on a dependency field that is not an object of strings, and on any publishConfig (P05 to P05d, P09)', () => {
    const query = `https://cdn.example/x.tgz?token=${TOKEN}`;
    const root = fixture({
      'package.json': json({
        dependencies: { x: [query] },
        devDependencies: [`x@${query}`],
        optionalDependencies: `x@${query}`,
        overrides: { x: [query] },
        publishConfig: { [`//${MOTION_HOST}/:_authToken`]: TOKEN, registry: `https://${MOTION_HOST}/?k=${TOKEN}` },
      }),
    });
    expect(check(root).result.findings.map((f) => `${f.rule} ${f.where.replace(/ \(line \d+\)$/, '')}: ${f.message}`)).toEqual([
      'PKG-SPEC dependencies.x: a spec that is not a string',
      'PKG-SPEC devDependencies: "devDependencies" is not an object of names and specs',
      'PKG-SPEC optionalDependencies: "optionalDependencies" is not an object of names and specs',
      'PKG-SPEC overrides.x: an override that is neither a spec nor an object',
      'PKG-SPEC publishConfig: publishConfig sets npm configuration, registries and auth included, for a site that publishes nothing; remove it',
    ]);
  });

  it('fails a git reference that looks like a token, in a path: part, a semver: prerelease, or a bare reference of any case (probe3, P06)', () => {
    const root = fixture({
      'package.json': json({
        dependencies: {
          a: `github:someone/a#path:${TOKEN}`,
          b: `github:someone/b#semver:1.0.0-${TOKEN}`,
          c: `github:someone/c#${LOWER}`,
          d: `github:someone/d#${UUID}`,
          e: `github:someone/e#${MIXED31}`,
        },
      }),
    });
    const { result } = check(root);
    expect(result.findings.map((f) => f.where.replace(/ \(line \d+\)$/, ''))).toEqual(['dependencies.a', 'dependencies.b', 'dependencies.c', 'dependencies.d', 'dependencies.e']);
    expect(result.findings.every((f) => f.message === 'the spec holds a fragment that is not a plain git reference (it may hold a token)')).toBe(true);
  });

  it('fails an address whose host or path looks like a token, and Motion+ from anywhere but its registry (P07, M01)', () => {
    const root = fixture({
      'package.json': json({
        dependencies: {
          x: `https://cdn.example/${TOKEN}/x.tgz`,
          'motion-plus': 'file:vendor/motionplus-core-2.0.0.tgz',
          '@motionplus/dom': 'https://cdn.example/dom.tgz',
          mp: 'npm:@motionplus/core@https://cdn.example/core.tgz',
        },
      }),
    });
    expect(check(root).result.findings.map((f) => `${f.where.replace(/ \(line \d+\)$/, '')}: ${f.message}`)).toEqual([
      'dependencies.x: the spec holds a host or path that looks like it holds a token',
      'dependencies["motion-plus"]: the spec holds a source for Motion+ other than its registry',
      'dependencies["@motionplus/dom"]: the spec holds a source for Motion+ other than its registry',
      'dependencies.mp: the spec holds a source for Motion+ other than its registry',
    ]);
  });
});

describe('NPMRC-AUTH', () => {
  it('passes a single ${NAME} reference, read as npm reads the file (BOM, CRLF, comments, spaces, quotes)', () => {
    const npmrc = [
      `${String.fromCharCode(0xfeff)}# Motion+ comes from its own registry`,
      '; with the token from the environment',
      `@motionplus:registry = "https://${MOTION_HOST}/"`,
      `//${MOTION_HOST}/:_authToken = "${REFERENCE}"`,
      `//${MOTION_HOST}/:always-auth=true`,
      '',
    ].join('\r\n');
    expect(check(fixture({ '.npmrc': npmrc, 'package-lock.json': lockV3() })).result.findings).toEqual([]);
  });

  it('fails a literal, a reference plus extra text, a bare $NAME, an old auth line after a value, and an address with credentials or a query string', () => {
    const npmrc = [
      `//${MOTION_HOST}/:_authToken=${SECRET}`,
      `//${MOTION_HOST}/:_password="${REFERENCE}${PIECE}"`,
      `//${MOTION_HOST}/:username=$MOTION_USER`,
      `_auth = ${base64(`user:${PASS}`)}`,
      `@motionplus:registry=https://user:${PASS}@${MOTION_HOST}/?key=${PIECE}`,
      '[section]',
      `token = '${SECRET}'`,
      `//${MOTION_HOST}/:_authToken=${REFERENCE} ; //${MOTION_HOST}/:_authToken=${SECRET}`,
      `//user:${PASS}@${MOTION_HOST}/:_authToken=${REFERENCE}`,
      '',
    ].join('\n');
    const { result } = check(fixture({ '.npmrc': npmrc }));
    expect(result.findings.filter((f) => f.rule === 'NPMRC-AUTH').map((f) => `${f.where}: ${f.message}`)).toEqual([
      `line 1: ${LITERAL('_authtoken')}`,
      'line 2: a key naming _password must hold exactly one ${NAME} reference and nothing else; this one holds a reference plus extra text',
      'line 3: a key naming username must hold exactly one ${NAME} reference and nothing else; this one holds a bare $NAME, which npm does not expand',
      `line 4: ${LITERAL('_auth')}`,
      'line 5: a registry address: a username, a password, a query string',
      `line 7: ${LITERAL('token')}`,
      'line 8: a commented-out key naming _authtoken holds a literal value; delete an old auth line rather than comment it out',
      'line 9: the registry address in this key holds a username, a password',
    ]);
  });

  it('fails settings that load another config file, move the registry, skip prebuild, or weaken TLS (B13r, B13g, L07, X4)', () => {
    const npmrc = [
      NPMRC.trimEnd(),
      'userconfig=config/motion.npmrc',
      'globalconfig=tools/npm/global.cfg',
      'prefix=tools/npm',
      'replace-registry-host=always',
      'ignore-scripts=true',
      'ignore_scripts=true',
      'cafile=certs/ca.pem',
      'ca="-----BEGIN CERTIFICATE-----"',
      'strict-ssl=false',
      'registry=https://npm-mirror.example/',
      '',
    ].join('\n');
    const ANOTHER = 'loads another config file, which this check does not read';
    const TRUST = 'so a token could be read on its way to the registry';
    expect(check(fixture({ '.npmrc': npmrc })).lines).toEqual([
      `.npmrc line 3 NPMRC-AUTH: sets userconfig, which ${ANOTHER}`,
      `.npmrc line 4 NPMRC-AUTH: sets globalconfig, which ${ANOTHER}`,
      '.npmrc line 5 NPMRC-AUTH: sets prefix, which moves the global config file npm loads, which this check does not read',
      '.npmrc line 6 NPMRC-AUTH: sets replace-registry-host, which changes the host npm fetches locked packages from',
      '.npmrc line 7 NPMRC-AUTH: sets ignore-scripts, which skips prebuild, where this check runs before every build',
      '.npmrc line 8 NPMRC-AUTH: sets ignore-scripts, which skips prebuild, where this check runs before every build',
      `.npmrc line 9 NPMRC-AUTH: sets cafile, which trusts another certificate authority, ${TRUST}`,
      `.npmrc line 10 NPMRC-AUTH: sets ca, which trusts another certificate authority, ${TRUST}`,
      `.npmrc line 11 NPMRC-AUTH: turns strict-ssl off, which trusts any certificate, ${TRUST}`,
      '.npmrc line 12 NPMRC-AUTH: the default registry may only be https://registry.npmjs.org/: another would serve every public package, and receive any token set for its host',
    ]);
  });

  it('fails a ${...} reference anywhere but a whole value, since npm expands it in keys and values alike (B1 to B5, B10b, B11)', () => {
    const X = ['$', '{X?}'].join('');
    const [front, back] = [TOKEN.slice(0, 20), TOKEN.slice(20)];
    const auth = base64(`user:${PASS}`);
    const npmrc = [
      `@motionplus:registry=https://${MOTION_HOST}/`,
      `//${MOTION_HOST}/:_a${X}uthToken=${TOKEN}`,
      `//${MOTION_HOST}/:_a${X}uthTo${X}ken=${front}${X}${back}`,
      `//${MOTION_HOST}/:_a${X}uth=${auth.slice(0, 10)}${X}${auth.slice(10)}`,
      `//${MOTION_HOST}/:user${X}name=owner`,
      `//${MOTION_HOST}/:_pass${X}word=${PIECE}`,
      `something=npm${X}_${NPM_TOKEN.slice(4)}`,
      `other=gh${X}${GITHUB_TOKEN.slice(2)}`,
      `https-proxy=ht${X}tps://user:${PASS}@proxy.example:8080/`,
      `key="-----BEGIN ${PRIVATE.slice(0, 3)}${X}${PRIVATE.slice(3)} KEY-----\\n${base64(TOKEN + OTHER)}\\n-----END ${PRIVATE} KEY-----"`,
      '',
    ].join('\n');
    const { result } = check(fixture({ '.npmrc': npmrc }));
    const KEY = 'a key with a ${...} reference in it: npm expands references in keys, so a split one can rebuild an auth key';
    const VALUE = 'a ${...} reference inside a longer value: npm expands it anywhere, so a split one can rebuild a literal; a reference may only stand alone';
    const at = (line: number) => messagesAt(result, 'NPMRC-AUTH', `line ${line}`);
    for (const line of [2, 3, 4, 5, 6]) expect(at(line)).toContain(KEY);
    for (const line of [3, 4, 7, 8, 9]) expect(at(line)).toContain(VALUE);
    expect(at(10)).toEqual(['a key naming key must hold exactly one ${NAME} reference and nothing else; this one holds a reference plus extra text']);
  });

  it('reads comments for old auth lines and tokens, on lines of their own and after a value (B6, B7, B7b)', () => {
    const npmrc = [
      `# //${MOTION_HOST}/:_authToken=${TOKEN}`,
      `# //${MOTION_HOST}/:_authToken=${REFERENCE}`,
      `@motionplus:registry=https://${MOTION_HOST}/ ; old ${TOKEN}`,
      `//${MOTION_HOST}/:_authToken=${REFERENCE} ; //${MOTION_HOST}/:_authToken=${LETTERS}`,
      `//${MOTION_HOST}/:always-auth=true # an honest comment`,
      `//${MOTION_HOST}/:_authToken ; a comment = ${REFERENCE}`,
      '',
    ].join('\n');
    expect(check(fixture({ '.npmrc': npmrc })).lines).toEqual([
      `.npmrc line 1 TOKEN-SHAPE: ${LOOKS_LIKE_A_TOKEN}`,
      `.npmrc line 3 TOKEN-SHAPE: ${LOOKS_LIKE_A_TOKEN}`,
      '.npmrc line 4 NPMRC-AUTH: a commented-out key naming _authtoken holds a literal value; delete an old auth line rather than comment it out',
      '.npmrc line 6 NPMRC-AUTH: a ; or # inside a key: npm cuts the key there, so text can hide in it; put comments on lines of their own',
      '.npmrc line 1 NPMRC-AUTH: a commented-out key naming _authtoken holds a literal value; delete an old auth line rather than comment it out',
    ]);
  });

  it('fails an auth setting for a host no "@scope:registry" line names, or for no host (E5)', () => {
    const npmrc = [
      `@motionplus:registry=https://${MOTION_HOST}/`,
      `//npm-mirror.example/:_authToken=${REFERENCE}`,
      `_authToken=${REFERENCE}`,
      `//registry.npmjs.org/:_authToken=${REFERENCE}`,
      '',
    ].join('\n');
    const ELSEWHERE = 'a key naming _authtoken for a host no "@scope:registry" line names; npm would send the value there';
    expect(check(fixture({ '.npmrc': npmrc })).lines).toEqual([
      `.npmrc line 2 NPMRC-AUTH: ${ELSEWHERE}`,
      '.npmrc line 3 NPMRC-AUTH: a key naming _authtoken must start with the registry it is for (//host/path/:...), so npm sends the value nowhere else',
      `.npmrc line 4 NPMRC-AUTH: ${ELSEWHERE}`,
    ]);
  });

  it('treats key, cert, certfile, and keyfile as credentials, and any private key header as one (B9, B10, B10c)', () => {
    const material = base64(TOKEN + OTHER);
    const npmrc = [
      NPMRC.trimEnd(),
      `//${MOTION_HOST}/:certfile=certs/motion-client.crt`,
      `//${MOTION_HOST}/:keyfile=certs/motion-client.key`,
      `key="-----BEGIN RSA ${PRIVATE} KEY-----\\nProc-Type: 4,ENCRYPTED\\nDEK-Info: AES-128-CBC,0123456789ABCDEF\\n\\n${material}\\n-----END RSA ${PRIVATE} KEY-----"`,
      `cert="-----BEGIN ${PRIVATE} KEY----- \\n${material}\\n-----END ${PRIVATE} KEY-----"`,
      '',
    ].join('\n');
    const { result } = check(fixture({ '.npmrc': npmrc }));
    expect(result.findings.filter((f) => f.rule === 'NPMRC-AUTH').map((f) => `${f.where}: ${f.message}`)).toEqual([
      `line 3: ${LITERAL('certfile')}`,
      `line 4: ${LITERAL('keyfile')}`,
      `line 5: ${LITERAL('key')}`,
      `line 6: ${LITERAL('cert')}`,
    ]);
    for (const line of [5, 6]) expect(messagesAt(result, 'TOKEN-SHAPE', `line ${line}`)).toContain('text with the shape of a private key');
  });

  it('fails a token in a registry host, a registry path, or the path of an auth key (B8, B20, B8b)', () => {
    const cases = [
      { npmrc: `@motionplus:registry=https://${MOTION_HOST}/${TOKEN}/\n//${MOTION_HOST}/:_authToken=${REFERENCE}\n`, line: 1 },
      { npmrc: `@motionplus:registry=https://${LOWER}.motion.example/\n`, line: 1 },
      { npmrc: `@motionplus:registry=https://${MOTION_HOST}/\n//${MOTION_HOST}/${TOKEN}/:_authToken=${REFERENCE}\n`, line: 2 },
    ];
    for (const { npmrc, line } of cases) expect(check(fixture({ '.npmrc': npmrc })).lines).toContain(`.npmrc line ${line} TOKEN-SHAPE: ${LOOKS_LIKE_A_TOKEN}`);
  });

  it('never prints a token pasted as a variable name or into a key without a registry', () => {
    const refName = check(fixture({ '.npmrc': `@motionplus:registry=https://${MOTION_HOST}/\n//${MOTION_HOST}/:_authToken=\${${TOKEN}}\n` }));
    expect(refName.lines).toEqual([
      `.npmrc line 2 TOKEN-VALUE: this auth line reads a variable whose name is not shown, ${NOT_SET}`,
      `.npmrc line 2 TOKEN-SHAPE: ${LOOKS_LIKE_A_TOKEN}`,
    ]);
    const NO_REGISTRY = '.npmrc line 2 NPMRC-AUTH: a key naming _authtoken must start with the registry it is for (//host/path/:...), so npm sends the value nowhere else';
    expect(check(fixture({ '.npmrc': `${NPMRC.split('\n')[0]}\n${TOKEN}_authToken=${REFERENCE}\n` })).lines).toContain(NO_REGISTRY);
    // Lower-case letters only: nothing looks like a token, so only the value search knows it is one.
    expect(check(fixture({ '.npmrc': `${NPMRC.split('\n')[0]}\n${LETTERS}_authToken=${REFERENCE}\n` }), { MOTION_TOKEN: LETTERS }).lines).toEqual([
      NO_REGISTRY,
      `.npmrc (file) TOKEN-VALUE: ${IN_THIS_FILE('MOTION_TOKEN')}`,
    ]);
  });

  it.skipIf(!hasGit)(
    'checks every .npmrc git tracks, copies under other names and the file a userconfig line names included (B12, B13, B13r, X3)',
    () => {
      const literal = `//${MOTION_HOST}/:_authToken=${PIECE}\n`;
      const root = repository({
        '.npmrc': `${NPMRC}userconfig=config/motion.npmrc\n`,
        '.npmrc.bak': literal,
        '.npmrc.ci': literal,
        'config/ci.npmrc': literal,
        'config/motion.npmrc': literal,
        'packages/b/.npmrc': NPMRC,
        'package.json': json({ name: 'fixture' }),
      });
      expect(check(root).lines).toEqual([
        '.npmrc line 3 NPMRC-AUTH: sets userconfig, which loads another config file, which this check does not read',
        `.npmrc.bak line 1 NPMRC-AUTH: ${LITERAL('_authtoken')}`,
        `.npmrc.ci line 1 NPMRC-AUTH: ${LITERAL('_authtoken')}`,
        `config/ci.npmrc line 1 NPMRC-AUTH: ${LITERAL('_authtoken')}`,
        `config/motion.npmrc line 1 NPMRC-AUTH: ${LITERAL('_authtoken')}`,
      ]);
    },
    SLOW,
  );

  it('outside git, checks every .npmrc below the folder, dot folders included (B14)', () => {
    const root = fixture({ '.npmrc': NPMRC, '.github/.npmrc': `//${MOTION_HOST}/:_authToken=${PIECE}\n` });
    expect(check(root).lines).toEqual([`.github/.npmrc line 1 NPMRC-AUTH: ${LITERAL('_authtoken')}`]);
  });

  it('fails an .npmrc with NUL bytes, as in UTF-16 without its byte-order mark (B17, N07, N09)', () => {
    const NUL = '.npmrc (file) NPMRC-AUTH: NUL bytes, as in UTF-16 text without its byte-order mark: npm cannot read this file, and this check cannot read it line by line';
    for (const text of [`//${MOTION_HOST}/:_authToken=${NPM_TOKEN}\n`, `# ${TOKEN}\n`]) {
      expect(check(fixture({ '.npmrc': Buffer.from(text, 'utf16le') }), { MOTION_TOKEN: TOKEN }).lines).toContain(NUL);
    }
  });
});

describe('TOKEN-SHAPE', () => {
  it('fails an npm token, a JSON Web Token, or a GitHub token anywhere in the files, and passes the clean twin', () => {
    const files = (leak: boolean) => ({
      'package.json': json({ name: 'fixture', description: leak ? `see ${JWT}` : 'a fixture' }),
      'package-lock.json': lockV3({ 'node_modules/paid': { ...fromNpm('paid', '1.0.0'), funding: { url: `https://pay.example/${leak ? NPM_TOKEN : ''}` } } }),
      '.npmrc': `${NPMRC}# ${leak ? GITHUB_TOKEN : 'no token here'}\n`,
    });
    const leaky = files(true);
    const { result, rules } = check(fixture(leaky));
    expect(rules).toEqual(['TOKEN-SHAPE']);
    expect(result.findings.map((f) => `${f.file} ${f.where} ${f.message}`)).toEqual([
      'package.json description (line 3) a string with the shape of a JSON Web Token',
      `package-lock.json packages["node_modules/paid"].funding.url (line ${lineOf(leaky['package-lock.json'], NPM_TOKEN)}) a string with the shape of an npm token`,
      '.npmrc line 3 text with the shape of a GitHub token',
    ]);
    expect(check(fixture(files(false))).result.findings).toEqual([]);
  });

  it('fails a UUID or a GitHub token glued to other text in an .npmrc, and a JSON Web Token right after another dotted run (B16, B16b)', () => {
    const root = fixture({
      '.npmrc': `${NPMRC}# publish token ${UUID}\n# oldtoken_${GITHUB_TOKEN}\n`,
      'package.json': json({ name: 'fixture', description: `${'a'.repeat(13)}.${JWT}` }),
    });
    expect(check(root).lines).toEqual([
      'package.json description (line 3) TOKEN-SHAPE: a string with the shape of a JSON Web Token',
      `.npmrc line 3 TOKEN-SHAPE: ${LOOKS_LIKE_A_TOKEN}`,
      '.npmrc line 4 TOKEN-SHAPE: text with the shape of a GitHub token',
    ]);
  });
});

describe('TOKEN-VALUE', () => {
  const leakyLock = (text: string) => lockV3({ 'node_modules/x': { ...fromNpm('x', '1.0.0'), license: text } });
  const valueIn = (root: string, env: Env) => check(root, env).result.findings.filter((f) => f.rule === 'TOKEN-VALUE').map((f) => `${f.file} ${f.message}`);

  it('finds a secret value as written, URL-encoded (any case), escaped in JSON, or in base64, and names only the variable', () => {
    const encoded = encodeURIComponent(SECRET).replace(/%2F/g, '%2f');
    const escapedFirst = ['\\u00', SECRET.charCodeAt(0).toString(16), SECRET.slice(1)].join('');
    const root = fixture({
      'package.json': `{ "name": "fixture", "description": "${escapedFirst}" }\n`,
      'package-lock.json': lockV3({ 'node_modules/paid': { ...fromNpm('paid', '1.0.0'), funding: { url: `https://pay.example/?k=${encoded}` } } }),
      'npm-shrinkwrap.json': lockV3(),
      '.npmrc': `${NPMRC}# old: _auth=${base64(`user:${SECRET}`)}\n`,
    });
    expect(valueIn(root, { MOTION_TOKEN: SECRET })).toEqual([
      `package.json ${IN_THIS_FILE('MOTION_TOKEN')}`,
      `package-lock.json ${IN_THIS_FILE('MOTION_TOKEN')}`,
      `.npmrc ${IN_THIS_FILE('MOTION_TOKEN')}`,
    ]);
    expect(check(fixture({ 'package-lock.json': lockV3(), '.npmrc': NPMRC }), { MOTION_TOKEN: SECRET }).result.findings).toEqual([]);
  });

  it(
    'reads the value from .env.local through the command, and prints the variable name only',
    () => {
      const files = (leak: boolean) => ({ '.env.local': `MOTION_TOKEN="${SECRET}"\n`, '.npmrc': NPMRC, 'package-lock.json': leak ? leakyLock(SECRET) : lockV3() });
      const leaked = cli(['--root', fixture(files(true))]);
      expect(leaked.status).toBe(1);
      expect(leaked.output).toContain(`ERROR   package-lock.json  (file)  TOKEN-VALUE  ${IN_THIS_FILE('MOTION_TOKEN')}`);
      expect(leaked.output).toMatch(/1 secret variable set here: 1 error$/m);
      expect(cli(['--root', fixture(files(false))]).status).toBe(0);
    },
    SLOW,
  );

  it('reads a value from .env.local as dotenv does, an inline comment cut off (E02, E03, E09)', () => {
    for (const line of [`MOTION_TOKEN=${TOKEN} # motion plus`, `MOTION_TOKEN="${TOKEN}" # motion plus`, `MOTION_TOKEN=${TOKEN}\t# motion plus`]) {
      const root = fixture({ '.env.local': `${line}\n`, '.npmrc': NPMRC, 'package-lock.json': leakyLock(TOKEN) });
      expect(valueIn(root, scanEnvironment(root, {}))).toEqual([`package-lock.json ${IN_THIS_FILE('MOTION_TOKEN')}`]);
    }
  });

  it('searches for every variable an auth line reads, and fails when one is not set (U1)', () => {
    const npmrc = `@motionplus:registry=https://${MOTION_HOST}/\n//${MOTION_HOST}/:_authToken=${['$', '{MOTIONPLUS_KEY}'].join('')}\n`;
    expect(valueIn(fixture({ '.npmrc': npmrc, 'package-lock.json': leakyLock(TOKEN) }), { MOTION_TOKEN: OTHER, MOTIONPLUS_KEY: TOKEN })).toEqual([
      `package-lock.json ${IN_THIS_FILE('MOTIONPLUS_KEY')}`,
    ]);
    expect(check(fixture({ '.npmrc': npmrc, 'package-lock.json': lockV3() })).lines).toEqual([`.npmrc line 2 TOKEN-VALUE: this auth line reads MOTIONPLUS_KEY, ${NOT_SET}`]);
  });

  it('finds the value encoded in ways npm never writes (V09 to V11, V15 to V17, V20 to V22, V30)', () => {
    const forms: Record<string, string> = {
      'percent after an invalid escape': `%FF${percent(TOKEN)}`,
      'percent before a cut sequence': `${percent(TOKEN)}%C3`,
      'percent twice': encodeURIComponent(percent(TOKEN)),
      base64: base64(TOKEN),
      'base64 of user:value': base64(`user:${TOKEN}`),
      base64url: Buffer.from(TOKEN).toString('base64url'),
      hex: Buffer.from(TOKEN).toString('hex'),
      'lower case': TOKEN.toLowerCase(),
      'a zero-width space inside': `${TOKEN.slice(0, 20)}${String.fromCharCode(0x200b)}${TOKEN.slice(20)}`,
    };
    for (const [form, text] of Object.entries(forms)) {
      expect(valueIn(fixture({ '.npmrc': NPMRC, 'package-lock.json': leakyLock(text) }), { MOTION_TOKEN: TOKEN }), form).toEqual([
        `package-lock.json ${IN_THIS_FILE('MOTION_TOKEN')}`,
      ]);
    }
    const plus = `${TOKEN.slice(0, 20)}+${TOKEN.slice(20)}`;
    SYNTHETIC.push(plus);
    expect(valueIn(fixture({ '.npmrc': NPMRC, 'package-lock.json': leakyLock(plus.replace('+', ' ')) }), { MOTION_TOKEN: plus })).toEqual([
      `package-lock.json ${IN_THIS_FILE('MOTION_TOKEN')}`,
    ]);
  });

  it('finds the value split in two, or in base64 at any alignment or over two lines (V18, V19, N03 to N05, N10)', () => {
    const [front, back] = [TOKEN.slice(0, 20), TOKEN.slice(20)];
    const encoded = base64(TOKEN);
    const lockfiles = [
      lockV3({ 'node_modules/x': { ...fromNpm('x', '1.0.0'), license: front, description: back } }),
      lockV3({ 'node_modules/x': { ...fromNpm('x', '1.0.0'), [front]: back } }),
    ];
    for (const lock of lockfiles) expect(valueIn(fixture({ '.npmrc': NPMRC, 'package-lock.json': lock }), { MOTION_TOKEN: TOKEN })).toEqual([`package-lock.json ${IN_THIS_FILE('MOTION_TOKEN')}`]);
    const comments = [
      `# ${base64(`xy${TOKEN}`)}\n`,
      `# ${Buffer.from(`?${TOKEN}`).toString('base64url')}\n`,
      `# ${encoded.slice(0, 28)}\n# ${encoded.slice(28)}\n`,
      `# ${front}\n# ${back}\n`,
    ];
    for (const comment of comments) expect(valueIn(fixture({ '.npmrc': `${NPMRC}${comment}` }), { MOTION_TOKEN: TOKEN })).toEqual([`.npmrc ${IN_THIS_FILE('MOTION_TOKEN')}`]);
  });

  it.skipIf(!hasGit)(
    'searches every file git tracks, on disk and staged (V35, V36)',
    () => {
      const root = repository({
        'package.json': json({ name: 'fixture', workspaces: ['packages/*'] }),
        'packages/a/package.json': json({ name: 'a', description: TOKEN }),
        '.yarnrc.yml': `npmAuthToken: "${TOKEN}"\n`,
        'docs/notes.md': `the token is ${TOKEN}\n`,
        'clean.txt': 'nothing here\n',
      });
      fs.writeFileSync(path.join(root, 'staged.txt'), `value ${TOKEN}\n`);
      git(root, ['add', 'staged.txt']);
      fs.writeFileSync(path.join(root, 'staged.txt'), 'cleaned on disk only\n');
      const { lines, result } = check(root, { MOTION_TOKEN: TOKEN });
      expect(lines).toEqual([
        `.yarnrc.yml (file) TOKEN-VALUE: ${IN_THIS_FILE('MOTION_TOKEN')}`,
        `docs/notes.md (file) TOKEN-VALUE: ${IN_THIS_FILE('MOTION_TOKEN')}`,
        `packages/a/package.json (file) TOKEN-VALUE: ${IN_THIS_FILE('MOTION_TOKEN')}`,
        `staged.txt (staged) (file) TOKEN-VALUE: ${IN_THIS_FILE('MOTION_TOKEN')}`,
      ]);
      expect(result.stats.searched).toBe(5);
    },
    SLOW,
  );
});

describe('MOTIONPLUS-SOURCE', () => {
  it.skipIf(!hasGit)(
    'fails when git tracks node_modules or Motion+ source, and passes when they are only on disk',
    () => {
      const files = { 'package.json': PACKAGE, 'node_modules/@motionplus/core/index.js': 'export {};\n', 'lib/motion-plus/index.js': 'export {};\n' };
      const tracked = repository(files);
      expect(check(tracked).result.findings.map((f) => `${f.rule} ${f.file}`)).toEqual(['MOTIONPLUS-SOURCE lib/motion-plus/', 'MOTIONPLUS-SOURCE node_modules/']);
      const untracked = fixture(files);
      git(untracked, ['init', '-q']);
      git(untracked, ['add', 'package.json']);
      expect(check(untracked).result.findings).toEqual([]);
    },
    SLOW,
  );

  it.skipIf(!hasGit)(
    'fails a package archive, a package.json naming Motion+, a local Motion+ source, and Motion+ under any folder spelling (M01, M02)',
    () => {
      const root = repository({
        'package.json': json({ name: 'fixture', dependencies: { 'motion-plus': 'file:vendor/motionplus-core-2.0.0.tgz' } }),
        'package-lock.json': lockV3({ 'node_modules/motion-plus': { name: '@motionplus/core', version: '2.0.0', resolved: 'file:vendor/motionplus-core-2.0.0.tgz' } }),
        'vendor/motionplus-core-2.0.0.tgz': Buffer.from([0x1f, 0x8b, 8, 0]),
        'vendor/motionplus/package.json': json({ name: '@motionplus/core', version: '2.0.0' }),
        'vendor/motionplus/index.js': 'export {};\n',
        'lib/motion_plus/index.js': 'export {};\n',
      });
      expect(check(root).lines.map((line) => line.replace(/ \(line \d+\)/, '')).sort()).toEqual([
        'lib/motion_plus/ (tracked) MOTIONPLUS-SOURCE: git tracks 1 file here that are not the site\'s own TypeScript or CSS; a folder named after Motion+ may hold only the site\'s own code, never Motion+ source',
        'package-lock.json packages["node_modules/motion-plus"].resolved LOCK-SOURCE: "resolved" holds a local source for Motion+, which may only come from its registry',
        'package.json dependencies["motion-plus"] PKG-SPEC: the spec holds a source for Motion+ other than its registry',
        'vendor/motionplus-core-2.0.0.tgz (tracked) MOTIONPLUS-SOURCE: a package archive, which can hold a package\'s source, Motion+ included; no archive may be committed',
        'vendor/motionplus/ (tracked) MOTIONPLUS-SOURCE: git tracks 2 files here that are not the site\'s own TypeScript or CSS; a folder named after Motion+ may hold only the site\'s own code, never Motion+ source',
        'vendor/motionplus/package.json (tracked) MOTIONPLUS-SOURCE: a package.json that names a Motion+ package, so Motion+ source is here',
      ]);
    },
    SLOW,
  );

  it.skipIf(!hasGit)(
    "passes the site's own TypeScript and CSS in a folder named after Motion+, such as a test stub (M04, M05)",
    () => {
      const root = repository({
        'package.json': json({ name: 'fixture' }),
        'components/motion-plus/LensCursor.tsx': 'export {};\n',
        'tests/stubs/motion-plus/react.tsx': 'export {};\n',
        'styles/motion-plus/lens.css': '.lens {}\n',
      });
      expect(check(root).result.findings).toEqual([]);
    },
    SLOW,
  );

  it.skipIf(!hasGit || !gitHidden)(
    'fails, rather than skips, in a repository where git cannot run (E3)',
    () => {
      const root = repository({ 'package.json': json({ name: 'fixture' }), 'node_modules/@motionplus/core/index.js': 'export {};\n' });
      const run = cli(['--root', root], {}, nodeOnly);
      expect(run.status).toBe(1);
      expect(run.output).toContain('ERROR   (repository)  (git)  MOTIONPLUS-SOURCE  this folder is in a git repository, but git could not run');
      expect(run.output).not.toContain('NOTE    MOTIONPLUS-SOURCE skipped');
    },
    SLOW,
  );

  it.skipIf(!hasGit)(
    "checks the folder's own repository even when a hook's GIT_DIR names another",
    () => {
      const other = repository({ 'package.json': PACKAGE });
      const root = repository({ 'package.json': json({ name: 'fixture' }), 'node_modules/left-pad/index.js': 'export {};\n' });
      const run = cli(['--root', root], { GIT_DIR: path.join(other, '.git') });
      expect(run.status).toBe(1);
      expect(run.output).toContain('ERROR   node_modules/  (tracked)  MOTIONPLUS-SOURCE');
    },
    SLOW,
  );

  it.skipIf(!hasGit)(
    'never prints a tracked folder name that could hold a secret (O4b, O4c)',
    () => {
      const root = repository({
        'package.json': json({ name: 'fixture' }),
        [`${LOWER}/node_modules/x.js`]: 'x\n',
        [`${percent(TOKEN.slice(0, 16))}/node_modules/y.js`]: 'y\n',
      });
      const { result } = check(root, { MOTION_TOKEN: TOKEN });
      expect(result.findings.map((f) => `${f.rule} ${f.file}`)).toEqual(['MOTIONPLUS-SOURCE (a name not shown)/node_modules/']);
    },
    SLOW,
  );

  it('is skipped with a note outside a git work tree', () => {
    const root = fixture({ 'package.json': PACKAGE });
    const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' }).stdout?.trim() === 'true';
    const { output } = check(root);
    if (!inside) expect(output).toContain('NOTE    MOTIONPLUS-SOURCE skipped');
    expect(output).toMatch(/: 0 errors$/);
  });

  it.skipIf(!hasGit)(
    'notes an installed pre-commit hook that does not run this check though package.json asks it to',
    () => {
      const root = repository({ 'package.json': json({ name: 'fixture', 'simple-git-hooks': { 'pre-commit': 'npm run check:lockfile' } }) });
      git(root, ['config', 'core.hooksPath', '.githooks']);
      const STALE = 'the installed pre-commit hook does not run check:lockfile, though package.json asks for it; run "npx simple-git-hooks" in this clone, then commit';
      expect(check(root).result.notes).toEqual([STALE]);
      fs.mkdirSync(path.join(root, '.githooks'));
      fs.writeFileSync(path.join(root, '.githooks', 'pre-commit'), '#!/bin/sh\nnpm run check:lockfile\n');
      expect(check(root).result.notes).toEqual([]);
    },
    SLOW,
  );
});

describe('staged copies', () => {
  it.skipIf(!hasGit)(
    'fail a token that is staged but no longer on disk',
    () => {
      const root = repository({ '.npmrc': NPMRC, 'package-lock.json': lockV3({ 'node_modules/x': { ...fromNpm('x', '1.0.0'), license: NPM_TOKEN } }) });
      fs.writeFileSync(path.join(root, 'package-lock.json'), lockV3());
      expect(check(root).result.findings.map((f) => `${f.file} ${f.rule}`)).toEqual(['package-lock.json (staged) TOKEN-SHAPE']);
      git(root, ['add', '.']);
      expect(check(root).result.findings).toEqual([]);
    },
    SLOW,
  );

  it.skipIf(!hasGit)(
    'read a tracked .npmrc whose name cannot be opened on disk by its blob id (B15a)',
    () => {
      const root = repository({ '.npmrc': NPMRC });
      const blob = git(root, ['hash-object', '-w', '--stdin'], `//${MOTION_HOST}/:_authToken=${PIECE}\n`);
      git(root, ['update-index', '--add', '--index-info'], Buffer.concat([Buffer.from(`100644 ${blob}\t`), Buffer.from([0x66, 0xff, 0x6f]), Buffer.from('/.npmrc\n')]));
      const { result } = check(root);
      expect(result.findings.map((f) => `${f.file.endsWith('/.npmrc (staged)')} ${f.where} ${f.rule}: ${f.message}`)).toEqual([`true line 1 NPMRC-AUTH: ${LITERAL('_authtoken')}`]);
    },
    SLOW,
  );
});

describe('files built to slip past a check', () => {
  it('fail when nested too deeply to read, written in UTF-16, or carrying a second "packages" map', () => {
    const deep = check(fixture({ 'package-lock.json': `${'['.repeat(2000)}${']'.repeat(2000)}` }));
    expect(deep.result.findings.map((f) => `${f.rule} ${f.where}`)).toEqual(['LOCK-SOURCE (file)']);
    expect(deep.result.findings[0].message).toContain('nested more than 1000 levels deep');

    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`//${MOTION_HOST}/:_authToken=${NPM_TOKEN}\n`, 'utf16le')]);
    expect(check(fixture({ '.npmrc': utf16 })).rules).toEqual(['NPMRC-AUTH', 'TOKEN-SHAPE']);

    const second = '{"lockfileVersion": 3, "packages": {"node_modules/b": {"resolved": "https://evil.example/b.tgz"}}, "packages": {}}';
    expect(check(fixture({ 'package-lock.json': second })).result.findings.map((f) => f.where)).toEqual(['packages["node_modules/b"].resolved (line 1)']);
  });

  it(
    'fail a string or line over 64 KB, and read it in time that grows with its length, not its square (D1 to D6)',
    () => {
      const started = performance.now();
      const lock = check(
        fixture({
          '.npmrc': NPMRC,
          'package-lock.json': lockV3({ 'node_modules/x': { ...fromNpm('x', '1.0.0'), license: 'eyJ'.repeat(100_000), description: 'a-'.repeat(150_000), author: 'a'.repeat(300_000) } }),
        }),
      );
      expect(lock.result.findings.map((f) => `${f.rule} ${f.where.replace(/ \(line \d+\)$/, '')}: ${f.message}`)).toEqual([
        'LOCK-SOURCE packages["node_modules/x"].license: a string longer than 64 KB, which no npm file needs',
        'LOCK-SOURCE packages["node_modules/x"].description: a string longer than 64 KB, which no npm file needs',
        'LOCK-SOURCE packages["node_modules/x"].author: a string longer than 64 KB, which no npm file needs',
      ]);
      const npmrc = check(fixture({ '.npmrc': `${NPMRC}# ${'eyJ'.repeat(100_000)}\n` }));
      expect(npmrc.lines).toContain('.npmrc line 3 NPMRC-AUTH: a line longer than 64 KB, which no .npmrc needs');
      expect(performance.now() - started).toBeLessThan(15_000);
    },
    SLOW,
  );
});

describe('the report', () => {
  it(
    'prints the file, the JSON path and line, the rule, and a summary, and exits 1 on an error',
    () => {
      const root = fixture({ 'package-lock.json': lockV3({ 'node_modules/d': { ...fromNpm('d', '1.0.0'), resolved: 'http://registry.npmjs.org/d/-/d-1.0.0.tgz' } }), '.npmrc': NPMRC });
      const run = cli(['--root', root], ENV);
      expect(run.status).toBe(1);
      expect(run.output).toMatch(/^ERROR {3}package-lock\.json {2}packages\["node_modules\/d"\]\.resolved \(line \d+\) {2}LOCK-SOURCE {2}"resolved" address: not https \(http\)$/m);
      expect(run.output).toMatch(/^check:lockfile: package-lock\.json, \d+ lockfile entries, 1 \.npmrc file, .*: 1 error$/m);
    },
    SLOW,
  );

  it(
    'refuses an argument it does not know',
    () => {
      const run = cli(['--rot', REPO]);
      expect(run.status).toBe(1);
      expect(run.output).toContain('Usage:');
    },
    SLOW,
  );
});
