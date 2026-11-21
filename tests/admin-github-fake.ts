/**
 * A small in-memory GitHub for the admin's server tests: refs, commits, trees, and blobs that
 * behave like Git's (non-forced ref updates must fast-forward, merges are three-way and report
 * conflicts, compare counts commits both ways), behind the REST paths lib/admin/server/repo.ts
 * and deploy.ts use. Nothing reaches the network: any other address is recorded and refused.
 *
 * Not a test file (Vitest runs tests/**\/*.test.ts only). Synthetic values only.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import { serializeContent, textDigest, type ContentResponse, type SaveBody } from '../lib/admin/contract';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth';

export const FAKE_REPO = 'owner/site-repo';
export const FAKE_API = `https://api.github.com/repos/${FAKE_REPO}`;
export const ORIGIN = 'https://admin.test';
export const ROOT = path.resolve(__dirname, '..');

/** Synthetic settings: none of these is a real credential or a real private term. */
export const TEST_ENV: Readonly<Record<string, string>> = {
  ADMIN_PASSWORD: 'synthetic admin password, tests only',
  SESSION_SECRET: 'synthetic-session-secret-long-enough-0123456789abcdef',
  // Token-shaped values are assembled at run time, so no source line looks like a real credential.
  GITHUB_TOKEN: ['github', 'pat', 'SYNTHETIC0TOKEN0FOR0TESTS0ONLY0abcdef'].join('_'),
  GITHUB_REPO: FAKE_REPO,
  GITHUB_BRANCH: 'main',
  GITHUB_DRAFT_BRANCH: 'draft',
  CONTENT_BLOCKLIST: 'zorblaxian|cs:Quuxworth',
  BLOB_READ_WRITE_TOKEN: ['vercel', 'blob', 'rw', 'TestStore123', 'SYNTHETICblobSECRETpart'].join('_'),
  VERCEL_TOKEN: 'SYNTHETICvercelTOKENvalue123',
  VERCEL_PROJECT_ID: 'prj_SYNTHETICproject',
};

/** Every variable the admin reads, set to a synthetic value or emptied, so the machine's own settings never leak in. */
export function stubAdminEnv(overrides: Record<string, string> = {}): void {
  const cleared = [
    'VERCEL',
    'CI',
    'VERCEL_ENV',
    'VERCEL_TEAM_ID',
    'VERCEL_BRANCH_URL',
    'VERCEL_GIT_COMMIT_REF',
    'VERCEL_GIT_COMMIT_SHA',
    'DRAFT_PREVIEW_URL',
    'NEXT_PUBLIC_SITE_URL',
    'BLOB_STORE_HOST',
  ];
  for (const name of cleared) vi.stubEnv(name, '');
  for (const [name, value] of Object.entries({ ...TEST_ENV, ...overrides })) vi.stubEnv(name, value);
}

/** A request to an admin route as the admin page sends it: this origin, a session, JSON. */
export function adminRequest(
  method: 'GET' | 'POST' | 'DELETE',
  route: string,
  options: { body?: unknown; origin?: string | null; session?: boolean } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.session !== false) headers.cookie = `${SESSION_COOKIE}=${createSessionToken(process.env).token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`${ORIGIN}${route}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/**
 * `SaveBody.expected` as the admin sends it for content it loaded: the digest of every file it
 * holds (`serializeContent` of the loaded data), and null for each path in `fresh` it holds none of.
 */
export function expectedFrom(content: ContentResponse, fresh: readonly string[] = []): SaveBody['expected'] {
  const expected: SaveBody['expected'] = {};
  for (const file of [content.site, ...content.projects]) expected[file.file] = textDigest(serializeContent(file.data));
  for (const path of fresh) if (!Object.hasOwn(expected, path)) expected[path] = null;
  return expected;
}

/** A save body on loaded `content`, as the admin builds it: its head as `base`, and `expected`. */
export function saveBodyFrom(content: ContentResponse, files: SaveBody['files'], deletes: string[] = []): SaveBody {
  return { base: content.head, files, deletes, expected: expectedFrom(content, [...files.map((file) => file.path), ...deletes]) };
}

/** A fake GitHub with the seed on `main`, installed as the global fetch. */
export function installFakeGitHub(live = 'main'): FakeGitHub {
  const fake = new FakeGitHub();
  fake.init(live, seedFiles(ROOT));
  vi.stubGlobal('fetch', fake.fetch);
  return fake;
}

interface TreeEntry {
  name: string;
  type: 'blob' | 'tree';
  sha: string;
}

interface CommitObject {
  tree: string;
  parents: string[];
  message: string;
}

export interface FakeCall {
  method: string;
  /** The path after /repos/{repo}, with its query. */
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface FakeDeployment {
  id: number;
  sha: string;
  environment: string;
  created_at: string;
  statuses: { state: string; environment_url?: string; created_at: string }[];
}

type Reply = { status: number; body?: unknown };
type Override = Reply | ((call: FakeCall) => Reply | undefined);

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function blobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}

const encoder = new TextEncoder();

export class FakeGitHub {
  readonly blobs = new Map<string, Uint8Array>();
  readonly trees = new Map<string, TreeEntry[]>();
  readonly commits = new Map<string, CommitObject>();
  readonly refs = new Map<string, string>();
  readonly calls: FakeCall[] = [];
  /** Addresses outside the fake that something tried to reach. */
  readonly unexpected: string[] = [];
  /** Replies that replace the fake for "METHOD /path" (the path without its query). */
  readonly overrides = new Map<string, Override>();
  /** Deployment records; null makes the deployments API answer 403, as for a token without Deployments read. */
  deployments: FakeDeployment[] | null = null;
  permissions: Record<string, boolean> = { admin: false, push: true, pull: true };
  private counter = 0;

  // -------------------------------------------------------------------------------------------
  // Objects
  // -------------------------------------------------------------------------------------------

  putBlob(bytes: Uint8Array): string {
    const sha = blobSha(bytes);
    this.blobs.set(sha, bytes);
    return sha;
  }

  private putTree(entries: TreeEntry[]): string {
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const sha = sha1(`tree ${JSON.stringify(sorted)}`);
    this.trees.set(sha, sorted);
    return sha;
  }

  private putCommit(tree: string, parents: string[], message: string): string {
    this.counter += 1;
    const sha = sha1(`commit ${this.counter} ${tree} ${parents.join(' ')} ${message}`);
    this.commits.set(sha, { tree, parents, message });
    return sha;
  }

  /** A tree from a flat map of path to blob sha. */
  private treeOf(flat: Map<string, string>): string {
    type Level = Map<string, Level | string>;
    const root: Level = new Map();
    for (const [file, sha] of flat) {
      const parts = file.split('/');
      let level = root;
      for (const part of parts.slice(0, -1)) {
        let next = level.get(part);
        if (!(next instanceof Map)) {
          next = new Map();
          level.set(part, next);
        }
        level = next;
      }
      level.set(parts[parts.length - 1], sha);
    }
    const build = (level: Level): string =>
      this.putTree(
        [...level].map(([name, value]): TreeEntry =>
          typeof value === 'string' ? { name, type: 'blob', sha: value } : { name, type: 'tree', sha: build(value) },
        ),
      );
    return build(root);
  }

  /** Every file of a tree, by path. */
  flatten(treeSha: string, prefix = ''): Map<string, string> {
    const out = new Map<string, string>();
    for (const entry of this.trees.get(treeSha) ?? []) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.type === 'blob') out.set(full, entry.sha);
      else for (const [file, sha] of this.flatten(entry.sha, full)) out.set(file, sha);
    }
    return out;
  }

  /** The files at a commit or branch, by path, as text. */
  filesAt(refOrSha: string): Map<string, string> {
    const sha = this.resolve(refOrSha);
    const out = new Map<string, string>();
    if (!sha) return out;
    for (const [file, blob] of this.flatten(this.commits.get(sha)!.tree)) {
      out.set(file, new TextDecoder().decode(this.blobs.get(blob)));
    }
    return out;
  }

  resolve(refOrSha: string): string | null {
    if (this.commits.has(refOrSha)) return refOrSha;
    return this.refs.get(refOrSha) ?? null;
  }

  private ancestors(sha: string): Set<string> {
    const seen = new Set<string>();
    const queue = [sha];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(this.commits.get(next)?.parents ?? []));
    }
    return seen;
  }

  private mergeBase(a: string, b: string): string | null {
    const ofA = this.ancestors(a);
    const queue = [b];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      if (ofA.has(next)) return next;
      queue.push(...(this.commits.get(next)?.parents ?? []));
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Setting up a repository
  // -------------------------------------------------------------------------------------------

  /** A first commit on `branch` holding `files`. */
  init(branch: string, files: Map<string, Uint8Array>): string {
    const flat = new Map<string, string>();
    for (const [file, bytes] of files) flat.set(file, this.putBlob(bytes));
    const sha = this.putCommit(this.treeOf(flat), [], 'initial');
    this.refs.set(branch, sha);
    return sha;
  }

  /** A commit on `branch` (as if someone pushed): text or bytes to write, null to remove. */
  push(branch: string, changes: Record<string, string | Uint8Array | null>, message = 'push'): string {
    const head = this.refs.get(branch);
    if (!head) throw new Error(`no branch ${branch}`);
    const flat = this.flatten(this.commits.get(head)!.tree);
    for (const [file, value] of Object.entries(changes)) {
      if (value === null) flat.delete(file);
      else flat.set(file, this.putBlob(typeof value === 'string' ? encoder.encode(value) : value));
    }
    const sha = this.putCommit(this.treeOf(flat), [head], message);
    this.refs.set(branch, sha);
    return sha;
  }

  /** Commit messages from `sha` back to the root, newest first, first parents only. */
  log(refOrSha: string): string[] {
    const out: string[] = [];
    let sha = this.resolve(refOrSha);
    while (sha) {
      const commit = this.commits.get(sha)!;
      out.push(commit.message);
      sha = commit.parents[0] ?? null;
    }
    return out;
  }

  writes(): FakeCall[] {
    return this.calls.filter((call) => call.method !== 'GET');
  }

  steps(): string[] {
    return this.calls.map((call) => `${call.method} ${call.path.split('?')[0]}`);
  }

  // -------------------------------------------------------------------------------------------
  // The REST API
  // -------------------------------------------------------------------------------------------

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(FAKE_API)) {
      this.unexpected.push(url);
      throw new Error('unexpected address');
    }
    const method = (init?.method ?? 'GET').toUpperCase();
    const full = url.slice(FAKE_API.length);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: FakeCall = { method, path: full, body, headers: Object.fromEntries(new Headers(init?.headers).entries()) };
    this.calls.push(call);
    const key = `${method} ${full.split('?')[0]}`;
    const override = this.overrides.get(key);
    const replaced = typeof override === 'function' ? override(call) : override;
    const reply = replaced ?? this.route(call);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
  };

  private route(call: FakeCall): Reply {
    const [pathname, query = ''] = call.path.split('?');
    const params = new URLSearchParams(query);
    const body = (call.body ?? {}) as Record<string, any>;
    const notFound: Reply = { status: 404, body: { message: 'Not Found' } };
    let match: RegExpExecArray | null;

    if (call.method === 'GET' && pathname === '') {
      return { status: 200, body: { full_name: FAKE_REPO, permissions: this.permissions } };
    }
    if (call.method === 'GET' && (match = /^\/git\/ref\/heads\/(.+)$/.exec(pathname))) {
      const branch = decodeURIComponent(match[1]);
      const sha = this.refs.get(branch);
      return sha ? { status: 200, body: { ref: `refs/heads/${branch}`, object: { sha, type: 'commit' } } } : notFound;
    }
    if (call.method === 'POST' && pathname === '/git/refs') {
      const branch = String(body.ref).replace(/^refs\/heads\//, '');
      if (this.refs.has(branch)) return { status: 422, body: { message: 'Reference already exists' } };
      if (!this.commits.has(body.sha)) return { status: 422, body: { message: 'Object does not exist' } };
      this.refs.set(branch, body.sha);
      return { status: 201, body: { ref: body.ref, object: { sha: body.sha } } };
    }
    if (call.method === 'PATCH' && (match = /^\/git\/refs\/heads\/(.+)$/.exec(pathname))) {
      const branch = decodeURIComponent(match[1]);
      const current = this.refs.get(branch);
      if (!current) return { status: 422, body: { message: 'Reference does not exist' } };
      if (!this.commits.has(body.sha)) return { status: 422, body: { message: 'Object does not exist' } };
      if (!body.force && !this.ancestors(body.sha).has(current)) {
        return { status: 422, body: { message: 'Update is not a fast forward' } };
      }
      this.refs.set(branch, body.sha);
      return { status: 200, body: { ref: `refs/heads/${branch}`, object: { sha: body.sha } } };
    }
    if (call.method === 'GET' && (match = /^\/git\/commits\/([0-9a-f]{40})$/.exec(pathname))) {
      const commit = this.commits.get(match[1]);
      if (!commit) return notFound;
      return { status: 200, body: { sha: match[1], tree: { sha: commit.tree }, parents: commit.parents.map((sha) => ({ sha })), message: commit.message } };
    }
    if (call.method === 'GET' && (match = /^\/git\/trees\/([0-9a-f]{40})$/.exec(pathname))) {
      const entries = this.trees.get(match[1]);
      if (!entries) return notFound;
      const list = (sha: string, prefix: string): unknown[] =>
        (this.trees.get(sha) ?? []).flatMap((entry) => {
          const full = prefix ? `${prefix}/${entry.name}` : entry.name;
          const own = {
            path: full,
            mode: entry.type === 'tree' ? '040000' : '100644',
            type: entry.type,
            sha: entry.sha,
            ...(entry.type === 'blob' ? { size: this.blobs.get(entry.sha)?.byteLength ?? 0 } : {}),
          };
          return entry.type === 'tree' && params.get('recursive') ? [own, ...list(entry.sha, full)] : [own];
        });
      return { status: 200, body: { sha: match[1], tree: list(match[1], ''), truncated: false } };
    }
    if (call.method === 'GET' && (match = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(pathname))) {
      const bytes = this.blobs.get(match[1]);
      if (!bytes) return notFound;
      return { status: 200, body: { sha: match[1], size: bytes.byteLength, encoding: 'base64', content: Buffer.from(bytes).toString('base64') } };
    }
    if (call.method === 'POST' && pathname === '/git/blobs') {
      if (body.encoding !== 'base64') return { status: 422, body: { message: 'Invalid encoding' } };
      return { status: 201, body: { sha: this.putBlob(new Uint8Array(Buffer.from(body.content, 'base64'))) } };
    }
    if (call.method === 'POST' && pathname === '/git/trees') {
      if (!this.trees.has(body.base_tree)) return { status: 422, body: { message: 'Invalid base_tree' } };
      const flat = this.flatten(body.base_tree);
      for (const entry of body.tree as { path: string; sha: string | null }[]) {
        if (entry.sha === null) {
          if (!flat.has(entry.path)) return { status: 422, body: { message: 'Path not found' } };
          flat.delete(entry.path);
        } else {
          if (!this.blobs.has(entry.sha)) return { status: 422, body: { message: 'Invalid sha' } };
          flat.set(entry.path, entry.sha);
        }
      }
      return { status: 201, body: { sha: this.treeOf(flat) } };
    }
    if (call.method === 'POST' && pathname === '/git/commits') {
      if (!this.trees.has(body.tree) || !(body.parents as string[]).every((sha) => this.commits.has(sha))) {
        return { status: 422, body: { message: 'Invalid commit' } };
      }
      return { status: 201, body: { sha: this.putCommit(body.tree, body.parents, body.message) } };
    }
    if (call.method === 'GET' && (match = /^\/compare\/([^.]+)\.\.\.(.+)$/.exec(pathname))) {
      const base = this.resolve(decodeURIComponent(match[1]));
      const head = this.resolve(decodeURIComponent(match[2]));
      if (!base || !head) return notFound;
      const ofBase = this.ancestors(base);
      const ofHead = this.ancestors(head);
      const ahead = [...ofHead].filter((sha) => !ofBase.has(sha)).length;
      const behind = [...ofBase].filter((sha) => !ofHead.has(sha)).length;
      const status = ahead === 0 && behind === 0 ? 'identical' : behind === 0 ? 'ahead' : ahead === 0 ? 'behind' : 'diverged';
      const mergeBase = this.mergeBase(base, head);
      const before = mergeBase ? this.flatten(this.commits.get(mergeBase)!.tree) : new Map<string, string>();
      const after = this.flatten(this.commits.get(head)!.tree);
      const files: { filename: string; status: string }[] = [];
      for (const [file, sha] of after) {
        if (!before.has(file)) files.push({ filename: file, status: 'added' });
        else if (before.get(file) !== sha) files.push({ filename: file, status: 'modified' });
      }
      for (const file of before.keys()) if (!after.has(file)) files.push({ filename: file, status: 'removed' });
      return { status: 200, body: { status, ahead_by: ahead, behind_by: behind, total_commits: ahead, files } };
    }
    if (call.method === 'POST' && pathname === '/merges') {
      const base = this.refs.get(body.base);
      const head = this.resolve(body.head);
      if (!base || !head) return notFound;
      if (this.ancestors(base).has(head)) return { status: 204 };
      const mergeBase = this.mergeBase(base, head);
      const origin = mergeBase ? this.flatten(this.commits.get(mergeBase)!.tree) : new Map<string, string>();
      const ours = this.flatten(this.commits.get(base)!.tree);
      const theirs = this.flatten(this.commits.get(head)!.tree);
      const merged = new Map<string, string>();
      for (const file of new Set([...ours.keys(), ...theirs.keys(), ...origin.keys()])) {
        const o = origin.get(file);
        const a = ours.get(file);
        const b = theirs.get(file);
        let result: string | undefined;
        if (a === b) result = a;
        else if (a === o) result = b;
        else if (b === o) result = a;
        else return { status: 409, body: { message: 'Merge conflict' } };
        if (result !== undefined) merged.set(file, result);
      }
      const sha = this.putCommit(this.treeOf(merged), [base, head], String(body.commit_message ?? 'Merge'));
      this.refs.set(body.base, sha);
      return { status: 201, body: { sha } };
    }
    if (call.method === 'GET' && (match = /^\/contents\/(.+)$/.exec(pathname))) {
      const ref = this.resolve(params.get('ref') ?? '');
      if (!ref) return notFound;
      const wanted = match[1].split('/').map(decodeURIComponent).join('/');
      const flat = this.flatten(this.commits.get(ref)!.tree);
      const blob = flat.get(wanted);
      if (blob) {
        const bytes = this.blobs.get(blob)!;
        const small = bytes.byteLength <= 1_000_000;
        return {
          status: 200,
          body: {
            type: 'file',
            name: wanted.split('/').pop(),
            path: wanted,
            sha: blob,
            size: bytes.byteLength,
            encoding: small ? 'base64' : 'none',
            content: small ? Buffer.from(bytes).toString('base64') : '',
          },
        };
      }
      const prefix = `${wanted}/`;
      const children = [...flat.keys()].filter((file) => file.startsWith(prefix));
      if (children.length > 0) return { status: 200, body: { type: 'dir', path: wanted, entries: [] } };
      return notFound;
    }
    if (call.method === 'GET' && pathname === '/deployments') {
      if (this.deployments === null) return { status: 403, body: { message: 'Resource not accessible by personal access token' } };
      const sha = params.get('sha');
      return { status: 200, body: this.deployments.filter((d) => !sha || d.sha === sha).map(({ statuses: _statuses, ...d }) => d) };
    }
    if (call.method === 'GET' && (match = /^\/deployments\/(\d+)\/statuses$/.exec(pathname))) {
      if (this.deployments === null) return { status: 403, body: { message: 'Resource not accessible by personal access token' } };
      const deployment = this.deployments.find((d) => d.id === Number(match![1]));
      if (!deployment) return notFound;
      // Oldest first: GitHub does not document the order, so the code must not rely on one.
      return { status: 200, body: deployment.statuses.map((status, i) => ({ id: i + 1, ...status })) };
    }
    return notFound;
  }
}

/** Every content file of this repository's working tree, and a placeholder for every /media/ file the content names. */
export function seedFiles(root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const read = (file: string) => new Uint8Array(fs.readFileSync(path.join(root, file)));
  files.set('content/site.json', read('content/site.json'));
  for (const name of fs.readdirSync(path.join(root, 'content/projects')).sort()) {
    if (name.endsWith('.json')) files.set(`content/projects/${name}`, read(`content/projects/${name}`));
  }
  const media = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (['src', 'poster', 'captions'].includes(key) && typeof item === 'string' && item.startsWith('/media/')) media.add(`public${item}`);
        walk(item);
      }
    }
  };
  for (const [file, bytes] of [...files]) if (file.startsWith('content/')) walk(JSON.parse(new TextDecoder().decode(bytes)));
  for (const file of media) files.set(file, encoder.encode(`placeholder for ${file}`));
  files.set('public/media/site/.gitkeep', new Uint8Array(0));
  files.set('package.json', encoder.encode('{ "name": "outside content" }'));
  return files;
}
