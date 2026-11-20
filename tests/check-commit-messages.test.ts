/**
 * The commit-message check CI runs (scripts/check-commit-messages.mjs; docs/V3_PLAN.md D-78): it
 * reads every message of a range whole, finds an em dash or an en dash anywhere in one, and names
 * the commit by its id without printing the message.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DASHES, LOG_FORMAT, commitsWithDashes, messageText, parseLog } from '../scripts/check-commit-messages.mjs';

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'check-commit-messages.mjs');
const EN = String.fromCharCode(0x2013);
const EM = String.fromCharCode(0x2014);

/** This process's environment without git's own variables or the Actions flag, so nothing points git elsewhere. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_') || name === 'GITHUB_ACTIONS') delete env[name];
  return env;
}

describe('reading the log', () => {
  it('takes each commit whole: its id and every line of its message', () => {
    const log = `${'a'.repeat(40)}\x00First line\n\nBody line one.\nBody line two.\n\x1e\n${'b'.repeat(40)}\x00Second\n\x1e\n`;
    expect(parseLog(log)).toEqual([
      { sha: 'a'.repeat(40), message: 'First line\n\nBody line one.\nBody line two.\n' },
      { sha: 'b'.repeat(40), message: 'Second\n' },
    ]);
    expect(parseLog('')).toEqual([]);
    expect(LOG_FORMAT).toBe('%H%x00%B%x1e');
  });

  it('finds an en dash or an em dash anywhere in a message, and nothing else', () => {
    const commits = [
      { sha: '1', message: 'Plain subject\n\nPlain body, with a hyphen-minus and a colon: fine.\n' },
      { sha: '2', message: `Subject ${EN} with an en dash\n` },
      { sha: '3', message: `Subject\n\nA body ${EM} with an em dash.\n` },
    ];
    expect(commitsWithDashes(commits)).toEqual(['2', '3']);
    expect(DASHES.test('a - b, c: d (e)')).toBe(false);
  });
});

// These run git and node many times over, which a busy machine slows well past the default 5 s.
describe('the check, run on a repository', { timeout: 30_000 }, () => {
  let tmp = '';

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  });

  /** A new repository with one empty commit per message; returns their ids, oldest first. */
  function repository(messages: string[]): string[] {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-messages-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', `core.hooksPath=${path.join(tmp, 'no-hooks')}`, '-c', 'commit.gpgsign=false', ...args], {
        cwd: tmp,
        env: cleanEnv(),
        encoding: 'utf8',
      }).trim();
    git('init', '-q');
    const ids: string[] = [];
    messages.forEach((message, index) => {
      const file = path.join(tmp, `message-${index}.txt`);
      fs.writeFileSync(file, message, 'utf8');
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-F', file);
      ids.push(git('rev-parse', 'HEAD'));
    });
    return ids;
  }

  function check(range: string) {
    return spawnSync(process.execPath, [script, range], {
      env: { ...cleanEnv(), GIT_DIR: path.join(tmp, '.git') },
      encoding: 'utf8',
    });
  }

  it('passes a range whose messages hold no dash', () => {
    const [first, second] = repository(['First commit\n', 'Second commit, with a body\n\nAnd a plain body.\n']);
    const result = check(`${first}..${second}`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 commit message in');
  });

  it('fails a range with a dash in any message, naming the commit by its id and never printing the message', () => {
    const marker = 'Unprinted marker vexillum';
    const ids = repository(['Base commit\n', `${marker} ${EM} subject\n`, 'Clean subject\n', `Clean subject\n\n${marker} body ${EN} line.\n`]);
    const result = check(`${ids[0]}..${ids[3]}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('2 of 3 commit messages');
    expect(result.stderr).toContain(ids[1]);
    expect(result.stderr).toContain(ids[3]);
    expect(result.stderr).not.toContain(ids[2]);
    expect(result.stderr + result.stdout).not.toContain(marker);
    expect(result.stderr + result.stdout).not.toMatch(DASHES);
  });

  it('reads only the range it is given, so history before it does not count', () => {
    const ids = repository([`Old ${EM} message from before the rule\n`, 'New commit\n']);
    expect(check(`${ids[0]}..${ids[1]}`).status).toBe(0);
    expect(check(`${ids[1]}^!`).status).toBe(0);
    expect(check(ids[1]).status).toBe(1);
  });

  it('stops with status 2 when there is no range or git cannot read it', () => {
    repository(['Only commit\n']);
    expect(check('').status).toBe(2);
    expect(check('--all').status).toBe(2);
    const result = check('no-such-branch..HEAD');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('git could not read');
  });
});

describe('the check, as a commit-msg hook', { timeout: 30_000 }, () => {
  let tmp = '';

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  });

  function hook(message: string | null) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-'));
    const file = path.join(tmp, 'COMMIT_EDITMSG');
    if (message !== null) fs.writeFileSync(file, message, 'utf8');
    return spawnSync(process.execPath, [script, '--message-file', file], { env: cleanEnv(), encoding: 'utf8' });
  }

  it('leaves out git\'s comment lines, as git does', () => {
    expect(messageText(`Subject\n\nBody.\n# Comment ${EM} from git\n#\n`)).toBe('Subject\n\nBody.\n');
  });

  it('passes a clean message, fails one with a dash, and ignores a dash in git\'s comments', () => {
    expect(hook('A clean subject\n\nA clean body: with a colon.\n').status).toBe(0);
    const faulty = hook(`A subject ${EN} with an en dash\n`);
    expect(faulty.status).toBe(1);
    expect(faulty.stderr).toContain('D-78');
    expect(hook(`A clean subject\n# Lines starting ${EM} with # are left out\n`).status).toBe(0);
  });

  it('stops with status 2 when it has no file to read', () => {
    expect(hook(null).status).toBe(2);
    expect(spawnSync(process.execPath, [script, '--message-file'], { env: cleanEnv(), encoding: 'utf8' }).status).toBe(2);
  });
});
