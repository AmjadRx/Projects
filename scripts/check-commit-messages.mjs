#!/usr/bin/env node
/**
 * No em dash or en dash in a commit message (docs/V3_PLAN.md D-78; ARCHITECTURE.md 0). The content
 * check covers every tracked file; this covers the commit messages, which no file holds. CI runs it on
 * the commits a push to v3 or a pull request would bring to main (.github/workflows/ci.yml).
 *
 * Usage: node scripts/check-commit-messages.mjs <revision range>
 *        node scripts/check-commit-messages.mjs --message-file <file>
 * The first form prints the ids of the commits at fault and never their messages. The second reads
 * one message, as git hands it to a commit-msg hook (lines that start with # are git's comments and
 * are left out, as git leaves them out), so the hook D-78 also asks for is one line in package.json's
 * simple-git-hooks: "commit-msg": "node scripts/check-commit-messages.mjs --message-file $1".
 * It exits 1 when a message holds a dash, and 2 when it cannot read the range or the file.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The two characters D-78 bans, U+2013 and U+2014, written as scripts/check-content.mjs writes them. */
export const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

/** The `git log` format read here: each commit's id, a NUL, its whole message, a record separator. */
export const LOG_FORMAT = '%H%x00%B%x1e';

/** The commits of `git log --format=LOG_FORMAT` output, as { sha, message }, in the log's order. */
export function parseLog(text) {
  return text
    .split('\x1e')
    .map((record) => record.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((record) => {
      const at = record.indexOf('\x00');
      return { sha: record.slice(0, at), message: record.slice(at + 1) };
    });
}

/** The ids of the commits whose messages hold a dash. */
export function commitsWithDashes(commits) {
  return commits.filter((commit) => DASHES.test(commit.message)).map((commit) => commit.sha);
}

/** A message as a commit-msg hook gets it, without git's comment lines (those that start with #). */
export function messageText(file) {
  return file
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('#'))
    .join('\n');
}

function checkMessageFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    console.error(`check-commit-messages: cannot read ${file}.`);
    process.exit(2);
  }
  if (DASHES.test(messageText(text))) {
    console.error('The commit message holds an em dash or an en dash (docs/V3_PLAN.md D-78). Use a comma, a colon, parentheses, or "to".');
    process.exit(1);
  }
}

function main() {
  if (process.argv[2] === '--message-file') {
    if (!process.argv[3]) {
      console.error('Usage: node scripts/check-commit-messages.mjs --message-file <file>');
      process.exit(2);
    }
    checkMessageFile(process.argv[3]);
    return;
  }
  const range = process.argv[2] ?? '';
  if (range === '' || range.startsWith('-')) {
    console.error('Usage: node scripts/check-commit-messages.mjs <revision range> | --message-file <file>');
    process.exit(2);
  }
  // A GitHub Actions annotation, so the failure shows on the run's page.
  const error = process.env.GITHUB_ACTIONS === 'true' ? '::error::' : '';
  let log;
  try {
    log = execFileSync('git', ['log', `--format=${LOG_FORMAT}`, '--end-of-options', range], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    console.error(`${error}check-commit-messages: git could not read the commits in ${range}.`);
    process.exit(2);
  }
  const commits = parseLog(log);
  const faults = commitsWithDashes(commits);
  if (faults.length) {
    console.error(
      `${error}${faults.length} of ${commits.length} commit messages in ${range} hold an em dash or an en dash (docs/V3_PLAN.md D-78): ${faults.join(' ')}`,
    );
    process.exit(1);
  }
  console.log(`${commits.length} commit message${commits.length === 1 ? '' : 's'} in ${range}, none with an em dash or an en dash.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
