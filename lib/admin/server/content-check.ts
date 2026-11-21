/**
 * The content check the admin runs on every save and over text taken from files before an upload
 * (ARCHITECTURE.md 7.2 and 12; docs/V3_PLAN.md D-19, D-24, D-76). Server only.
 *
 * - A save is checked as the whole content will be after it, not only the files it changes, so a
 *   save can never leave a draft that `npm run check:content` refuses: schema version 3, slugs
 *   that match their file names and are unique, the public patterns of
 *   content-rules.public.json, then the private CONTENT_BLOCKLIST terms, the copies of an emptied
 *   GPA or phone, media addresses, links to this repository, and, when the caller lists the
 *   branch's media, that every /media/ path names a file with exact case.
 * - Guard-rail findings (a proof or an internal link that leads nowhere) come back as warnings;
 *   they never block a save (ARCHITECTURE.md 7.4).
 * - A private-term hit names the file, the field, and the rule BLOCKLIST, never the term
 *   (lib/lint.ts words it so), and nothing here logs.
 * - A missing CONTENT_BLOCKLIST fails closed on Vercel and in CI (`requireBlocklist` answers 503
 *   before anything is written) and is a warning on the owner's machine, where the public rules
 *   still run.
 */
import 'server-only';
import rulesFile from '@/content-rules.public.json';
import {
  checkText,
  compileRules,
  DEFAULT_SITE_URL,
  formatPath,
  lintContent,
  parseBlocklist,
  siteHostsOf,
  validateContent,
  type BlocklistEntry,
  type CompiledRule,
  type RawContent,
} from '@/lib/lint';
import { ProjectSchema, SiteSchema } from '@/lib/schema';
import { envValue } from '@/lib/storage/shared';
import { SITE_FILE, type Finding } from '../contract';
import { blocklistFailsClosed, blocklistRaw, siteRepository, type Env } from './env';
import { ApiFailure } from './guard';

export const CHECK_MESSAGES = {
  blocklistMissing:
    'CONTENT_BLOCKLIST is not set on this deployment, so private terms cannot be checked and nothing is saved. ' +
    'Set it in the hosting dashboard and redeploy.',
  blocklistNotChecked: 'CONTENT_BLOCKLIST is not set here, so private terms were not checked. Add it to .env.local.',
  siteMissing: 'content/site.json is missing.',
  mediaMissing: (src: string) => `No file at public${src} with exactly this case.`,
} as const;

let compiled: CompiledRule[] | null = null;

/** The public patterns, compiled once per server instance. */
export function publicRules(): CompiledRule[] {
  compiled ??= compileRules(rulesFile);
  return compiled;
}

export interface BlocklistState {
  /** The private terms as compiled patterns; never the terms themselves. */
  entries: BlocklistEntry[];
  /** True when CONTENT_BLOCKLIST holds at least one term. */
  set: boolean;
  /** True on Vercel and in CI, where a missing list refuses every save and check. */
  failClosed: boolean;
}

export function blocklistState(env: Env = process.env): BlocklistState {
  const entries = parseBlocklist(blocklistRaw(env));
  return { entries, set: entries.length > 0, failClosed: blocklistFailsClosed(env) };
}

/** The blocklist to check with, or ApiFailure 503 'not-configured' when it is missing where it must be set. */
export function requireBlocklist(env: Env = process.env): BlocklistState {
  const state = blocklistState(env);
  if (!state.set && state.failClosed) {
    throw new ApiFailure(503, 'not-configured', CHECK_MESSAGES.blocklistMissing, { missing: ['CONTENT_BLOCKLIST'] });
  }
  return state;
}

/** The host names that mean this site, as scripts/check-content.mjs works them out. */
function siteHosts(env: Env): string[] {
  const configured = envValue(env, 'NEXT_PUBLIC_SITE_URL');
  return siteHostsOf(/^https?:\/\//.test(configured) ? configured : DEFAULT_SITE_URL);
}

/** Every path a set of repository files implies, folders included, as check:content's exact-case test sees them. */
function withFolders(files: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    const parts = file.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i += 1) out.add(parts.slice(0, i).join('/'));
  }
  return out;
}

/** /media/ paths in src, poster, and captions that name nothing on the branch (scripts/check-content.mjs, MEDIA). */
function missingMedia(file: string, value: unknown, present: ReadonlySet<string>, at: PropertyKey[] = []): Finding[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => missingMedia(file, item, present, [...at, i]));
  if (value === null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const out: Finding[] = [];
  for (const key of ['src', 'poster', 'captions']) {
    const src = record[key];
    if (typeof src !== 'string' || !src.startsWith('/media/')) continue;
    const path = ['public', ...src.split('/').filter(Boolean)].join('/');
    if (!present.has(path)) {
      out.push({ file, path: formatPath([...at, key]), rule: 'MEDIA', message: CHECK_MESSAGES.mediaMissing(src), severity: 'error' });
    }
  }
  for (const [key, item] of Object.entries(record)) {
    if (item !== null && typeof item === 'object') out.push(...missingMedia(file, item, present, [...at, key]));
  }
  return out;
}

export interface ContentCheckOptions {
  env?: Env;
  /** The private terms; read from the environment when not given. */
  blocklist?: BlocklistState;
  /**
   * Every file under public/media on the branch the content will live on (repository paths, exact
   * case). When given, each /media/ address must name one of them, as check:content requires.
   */
  mediaFiles?: Iterable<string> | null;
}

export interface ContentCheckResult {
  /** Findings that refuse a save. */
  errors: Finding[];
  /** Guard rails that never block a save. */
  warnings: Finding[];
}

/** The whole content check over every content file, by repository path, as raw data. */
export function checkContent(
  files: readonly { path: string; data: unknown }[],
  options: ContentCheckOptions = {},
): ContentCheckResult {
  const env = options.env ?? process.env;
  const blocklist = options.blocklist ?? blocklistState(env);
  const findings: Finding[] = [];

  const site = files.find((file) => file.path === SITE_FILE);
  if (!site) {
    findings.push({ file: SITE_FILE, path: '(file)', rule: 'SCHEMA', message: CHECK_MESSAGES.siteMissing, severity: 'error' });
  } else {
    const raw: RawContent = {
      site: { file: SITE_FILE, data: site.data },
      projects: files.filter((file) => file.path !== SITE_FILE).map((file) => ({ file: file.path, data: file.data })),
    };
    const { content, findings: invalid } = validateContent(raw, { SiteSchema, ProjectSchema });
    findings.push(...invalid);
    if (content) {
      findings.push(
        ...lintContent(content, {
          rules: publicRules(),
          blocklist: blocklist.entries,
          siteHosts: siteHosts(env),
          siteRepository: siteRepository(env),
        }),
      );
      if (options.mediaFiles) {
        const present = withFolders(options.mediaFiles);
        for (const file of files) findings.push(...missingMedia(file.path, file.data, present));
      }
    }
  }

  if (!blocklist.set && !blocklist.failClosed) {
    findings.push({
      file: '(environment)',
      path: 'CONTENT_BLOCKLIST',
      rule: 'BLOCKLIST',
      message: CHECK_MESSAGES.blocklistNotChecked,
      severity: 'warning',
    });
  }

  return {
    errors: findings.filter((finding) => finding.severity === 'error'),
    warnings: findings.filter((finding) => finding.severity === 'warning'),
  };
}

/**
 * The public patterns, then the private terms, over labelled text taken from one file (D-24):
 * every hit is an error under the file's name and the item's label.
 */
export function checkTexts(
  source: string,
  items: readonly { label: string; text: string }[],
  blocklist: BlocklistState,
): Finding[] {
  const rules = publicRules();
  const findings: Finding[] = [];
  for (const item of items) {
    for (const hit of checkText(item.text, rules, blocklist.entries)) {
      findings.push({ file: source, path: item.label, rule: hit.rule, message: hit.message, severity: 'error' });
    }
  }
  return findings;
}
