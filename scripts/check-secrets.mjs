#!/usr/bin/env node
/**
 * The build-output secret scan (ARCHITECTURE.md 15, acceptance 11: "No secret reaches the client
 * bundle (checked by a build-output scan)"; docs/V3_PLAN.md D-42). It runs after every build
 * (postbuild) and exits 1 on a hit.
 *
 * What it reads: every file under <dist>/static/ (the JavaScript, CSS, and media browsers
 * download) and the prerendered pages under <dist>/server/app/ (.html, .rsc, .body, .meta), which
 * are sent to browsers as they are.
 *
 * What it looks for:
 * - the value of each secret variable set in this environment at build time (ADMIN_PASSWORD,
 *   SESSION_SECRET, GITHUB_TOKEN, BLOB_READ_WRITE_TOKEN, VERCEL_TOKEN, MOTION_TOKEN,
 *   VERCEL_AUTOMATION_BYPASS_SECRET), as written, JSON-escaped, and URL-encoded;
 * - in the browser code under static/ only, each CONTENT_BLOCKLIST entry of 6 characters or more
 *   (without regard to case unless it starts with "cs:"), so a private name typed into a
 *   component never ships (pages themselves are covered by the content check);
 * - token shapes whatever the variable: GitHub tokens, Vercel Blob read-write tokens, private keys.
 *
 * Values are never printed: a hit names the variable (or the token shape) and the file only.
 *
 * Usage: node scripts/check-secrets.mjs --build [<dist directory>]   (default NEXT_DIST_DIR or .next)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SECRET_VARIABLES = [
  'ADMIN_PASSWORD',
  'SESSION_SECRET',
  'GITHUB_TOKEN',
  'BLOB_READ_WRITE_TOKEN',
  'VERCEL_TOKEN',
  'MOTION_TOKEN',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
];

/** Shorter values are too likely to occur by chance; a real secret is never this short. */
const MIN_SECRET_LENGTH = 6;
const MIN_TERM_LENGTH = 6;

export const TOKEN_SHAPES = [
  { name: 'a GitHub fine-grained token', re: /github_pat_[A-Za-z0-9_]{22,}/ },
  { name: 'a GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'a Vercel Blob read-write token', re: /vercel_blob_rw_[A-Za-z0-9]{6,}_[A-Za-z0-9]{10,}/ },
  // The header followed by key material (a raw or an escaped newline, then base64). Libraries that
  // parse keys hold the bare header as a string to compare against; that is not a key.
  { name: 'a private key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----(?:\\r)?(?:\\n|\r?\n)[A-Za-z0-9+/=]{40,}/ },
];

const PAGE_FILE = /\.(?:html|rsc|body|meta)$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * The value as the app reads it (lib/storage/shared.ts envValue): trimmed, with quotes pasted
 * around it removed. A value saved as 'secret' in quotes is used as secret, so both are searched.
 */
export function normalizedValue(value) {
  return value
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

function variants(raw) {
  const value = raw.trim();
  const set = new Set([value, normalizedValue(value)]);
  for (const one of [...set]) {
    set.add(JSON.stringify(one).slice(1, -1));
    try {
      set.add(encodeURIComponent(one));
    } catch {
      // An unpaired surrogate cannot be encoded; the raw value is still checked.
    }
  }
  return [...set].filter((v) => v.length >= MIN_SECRET_LENGTH);
}

/** The private terms, as CONTENT_BLOCKLIST lists them: entries split on "|", "cs:" for exact case. */
export function blocklistTerms(raw) {
  if (!raw) return [];
  return raw
    .split('|')
    .map((part, i) => {
      const trimmed = part.trim();
      const exact = trimmed.startsWith('cs:');
      const term = (exact ? trimmed.slice(3) : trimmed).trim();
      return { index: i + 1, term, exact };
    })
    .filter((entry) => entry.term.length >= MIN_TERM_LENGTH);
}

/**
 * Scans a build folder. Returns { files, hits } where each hit is { label, file } with the file
 * relative to `dist`. Nothing returned holds a value.
 */
export function scanBuild(dist, env = process.env) {
  const staticFiles = walk(path.join(dist, 'static'));
  const pageFiles = walk(path.join(dist, 'server', 'app')).filter((file) => PAGE_FILE.test(file));
  const secrets = SECRET_VARIABLES.flatMap((name) => {
    const value = (env[name] ?? '').trim();
    return value.length >= MIN_SECRET_LENGTH ? [{ name, values: variants(value) }] : [];
  });
  const terms = blocklistTerms(env.CONTENT_BLOCKLIST);
  const hits = [];
  const seen = new Set();
  const hit = (label, file) => {
    const rel = path.relative(dist, file).split(path.sep).join('/');
    const key = `${label}\u0000${rel}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ label, file: rel });
  };

  for (const file of [...staticFiles, ...pageFiles]) {
    const text = fs.readFileSync(file, 'latin1');
    for (const { name, values } of secrets) {
      if (values.some((value) => text.includes(Buffer.from(value, 'utf8').toString('latin1')))) hit(name, file);
    }
    for (const shape of TOKEN_SHAPES) if (shape.re.test(text)) hit(shape.name, file);
  }
  if (terms.length > 0) {
    for (const file of staticFiles) {
      const text = fs.readFileSync(file, 'utf8');
      const lower = text.toLowerCase();
      for (const { index, term, exact } of terms) {
        if (exact ? text.includes(term) : lower.includes(term.toLowerCase())) hit(`CONTENT_BLOCKLIST entry ${index}`, file);
      }
    }
  }
  return { files: staticFiles.length + pageFiles.length, hits };
}

/**
 * The variables to look for: the environment, plus, for any of them not set there, the values in
 * .env.local, which `next build` loads on the owner's machine (as scripts/check-content.mjs does).
 * Values stay in memory and are never printed.
 */
export function scanEnvironment(root, env = process.env) {
  const out = { ...env };
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) return out;
  const wanted = new Set([...SECRET_VARIABLES, 'CONTENT_BLOCKLIST']);
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !wanted.has(match[1]) || (out[match[1]] ?? '').trim() !== '') continue;
    out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function main() {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const arg = process.argv.indexOf('--build');
  if (arg === -1) {
    console.error('Usage: node scripts/check-secrets.mjs --build [<dist directory>]');
    process.exit(2);
  }
  const named = process.argv[arg + 1];
  const dist = path.resolve(ROOT, named && !named.startsWith('--') ? named : process.env.NEXT_DIST_DIR || '.next');
  if (!fs.existsSync(path.join(dist, 'static'))) {
    console.error(`check:secrets: no build output at ${path.relative(ROOT, dist) || '.'}; run next build first.`);
    process.exit(1);
  }
  const env = scanEnvironment(ROOT);
  const { files, hits } = scanBuild(dist, env);
  if (hits.length > 0) {
    for (const { label, file } of hits) console.error(`SECRET  ${label}  found in ${file}`);
    console.error(`check:secrets: ${hits.length} hit${hits.length === 1 ? '' : 's'} in the build output. Nothing printed holds a value.`);
    process.exit(1);
  }
  const checked = SECRET_VARIABLES.filter((name) => (env[name] ?? '').trim().length >= MIN_SECRET_LENGTH);
  console.log(
    `check:secrets: ${files} build files scanned, no secret found (${checked.length} secret variable${checked.length === 1 ? '' : 's'} set here, ` +
      `${blocklistTerms(env.CONTENT_BLOCKLIST).length} private terms, ${TOKEN_SHAPES.length} token shapes).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
