#!/usr/bin/env node
/**
 * Writes lib/generated/content-dates.json: the date of the last commit that changed each file in
 * content/ (docs/V3_PLAN.md D-09). Project pages print it as REV and the footer prints the newest
 * one as "last updated". Visitors never trigger this: it runs once, before `next build`.
 *
 * Sources, in order:
 *   1. local git, when the clone holds the full history (a shallow clone would give wrong dates);
 *   2. the GitHub API at the deployed commit, on Vercel (GITHUB_TOKEN is used when it is set);
 *   3. nothing: the dates stay unknown and the pages leave them out rather than guess.
 *
 * The script never fails the build, and it never prints a token or a response body.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'lib', 'generated', 'content-dates.json');

function contentFiles() {
  const projects = fs
    .readdirSync(path.join(root, 'content', 'projects'))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => `content/projects/${name}`);
  return ['content/site.json', ...projects];
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function fromLocalGit(files) {
  try {
    if (git(['rev-parse', '--is-shallow-repository']) !== 'false') return null;
    const dates = {};
    for (const file of files) {
      const date = git(['log', '-1', '--format=%cs', '--', file]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates[file] = date;
    }
    return dates;
  } catch {
    return null;
  }
}

/** GITHUB_TOKEN trimmed and with pasted quotes removed, as the rest of the site reads it. Never printed. */
function githubToken() {
  return (process.env.GITHUB_TOKEN ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
}

/**
 * Dates from the GitHub API. A run that stops partway keeps the dates it has: each one is still
 * the true date of its file, and lib/history.ts prints "last updated" only when every file in
 * its set has a date, so a partial run can never print an older date as the newest.
 */
async function fromGitHub(files) {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const repo = process.env.VERCEL_GIT_REPO_SLUG;
  if (!sha || !owner || !repo) return null;
  let token = githubToken();
  const headers = () => ({
    Accept: 'application/vnd.github+json',
    'User-Agent': 'site-build',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  const dates = {};
  for (const file of files) {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${sha}&path=${encodeURIComponent(file)}&per_page=1`;
    try {
      let response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(8000) });
      // A token GitHub refuses (expired, or for another account) must not cost the dates: ask once
      // more without it, and go on without it.
      if (token && (response.status === 401 || response.status === 403)) {
        token = '';
        response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(8000) });
      }
      if (!response.ok) return Object.keys(dates).length > 0 ? dates : null;
      const [commit] = await response.json();
      const date = commit?.commit?.committer?.date ?? commit?.commit?.author?.date;
      if (typeof date === 'string') dates[file] = date.slice(0, 10);
    } catch {
      return Object.keys(dates).length > 0 ? dates : null;
    }
  }
  return dates;
}

const files = contentFiles();
let source = 'local git';
let dates = fromLocalGit(files);
if (!dates) {
  source = 'GitHub API';
  dates = await fromGitHub(files);
}
if (!dates) {
  source = 'none';
  dates = {};
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify({ source, files: dates }, null, 2)}\n`);
console.log(`content-dates: ${Object.keys(dates).length} of ${files.length} files dated (source: ${source})`);
