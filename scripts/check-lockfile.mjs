#!/usr/bin/env node
/**
 * The lockfile check (docs/V3_PLAN.md R-08), for `npm run check:lockfile`, the pre-commit hook,
 * and the start of `prebuild`. Motion+ installs from a private registry with MOTION_TOKEN, which
 * reaches npm only through the environment. This check exits 1 when a token, a credential, or
 * Motion+ source could reach a committed file through npm, and 0 otherwise.
 *
 * Rules:
 * - LOCK-SOURCE. In package-lock.json and npm-shrinkwrap.json (lockfileVersion 1 to 3: the
 *   "packages" map and the legacy "dependencies" tree), every "resolved", and every "version" that
 *   is an address, is https with no username, password, query string, or fragment, on the
 *   package's registry, and is the one address that registry's layout gives the package and
 *   version (<registry><name>/-/<name>-<version>.tgz), so no part of its path can carry a token.
 *   The registry is registry.npmjs.org, or for a scoped package the one the root .npmrc gives its
 *   scope ("@scope:registry=https://host/path/"). A package's name is the packages-map key after
 *   its last "node_modules/", or an alias's "name" (in the legacy tree, the name inside an "npm:"
 *   version), and a folder in a scope .npmrc gives a registry holds only that scope's packages. A
 *   remote source has an integrity. Links, workspaces, bundled packages, and file: packages stay
 *   on this computer and pass, unless they carry a query string, a fragment, or Motion+. Every
 *   dependency map in an entry ("requires" in the legacy tree) is read as PKG-SPEC reads
 *   package.json. No other string holds an address with a password, or a username other than git.
 * - PKG-SPEC. In package.json, a spec in dependencies, devDependencies, optionalDependencies,
 *   peerDependencies, or overrides at any depth (keys included) that is a URL or a git address
 *   carries no username, password, query string, host or path that looks like a token, or
 *   fragment other than a plain git reference. npm: aliases and ranges pass, and Motion+ installs
 *   only from its registry. A dependency field is an object of strings, and there is no
 *   publishConfig. No other string holds an address with a password, or a username other than git.
 * - NPMRC-AUTH. In every .npmrc git tracks (copies under another name, such as .npmrc.bak or
 *   ci.npmrc, included) and the root one: a setting whose name contains _authToken, _auth,
 *   _password, password, token, or username, or that is key, cert, certfile, or keyfile, holds
 *   exactly one environment reference, ${NAME} (or ${NAME?}), and names a host an
 *   "@scope:registry" line names. No key holds a reference, and no other value holds one except
 *   as its whole value, since npm expands them anywhere; a reference whose name looks like a
 *   token fails. No commented-out auth line holds a literal, on a line of its own or after a
 *   value, and no key holds a comment. The default registry stays https://registry.npmjs.org/,
 *   and nothing sets userconfig, globalconfig, prefix, replace-registry-host, ignore-scripts, ca,
 *   or cafile, or turns strict-ssl off. An address has no username or password, and a registry's
 *   is https with no query string. Lines are read as npm's ini reader reads them: a byte-order
 *   mark, CRLF, spaces around "=", quotes, # and ; comments, and [section] lines. NUL bytes fail
 *   the file.
 * - TOKEN-SHAPE. No string in package.json, the lockfiles, or those .npmrc files has a
 *   credential's shape: TOKEN_SHAPES from scripts/check-secrets.mjs, plus shapes added here only
 *   (npm tokens, JSON Web Tokens, GitHub tokens glued to other text, any private key header), so
 *   the build-output scan keeps its own list. In an .npmrc, text that looks like a token (a long
 *   mix of letters and digits, or a UUID) fails too.
 * - TOKEN-VALUE. No file holds the value of a secret variable (SECRET_VARIABLES, and every
 *   variable an .npmrc credential setting reads) set in the environment or, failing that, in
 *   .env.local through scanEnvironment, in any form scripts/check-secrets.mjs searches for (as
 *   written, normalized, JSON-escaped, URL-encoded), long forms in any case. In npm's files it also
 *   looks for hex, base64 at every alignment, percent-escapes decoded again and again, the value
 *   split in two, and the value as dotenv reads it. In a git work tree every tracked file is
 *   searched, on disk and staged. A variable an .npmrc credential setting reads, and MOTION_TOKEN
 *   once Motion+ is a dependency, must be set where the check runs. Only the name and file print.
 * - MOTIONPLUS-SOURCE. Git tracks no path inside node_modules/, no package archive (.tgz, .tar),
 *   no package.json naming a Motion+ package, and, in a folder named after Motion+ (@motionplus,
 *   motion-plus, motion_plus), nothing but the site's own TypeScript and CSS. Outside a git work
 *   tree the rule is skipped with a note, and every .npmrc below the folder (node_modules and .git
 *   aside) is checked as if git tracked it; in a repository where git cannot run, the check fails.
 *
 * In a git work tree the staged copies (the index, read by blob id) are checked too when they
 * differ from the files on disk, so a token that is staged but no longer on disk still stops the
 * commit. A note says when the installed pre-commit hook does not run this check though
 * package.json asks it to.
 *
 * Fails closed: a JSON file that is not JSON, or is nested more than 1000 levels deep, fails its
 * LOCK-SOURCE or PKG-SPEC rule while the token rules still read it line by line, a string or line
 * over 64 KB fails, and a check that cannot finish exits 1. A file is read as UTF-8, or as UTF-16
 * when it starts with that mark. Every pattern reads each part of a file a bounded number of times.
 *
 * Every finding prints the file, the JSON path and line (or the line), the rule id, and what is
 * wrong. No finding prints a secret or the text that matched: an address problem names the part
 * ("a query string", "a username", a well-known host), a key, file name, host, or scheme that could
 * hold a secret is not shown, and a value is named by its variable only.
 *
 * Usage: node scripts/check-lockfile.mjs [--root <repository directory>]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SECRET_VARIABLES, TOKEN_SHAPES, normalizedValue, scanEnvironment } from './check-secrets.mjs';

const NPM_REGISTRY = 'registry.npmjs.org';
const NPM_REGISTRY_URL = `https://${NPM_REGISTRY}/`;
const JSON_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'];
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json']);
const SPEC_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
/** In the order a finding names them: the first one a setting's name contains. */
const AUTH_KEY_WORDS = ['_authtoken', '_password', '_auth', 'password', 'token', 'username'];
/** Settings that hold a client certificate or its key, or name the file that does. */
const CREDENTIAL_SETTINGS = new Set(['key', 'cert', 'certfile', 'keyfile']);
const ANOTHER_FILE = 'loads another config file, which this check does not read';
const TRUST = 'trusts another certificate authority, so a token could be read on its way to the registry';
/** Settings a committed .npmrc may not set, and why. */
const FORBIDDEN_SETTINGS = new Map([
  ['userconfig', ANOTHER_FILE],
  ['globalconfig', ANOTHER_FILE],
  ['prefix', 'moves the global config file npm loads, which this check does not read'],
  ['replace-registry-host', 'changes the host npm fetches locked packages from'],
  ['ignore-scripts', 'skips prebuild, where this check runs before every build'],
  ['ca', TRUST],
  ['cafile', TRUST],
]);
/** As in scripts/check-secrets.mjs: a shorter value is too likely to occur by chance. */
const MIN_SECRET_LENGTH = 6;
/** A secret is never printed, and neither is any text holding a piece of one this long. */
const PIECE = 8;
/** Forms this long are compared without regard to case; shorter ones exactly. */
const LONG_FORM = 16;
/** A value this long is also found from a 16-character piece of it (taken every 4 characters), so splitting it in two does not hide it. */
const WINDOW_FROM = 24;
const WINDOW = 16;
const WINDOW_STEP = 4;
/** No string in an npm file, or line in an .npmrc, needs to be longer. */
const MAX_STRING = 64 * 1024;
/** Tracked files larger than this (media) are not searched for secret values. */
const MAX_SEARCHED = 4 * 1024 * 1024;
const BATCH_BYTES = 32 * 1024 * 1024;

// Shapes ---------------------------------------------------------------------------------------

/**
 * A JSON Web Token: dot-separated base64url parts, the first holding eyJ and 10 more. Each match
 * is one part, with the next two looked at but not taken, so a token right after another dotted
 * run is still found. Each run of text is read a bounded number of times.
 */
function hasJwt(text) {
  for (const [first] of text.matchAll(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{13,}(?=\.[A-Za-z0-9_-]{2,}\.)/g)) {
    const at = first.indexOf('eyJ');
    if (at !== -1 && first.length - at >= 13) return true;
  }
  return false;
}

/** Any private key header, with or without key material after it. Built from parts, so this file holds none. */
const PRIVATE_KEY_HEADER = new RegExp(['PRIVATE', 'KEY-----'].join(' '));

/** The credential shapes searched for: the build-output scan's, and those only npm's files need. */
export const SHAPES = [
  ...TOKEN_SHAPES.map(({ name, re }) => ({ name, test: (text) => re.test(text) })),
  { name: 'a GitHub token', test: (text) => /gh[pousr]_[A-Za-z0-9]{30,}/.test(text) },
  { name: 'an npm token', test: (text) => /npm_[A-Za-z0-9]{36}/.test(text) },
  { name: 'a JSON Web Token', test: hasJwt },
  { name: 'a private key', test: (text) => PRIVATE_KEY_HEADER.test(text) },
];

const shapesIn = (text) => [...new Set(SHAPES.filter((shape) => shape.test(text)).map((shape) => shape.name))];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const REFERENCES = /\$\{[A-Za-z_][A-Za-z0-9_]*\??\}/g;

/**
 * True when text holds something that looks like a token: a UUID, a run of 20 or more letters and
 * digits that mixes the two (a commit hash aside), or a run of 32 or more that mixes cases. In
 * `strict` mode, for an .npmrc, where no hash belongs, any run of 20 with a digit counts, and so
 * does a run of 32 that mixes letters and digits around - or _.
 */
function tokenLike(text, strict = false) {
  if (UUID.test(text)) return true;
  for (const [run] of text.matchAll(/[A-Za-z0-9]{20,}/g)) {
    if (/\d/.test(run) && (strict || (/[A-Za-z]/.test(run) && !/^[0-9a-f]+$/i.test(run)))) return true;
    if (run.length >= 32 && /[a-z]/.test(run) && /[A-Z]/.test(run)) return true;
  }
  if (strict) {
    for (const [run] of text.matchAll(/[A-Za-z0-9_-]{32,}/g)) if (/[A-Za-z]/.test(run) && /\d/.test(run)) return true;
  }
  return false;
}

// Secrets --------------------------------------------------------------------------------------

/** The forms scripts/check-secrets.mjs searches for: as written, normalized, JSON-escaped, URL-encoded. */
function variants(raw) {
  const value = raw.trim();
  const set = new Set([value, normalizedValue(value)]);
  for (const one of [...set]) {
    set.add(JSON.stringify(one).slice(1, -1));
    try {
      set.add(encodeURIComponent(one));
    } catch {
      // An unpaired surrogate cannot be encoded; the other forms are still searched.
    }
  }
  return [...set].filter((v) => v.length >= MIN_SECRET_LENGTH);
}

/** The value as dotenv reads a .env line: inside its quotes, or cut at a # comment. */
function dotenvValue(value) {
  const quoted = /^(['"`])(.*?)\1/s.exec(value);
  if (quoted) return quoted[2];
  const hash = value.indexOf('#');
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

/** The base64 (and base64url) text that holds `value` whatever bytes come before it: one core for each alignment. */
function base64Cores(value) {
  const bytes = Buffer.from(value, 'utf8');
  const cores = [];
  for (let shift = 0; shift < 3; shift += 1) {
    const length = Math.floor((bytes.length - shift) / 3) * 3;
    if (length < 12) continue;
    const core = bytes.subarray(shift, shift + length).toString('base64');
    cores.push(core, core.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return cores;
}

const latin1Lower = (text) => Buffer.from(text, 'utf8').toString('latin1').toLowerCase();
const isLong = (form) => form.length >= LONG_FORM;

/**
 * Each secret variable set in `env`, with the forms searched for and the pieces never printed.
 * `plain` forms are check-secrets' own, searched in every file; npm's files are also searched for
 * the `all` forms (hex, base64, a + read as a space and back, lower-case escapes) and the windows.
 * Nothing here is ever printed.
 */
function secretsOf(env, names) {
  return names.flatMap((name) => {
    const value = String(env[name] ?? '').trim();
    if (value.length < MIN_SECRET_LENGTH) return [];
    const bases = [...new Set([value, dotenvValue(value)])].filter((one) => one.length >= MIN_SECRET_LENGTH);
    const plain = new Set(bases.flatMap(variants));
    const all = new Set(plain);
    for (const base of bases) {
      all.add(base.replace(/\+/g, ' '));
      all.add(base.replace(/ /g, '+'));
      all.add(Buffer.from(base, 'utf8').toString('hex'));
      for (const core of base64Cores(base)) all.add(core);
    }
    for (const one of [...all]) all.add(one.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()));
    const forms = [...all].filter((one) => one.length >= MIN_SECRET_LENGTH);
    const windows = new Set();
    for (const base of bases) {
      if (base.length < WINDOW_FROM) continue;
      for (let i = 0; i + WINDOW <= base.length; i += WINDOW_STEP) windows.add(base.slice(i, i + WINDOW).toLowerCase());
      windows.add(base.slice(-WINDOW).toLowerCase());
    }
    const pieces = new Set();
    for (const one of forms) {
      const lower = one.toLowerCase();
      if (lower.length <= PIECE) pieces.add(lower);
      else for (let i = 0; i + PIECE <= lower.length; i += 1) pieces.add(lower.slice(i, i + PIECE));
    }
    const plainForms = [...plain];
    return [
      {
        name,
        plainBytes: plainForms.map((one) => Buffer.from(one, 'utf8')),
        plainShortBytes: plainForms.filter((one) => !isLong(one)).map((one) => Buffer.from(one, 'utf8')),
        plainLongLatin: [...new Set(plainForms.filter(isLong).map(latin1Lower))],
        allShort: forms.filter((one) => !isLong(one)),
        allShortBytes: forms.filter((one) => !isLong(one)).map((one) => Buffer.from(one, 'utf8')),
        allLong: [...new Set(forms.filter(isLong).map((one) => one.toLowerCase()))],
        allLongLatin: [...new Set(forms.filter(isLong).map(latin1Lower))],
        windows: [...windows],
        pieces: [...pieces],
      },
    ];
  });
}

/** Text with every run of percent-escapes decoded byte by byte; an invalid sequence becomes U+FFFD. */
const percentDecoded = (text) => (text.includes('%') ? text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => Buffer.from(run.replace(/%/g, ''), 'hex').toString('utf8')) : text);

/** Text and what it decodes to, pass after pass (up to 3), so encoding twice hides nothing. */
function decodings(text) {
  const out = [text];
  for (let pass = 0; pass < 3; pass += 1) {
    const next = percentDecoded(out[out.length - 1]);
    if (next === out[out.length - 1]) break;
    out.push(next);
  }
  return out;
}

/** The names of the secrets in one tracked file: check-secrets' forms as bytes, long ones in any case in text. */
function valuesInFile(buffer, secrets) {
  const binary = buffer.subarray(0, 8000).includes(0);
  let lower = null;
  return secrets
    .filter((secret) => {
      if (binary) return secret.plainBytes.some((form) => buffer.includes(form));
      if (secret.plainShortBytes.some((form) => buffer.includes(form))) return true;
      lower ??= buffer.toString('latin1').toLowerCase();
      return secret.plainLongLatin.some((form) => lower.includes(form));
    })
    .map(({ name }) => name);
}

/**
 * The names of the secrets in one of npm's files: in its bytes, and in its text and the strings
 * read from it, with percent-escapes decoded, format characters removed, short texts (base64 that
 * wraps over lines) also without spaces, long forms in any case, and from a window of the value.
 */
function valuesInNpm(buffer, texts, secrets) {
  if (secrets.length === 0) return [];
  const parts = [];
  for (const text of texts) {
    const seen = new Set();
    for (const one of decodings(text)) {
      seen.add(one);
      const plain = /\p{Cf}/u.test(one) ? one.replace(/\p{Cf}/gu, '') : one;
      seen.add(plain);
      if (plain.length <= MAX_STRING) seen.add(plain.replace(/\s+/g, ''));
    }
    parts.push(...seen);
  }
  const haystack = parts.join('\u0000');
  const lower = haystack.toLowerCase();
  let bytesLower = null;
  return secrets
    .filter((secret) => {
      if (secret.allShortBytes.some((form) => buffer.includes(form)) || secret.allShort.some((form) => haystack.includes(form))) return true;
      if (secret.allLong.some((form) => lower.includes(form)) || secret.windows.some((piece) => lower.includes(piece))) return true;
      bytesLower ??= buffer.toString('latin1').toLowerCase();
      return secret.allLongLatin.some((form) => bytesLower.includes(form));
    })
    .map(({ name }) => name);
}

// Printing -----------------------------------------------------------------------------------

/**
 * Control characters, and the marks that reorder or break a line, which text from a file could use
 * to disguise the output. Built from character codes so that this file holds none of them.
 */
const UNPRINTABLE = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200e, 0x200f],
    [0x2028, 0x2029],
    [0x202a, 0x202e],
    [0x2066, 0x2069],
  ]
    .map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`)
    .join('')}]`,
  'g',
);
const printable = (text) => String(text).replace(UNPRINTABLE, '?');

/** Text without the byte-order mark an editor may write first; npm and ini ignore it too. */
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** A file's text: UTF-8, or UTF-16 when it starts with a UTF-16 byte-order mark, so no encoding hides a token. */
function textOf(buffer) {
  const utf16 = (body) => body.subarray(0, body.length - (body.length % 2));
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return utf16(buffer.subarray(2)).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(utf16(buffer.subarray(2))).swap16().toString('utf16le');
  return stripBom(buffer.toString('utf8'));
}

/** True when text taken from a file could hold a secret: a shape, credentials, or a piece of a value in any case, decoded or not. */
function holdsSecret(text, secrets) {
  if (shapesIn(text).length > 0 || credentialAddress(text)) return true;
  const forms = decodings(text).map((one) => one.replace(/\p{Cf}/gu, '').toLowerCase());
  return secrets.some(({ pieces }) => pieces.some((piece) => forms.some((form) => form.includes(piece))));
}

/** True when text from a file may be printed: no secret, nothing that looks like a token, no percent-escapes. */
const safeText = (text, secrets) => !/%[0-9A-Fa-f]{2}/.test(text) && !tokenLike(text) && !holdsSecret(text, secrets);

/** A JSON path such as packages["node_modules/x"].resolved. A key that could hold a secret is not shown. */
function jsonPath(segments, secrets) {
  let out = '';
  for (const segment of segments) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else if (!safeText(segment, secrets) || /@[^/\s]*:/.test(segment)) out += '[(a key not shown)]';
    else if (/^[A-Za-z_$][\w$]*$/.test(segment)) out += out ? `.${segment}` : segment;
    else out += `[${JSON.stringify(segment.length > 100 ? `${segment.slice(0, 100)}...` : segment)}]`;
  }
  return printable(out || '(top level)');
}

/** A path in the repository, with any part that could hold a secret not shown. */
function filePath(rel, secrets) {
  return printable(
    rel
      .split('/')
      .map((part) => (safeText(part, secrets) ? part : '(a name not shown)'))
      .join('/'),
  );
}

/**
 * A variable's name. The secret variables' own names are printed as they are; a name read from an
 * .npmrc reference is printed only when it reads as a plain name that holds nothing secret, since
 * a token pasted inside ${...} would otherwise be printed as a "name".
 */
function variableText(name, secrets) {
  if (SECRET_VARIABLES.includes(name)) return name;
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) && safeText(name, secrets) ? name : 'a variable whose name is not shown';
}

/** Hosts and schemes a finding may name. Any other is described, never printed, since it could hold a token. */
const KNOWN_HOSTS = new Set([NPM_REGISTRY, 'registry.yarnpkg.com', 'github.com', 'codeload.github.com', 'gitlab.com', 'bitbucket.org']);
const KNOWN_SCHEMES = new Set(['https', 'http', 'git', 'git+ssh', 'git+https', 'git+http', 'git+file', 'ssh', 'file', 'ftp', 'ws', 'wss']);

function schemeName(protocol) {
  const name = protocol.replace(/:$/, '').toLowerCase();
  return KNOWN_SCHEMES.has(name) ? name : 'another scheme';
}

/** A scope, when it is a plain one that holds nothing secret. */
const scopeText = (scope, secrets) => (/^@[a-z0-9][a-z0-9._-]{0,50}$/.test(scope) && safeText(scope, secrets) ? scope : 'its scope');

const registryText = (registry, secrets) => (registry.scope ? `the registry .npmrc gives ${scopeText(registry.scope, secrets)}` : NPM_REGISTRY);

function hostText(host, ctx) {
  if (host === '') return 'no host';
  if (KNOWN_HOSTS.has(host)) return `host ${host}`;
  for (const [scope, registry] of ctx.registries) {
    if (registry.host === host) return `the host of the registry .npmrc gives ${scopeText(scope, ctx.secrets)}`;
  }
  return 'a host that is not approved';
}

// JSON with every value -----------------------------------------------------------------------

/** Deeper than any real package.json or lockfile; a file nested deeper fails rather than overflow the stack. */
const MAX_DEPTH = 1000;

class TooDeep extends Error {}

/**
 * Parses JSON text into a tree that keeps what JSON.parse drops: each copy of a repeated key, and
 * the line of every key and value. Objects are { type: 'object', entries: [{ key, keyEscaped, line,
 * value }] }, arrays { type: 'array', items }, strings { type: 'string', value, escaped }, and the
 * rest { type: 'literal', raw }; `escaped` says the string was written with a backslash escape.
 * Call it only on text JSON.parse accepts. Throws TooDeep past MAX_DEPTH.
 */
function parseTree(text) {
  let i = 0;
  let line = 1;
  let depth = 0;
  const space = () => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 10) line += 1;
      else if (c !== 32 && c !== 9 && c !== 13) return;
      i += 1;
    }
  };
  const string = () => {
    let out = '';
    let escaped = false;
    let start = (i += 1);
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        out += text.slice(start, i);
        i += 1;
        return { value: out, escaped };
      }
      if (c === 92) {
        escaped = true;
        out += text.slice(start, i);
        const escape = text[i + 1];
        if (escape === 'u') {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
        } else {
          out += { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[escape] ?? escape;
          i += 2;
        }
        start = i;
      } else i += 1;
    }
  };
  const value = () => {
    space();
    const at = line;
    const c = text[i];
    if (c === '{' || c === '[') {
      const object = c === '{';
      const node = object ? { type: 'object', entries: [], line: at } : { type: 'array', items: [], line: at };
      depth += 1;
      if (depth > MAX_DEPTH) throw new TooDeep();
      i += 1;
      space();
      if (text[i] === (object ? '}' : ']')) {
        i += 1;
        depth -= 1;
        return node;
      }
      for (;;) {
        if (object) {
          space();
          const keyLine = line;
          const key = string();
          space();
          i += 1;
          node.entries.push({ key: key.value, keyEscaped: key.escaped, line: keyLine, value: value() });
        } else node.items.push(value());
        space();
        const next = text[i];
        i += 1;
        if (next !== ',') {
          depth -= 1;
          return node;
        }
      }
    }
    if (c === '"') {
      const parsed = string();
      return { type: 'string', value: parsed.value, escaped: parsed.escaped, line: at };
    }
    const start = i;
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i += 1;
    return { type: 'literal', raw: text.slice(start, i), line: at };
  };
  return value();
}

const entriesOf = (node) => (node && node.type === 'object' ? node.entries : []);
const fields = (node, key) => entriesOf(node).filter((entry) => entry.key === key);

/** The value npm reads for a key: the last copy, when it is a string. */
function lastString(node, key) {
  const all = fields(node, key);
  const last = all[all.length - 1];
  return last && last.value.type === 'string' ? last.value.value : undefined;
}

function lastIsTrue(node, key) {
  const all = fields(node, key);
  const last = all[all.length - 1];
  return Boolean(last && last.value.type === 'literal' && last.value.raw === 'true');
}

/** Calls visit(text, segments, line, isKey, node, escaped) for every key and every string value. */
function eachString(node, segments, visit) {
  if (node.type === 'string') visit(node.value, segments, node.line, false, node, node.escaped);
  else if (node.type === 'array') node.items.forEach((item, index) => eachString(item, [...segments, index], visit));
  else {
    for (const entry of entriesOf(node)) {
      visit(entry.key, segments, entry.line, true, entry, entry.keyEscaped);
      eachString(entry.value, [...segments, entry.key], visit);
    }
  }
}

// Addresses ------------------------------------------------------------------------------------

/** A scheme of two letters or more, so that a Windows drive letter reads as a path. */
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;
const LEGACY_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PLAIN_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PLAIN_NAME = /^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/;
/** A version range or a tag. */
const RANGE = /^[0-9A-Za-z.\-^~<>=|*+\s]*$/;
/** Schemes a URL parser reads an authority after any run of slashes or backslashes for, or none. */
const SPECIAL_SCHEMES = new Set(['http', 'https', 'ws', 'wss', 'ftp', 'file']);
/** Commonly used SRI hashes, as npm writes them. */
const SRI = /^(?:sha512-[A-Za-z0-9+/]{86}==|sha384-[A-Za-z0-9+/]{64}|sha256-[A-Za-z0-9+/]{43}=|sha1-[A-Za-z0-9+/]{27}=)$/;

function parseUrl(text) {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/**
 * The userinfo of every address in the text, as { user, password }. An address starts at a scheme
 * that no scheme character comes before. For http, https, ws, wss, ftp, and file (and git+ each),
 * the authority follows any run of slashes or backslashes, or none, as a URL parser reads it; for
 * any other scheme it follows "//". Each part of the text is read once.
 */
function userinfos(text) {
  const out = [];
  const scheme = /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*):/g;
  for (let match = scheme.exec(text); match !== null; match = scheme.exec(text)) {
    const name = match[1].toLowerCase();
    const begin = scheme.lastIndex;
    let start = begin;
    while (start < text.length && (text[start] === '/' || text[start] === '\\')) start += 1;
    const special = SPECIAL_SCHEMES.has(name) || (name.startsWith('git+') && SPECIAL_SCHEMES.has(name.slice(4)));
    if (!special && text.slice(begin, start) !== '//') continue;
    let end = start;
    while (end < text.length && !/[/?#\\\s]/.test(text[end])) end += 1;
    scheme.lastIndex = Math.max(end, begin);
    const span = text.slice(start, end);
    const at = span.lastIndexOf('@');
    if (at === -1) continue;
    const info = span.slice(0, at);
    const colon = info.indexOf(':');
    out.push({ user: colon === -1 ? info : info.slice(0, colon), password: colon === -1 ? '' : info.slice(colon + 1) });
  }
  return out;
}

/** True when the text holds an address with a password, or with a username other than git. */
const credentialAddress = (text) => userinfos(text).some(({ user, password }) => password !== '' || (user !== '' && user.toLowerCase() !== 'git'));

/** A file: address without a host, or a link's folder: both stay on this computer. */
function isLocal(spec, link) {
  if (/^file:/i.test(spec)) return (parseUrl(spec)?.host ?? '') === '';
  return link && !SCHEME.test(spec) && !/^[\\/]{2}/.test(spec);
}

/** Whether a lockfile "version" is an address. In the legacy tree, anything but a version, an alias, or a local file is. */
function versionIsAddress(version, legacy) {
  if (/^npm:/i.test(version)) return false;
  if (/^file:/i.test(version)) return !isLocal(version, false);
  if (legacy) return !LEGACY_VERSION.test(version);
  return SCHEME.test(version) || version.includes('//') || /^[^@\s/]+@[^:\s/]+:/.test(version);
}

/** The userinfo of a spec: in scheme://user@host, in scheme:user@..., in user@host:path, or before the first slash. */
function userinfoOf(spec) {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\\]*)/i.exec(spec);
  const opaque = authority ? null : /^[a-z][a-z0-9+.-]+:([^/?#\\]*)/i.exec(spec);
  const scp = /^([^@\s/:]+)@[^:\s/]+:/.exec(spec);
  const part = authority?.[1] ?? opaque?.[1] ?? (scp ? `${scp[1]}@` : /^([^/?#\\]*)/.exec(spec)[1]);
  const at = part.lastIndexOf('@');
  return at === -1 ? '' : part.slice(0, at);
}

const SEMVER_COMPARATOR = /^(?:[<>]=?|=|\^|~)?v?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A git committish as npm writes one: a commit, tag, or branch, semver:<range>, or path:<folder>, joined by "::", none of it token-like. */
function plainGitReference(fragment) {
  return fragment.split('::').every((part) => {
    if (part === '') return true;
    if (part.startsWith('semver:')) {
      const range = part.slice('semver:'.length);
      return !tokenLike(range) && range.split(/\s+|\|\|/).every((token) => token === '' || token === '-' || SEMVER_COMPARATOR.test(token));
    }
    if (part.startsWith('path:')) return /^[\w.\-/@]+$/.test(part.slice('path:'.length)) && !tokenLike(part);
    return /^[\w.\-/]+$/.test(part) && !tokenLike(part);
  });
}

/** What is wrong with a dependency spec. A range, a tag, or a file name has nothing wrong. */
function specProblems(spec) {
  const s = spec.trim();
  if (/^npm:/i.test(s)) {
    const rest = s.slice('npm:'.length);
    if (SCHEME.test(rest)) return specProblems(rest);
    const at = rest.indexOf('@', 1);
    return at === -1 ? [] : specProblems(rest.slice(at + 1));
  }
  if (RANGE.test(s)) return [];
  const problems = new Set();
  const userinfo = userinfoOf(s);
  const colon = userinfo.indexOf(':');
  if ((colon === -1 ? userinfo : userinfo.slice(0, colon)) !== '') problems.add('a username');
  if (colon !== -1 && userinfo.slice(colon + 1) !== '') problems.add('a password');
  // As a URL parser reads it: userinfo after any run of slashes or backslashes.
  for (const { user, password } of userinfos(s)) {
    if (user !== '') problems.add('a username');
    if (password !== '') problems.add('a password');
  }
  const url = SCHEME.test(s) ? parseUrl(s) : null;
  if (url?.username) problems.add('a username');
  if (url?.password) problems.add('a password');
  const hash = s.indexOf('#');
  const address = hash === -1 ? s : s.slice(0, hash);
  if (address.includes('?')) problems.add('a query string');
  if (hash !== -1 && !plainGitReference(s.slice(hash + 1))) problems.add('a fragment that is not a plain git reference (it may hold a token)');
  if (/^[a-z][a-z0-9+.-]*:/i.test(address) && tokenLike(address.replace(/^[a-z][a-z0-9+.-]*:/i, ''))) {
    problems.add('a host or path that looks like it holds a token');
  }
  return [...problems];
}

// .npmrc -------------------------------------------------------------------------------------

/** A key or value as npm's ini reader reads it (trimmed, unquoted, cut at an inline ; or # comment), and the comment it cut. */
function iniParse(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    let inner = value.startsWith("'") ? value.slice(1, -1) : value;
    try {
      inner = JSON.parse(inner);
    } catch {
      // Kept as it is, as ini keeps it.
    }
    return { value: typeof inner === 'string' ? inner : JSON.stringify(inner), comment: null };
  }
  let out = '';
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (escaped) {
      out += '\\;#'.includes(c) ? c : `\\${c}`;
      escaped = false;
    } else if (c === ';' || c === '#') return { value: out.trim(), comment: value.slice(i + 1) };
    else if (c === '\\') escaped = true;
    else out += c;
  }
  if (escaped) out += '\\';
  return { value: out.trim(), comment: null };
}

/**
 * An .npmrc's lines, its key lines ({ line, section, key, hasValue, value, keyComment,
 * valueComment }: a comment is the text an inline ; or # cut off, or null), and its full-line
 * comments.
 */
function npmrcLines(text) {
  const lines = stripBom(text).split(/\r\n|\r|\n/);
  const entries = [];
  const comments = [];
  let section = '';
  lines.forEach((line, index) => {
    if (/^\s*$/.test(line)) return;
    const marker = /^\s*[;#]/.exec(line);
    if (marker) {
      comments.push({ line: index + 1, text: line.slice(marker[0].length) });
      return;
    }
    const header = /^\[([^\]]*)\]\s*$/.exec(line);
    if (header) {
      section = header[1];
      return;
    }
    const eq = line.indexOf('=');
    const key = iniParse(eq === -1 ? line : line.slice(0, eq));
    const value = iniParse(eq === -1 ? '' : line.slice(eq + 1));
    // A line with no "=" is a setting npm reads as true: a comment after it ends the line, as one after a value does.
    const keyComment = eq === -1 ? null : key.comment;
    const valueComment = eq === -1 ? key.comment : value.comment;
    entries.push({ line: index + 1, section, key: key.value, hasValue: eq !== -1, value: value.value, keyComment, valueComment });
  });
  return { lines, entries, comments };
}

/** The setting a key sets: for a per-registry key (//host/path/:setting), the part after "/:". Lower case. */
function settingOf(key) {
  const at = key.startsWith('//') ? key.indexOf('/:') : -1;
  return (at === -1 ? key : key.slice(at + 2)).toLowerCase();
}

/** The auth word a setting's name holds, or the credential setting it is. */
const credentialWord = (setting) => AUTH_KEY_WORDS.find((word) => setting.includes(word)) ?? (CREDENTIAL_SETTINGS.has(setting) ? setting : undefined);

const REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\??\}$/;

/** Why a credential setting's value is not exactly one ${NAME} reference, as npm reads it, or null when it is one. */
function referenceProblem(entry) {
  if (!entry.hasValue) return 'no value';
  if (REFERENCE.test(entry.value)) return null;
  if (entry.value === '') return 'an empty value';
  if (entry.value.includes('${')) return 'a reference plus extra text';
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(entry.value)) return 'a bare $NAME, which npm does not expand';
  return 'a literal value';
}

/** The host a per-registry key names, or null when it names none. */
function authHost(key) {
  if (!key.startsWith('//')) return null;
  const at = key.indexOf('/:');
  return parseUrl(`https:${at === -1 ? key : key.slice(0, at + 1)}`)?.host.toLowerCase() || null;
}

/** The registries an .npmrc gives to scopes (@scope:registry=https://host/path/), as { base, host } by lower-case scope. */
function scopeRegistries(buffer) {
  const registries = new Map();
  if (!buffer) return registries;
  for (const entry of npmrcLines(textOf(buffer)).entries) {
    const scope = /^(@[^:/\s]+):registry$/i.exec(entry.key)?.[1]?.toLowerCase();
    if (!scope || entry.section !== '' || !entry.hasValue) continue;
    const url = parseUrl(entry.value);
    if (url && url.host) {
      const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
      registries.set(scope, { base: `${url.protocol}//${url.host}${pathname}`, host: url.host.toLowerCase() });
    } else registries.delete(scope);
  }
  return registries;
}

/** The variables an .npmrc's credential settings read, each with its line. */
function authReferences(buffer) {
  return npmrcLines(textOf(buffer))
    .entries.filter((entry) => credentialWord(settingOf(entry.key)) && REFERENCE.test(entry.value))
    .map((entry) => ({ name: /^\$\{([A-Za-z0-9_]+)/.exec(entry.value)[1], line: entry.line }));
}

/** The text a base64 value decodes to (npm's _auth is base64 of user:password), or null. */
function base64Text(value) {
  const compact = value.trim();
  if (compact.length < 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  return Buffer.from(compact, 'base64').toString('utf8');
}

/** A tracked file npm could be pointed at as an .npmrc: .npmrc, npmrc, or a copy such as .npmrc.bak or ci.npmrc. */
function isNpmrcName(rel) {
  const base = path.posix.basename(rel).toLowerCase();
  return /^\.?npmrc(?:\..*)?$|\.npmrc$/.test(base) && !/\.(?:[cm]?[jt]sx?|json|md)$/.test(base);
}

// The checks ---------------------------------------------------------------------------------

/** The package a packages-map key installs to: the key after its last node_modules/ (a backslash read as a slash). */
function keyName(key) {
  const normal = key.replace(/\\/g, '/');
  const at = normal.lastIndexOf('node_modules/');
  return at === -1 ? normal : normal.slice(at + 'node_modules/'.length);
}

const scopeOf = (name) => /^(@[^/]+)\//.exec(name ?? '')?.[1].toLowerCase() ?? null;
const isMotionPlus = (name) => /^@motionplus\//i.test(name ?? '') || /^motion-plus$/i.test(name ?? '');

/** The package and version an "npm:" alias installs: npm:@scope/name@1.2.3 is @scope/name at 1.2.3. */
function aliasOf(version) {
  const rest = version.slice('npm:'.length);
  const at = rest.lastIndexOf('@');
  return at > 0 ? { name: rest.slice(0, at), version: rest.slice(at + 1) } : { name: rest, version: undefined };
}

/** The registry a package comes from: the one .npmrc gives its scope, or registry.npmjs.org. */
function registryFor(name, registries) {
  const scope = scopeOf(name);
  const declared = scope ? registries.get(scope) : undefined;
  return declared ? { ...declared, scope } : { base: NPM_REGISTRY_URL, host: NPM_REGISTRY, scope: null };
}

/** The paths a registry's layout gives a package and version: name/-/name-version.tgz, with the scope's slash written / or %2f, or the scoped file name some registries use. */
function registryPaths(base, name, version) {
  const slash = name.startsWith('@') ? name.indexOf('/') : -1;
  const unscoped = slash === -1 ? name : name.slice(slash + 1);
  const names = slash === -1 ? [name] : [name, `${name.slice(0, slash)}%2f${unscoped}`, `${name.slice(0, slash)}%2F${unscoped}`];
  const addresses = names.map((one) => `${base}${one}/-/${unscoped}-${version}.tgz`);
  if (slash !== -1) addresses.push(`${base}${name}/-/${name}-${version}.tgz`);
  return addresses.map((address) => parseUrl(address)?.pathname).filter(Boolean);
}

/** What is wrong with the address a registry package is fetched from. Only a well-known host is named. */
function sourceProblems(address, registry, pkg, ctx) {
  const url = parseUrl(address);
  if (!url) return ['not an https address'];
  const problems = [];
  if (url.protocol !== 'https:') problems.push(`not https (${schemeName(url.protocol)})`);
  if (url.username) problems.push('a username');
  if (url.password) problems.push('a password');
  if (url.search || /^[^#]*\?/.test(address)) problems.push('a query string');
  if (url.hash || address.includes('#')) problems.push('a fragment');
  const host = url.host.toLowerCase();
  if (host !== registry.host) {
    problems.push(`${hostText(host, ctx)}, where this package may only come from ${registryText(registry, ctx.secrets)}`);
  } else if (!PLAIN_NAME.test(pkg.name ?? '') || !PLAIN_VERSION.test(pkg.version ?? '')) {
    problems.push('no plain name and version to check its path against');
  } else if (!registryPaths(registry.base, pkg.name, pkg.version).includes(url.pathname)) {
    problems.push(`a path other than the one ${registryText(registry, ctx.secrets)} gives this name and version (<registry>/<name>/-/<name>-<version>.tgz), so it could carry a token`);
  }
  return problems;
}

/** What is wrong with a local source: a query string, a fragment, credentials, or Motion+, which only its registry serves. */
function localProblems(address, pkg) {
  const problems = [];
  if (address.includes('?')) problems.push('a query string');
  if (address.includes('#')) problems.push('a fragment');
  if (credentialAddress(address)) problems.push('a username or password');
  if (isMotionPlus(pkg.name) || isMotionPlus(pkg.folder)) problems.push('a local source for Motion+, which may only come from its registry');
  return problems;
}

const hasIntegrity = (entry) => (lastString(entry, 'integrity') ?? '').split(/\s+/).some((part) => SRI.test(part));

const MOTION_PLUS_SOURCE = 'a source for Motion+ other than its registry';

/** Motion+ installs only from its registry: as a range, or as npm:@motionplus/<package> with a range. */
function motionPlusProblem(name, spec) {
  const s = spec.trim();
  const target = /^npm:/i.test(s) ? aliasOf(s).name : null;
  if (!isMotionPlus(name) && !(target !== null && isMotionPlus(target))) return null;
  if (target === null) return RANGE.test(s) ? null : MOTION_PLUS_SOURCE;
  const tail = s.slice('npm:'.length + target.length);
  return /^@motionplus\//i.test(target) && (tail === '' || (tail.startsWith('@') && RANGE.test(tail.slice(1)))) ? null : MOTION_PLUS_SOURCE;
}

/** Checks a map of dependency specs: an object of strings, each one clean. */
function checkSpecMap(group, segments, report, checked) {
  if (group.value.type !== 'object') {
    report(segments, group.line, `"${group.key}" is not an object of names and specs`);
    return;
  }
  for (const entry of entriesOf(group.value)) {
    const at = [...segments, entry.key];
    if (entry.value.type !== 'string') {
      report(at, entry.line, 'a spec that is not a string');
      continue;
    }
    checked.add(entry.value);
    const problems = specProblems(entry.value.value);
    const motion = motionPlusProblem(entry.key, entry.value.value);
    if (motion) problems.push(motion);
    if (problems.length > 0) report(at, entry.value.line, `the spec holds ${problems.join(', ')}`);
  }
}

function checkLockTree(file, tree, ctx, checked) {
  const report = (segments, line, message) => ctx.add('LOCK-SOURCE', file, `${jsonPath(segments, ctx.secrets)} (line ${line})`, message);
  const source = (field, segments, pkg) => {
    if (field.value.type !== 'string') {
      report(segments, field.line, `"${field.key}" is not a string`);
      return;
    }
    checked.add(field.value);
    const address = field.value.value;
    if (isLocal(address, pkg.link)) {
      const problems = localProblems(address, pkg);
      if (problems.length > 0) report(segments, field.line, `"${field.key}" holds ${problems.join(', ')}`);
      return;
    }
    const problems = sourceProblems(address, registryFor(pkg.name, ctx.registries), pkg, ctx);
    if (field.key === 'resolved' && !pkg.integrity) problems.push('no integrity, so npm would install whatever the address sends');
    if (problems.length > 0) report(segments, field.line, `"${field.key}" address: ${problems.join(', ')}`);
  };
  const versions = (value, segments, pkg, legacy) => {
    for (const each of fields(value, 'version')) {
      if (each.value.type !== 'string') continue;
      const version = each.value.value;
      if (/^npm:/i.test(version)) {
        // An alias: the part after the package's name is read as a spec.
        checked.add(each.value);
        const problems = specProblems(version);
        if (problems.length > 0) report([...segments, 'version'], each.line, `"version" holds ${problems.join(', ')}`);
      } else if (versionIsAddress(version, legacy)) source(each, [...segments, 'version'], { ...pkg, version: undefined });
    }
  };
  const inScope = (pkg, segments, line) => {
    const scope = scopeOf(pkg.folder);
    if (scope && ctx.registries.has(scope) && scopeOf(pkg.name) !== scope) {
      report(segments, line, `the folder is in ${scopeText(scope, ctx.secrets)}, a scope .npmrc gives a registry, but it holds a package of another scope or of none`);
    }
  };
  for (const packages of fields(tree, 'packages')) {
    if (packages.value.type !== 'object') {
      report(['packages'], packages.line, '"packages" is not an object');
      continue;
    }
    for (const { key, value, line } of entriesOf(packages.value)) {
      ctx.stats.entries += 1;
      const at = ['packages', key];
      if (value.type !== 'object') {
        report(at, line, 'an entry that is not an object');
        continue;
      }
      const folder = keyName(key);
      const raw = lastString(value, 'version');
      const alias = raw !== undefined && /^npm:/i.test(raw) ? aliasOf(raw) : null;
      const pkg = {
        name: alias?.name ?? lastString(value, 'name') ?? folder,
        folder,
        version: alias ? alias.version : raw,
        link: lastIsTrue(value, 'link'),
        integrity: hasIntegrity(value),
      };
      inScope(pkg, at, line);
      for (const resolved of fields(value, 'resolved')) source(resolved, [...at, 'resolved'], pkg);
      versions(value, at, pkg, false);
      for (const field of SPEC_FIELDS) for (const group of fields(value, field)) checkSpecMap(group, [...at, field], report, checked);
    }
  }
  const legacy = (node, segments) => {
    for (const dependencies of fields(node, 'dependencies')) {
      if (dependencies.value.type !== 'object') {
        report([...segments, 'dependencies'], dependencies.line, '"dependencies" is not an object');
        continue;
      }
      for (const { key, value, line } of entriesOf(dependencies.value)) {
        ctx.stats.entries += 1;
        const at = [...segments, 'dependencies', key];
        if (value.type !== 'object') {
          report(at, line, 'an entry that is not an object');
          continue;
        }
        const raw = lastString(value, 'version');
        const alias = raw !== undefined && /^npm:/i.test(raw) ? aliasOf(raw) : null;
        const pkg = { name: alias?.name ?? key, folder: key, version: alias ? alias.version : raw, link: false, integrity: hasIntegrity(value) };
        inScope(pkg, at, line);
        for (const resolved of fields(value, 'resolved')) source(resolved, [...at, 'resolved'], pkg);
        versions(value, at, pkg, true);
        for (const group of fields(value, 'requires')) checkSpecMap(group, [...at, 'requires'], report, checked);
        legacy(value, at);
      }
    }
  };
  legacy(tree, []);
}

function checkPackageTree(file, tree, ctx, checked) {
  const report = (segments, line, message) => ctx.add('PKG-SPEC', file, `${jsonPath(segments, ctx.secrets)} (line ${line})`, message);
  for (const field of SPEC_FIELDS) for (const group of fields(tree, field)) checkSpecMap(group, [field], report, checked);
  const overrides = (node, segments, line) => {
    if (node.type === 'string') {
      checked.add(node);
      const problems = specProblems(node.value);
      if (problems.length > 0) report(segments, node.line, `the spec holds ${problems.join(', ')}`);
      return;
    }
    if (node.type !== 'object') {
      report(segments, line, 'an override that is neither a spec nor an object');
      return;
    }
    for (const entry of entriesOf(node)) {
      checked.add(entry);
      const problems = new Set();
      const at = entry.key.indexOf('@', 1);
      if (at !== -1) for (const one of specProblems(entry.key.slice(at + 1))) problems.add(one);
      if (SCHEME.test(entry.key) || entry.key.includes('//')) for (const one of specProblems(entry.key)) problems.add(one);
      if (!problems.has('a username') && !problems.has('a password') && credentialAddress(entry.key)) {
        problems.add('an address with a password, or with a username other than git');
      }
      if (problems.size > 0) {
        ctx.add('PKG-SPEC', file, `${jsonPath(segments, ctx.secrets)} (a key, line ${entry.line})`, `the spec in this key holds ${[...problems].join(', ')}`);
      }
      overrides(entry.value, [...segments, entry.key], entry.line);
    }
  };
  for (const group of fields(tree, 'overrides')) overrides(group.value, ['overrides'], group.line);
  for (const group of fields(tree, 'publishConfig')) {
    report(['publishConfig'], group.line, 'publishConfig sets npm configuration, registries and auth included, for a site that publishes nothing; remove it');
  }
}

function checkJson(file, buffer, ctx) {
  const lockfile = LOCKFILES.has(file);
  const rule = lockfile ? 'LOCK-SOURCE' : 'PKG-SPEC';
  const text = textOf(buffer);
  let tree = null;
  try {
    JSON.parse(text);
    tree = parseTree(text);
  } catch (error) {
    // The parser's message quotes the file, so it is never printed.
    const why = error instanceof TooDeep ? `nested more than ${MAX_DEPTH} levels deep` : 'not valid JSON';
    ctx.add(rule, file, '(file)', `${why}, so its ${lockfile ? 'sources' : 'specs'} cannot be checked; the token checks read it line by line`);
  }
  // The whole text, each string written with an escape (it reads differently once decoded), and
  // each string with a space in it (base64 split by spaces reads whole once they are removed).
  const texts = [text];
  if (tree === null) {
    text.split(/\r\n|\r|\n/).forEach((line, index) => {
      if (line.length > MAX_STRING) ctx.add(rule, file, `line ${index + 1}`, 'a line longer than 64 KB, which no npm file needs');
      for (const shape of shapesIn(line)) ctx.add('TOKEN-SHAPE', file, `line ${index + 1}`, `text with the shape of ${shape}`);
    });
  } else {
    const checked = new Set();
    if (lockfile) checkLockTree(file, tree, ctx, checked);
    else checkPackageTree(file, tree, ctx, checked);
    eachString(tree, [], (string, segments, line, isKey, node, escaped) => {
      if (escaped || /\s/.test(string)) texts.push(string);
      const what = isKey ? 'a key' : 'a string';
      const where = () => `${jsonPath(segments, ctx.secrets)} (${isKey ? 'a key, ' : ''}line ${line})`;
      if (string.length > MAX_STRING) ctx.add(rule, file, where(), `${what} longer than 64 KB, which no npm file needs`);
      for (const shape of shapesIn(string)) ctx.add('TOKEN-SHAPE', file, where(), `${what} with the shape of ${shape}`);
      if (!checked.has(node) && credentialAddress(string)) {
        ctx.add(rule, file, where(), `${what} that holds an address with a password, or with a username other than git`);
      }
    });
  }
  for (const name of valuesInNpm(buffer, texts, ctx.secrets)) ctx.add('TOKEN-VALUE', file, '(file)', `the value of ${variableText(name, ctx.secrets)} is in this file`);
}

function checkNpmrc(rel, buffer, ctx) {
  const file = filePath(rel, ctx.secrets);
  const text = textOf(buffer);
  const texts = [text];
  if (text.includes('\u0000')) {
    ctx.add('NPMRC-AUTH', file, '(file)', 'NUL bytes, as in UTF-16 text without its byte-order mark: npm cannot read this file, and this check cannot read it line by line');
  }
  const { lines, entries, comments } = npmrcLines(text);
  lines.forEach((line, index) => {
    const where = `line ${index + 1}`;
    if (line.length > MAX_STRING) ctx.add('NPMRC-AUTH', file, where, 'a line longer than 64 KB, which no .npmrc needs');
    // npm's _auth is base64 of user:password, and a copy can sit on any line, a comment included.
    const decoded = (line.match(/[A-Za-z0-9+/]{12,}={0,2}/g) ?? []).map((run) => Buffer.from(run, 'base64').toString('utf8'));
    texts.push(...decoded);
    const shapes = new Set([line, ...decoded].flatMap(shapesIn));
    for (const shape of shapes) ctx.add('TOKEN-SHAPE', file, where, `text with the shape of ${shape}`);
    // A ${NAME} reference is set aside, since a long variable name is not a token, unless the
    // name itself looks like one: a token pasted inside ${...} is still committed.
    const tokenName = [...line.matchAll(REFERENCES)].some(([reference]) => tokenLike(reference.slice(2, -1).replace(/\?$/, '')));
    if (shapes.size === 0 && (tokenName || tokenLike(line.replace(REFERENCES, ''), true))) {
      ctx.add('TOKEN-SHAPE', file, where, 'text that looks like a token (a long mix of letters and digits, or a UUID)');
    }
  });
  /** An old auth line kept as a comment may hold a reference for documentation, never a literal. */
  const commentedAuth = (text, where) => {
    const body = text.trim();
    const eq = body.indexOf('=');
    if (eq === -1) return;
    const key = iniParse(body.slice(0, eq)).value;
    const entry = { hasValue: true, value: iniParse(body.slice(eq + 1)).value };
    texts.push(key, entry.value);
    if (!/^[@\w./:-]+$/.test(key)) return;
    const word = credentialWord(settingOf(key));
    const problem = word ? referenceProblem(entry) : null;
    if (problem) ctx.add('NPMRC-AUTH', file, where, `a commented-out key naming ${word} holds ${problem}; delete an old auth line rather than comment it out`);
  };
  for (const entry of entries) {
    const where = `line ${entry.line}`;
    const setting = settingOf(entry.key);
    const word = credentialWord(setting);
    const decoded = base64Text(entry.value);
    texts.push(entry.key, entry.value, ...(decoded === null ? [] : [decoded]));
    for (const piece of [entry.key, entry.value, decoded ?? '']) {
      for (const shape of shapesIn(piece)) ctx.add('TOKEN-SHAPE', file, where, `text with the shape of ${shape}`);
    }

    if (entry.key.includes('${')) {
      ctx.add('NPMRC-AUTH', file, where, 'a key with a ${...} reference in it: npm expands references in keys, so a split one can rebuild an auth key');
    }
    // npm drops an inline comment, as it drops a comment line: one after a value is read the same
    // way (an old auth line there fails, and the line scan above looks for tokens in it). A
    // comment inside a key has no honest use.
    if (entry.keyComment !== null) ctx.add('NPMRC-AUTH', file, where, 'a ; or # inside a key: npm cuts the key there, so text can hide in it; put comments on lines of their own');
    if (entry.valueComment !== null) commentedAuth(entry.valueComment, where);
    if (word) {
      const problem = referenceProblem(entry);
      if (problem) ctx.add('NPMRC-AUTH', file, where, `a key naming ${word} must hold exactly one \${NAME} reference and nothing else; this one holds ${problem}`);
      else {
        const host = authHost(entry.key);
        if (host === null) ctx.add('NPMRC-AUTH', file, where, `a key naming ${word} must start with the registry it is for (//host/path/:...), so npm sends the value nowhere else`);
        else if (!ctx.authHosts.has(host)) ctx.add('NPMRC-AUTH', file, where, `a key naming ${word} for a host no "@scope:registry" line names; npm would send the value there`);
      }
    } else if (entry.value.includes('${') && !REFERENCE.test(entry.value)) {
      ctx.add('NPMRC-AUTH', file, where, 'a ${...} reference inside a longer value: npm expands it anywhere, so a split one can rebuild a literal; a reference may only stand alone');
    }
    // Written with _ for -, as npm reads a setting from the environment, so a spelling does not slip past.
    const forbidden = setting.startsWith('_') ? setting : setting.replace(/_/g, '-');
    if (FORBIDDEN_SETTINGS.has(forbidden)) ctx.add('NPMRC-AUTH', file, where, `sets ${forbidden}, which ${FORBIDDEN_SETTINGS.get(forbidden)}`);
    if (setting === 'strict-ssl' && /^false$/i.test(entry.value)) ctx.add('NPMRC-AUTH', file, where, `turns strict-ssl off, which ${TRUST.replace('trusts another certificate authority', 'trusts any certificate')}`);
    if (entry.key.toLowerCase() === 'registry' && entry.hasValue && !/^https:\/\/registry\.npmjs\.org\/?$/.test(entry.value)) {
      ctx.add('NPMRC-AUTH', file, where, 'the default registry may only be https://registry.npmjs.org/: another would serve every public package, and receive any token set for its host');
    }

    // A per-registry key (//host/path/:_authToken) names its registry's address.
    if (entry.key.startsWith('//')) {
      const at = entry.key.indexOf('/:');
      const keyAddress = at === -1 ? entry.key : entry.key.slice(0, at + 1);
      const url = parseUrl(`https:${keyAddress}`);
      const problems = [];
      if (url?.username) problems.push('a username');
      if (url?.password) problems.push('a password');
      if (url?.search || /^[^#]*\?/.test(keyAddress)) problems.push('a query string');
      if (problems.length > 0) ctx.add('NPMRC-AUTH', file, where, `the registry address in this key holds ${problems.join(', ')}`);
    }

    // An address in a value: a registry's must be https with no query string; none may hold
    // credentials. A value that is only a ${NAME} reference has nothing to check here.
    const registry = /(?:^|:)registry$/i.test(entry.key);
    const value = entry.value.trim();
    const valueIsAddress = (registry && entry.hasValue) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//');
    if (valueIsAddress && !REFERENCE.test(value)) {
      const url = parseUrl(value.startsWith('//') ? `https:${value}` : value);
      const problems = [];
      if (!url) problems.push('not an https address');
      else {
        if (registry && url.protocol !== 'https:') problems.push(`not https (${schemeName(url.protocol)})`);
        if (url.username) problems.push('a username');
        if (url.password) problems.push('a password');
        if (registry && (url.search || /^[^#]*\?/.test(value))) problems.push('a query string');
      }
      if (problems.length > 0) ctx.add('NPMRC-AUTH', file, where, `${registry ? 'a registry address' : 'an address'}: ${problems.join(', ')}`);
    }
  }
  for (const comment of comments) commentedAuth(comment.text, `line ${comment.line}`);
  for (const name of valuesInNpm(buffer, texts, ctx.secrets)) ctx.add('TOKEN-VALUE', file, '(file)', `the value of ${variableText(name, ctx.secrets)} is in this file`);
}

/** Checks one set of npm's files (the copies on disk, or the staged copies), given as { path: Buffer }. */
function checkFiles(files, ctx, rootNpmrc) {
  const registries = scopeRegistries(rootNpmrc);
  const view = { ...ctx, registries };
  for (const file of JSON_FILES) if (files[file]) checkJson(file, files[file], view);
  for (const rel of Object.keys(files).sort()) {
    if (JSON_FILES.includes(rel)) continue;
    const authHosts = new Set([...registries.values(), ...scopeRegistries(files[rel]).values()].map(({ host }) => host));
    checkNpmrc(rel, files[rel], { ...view, authHosts });
  }
}

function collector() {
  const findings = [];
  const seen = new Set();
  const add = (rule, file, where, message) => {
    const key = [rule, file, where, message].join('\u0000');
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ rule, file, where, message });
  };
  return { findings, add };
}

// Git ------------------------------------------------------------------------------------------

/** True when `root` or a folder above it holds a .git folder or file. */
function inRepository(root) {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

/** The index as git ls-files -s -z lists it, read as bytes: { mode, sha, stage, rel, readable }. */
function parseIndex(listed) {
  const entries = [];
  let start = 0;
  for (let i = 0; i < listed.length; i += 1) {
    if (listed[i] !== 0) continue;
    const record = listed.subarray(start, i);
    start = i + 1;
    const tab = record.indexOf(9);
    const meta = tab === -1 ? [] : record.subarray(0, tab).toString('latin1').split(' ');
    if (meta.length !== 3) return null;
    const raw = record.subarray(tab + 1);
    const rel = raw.toString('utf8');
    // A name that is not UTF-8 cannot be opened on disk; its staged copy is still read by blob id.
    entries.push({ mode: meta[0], sha: meta[1], stage: meta[2], rel, readable: Buffer.from(rel, 'utf8').equals(raw) });
  }
  return entries;
}

/**
 * Git at `root`: null outside a repository, { failed: true } in one where git cannot run or list
 * what it tracks, or the index entries (with blob sizes), a reader for blobs by id, and the hooks
 * folder.
 */
function gitAt(root) {
  // A hook may set GIT_DIR for its own repository; the folder being checked decides here.
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const run = (args, input, maxBuffer = 64 * 1024 * 1024) => {
    const result = spawnSync('git', args, { cwd: root, env, input, maxBuffer, windowsHide: true });
    return result.error || result.status !== 0 ? null : result.stdout;
  };
  if (run(['rev-parse', '--is-inside-work-tree'])?.toString().trim() !== 'true') return inRepository(root) ? { failed: true } : null;
  const listed = run(['ls-files', '-s', '-z']);
  const entries = listed === null ? null : parseIndex(listed);
  if (entries === null) return { failed: true };
  const ids = [...new Set(entries.filter((entry) => entry.mode !== '160000').map((entry) => entry.sha))];
  const sizes = new Map();
  if (ids.length > 0) {
    const checked = run(['cat-file', '--batch-check'], `${ids.join('\n')}\n`);
    if (checked === null) return { failed: true };
    for (const line of checked.toString('latin1').split('\n')) {
      const [sha, type, size] = line.split(' ');
      if (type === 'blob') sizes.set(sha, Number(size));
    }
  }
  for (const entry of entries) entry.size = sizes.get(entry.sha) ?? null;
  /** The blobs with these ids, as { sha: Buffer }, or null when git cannot read them. */
  const read = (wanted) => {
    const blobs = new Map();
    let batch = [];
    let bytes = 0;
    const flush = () => {
      if (batch.length === 0) return true;
      const out = run(['cat-file', '--batch'], `${batch.join('\n')}\n`, bytes + batch.length * 128 + 1024 * 1024);
      batch = [];
      bytes = 0;
      if (out === null) return false;
      for (let at = 0; at < out.length; ) {
        const eol = out.indexOf(10, at);
        if (eol === -1) return false;
        const [sha, type, size] = out.subarray(at, eol).toString('latin1').split(' ');
        at = eol + 1;
        if (size === undefined) continue;
        if (type === 'blob') blobs.set(sha, out.subarray(at, at + Number(size)));
        at += Number(size) + 1;
      }
      return true;
    };
    for (const id of new Set(wanted)) {
      if (!sizes.has(id)) continue;
      batch.push(id);
      bytes += sizes.get(id);
      if (bytes >= BATCH_BYTES && !flush()) return null;
    }
    return flush() ? blobs : null;
  };
  const hooks = run(['rev-parse', '--git-path', 'hooks']);
  return { entries, read, hooksDir: hooks === null ? null : path.resolve(root, hooks.toString().trim()) };
}

/** Outside git: every .npmrc (or copy of one) below `root`, leaving out node_modules and .git. */
function npmrcBelow(root, dir = '', out = []) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') npmrcBelow(root, rel, out);
    } else if (entry.isFile() && isNpmrcName(rel)) out.push(rel);
  }
  return out;
}

function readEach(names, read) {
  const files = {};
  for (const rel of names) {
    const buffer = read(rel);
    if (buffer) files[rel] = buffer;
  }
  return files;
}

function sameFiles(a, b) {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((rel) => a[rel] && b[rel] && a[rel].equals(b[rel]));
}

/** A file on disk, when it is a file no larger than `limit`. */
function readFile(full, limit = Infinity) {
  try {
    const stat = fs.statSync(full);
    return stat.isFile() && stat.size <= limit ? fs.readFileSync(full) : null;
  } catch {
    return null;
  }
}

/** TOKEN-VALUE in every other tracked file up to MAX_SEARCHED, on disk and staged. Returns how many were searched, or null if git failed. */
function searchTracked(root, git, secrets, add) {
  const entries = git.entries.filter(
    (entry) => entry.mode !== '160000' && entry.size !== null && entry.size <= MAX_SEARCHED && !JSON_FILES.includes(entry.rel) && !isNpmrcName(entry.rel),
  );
  const blobs = git.read(entries.map((entry) => entry.sha));
  if (blobs === null) return null;
  for (const entry of entries) {
    // A symbolic link commits only the path it points to, which its staged copy holds.
    const disk = entry.readable && entry.mode !== '120000' ? readFile(path.join(root, entry.rel), MAX_SEARCHED) : null;
    const blob = blobs.get(entry.sha);
    const onDisk = disk ? valuesInFile(disk, secrets) : [];
    const staged = !blob ? [] : disk && disk.equals(blob) ? onDisk : valuesInFile(blob, secrets);
    if (onDisk.length === 0 && staged.length === 0) continue;
    const file = filePath(entry.rel, secrets);
    for (const name of onDisk) add('TOKEN-VALUE', file, '(file)', `the value of ${variableText(name, secrets)} is in this file`);
    for (const name of staged) if (!onDisk.includes(name)) add('TOKEN-VALUE', `${file} (staged)`, '(file)', `the value of ${variableText(name, secrets)} is in this file`);
  }
  return entries.length;
}

const ARCHIVE = /\.(?:tgz|tar|tar\.(?:gz|zst|xz|bz2|br|lz4))$/i;
const siteSource = (name) => /\.(?:[cm]?tsx?|css)$/i.test(name) && !/\.d\.[cm]?tsx?$/i.test(name);
const motionPlusFolder = (part) => part.toLowerCase().replace(/[^a-z0-9]/g, '') === 'motionplus';

/** MOTIONPLUS-SOURCE on what git tracks. Returns false when git cannot read the package.json files. */
function checkSource(git, secrets, add) {
  const folders = new Map();
  const count = (folder, kind) => {
    const one = folders.get(folder) ?? { kind, count: 0 };
    one.count += 1;
    folders.set(folder, one);
  };
  for (const entry of git.entries) {
    const parts = entry.rel.split('/');
    const modules = parts.findIndex((part) => part.toLowerCase() === 'node_modules');
    if (modules !== -1) {
      count(parts.slice(0, modules + 1).join('/'), 'modules');
      continue;
    }
    const motion = parts.slice(0, -1).findIndex(motionPlusFolder);
    if (motion !== -1 && !siteSource(parts[parts.length - 1])) count(parts.slice(0, motion + 1).join('/'), 'motion');
    if (ARCHIVE.test(entry.rel)) {
      add('MOTIONPLUS-SOURCE', filePath(entry.rel, secrets), '(tracked)', "a package archive, which can hold a package's source, Motion+ included; no archive may be committed");
    }
  }
  for (const [folder, { kind, count: n }] of folders) {
    const paths = `${n} ${kind === 'modules' ? 'path' : 'file'}${n === 1 ? '' : 's'}`;
    add(
      'MOTIONPLUS-SOURCE',
      `${filePath(folder, secrets)}/`,
      '(tracked)',
      kind === 'modules'
        ? `git tracks ${paths} here; nothing inside node_modules/ may be committed`
        : `git tracks ${paths} here that are not the site's own TypeScript or CSS; a folder named after Motion+ may hold only the site's own code, never Motion+ source`,
    );
  }
  const manifests = git.entries.filter((entry) => path.posix.basename(entry.rel) === 'package.json');
  const blobs = git.read(manifests.map((entry) => entry.sha));
  if (blobs === null) return false;
  for (const entry of manifests) {
    const buffer = blobs.get(entry.sha);
    if (!buffer) continue;
    const text = textOf(buffer);
    let name;
    try {
      name = JSON.parse(text)?.name;
    } catch {
      name = /"name"\s*:\s*"([^"]*)"/.exec(text)?.[1];
    }
    if (typeof name === 'string' && isMotionPlus(name)) {
      add('MOTIONPLUS-SOURCE', filePath(entry.rel, secrets), '(tracked)', 'a package.json that names a Motion+ package, so Motion+ source is here');
    }
  }
  return true;
}

/** A note when package.json asks the pre-commit hook to run this check and the installed hook does not. */
function hookNote(git, packageJson) {
  if (!git.hooksDir || !packageJson) return null;
  let wanted;
  try {
    wanted = JSON.parse(textOf(packageJson))?.['simple-git-hooks']?.['pre-commit'];
  } catch {
    return null;
  }
  if (typeof wanted !== 'string' || !wanted.includes('check:lockfile')) return null;
  const installed = readFile(path.join(git.hooksDir, 'pre-commit'), MAX_STRING)?.toString('utf8') ?? '';
  if (installed.includes('check:lockfile')) return null;
  return 'the installed pre-commit hook does not run check:lockfile, though package.json asks for it; run "npx simple-git-hooks" in this clone, then commit';
}

/**
 * Runs every rule on the repository at `root`. `env` holds the secret variables to look for.
 * Returns { findings: [{ rule, file, where, message }], notes, stats }; nothing returned holds a
 * secret.
 */
export function checkLockfile(root, env = {}) {
  const { findings, add } = collector();
  const keyOf = (f) => [f.rule, f.file, f.where, f.message].join('\u0000');
  const notes = [];
  const stats = { entries: 0 };
  const found = gitAt(root);
  const git = found && !found.failed ? found : null;
  const gitFailed = () =>
    add('MOTIONPLUS-SOURCE', '(repository)', '(git)', 'this folder is in a git repository, but git could not run, or list or read what it tracks, so the check cannot finish');
  if (found?.failed) gitFailed();

  // npm's files: on disk, and staged.
  const tracked = git ? git.entries.filter((entry) => entry.stage === '0') : [];
  const npmrcTracked = git ? tracked.filter((entry) => isNpmrcName(entry.rel)).map((entry) => entry.rel) : npmrcBelow(root);
  const npmrcNames = [...new Set([...npmrcTracked, ...(readFile(path.join(root, '.npmrc')) ? ['.npmrc'] : [])])];
  const working = readEach([...JSON_FILES, ...npmrcNames], (rel) => readFile(path.join(root, rel)));
  let index = null;
  if (git) {
    const npmEntries = tracked.filter((entry) => JSON_FILES.includes(entry.rel) || isNpmrcName(entry.rel));
    const blobs = git.read(npmEntries.map((entry) => entry.sha));
    if (blobs === null) gitFailed();
    else {
      index = {};
      for (const entry of npmEntries) if (blobs.has(entry.sha)) index[entry.rel] = blobs.get(entry.sha);
    }
  }

  // The variables npm reads as credentials here, and MOTION_TOKEN once Motion+ is a dependency:
  // each must be set where this check runs, and each is searched for.
  const required = new Map();
  const views = [working, index ?? {}];
  for (const files of views) {
    for (const [rel, buffer] of Object.entries(files)) {
      if (JSON_FILES.includes(rel)) continue;
      for (const { name, line } of authReferences(buffer)) {
        if (!required.has(name)) required.set(name, { file: rel, where: `line ${line}`, motion: false });
      }
    }
  }
  for (const files of views) {
    for (const file of JSON_FILES) {
      if (!required.has('MOTION_TOKEN') && files[file] && /@motionplus\//i.test(textOf(files[file]))) {
        required.set('MOTION_TOKEN', { file, where: '(file)', motion: true });
      }
    }
  }
  const secrets = secretsOf(env, [...new Set([...SECRET_VARIABLES, ...required.keys()])]);
  for (const [name, { file, where, motion }] of required) {
    if (String(env[name] ?? '').trim().length < MIN_SECRET_LENGTH) {
      const why = motion ? 'Motion+ is a dependency here, so npm needs MOTION_TOKEN' : `this auth line reads ${variableText(name, secrets)}`;
      add(
        'TOKEN-VALUE',
        filePath(file, secrets),
        where,
        `${why}, and it is not set where this check runs (or is shorter than ${MIN_SECRET_LENGTH} characters), so its value cannot be searched for; set it wherever npm or this check runs`,
      );
    }
  }

  checkFiles(working, { add, secrets, stats }, working['.npmrc']);
  let staged = null;
  if (index) {
    staged = sameFiles(working, index) ? 'same' : 'checked';
    if (staged === 'checked') {
      const extra = collector();
      checkFiles(index, { add: extra.add, secrets, stats: { entries: 0 } }, index['.npmrc'] ?? working['.npmrc']);
      const known = new Set(findings.map(keyOf));
      for (const f of extra.findings) if (!known.has(keyOf(f))) add(f.rule, `${f.file} (staged)`, f.where, f.message);
    }
  }

  let searched = null;
  if (git) {
    if (secrets.length > 0) {
      searched = searchTracked(root, git, secrets, add);
      if (searched === null) gitFailed();
    }
    if (!checkSource(git, secrets, add)) gitFailed();
    const note = hookNote(git, working['package.json']);
    if (note) notes.push(note);
  } else if (!found) {
    notes.push('MOTIONPLUS-SOURCE skipped: this folder is not in a git repository, so its tracked paths cannot be listed. Every .npmrc below it was checked.');
  }

  return {
    findings,
    notes,
    stats: {
      files: JSON_FILES.filter((file) => working[file]),
      entries: stats.entries,
      npmrc: npmrcNames.filter((rel) => working[rel]).length + Object.keys(index ?? {}).filter((rel) => !JSON_FILES.includes(rel) && !working[rel]).length,
      tracked: git ? git.entries.length : null,
      staged,
      searched,
      shapes: SHAPES.length,
      secrets: secrets.length,
    },
  };
}

/** The lines the command prints: one per finding, the notes, and the summary. */
export function reportLines({ findings, notes, stats }) {
  const lines = findings.map((f) => `ERROR   ${f.file}  ${f.where}  ${f.rule}  ${f.message}`);
  for (const note of notes) lines.push(`NOTE    ${note}`);
  const parts = [
    stats.files.length > 0 ? stats.files.join(', ') : 'no package.json or lockfile',
    `${stats.entries} lockfile entries`,
    `${stats.npmrc} .npmrc file${stats.npmrc === 1 ? '' : 's'}`,
    stats.tracked === null ? 'tracked paths not listed' : `${stats.tracked} tracked paths`,
    ...(stats.staged === null ? [] : [stats.staged === 'same' ? 'staged copies the same' : 'staged copies checked']),
    ...(stats.searched === null || stats.searched === undefined ? [] : [`${stats.searched} other tracked files searched for values`]),
    `${stats.shapes} token shapes`,
    `${stats.secrets} secret variable${stats.secrets === 1 ? '' : 's'} set here`,
  ];
  lines.push(`check:lockfile: ${parts.join(', ')}: ${findings.length} error${findings.length === 1 ? '' : 's'}`);
  return lines;
}

function main() {
  const usage = 'Usage: node scripts/check-lockfile.mjs [--root <repository directory>]';
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root' && args[i + 1] !== undefined) {
      root = path.resolve(args[i + 1]);
      i += 1;
    } else {
      console.error(usage);
      process.exit(1);
    }
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`check:lockfile: no folder at ${printable(root)}.`);
    process.exit(1);
  }
  let result;
  try {
    result = checkLockfile(root, scanEnvironment(root));
  } catch (error) {
    // An error's message can quote a file, so only its name is printed; a check that cannot
    // finish fails.
    console.error(`check:lockfile: the check could not finish (${printable(error?.name ?? 'an error')}), so it fails.`);
    process.exit(1);
  }
  for (const line of reportLines(result)) console.log(line);
  process.exit(result.findings.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
