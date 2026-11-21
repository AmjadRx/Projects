/**
 * Saving (ARCHITECTURE.md 7.1 and 7.2; docs/V3_PLAN.md D-18, D-20), written as a function of the
 * store and the API so tests can run it with a stubbed API.
 *
 * - Nothing changed: no request.
 * - The body is exactly the changed files and the removed project files, with the digest of the
 *   version of every file the editor holds (`expected`), so the server refuses to overwrite a file
 *   that changed on the draft since this editor loaded it; the store records the text it sent, so
 *   typing during the request stays unsaved.
 * - Saved: files the server says changed on the draft without this editor (`moved`) are marked
 *   stale; the save bar offers to reload them.
 * - 401: wait for the owner to sign in again (the ReloginDialog), then send the same body once more.
 * - 422 content-check: the save is refused; the findings go to the store and the first one is
 *   revealed (its tab opens and the field scrolls into view).
 * - 409 conflict: a file the save writes changed on the draft; it is marked stale and the shell
 *   offers Reload or Keep editing.
 * - Anything else (503, 502, 400): the server's sentence in the save bar.
 */
import { isApiError, isContentPath, textDigest, type ApiError, type ApiResult, type SaveBody, type SaveResponse } from '@/lib/admin/contract';
import { locate } from '@/lib/admin/locate';
import type { AdminStore, Changes } from '../state/store';
import { plural, shortSha } from './format';

export interface SaveDeps {
  store: AdminStore;
  save: (body: SaveBody) => Promise<ApiResult<SaveResponse>>;
  /** After a 401: resolves true once the owner has signed in again. */
  reauthenticate: () => Promise<boolean>;
  /** A 409 conflict: the draft changed since the editor loaded it. */
  onConflict?: (error: ApiError) => void;
  /** A save made a commit: the shell starts watching the draft's preview build. */
  onCommitted?: (commit: string) => void;
}

export type SaveOutcome = 'nothing' | 'busy' | 'saved' | 'refused' | 'conflict' | 'signed-out' | 'failed';

/**
 * `SaveBody.expected` for a set of changes: the digest of every content file the editor holds
 * (`stored`), and null for each file the save writes that it holds none of (a new project).
 */
export function expectedOf(stored: Readonly<Record<string, string>>, changes: Changes): SaveBody['expected'] {
  const expected: SaveBody['expected'] = {};
  for (const [path, text] of Object.entries(stored)) if (isContentPath(path)) expected[path] = textDigest(text);
  for (const path of [...changes.writes.map((write) => write.path), ...changes.deletes]) {
    if (!Object.hasOwn(expected, path)) expected[path] = null;
  }
  return expected;
}

/** The request body for a set of changes on `base`, with the versions the editor holds. */
export function saveBodyOf(changes: Changes, base: string | null, expected: SaveBody['expected']): SaveBody {
  return {
    base,
    files: changes.writes.map((write) => ({ path: write.path, data: write.data })),
    deletes: [...changes.deletes],
    expected,
  };
}

/** The number of files a save would write or remove. */
export function changeCount(changes: Changes): number {
  return changes.writes.length + changes.deletes.length;
}

/** The save bar's sentence after a successful save. */
export function savedMessage(answer: SaveResponse, draftBranch: string | null): string {
  let text: string;
  if (answer.mode === 'disk') text = 'Saved to the content files on this computer.';
  else if (!answer.commit) text = 'Saved. Nothing had changed, so no commit was made.';
  else text = `Saved as commit ${shortSha(answer.commit)} on ${draftBranch ? `the ${draftBranch} branch` : 'the draft branch'}.`;
  if (answer.warnings.length > 0) text += ` ${plural(answer.warnings.length, 'warning')}.`;
  return text;
}

/** The first finding the admin can take the owner to: an error first, then a warning. */
export function firstRevealable<T extends { file: string; path: string; severity: string }>(findings: readonly T[]): T | undefined {
  const located = findings.filter((f) => {
    const where = locate(f.file, f.path);
    return where !== null && where.ids.length > 0;
  });
  return located.find((f) => f.severity === 'error') ?? located[0];
}

/** Runs one save. Returns what happened; the store holds the details for the save bar. */
export async function runSave(deps: SaveDeps): Promise<SaveOutcome> {
  const { store } = deps;
  const state = store.getState();
  if (!state.doc || !state.info) return 'nothing';
  if (state.save.status === 'saving') return 'busy';
  const sent = store.changes();
  if (changeCount(sent) === 0) return 'nothing';
  // The versions this editor holds, from the same state as the changes.
  const body = saveBodyOf(sent, state.info.head, expectedOf(state.info.stored, sent));

  store.setSaving();
  let answer = await deps.save(body);
  if (isApiError(answer) && answer.code === 'unauthorized' && (await deps.reauthenticate())) {
    answer = await deps.save(body);
  }

  if (!isApiError(answer)) {
    const message = savedMessage(answer, store.getState().info?.draftBranch ?? null);
    store.saved(sent, {
      head: answer.head,
      commit: answer.commit,
      warnings: answer.warnings,
      preview: answer.preview,
      message,
      moved: answer.moved,
      merged: answer.merged,
    });
    if (answer.commit) deps.onCommitted?.(answer.commit);
    return 'saved';
  }

  switch (answer.code) {
    case 'unauthorized':
      store.saveFailed('Not saved: your session has ended. Sign in again to save; your changes are still here.');
      return 'signed-out';
    case 'content-check': {
      const findings = answer.findings ?? [];
      store.saveFailed(`Not saved. ${answer.error} ${plural(findings.length, 'problem')} listed below.`, findings);
      const first = firstRevealable(findings);
      if (first) store.reveal(first.file, first.path);
      return 'refused';
    }
    case 'conflict':
      store.saveFailed(`Not saved. ${answer.error}`);
      store.noteStale(answer.files ?? []);
      deps.onConflict?.(answer);
      return 'conflict';
    default: {
      const findings = answer.findings ?? [];
      store.saveFailed(`Not saved. ${answer.error}`, findings);
      const first = firstRevealable(findings);
      if (first) store.reveal(first.file, first.path);
      return 'failed';
    }
  }
}
