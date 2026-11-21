/**
 * The repository backend through the GitHub API (ARCHITECTURE.md 11 and 13A; docs/V3_PLAN.md
 * D-17, D-18, D-25, R-07, R-19, 5.7). Server only.
 *
 * - Writes go only to the branch named by GITHUB_DRAFT_BRANCH. There is no default branch: with
 *   that variable missing, or naming the production branch (GITHUB_BRANCH) or "main", every write
 *   is refused before any request is made.
 * - Each put, batch, or delete is one commit through the Git Data API: a blob per file, a tree on
 *   the draft head, a commit, then a fast-forward of the branch. A batch of uploads therefore makes
 *   one commit and one preview build (R-19). When the branch moved meanwhile, the fast-forward is
 *   refused and the save reports a conflict instead of overwriting (D-18).
 * - A name already in the folder is refused unless the owner chose Replace (D-25).
 * - Reads list the draft branch, or the production branch while the draft branch does not exist
 *   (D-17).
 * - The token stays in this closure, travels only in the Authorization header, and is removed from
 *   any error text. Nothing here logs.
 */
import 'server-only';
import { COMMIT_MESSAGES, STORAGE_MESSAGES as M } from './labels';
import {
  checkFolder,
  checkStoredName,
  isStoredName,
  parseSitePath,
  REPO_MEDIA_DIR,
  repoPathOf,
  sitePathOf,
  StorageError,
} from './rules';
import { asList, byName, envValue, errorDetail, prepareAll, storedRepoFile, toBuffer, toSet, type Env } from './shared';
import type { DeleteOptions, MediaStorage, PutInput, PutOptions, StorageOptions, StoredFile } from './types';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export interface GitHubSettings {
  token: string;
  /** "owner/name". */
  repo: string;
  /** GITHUB_BRANCH, the production branch. May be empty. */
  productionBranch: string;
  /** GITHUB_DRAFT_BRANCH, the only branch written to. Empty refuses every write. */
  draftBranch: string;
}

/**
 * The GitHub settings from the environment, or null when neither GITHUB_TOKEN nor GITHUB_REPO is
 * set (local development then writes to disk). One without the other is refused.
 */
export function readGitHubSettings(env: Env): GitHubSettings | null {
  const token = envValue(env, 'GITHUB_TOKEN');
  const repo = envValue(env, 'GITHUB_REPO');
  if (!token && !repo) return null;
  if (!token) throw new StorageError('github-incomplete', M.githubIncomplete('GITHUB_TOKEN'), 503);
  if (!repo) throw new StorageError('github-incomplete', M.githubIncomplete('GITHUB_REPO'), 503);
  if (!REPO.test(repo) || /\/\.{1,2}$/.test(repo)) throw new StorageError('bad-repo', M.badRepo, 503);
  return {
    token,
    repo,
    productionBranch: envValue(env, 'GITHUB_BRANCH'),
    draftBranch: envValue(env, 'GITHUB_DRAFT_BRANCH'),
  };
}

function normalizeBranch(name: string): string {
  return name.trim().replace(/^refs\/heads\//, '').replace(/^heads\//, '');
}

function isValidBranch(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,100}$/.test(name) &&
    !/^[-./]/.test(name) &&
    !/[/.]$/.test(name) &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.includes('/.')
  );
}

/**
 * The branch writes go to. Refuses a missing or invalid GITHUB_DRAFT_BRANCH, and one that names
 * "main" or the production branch, in any letter case (docs/V3_PLAN.md 5.7, R-07).
 */
export function checkDraftBranch(settings: Pick<GitHubSettings, 'draftBranch' | 'productionBranch'>): string {
  const draft = normalizeBranch(settings.draftBranch);
  if (!draft) throw new StorageError('no-draft-branch', M.noDraftBranch, 503);
  if (!isValidBranch(draft)) throw new StorageError('bad-branch', M.badBranch, 503);
  const production = normalizeBranch(settings.productionBranch).toLowerCase();
  const lower = draft.toLowerCase();
  if (lower === 'main' || (production !== '' && lower === production)) {
    throw new StorageError('protected-branch', M.protectedBranch(draft), 503);
  }
  return draft;
}

export interface GitHubStorageOptions extends StorageOptions {
  settings: GitHubSettings;
  /** Defaults to the server's own `fetch`, looked up at each request. */
  fetch?: typeof fetch;
}

interface Reply {
  status: number;
  data: unknown;
}

interface FolderEntry {
  name: string;
  size?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pick(data: unknown, ...keys: string[]): unknown {
  let value = data;
  for (const key of keys) value = isRecord(value) ? value[key] : undefined;
  return value;
}

function shaOf(value: unknown): string {
  if (typeof value === 'string' && SHA.test(value)) return value;
  throw new StorageError('github-failed', M.githubUnexpected, 502);
}

function refPath(branch: string): string {
  return `heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
}

function uniqueTargets(targets: { folder: string; name: string }[]): { folder: string; name: string }[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.folder}/${target.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createGitHubStorage(options: GitHubStorageOptions): MediaStorage {
  const { token, repo, draftBranch, productionBranch } = options.settings;
  const branches = { draftBranch, productionBranch };
  const folders = toSet(options.knownFolders);
  const send: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function call(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<Reply> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await send(`${API}/repos/${repo}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new StorageError('github-unreachable', M.githubUnreachable, 502);
    }
    const text = await response.text().catch(() => '');
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { status: response.status, data };
  }

  /** The reply's data when its status is one of `ok`; otherwise GitHub's own message, without the token. */
  function accept(reply: Reply, ...ok: number[]): unknown {
    if (!ok.includes(reply.status)) {
      const message = pick(reply.data, 'message');
      const detail = typeof message === 'string' ? errorDetail(message, token) : '';
      throw new StorageError('github-failed', M.githubFailed(reply.status, detail), 502);
    }
    return reply.data;
  }

  async function headOf(branch: string): Promise<string | null> {
    const reply = await call('GET', `/git/ref/${refPath(branch)}`);
    if (reply.status === 404) return null;
    return shaOf(pick(accept(reply, 200), 'object', 'sha'));
  }

  /** The head to write on: the draft branch, which must exist. */
  async function writeHead(branch: string): Promise<string> {
    const head = await headOf(branch);
    if (!head) throw new StorageError('draft-missing', M.draftMissing(branch), 409);
    return head;
  }

  /** The head to read: the draft branch, or the production branch while there is no draft branch. */
  async function readHead(): Promise<string> {
    let draft: string | null = null;
    try {
      draft = checkDraftBranch(branches);
    } catch {
      draft = null;
    }
    if (draft) {
      const head = await headOf(draft);
      if (head) return head;
    }
    const production = normalizeBranch(productionBranch);
    if (production && isValidBranch(production)) {
      const head = await headOf(production);
      if (head) return head;
    }
    if (draft) throw new StorageError('draft-missing', M.draftMissing(draft), 409);
    throw new StorageError('no-draft-branch', M.noDraftBranch, 503);
  }

  async function filesAt(folder: string, ref: string): Promise<FolderEntry[]> {
    const reply = await call('GET', `/contents/${REPO_MEDIA_DIR}/${folder}?ref=${encodeURIComponent(ref)}`);
    if (reply.status === 404) return [];
    const data = accept(reply, 200);
    if (!Array.isArray(data)) return [];
    return data.flatMap((entry: unknown): FolderEntry[] =>
      isRecord(entry) && entry.type === 'file' && typeof entry.name === 'string'
        ? [{ name: entry.name, ...(typeof entry.size === 'number' ? { size: entry.size } : {}) }]
        : [],
    );
  }

  /**
   * One commit on the draft branch: a tree on `head` with `entries` (sha null removes a file), then
   * a fast-forward. Nothing is committed when the tree does not change (a Replace with the same
   * bytes), so no empty commit and no preview build.
   */
  async function commit(
    branch: string,
    head: string,
    entries: { path: string; sha: string | null }[],
    message: string,
  ): Promise<void> {
    const baseTree = shaOf(pick(accept(await call('GET', `/git/commits/${head}`), 200), 'tree', 'sha'));
    const tree = shaOf(
      pick(
        accept(
          await call('POST', '/git/trees', {
            base_tree: baseTree,
            tree: entries.map((entry) => ({ path: entry.path, mode: '100644', type: 'blob', sha: entry.sha })),
          }),
          201,
          200,
        ),
        'sha',
      ),
    );
    if (tree === baseTree) return;
    const created = shaOf(pick(accept(await call('POST', '/git/commits', { message, tree, parents: [head] }), 201, 200), 'sha'));
    const update = await call('PATCH', `/git/refs/${refPath(branch)}`, { sha: created, force: false });
    if (update.status === 404 || update.status === 409 || update.status === 422) {
      throw new StorageError('conflict', M.conflict, 409);
    }
    accept(update, 200);
  }

  async function putMany(files: readonly PutInput[], putOptions: PutOptions = {}): Promise<StoredFile[]> {
    const branch = checkDraftBranch(branches);
    const prepared = await prepareAll(files, 'repo', folders, putOptions.inspect);
    if (prepared.length === 0) return [];
    const head = await writeHead(branch);

    let replaced = 0;
    for (const folder of new Set(prepared.map((file) => file.folder))) {
      const existing = await filesAt(folder, head);
      for (const file of prepared) {
        if (file.folder !== folder) continue;
        if (existing.some((entry) => entry.name === file.name)) {
          if (!putOptions.replace) throw new StorageError('exists', M.exists(file.name), 409);
          replaced += 1;
          continue;
        }
        const other = existing.find((entry) => entry.name.toLowerCase() === file.name.toLowerCase());
        if (other) throw new StorageError('exists', M.existsOtherCase(file.name, other.name), 409);
      }
    }

    const entries: { path: string; sha: string }[] = [];
    for (const file of prepared) {
      const reply = await call('POST', '/git/blobs', {
        content: toBuffer(file.bytes).toString('base64'),
        encoding: 'base64',
      });
      entries.push({ path: repoPathOf(file.folder, file.name), sha: shaOf(pick(accept(reply, 201, 200), 'sha')) });
    }
    const paths = prepared.map((file) => `${file.folder}/${file.name}`);
    await commit(branch, head, entries, putOptions.message?.trim() || COMMIT_MESSAGES.save(paths, replaced));
    return prepared.map((file) => storedRepoFile(file.folder, file.name, file.bytes.byteLength));
  }

  return {
    store: 'repo',
    target: 'github',

    async put(file, putOptions) {
      const [stored] = await putMany([file], putOptions);
      if (!stored) throw new StorageError('invalid-size', M.invalidSize, 400);
      return stored;
    },

    putMany,

    async delete(src, deleteOptions: DeleteOptions = {}) {
      const branch = checkDraftBranch(branches);
      const targets = uniqueTargets(asList(src).map((value) => parseSitePath(value, folders)));
      if (targets.length === 0) return;
      const head = await writeHead(branch);
      const present: { folder: string; name: string }[] = [];
      for (const folder of new Set(targets.map((target) => target.folder))) {
        const names = new Set((await filesAt(folder, head)).map((entry) => entry.name));
        present.push(...targets.filter((target) => target.folder === folder && names.has(target.name)));
      }
      if (present.length === 0) return;
      const paths = present.map((target) => `${target.folder}/${target.name}`);
      await commit(
        branch,
        head,
        present.map((target) => ({ path: repoPathOf(target.folder, target.name), sha: null })),
        deleteOptions.message?.trim() || COMMIT_MESSAGES.remove(paths),
      );
    },

    async list(folder) {
      const checked = checkFolder(folder, folders);
      const entries = await filesAt(checked, await readHead());
      return entries
        .filter((entry) => isStoredName(entry.name))
        .map((entry) => storedRepoFile(checked, entry.name, entry.size))
        .sort(byName);
    },

    url(file) {
      return sitePathOf(checkFolder(file.folder, folders), checkStoredName(file.name));
    },
  };
}
