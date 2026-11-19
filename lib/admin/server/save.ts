/**
 * The save behind POST /api/save (ARCHITECTURE.md 7.1 and 7.2; docs/V3_PLAN.md D-17 to D-20,
 * D-76). Server only.
 *
 * In this order, and nothing is written until every check has passed:
 * a. every path is content/site.json or content/projects/<slug>.json, site.json is never deleted,
 *    no path appears twice, and every path written or removed says which version of it the
 *    editor holds (`expected`) (400, rule PATH);
 * b. each file passes schema version 3, and a project's slug equals its file name (422);
 * c. CONTENT_BLOCKLIST is set wherever it must be (503 before anything is written);
 * d. on the draft as it stands (the live branch while there is no draft): every file this save
 *    writes or removes is still the version the editor holds (409 conflict with the files), so a
 *    save from another window, a discard, a rename's rewrite, or a merge the editor never loaded
 *    is never overwritten; then the whole content as it will be after the save passes the content
 *    check (422 with the rule id, the file, and the field path of every error);
 * e. the draft branch is made ready (D-20): created at the live head, moved up to it, or merged
 *    with it. When that changed the draft's content, step d runs again on the new content. If it
 *    now refuses, a merge or a move made here is put back (only while the draft still points at
 *    it), so a refused save leaves no draft behind that fails the check. One exception: when the
 *    published branch changed only files this save writes and the merged draft passes the check on
 *    its own, the merge stays, and the 409 asks for a reload, which brings those changes into the
 *    editor (putting it back would refuse the same save again after every reload);
 * f. each file is stored as the client's own data in the seed's format (`serializeContent`), so
 *    key order and empty strings survive and an unedited file never changes; files whose text is
 *    unchanged are dropped, and a save that changes nothing makes no commit and no build;
 * g. one commit with a plain public message built from slugs and "site";
 * h. the answer carries the new head, the changed paths, the files whose copy in the editor is out
 *    of date (`moved`), whether the published branch was merged in, the guard-rail warnings, and
 *    the preview.
 *
 * Conflicts are decided per file from the editor's `expected` digests, not from the head it
 * loaded: a head comparison cannot see a discard (GitHub's compare lists only the files changed
 * after the common ancestor), and it would let a save that moved the editor's base past changes it
 * never loaded overwrite them later.
 *
 * On the local disk (development without GitHub variables) the same checks run, then the files
 * are written in place.
 */
import 'server-only';
import { formatPath } from '@/lib/lint';
import { ProjectSchema, SiteSchema } from '@/lib/schema';
import {
  isContentPath,
  serializeContent,
  SITE_FILE,
  slugOfProjectFile,
  textDigest,
  type Finding,
  type SaveBody,
  type SaveResponse,
} from '../contract';
import { checkContent, requireBlocklist } from './content-check';
import { resolvePreview } from './deploy';
import type { Env } from './env';
import { ApiFailure } from './guard';
import { getContentRepo, REPO_MESSAGES, type ContentRepo, type ContentSnapshot, type DraftPreparation, type FileChange } from './repo';

export const SAVE_MESSAGES = {
  pathRefused: 'The admin saves only content/site.json and content/projects/<slug>.json.',
  siteNeverDeleted: 'content/site.json is never deleted.',
  duplicate: 'This file appears more than once in the save.',
  writtenAndDeleted: 'This file is both written and deleted in the save.',
  noExpected: 'The save does not say which version of this file the editor holds. Reload the admin, then save again.',
  schema: 'The content does not match schema version 3. Fix the fields named, then save again.',
  slug: (slug: string) => `The slug must match the file name ("${slug}").`,
  notJson: 'This stored file is not valid JSON.',
  check: 'The content check refused this save. Fix the fields named, then save again.',
  stale: 'These files changed on the draft branch after you loaded them. Reload, then make your edits again.',
  mergedIn:
    'The published branch changed these files, and its changes are now in the draft. Reload to bring them into the editor, then make your edits again.',
  notMergedIn:
    'The published branch changed these files, and the draft cannot take its changes until the content check passes without your edits to them. ' +
    'Undo your edits to these files and save the rest first, then reload and make those edits again.',
} as const;

function pathFinding(file: string, message: string): Finding {
  return { file: file.slice(0, 300), path: '(path)', rule: 'PATH', message, severity: 'error' };
}

/**
 * Step a: every path the save names, as sent, and an `expected` entry for each file it writes or
 * removes. Throws 400 'bad-request' with one PATH finding per bad path.
 */
export function checkSavePaths(body: Pick<SaveBody, 'files' | 'deletes'> & Partial<Pick<SaveBody, 'expected'>>): void {
  const findings: Finding[] = [];
  const expected = body.expected ?? {};
  const has = (path: string) => Object.prototype.hasOwnProperty.call(expected, path);
  const written = new Set<string>();
  for (const { path } of body.files) {
    if (!isContentPath(path)) findings.push(pathFinding(path, SAVE_MESSAGES.pathRefused));
    else if (written.has(path)) findings.push(pathFinding(path, SAVE_MESSAGES.duplicate));
    else if (!has(path)) findings.push(pathFinding(path, SAVE_MESSAGES.noExpected));
    written.add(path);
  }
  const deleted = new Set<string>();
  for (const path of body.deletes) {
    if (!isContentPath(path)) findings.push(pathFinding(path, SAVE_MESSAGES.pathRefused));
    else if (path === SITE_FILE) findings.push(pathFinding(path, SAVE_MESSAGES.siteNeverDeleted));
    else if (deleted.has(path)) findings.push(pathFinding(path, SAVE_MESSAGES.duplicate));
    else if (written.has(path)) findings.push(pathFinding(path, SAVE_MESSAGES.writtenAndDeleted));
    else if (!has(path)) findings.push(pathFinding(path, SAVE_MESSAGES.noExpected));
    deleted.add(path);
  }
  for (const path of Object.keys(expected)) {
    if (!isContentPath(path)) findings.push(pathFinding(path, SAVE_MESSAGES.pathRefused));
  }
  if (findings.length > 0) throw new ApiFailure(400, 'bad-request', SAVE_MESSAGES.pathRefused, { findings });
}

/** Step b: schema version 3 for each file sent, and a project's slug equal to its file name. */
export function schemaFindings(files: SaveBody['files']): Finding[] {
  const findings: Finding[] = [];
  for (const { path, data } of files) {
    const result = path === SITE_FILE ? SiteSchema.safeParse(data) : ProjectSchema.safeParse(data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        findings.push({ file: path, path: formatPath(issue.path), rule: 'SCHEMA', message: issue.message, severity: 'error' });
      }
      continue;
    }
    const slug = slugOfProjectFile(path);
    if (slug !== null && (result.data as { slug?: unknown }).slug !== slug) {
      findings.push({ file: path, path: 'slug', rule: 'SLUG', message: SAVE_MESSAGES.slug(slug), severity: 'error' });
    }
  }
  return findings;
}

/** The public name of a content file in a commit message: its slug, or "site". */
function nameOf(path: string): string {
  return path === SITE_FILE ? 'site' : (slugOfProjectFile(path) ?? 'content');
}

function listNames(paths: readonly string[]): string {
  const names = paths.map(nameOf);
  return names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', ');
}

/** "content: update raven, site; remove old-project": slugs and "site" only, nothing private. */
export function commitMessageOf(change: { added: string[]; updated: string[]; removed: string[] }): string {
  const parts: string[] = [];
  if (change.added.length > 0) parts.push(`add ${listNames(change.added)}`);
  if (change.updated.length > 0) parts.push(`update ${listNames(change.updated)}`);
  if (change.removed.length > 0) parts.push(`remove ${listNames(change.removed)}`);
  return `content: ${parts.join('; ') || 'update'}`;
}

/** Stored text compared with the seed's format; a checkout with CRLF line ends is the same file. */
function sameText(stored: string, next: string): boolean {
  return stored.replace(/\r\n/g, '\n') === next;
}

/**
 * The text the editor holds for a stored file: what GET /api/content gives it (the parsed data,
 * or null for a file that is not JSON) in the seed's format. Digests are taken over this, so a
 * stored file in another layout (CRLF line ends, a final newline from an edit on GitHub) is the
 * same version as the editor's copy, and never a conflict that a reload cannot clear.
 */
export function heldTextOf(stored: string): string {
  let data: unknown = null;
  try {
    data = JSON.parse(stored);
  } catch {
    data = null;
  }
  return serializeContent(data);
}

/** The draft's content files by path, as stored, with the digest of the text an editor holds for each. */
interface DraftFiles {
  stored: Map<string, string>;
  digests: Map<string, string>;
}

function draftFilesOf(snapshot: ContentSnapshot): DraftFiles {
  const stored = new Map(snapshot.files.map((file) => [file.path, file.text]));
  return { stored, digests: new Map([...stored].map(([path, text]) => [path, textDigest(heldTextOf(text))])) };
}

function expectedOf(body: SaveBody, path: string): string | null {
  return Object.prototype.hasOwnProperty.call(body.expected, path) ? body.expected[path] : null;
}

/** Files this save writes or removes that are not, on the draft, the version the editor holds. */
function conflictsOf(draft: DraftFiles, body: SaveBody, touched: readonly string[]): string[] {
  return touched.filter((path) => (draft.digests.get(path) ?? null) !== expectedOf(body, path));
}

/** Content files this save does not write whose text on the draft differs from the editor's copy. */
function movedOf(draft: DraftFiles, body: SaveBody, touched: ReadonlySet<string>): string[] {
  const paths = new Set([...draft.digests.keys(), ...Object.keys(body.expected)]);
  return [...paths]
    .filter((path) => isContentPath(path) && !touched.has(path) && (draft.digests.get(path) ?? null) !== expectedOf(body, path))
    .sort();
}

/** The content check over the draft's files with `files` written and `deletes` removed. */
async function checkAfter(
  repo: ContentRepo,
  draft: DraftFiles,
  change: Pick<SaveBody, 'files' | 'deletes'>,
  options: { env: Env; blocklist: ReturnType<typeof requireBlocklist> },
): Promise<{ errors: Finding[]; warnings: Finding[] }> {
  const replaced = new Set([...change.files.map((file) => file.path), ...change.deletes]);
  const result = new Map<string, unknown>();
  const unreadable: Finding[] = [];
  for (const [path, text] of draft.stored) {
    if (replaced.has(path)) continue;
    try {
      result.set(path, JSON.parse(text));
    } catch {
      unreadable.push({ file: path, path: '(file)', rule: 'SCHEMA', message: SAVE_MESSAGES.notJson, severity: 'error' });
    }
  }
  for (const file of change.files) result.set(file.path, file.data);
  const mediaFiles = (await repo.listFiles('draft', 'public/media')).map((entry) => entry.path);
  const check = checkContent(
    [...result].map(([path, data]) => ({ path, data })),
    { env: options.env, blocklist: options.blocklist, mediaFiles },
  );
  return { errors: [...unreadable, ...check.errors], warnings: check.warnings };
}

/** `prepareDraftReport` where the repository has it; a stand-in without it reports nothing to put back. */
async function prepare(repo: ContentRepo): Promise<DraftPreparation> {
  if (repo.prepareDraftReport) return repo.prepareDraftReport();
  const head = await repo.prepareDraft();
  return { head, previous: head, action: 'none' };
}

/**
 * Puts the draft back where preparing it found it, but only while the draft still points at what
 * preparing it made. When it no longer does, a save has built on it and it stays; a failure here
 * leaves the draft as preparing it left it, and the save is refused either way.
 */
async function putBack(repo: ContentRepo, prepared: DraftPreparation): Promise<void> {
  if (!prepared.previous || !prepared.head || prepared.previous === prepared.head) return;
  try {
    await repo.resetDraft(prepared.previous, prepared.head);
  } catch {
    // Nothing more to do: the refusal below is the answer.
  }
}

function conflict(files: string[], message: string): ApiFailure {
  return new ApiFailure(409, 'conflict', message, { files });
}

export interface SaveOptions {
  env?: Env;
  /** For tests: a repository instead of the one the environment names. */
  repo?: ContentRepo;
}

const encoder = new TextEncoder();

export async function saveContent(body: SaveBody, options: SaveOptions = {}): Promise<SaveResponse> {
  const env = options.env ?? process.env;

  // a, b, c: nothing is read or written before these pass.
  checkSavePaths(body);
  const invalid = schemaFindings(body.files);
  if (invalid.length > 0) throw new ApiFailure(422, 'content-check', SAVE_MESSAGES.schema, { findings: invalid });
  const blocklist = requireBlocklist(env);
  const checkOptions = { env, blocklist };

  const repo = options.repo ?? getContentRepo(env);
  const touched = [...body.files.map((file) => file.path), ...body.deletes];

  // d: the draft as it stands, before anything is written.
  const before = await repo.readContent('draft');
  let draft = draftFilesOf(before);
  const stale = conflictsOf(draft, body, touched);
  if (stale.length > 0) throw conflict(stale, SAVE_MESSAGES.stale);
  let check = await checkAfter(repo, draft, body, checkOptions);
  if (check.errors.length > 0) throw new ApiFailure(422, 'content-check', SAVE_MESSAGES.check, { findings: check.errors });

  // e: the head this save writes on (null on disk), and step d again when preparing changed it.
  const prepared = await prepare(repo);
  const head = prepared.head;
  if (repo.source === 'github' && head !== before.head) {
    const snapshot = await repo.readContent('draft');
    if (snapshot.head !== head) throw new ApiFailure(409, 'conflict', REPO_MESSAGES.conflict);
    draft = draftFilesOf(snapshot);
    const conflicts = conflictsOf(draft, body, touched);
    check = await checkAfter(repo, draft, body, checkOptions);
    if (conflicts.length > 0 || check.errors.length > 0) {
      // Only a fast-forward or a merge made here can be put back; a created branch sits at the
      // live head with nothing unpublished, and a head that another save moved is not ours.
      const undoable = prepared.action === 'fast-forward' || prepared.action === 'merged';
      if (conflicts.length > 0) {
        if (prepared.action === 'none') throw conflict(conflicts, SAVE_MESSAGES.stale);
        const keep = !undoable || (await checkAfter(repo, draft, { files: [], deletes: [] }, checkOptions)).errors.length === 0;
        if (keep) throw conflict(conflicts, SAVE_MESSAGES.mergedIn);
        await putBack(repo, prepared);
        if (check.errors.length === 0) throw conflict(conflicts, SAVE_MESSAGES.notMergedIn);
      } else if (undoable) {
        await putBack(repo, prepared);
      }
      throw new ApiFailure(422, 'content-check', SAVE_MESSAGES.check, { findings: check.errors });
    }
  }

  // f: only files whose stored text changes.
  const changes: FileChange[] = [];
  const summary = { added: [] as string[], updated: [] as string[], removed: [] as string[] };
  for (const file of body.files) {
    const text = serializeContent(file.data);
    const stored = draft.stored.get(file.path);
    if (stored !== undefined && sameText(stored, text)) continue;
    changes.push({ path: file.path, bytes: encoder.encode(text) });
    (stored === undefined ? summary.added : summary.updated).push(file.path);
  }
  for (const path of body.deletes) {
    if (!draft.stored.has(path)) continue;
    changes.push({ path, bytes: null });
    summary.removed.push(path);
  }

  // g: one commit (or, on disk, the files written in place).
  const commit = changes.length > 0 ? await repo.commit(head, changes, commitMessageOf(summary)) : null;
  const newHead = commit ?? head;
  const changed = repo.source === 'disk' || commit !== null ? changes.map((change) => change.path) : [];

  // h. A commit made a moment ago has no deployment yet, so the address is the branch alias or
  // DRAFT_PREVIEW_URL. Without either the answer carries none, and the editor keeps the one it has.
  const resolved = resolvePreview({ env, draftBranch: repo.draftBranch, draftHead: newHead, draftDeploy: null }).preview;
  const preview = resolved?.url ? resolved : null;
  return {
    ok: true,
    mode: repo.source,
    commit,
    head: newHead,
    changed,
    moved: movedOf(draft, body, new Set(touched)),
    merged: prepared.action === 'merged',
    warnings: check.warnings,
    preview,
  };
}
