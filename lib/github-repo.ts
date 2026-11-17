/**
 * Repository cards (ARCHITECTURE.md 13A, "Repository"; docs/V3_PLAN.md D-34).
 *
 * At build time the card reads a public repository's name, description, language, and last push
 * from the GitHub API. Every fetched word passes the public content rules and the private
 * CONTENT_BLOCKLIST before it may be shown. On a hit, a failed or slow request, a private
 * repository, or an address that is not https://github.com/OWNER/REPO, the block shows the
 * plain link instead. A blocklist hit is reported by entry number, never by the term (D-76),
 * and nothing here prints the token or the blocklist.
 *
 * Requests use Node's own HTTPS client, not the global fetch: Next.js 14 keeps fetch answers in
 * its data cache and reuses them on later builds, and a fetch that skips that cache would make
 * the page dynamic. This way every build reads the repository afresh and the page stays static.
 * Answers are kept for the life of the server process, so a build asks once per repository.
 */
import 'server-only';
import https from 'node:https';
import rulesFile from '@/content-rules.public.json';
import { checkText, compileRules, missingBlocklistIsError, parseBlocklist, type BlocklistEntry, type CompiledRule } from './lint';

export interface RepoAddress {
  owner: string;
  repo: string;
}

/** What a card shows. Every string here passed the content check. */
export interface RepoCardData {
  /** https://github.com/Owner/Name, spelled as GitHub spells it. */
  href: string;
  /** Owner/Name, spelled as GitHub spells it. */
  fullName: string;
  description?: string;
  language?: string;
  /** The last push: the timestamp, and its UTC date (YYYY-MM-DD) for display. */
  pushed?: { iso: string; date: string };
}

export type RepoCardResult =
  | { kind: 'card'; card: RepoCardData }
  /** The plain link: the fallback. `github` is true for a github.com address. */
  | { kind: 'link'; href: string; text: string; github: boolean }
  /** Nothing to show: not a web address, or the site's own repository. */
  | { kind: 'none' };

/** The part of a fetch response this module reads. A WHATWG fetch Response fits. */
export interface RepoResponse {
  status: number;
  text(): Promise<string>;
}

export type RepoFetcher = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<RepoResponse>;

export interface RepoCardOptions {
  /** The HTTP client. Defaults to Node's HTTPS client; tests pass a mock. */
  fetcher?: RepoFetcher;
  /** Environment variables. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Where a fallback is reported (the build log). Never receives a term or a token. */
  warn?: (message: string) => void;
  /** The whole request, answer included, must finish within this time. */
  timeoutMs?: number;
}

const API = 'https://api.github.com';
const USER_AGENT = 'amjadrehawi.com repository card';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 1_000_000;
/** A failed lookup is retried after this long (it matters only to a long-running dev server). */
const FAILURE_TTL_MS = 60_000;
/** Answers to a request with the token that are worth one more try without it. */
const RETRY_WITHOUT_TOKEN = new Set([401, 403, 404]);

// GitHub's own limits: an owner is 1 to 39 letters, digits, or single inner hyphens; a repository
// name is up to 100 letters, digits, dots, hyphens, or underscores.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

function validRepoName(repo: string): boolean {
  return REPO.test(repo) && repo !== '.' && repo !== '..' && !repo.toLowerCase().endsWith('.git');
}

/** Reads an environment variable defensively: trimmed, with stray pasted quotes removed. */
function envValue(env: Record<string, string | undefined>, name: string): string {
  return (env[name] ?? '').trim().replace(/^["']+|["']+$/g, '');
}

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

/**
 * Accepts only https://github.com/OWNER/REPO, with or without a final slash. Anything else
 * (another host, http, a deeper path, a query, a clone address) returns null.
 */
export function parseRepoUrl(raw: string): RepoAddress | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  const parts = url.pathname.replace(/\/$/, '').split('/');
  if (parts.length !== 3 || parts[0] !== '') return null;
  const [, owner, repo] = parts;
  if (!OWNER.test(owner) || !validRepoName(repo)) return null;
  return { owner, repo };
}

/** The owner and repository that any github.com address points into (a file, a branch), or null. */
function githubRepoOf(raw: string): RepoAddress | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !['github.com', 'www.github.com'].includes(url.hostname)) return null;
  const [owner = '', repo = ''] = url.pathname.split('/').filter(Boolean);
  const name = repo.replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !REPO.test(name)) return null;
  return { owner, repo: name };
}

/**
 * True when an address points into this site's own repository (GITHUB_REPO), which the site
 * never links (CONTENT_RULES.md 2). Used by the repository card and the code block's link.
 */
export function isSiteRepository(raw: string, env: Record<string, string | undefined> = process.env): boolean {
  const own = envValue(env, 'GITHUB_REPO').toLowerCase();
  if (own === '') return false;
  const address = githubRepoOf(raw);
  return address !== null && `${address.owner}/${address.repo}`.toLowerCase() === own;
}

/** The fallback for any address: a plain link when it is a web address, else nothing. */
function plainLink(raw: string): RepoCardResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'none' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'none' };
  const text = url.href.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return { kind: 'link', href: url.href, text, github: url.hostname === 'github.com' || url.hostname === 'www.github.com' };
}

function githubLink(address: RepoAddress): RepoCardResult {
  const path = `${address.owner}/${address.repo}`;
  return { kind: 'link', href: `https://github.com/${path}`, text: `github.com/${path}`, github: true };
}

// ---------------------------------------------------------------------------------------------
// The HTTP client
// ---------------------------------------------------------------------------------------------

/** Node's HTTPS client behind the fetch shape. It does not follow redirects (a renamed repository falls back). */
export const httpsFetcher: RepoFetcher = (url, { headers, signal }) =>
  new Promise<RepoResponse>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('The request failed.'));
    };
    const request = https.request(url, { method: 'GET', headers, signal }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          request.destroy(new Error('The answer is too large.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode ?? 0, text: async () => body });
      });
      response.on('error', fail);
      response.on('close', () => fail(new Error('The connection closed early.')));
    });
    request.on('error', fail);
    request.end();
  });

class TimeoutError extends Error {
  constructor() {
    super('The request timed out.');
    this.name = 'TimeoutError';
  }
}

/** One GET with a deadline over the whole exchange, the answer's body included. */
async function getJson(
  url: string,
  token: string,
  fetcher: RepoFetcher,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timedOut = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new TimeoutError()), { once: true });
  });
  timedOut.catch(() => undefined);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token !== '') headers.Authorization = `Bearer ${token}`;
    const response = await Promise.race([fetcher(url, { headers, signal: controller.signal }), timedOut]);
    const body = await Promise.race([response.text(), timedOut]);
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// Reading and checking the answer
// ---------------------------------------------------------------------------------------------

interface RepoFields {
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string;
  language: string;
  pushedAt: string;
  isPublic: boolean;
}

function readRepo(data: unknown): RepoFields | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const fullName = text(record.full_name);
  const [owner = '', repo = '', ...rest] = fullName.split('/');
  if (rest.length > 0 || !OWNER.test(owner) || !validRepoName(repo)) return null;
  // Public only when GitHub says so: `private` must be false, and `visibility`, when given, public.
  const isPublic = record.private === false && (record.visibility === undefined || record.visibility === 'public');
  return {
    name: text(record.name),
    fullName,
    htmlUrl: text(record.html_url),
    description: text(record.description),
    language: text(record.language),
    pushedAt: text(record.pushed_at),
    isPublic,
  };
}

const ISO_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function pushedDate(value: string): RepoCardData['pushed'] {
  const match = ISO_TIME.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return undefined;
  return { iso: value, date: match[1] };
}

let publicRules: CompiledRule[] | undefined;
function rules(): CompiledRule[] {
  publicRules ??= compileRules(rulesFile);
  return publicRules;
}

/**
 * The fields that tripped a rule: "field: rule ID" for a public rule, and for a blocklist hit the
 * field with the check's own message, which names the entry number and never the term.
 */
function contentHits(repo: RepoFields, blocklist: BlocklistEntry[]): string[] {
  const fields: [string, string][] = [
    ['name', repo.name],
    ['full_name', repo.fullName],
    ['description', repo.description],
    ['language', repo.language],
  ];
  const out: string[] = [];
  for (const [field, value] of fields) {
    if (value === '') continue;
    for (const hit of checkText(value, rules(), blocklist)) {
      out.push(hit.rule === 'BLOCKLIST' ? `${field}: ${hit.message}` : `${field}: rule ${hit.rule}`);
    }
  }
  return out;
}

interface FetchContext {
  env: Record<string, string | undefined>;
  warn: (message: string) => void;
  fetcher: RepoFetcher;
  timeoutMs: number;
  blocklist: BlocklistEntry[];
}

/** Fetches and checks one repository. Never throws: every failure is the plain link. */
async function fetchCard(address: RepoAddress, context: FetchContext): Promise<RepoCardResult> {
  const name = `${address.owner}/${address.repo}`;
  const fallback = (reason: string): RepoCardResult => {
    context.warn(`Repository card for ${name}: showing the plain link (${reason}).`);
    return githubLink(address);
  };

  const url = `${API}/repos/${address.owner}/${address.repo}`;
  const token = envValue(context.env, 'GITHUB_TOKEN');
  let answer: { status: number; body: string };
  try {
    answer = await getJson(url, token, context.fetcher, context.timeoutMs);
    // A token that GitHub refuses (401), or one scoped to other repositories (403, 404), must not
    // hide a public repository: ask once more without it.
    if (token !== '' && RETRY_WITHOUT_TOKEN.has(answer.status)) {
      answer = await getJson(url, '', context.fetcher, context.timeoutMs);
    }
  } catch (error) {
    return fallback(error instanceof TimeoutError ? 'the request timed out' : 'the request failed');
  }
  if (answer.status !== 200) return fallback(`GitHub answered ${answer.status}`);

  let data: unknown;
  try {
    data = JSON.parse(answer.body);
  } catch {
    return fallback('the answer was not JSON');
  }
  const repo = readRepo(data);
  if (!repo) return fallback('the answer did not describe a repository');
  if (!repo.isPublic) return fallback('the repository is not public');
  if (repo.fullName.toLowerCase() !== name.toLowerCase()) return fallback('the repository answered under another name');
  const href = `https://github.com/${repo.fullName}`;
  if (repo.htmlUrl.toLowerCase() !== href.toLowerCase()) return fallback('the repository answered with another address');

  const hits = contentHits(repo, context.blocklist);
  if (hits.length > 0) return fallback(`the content check matched ${hits.join('; ')}`);

  const card: RepoCardData = { href, fullName: repo.fullName };
  if (repo.description !== '') card.description = repo.description;
  if (repo.language !== '') card.language = repo.language;
  const pushed = pushedDate(repo.pushedAt);
  if (pushed) card.pushed = pushed;
  return { kind: 'card', card };
}

// ---------------------------------------------------------------------------------------------
// The public function, cached per process
// ---------------------------------------------------------------------------------------------

const cache = new Map<string, { result: Promise<RepoCardResult>; expires: number }>();

/** Forgets every cached answer (for tests). */
export function clearRepoCardCache(): void {
  cache.clear();
}

/**
 * What a repository block shows for an address: the card, the plain link, or nothing. Never
 * throws and never rejects.
 */
export async function loadRepoCard(raw: string, options: RepoCardOptions = {}): Promise<RepoCardResult> {
  const env = options.env ?? process.env;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const value = raw.trim();
  if (value === '') return { kind: 'none' };

  if (isSiteRepository(value, env)) {
    warn("Repository block: it points at the site's own repository, which is never linked, so it is left out.");
    return { kind: 'none' };
  }

  const address = parseRepoUrl(value);
  if (!address) {
    const link = plainLink(value);
    warn(
      link.kind === 'none'
        ? 'Repository block: the value is not a web address, so it is left out.'
        : 'Repository block: the address is not https://github.com/OWNER/REPO, so it shows as a plain link.',
    );
    return link;
  }

  // On Vercel and in CI a missing blocklist fails closed (docs/V3_PLAN.md D-76): fetched words
  // that cannot be checked are not shown.
  const blocklist = parseBlocklist(env.CONTENT_BLOCKLIST);
  if (blocklist.length === 0 && missingBlocklistIsError(env)) {
    warn(`Repository card for ${address.owner}/${address.repo}: showing the plain link (CONTENT_BLOCKLIST is not set).`);
    return githubLink(address);
  }

  const key = `${address.owner}/${address.repo}`.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;

  const entry = { result: Promise.resolve<RepoCardResult>({ kind: 'none' }), expires: Number.POSITIVE_INFINITY };
  entry.result = fetchCard(address, {
    env,
    warn,
    fetcher: options.fetcher ?? httpsFetcher,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    blocklist,
  })
    .catch((): RepoCardResult => {
      warn(`Repository card for ${address.owner}/${address.repo}: showing the plain link (an unexpected error).`);
      return githubLink(address);
    })
    .then((result) => {
      if (result.kind !== 'card') entry.expires = Date.now() + FAILURE_TTL_MS;
      return result;
    });
  cache.set(key, entry);
  return entry.result;
}
