'use client';

/**
 * "Revert this file to published" (ARCHITECTURE.md 7.5). It asks the server for the live branch's
 * version of one content file (GET /api/content?ref=live&path=) and loads it into the editor with
 * `store.revertFile`. Nothing is written until the next save, and Undo brings the owner's version
 * back. On disk (local development) the "published" version is the file as saved on this computer.
 *
 * A project that is not on the published site has no published version, so reverting it removes
 * it, and that is a delete: it goes the way Delete in the project list goes (docs/V3_PLAN.md D-06,
 * D-21). It is refused for the last visible project; otherwise every reference to the project is
 * listed first and can be updated, and the removal and the reference updates are one undo step.
 *
 * Put it in an editor's header:
 *
 *   <RevertFileButton file={SITE_FILE} />                     the site tabs
 *   <RevertFileButton file={entry.loadedFile ?? projectFile} />   a project (the file it was loaded from)
 */
import { useState } from 'react';
import { History } from 'lucide-react';
import { SITE_FILE } from '@/lib/admin/contract';
import { plural } from './format';
import { deleteProject, planRemoval, type Patch, type SlugReference } from '../projects/references';
import { ReferencesDialog, type ReferencesAnswer } from '../projects/ReferencesDialog';
import { api, isApiError, withReauth } from '../state/api';
import { useAdmin, useAdminStore } from '../state/hooks';
import { pathOfEntry, textOf, type AdminState, type ProjectEntry } from '../state/store';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/Confirm';
import { cx } from '../ui/cx';

/** The project entry saved to or loaded from `file`, if any. */
function entryOfFile(state: AdminState, file: string): ProjectEntry | undefined {
  return state.doc?.projects.find((entry) => pathOfEntry(entry) === file || entry.loadedFile === file);
}

/** The working copy of a content file: the site, or the project saved to or loaded from `file`. */
export function workingData(state: AdminState, file: string): unknown | undefined {
  if (!state.doc) return undefined;
  if (file === SITE_FILE) return state.doc.site;
  return entryOfFile(state, file)?.data;
}

export interface RevertFileButtonProps {
  /** "content/site.json" or "content/projects/<slug>.json". */
  file: string;
  label?: string;
  className?: string;
}

interface PendingRemoval {
  key: string;
  slug: string;
  title: string;
  refs: SlugReference[];
  patches: (Patch | null)[];
}

export function RevertFileButton({ file, label = 'Revert this file to published', className }: RevertFileButtonProps) {
  const store = useAdminStore();
  const confirm = useConfirm();
  const disk = useAdmin((s) => s.info?.source === 'disk');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const published = disk ? 'the version saved on this computer' : 'the published version';

  /** Removes the project as one edit, with the reference updates the owner chose. */
  const remove = (key: string, patches: readonly Patch[]) => {
    store.edit((doc) => deleteProject(doc, key, patches));
    setResult({
      tone: 'ok',
      text: `Reverted in the editor: the project is removed${patches.length > 0 ? `, with ${plural(patches.length, 'reference')} updated` : ''}. Save to keep it; Undo brings it back.`,
    });
  };

  const revert = async () => {
    setBusy(true);
    setResult(null);
    const answer = await withReauth(() => api.publishedFile(file));
    setBusy(false);
    if (isApiError(answer)) {
      setResult({ tone: 'error', text: `Not reverted. ${answer.error}` });
      return;
    }
    const state = store.getState();
    const current = workingData(state, file);
    if (answer.data !== null && current !== undefined && textOf(answer.data) === textOf(current)) {
      setResult({ tone: 'ok', text: `This file already matches ${published}.` });
      return;
    }
    if (answer.data === null && current === undefined) {
      setResult({ tone: 'ok', text: 'This file is neither published nor in the editor.' });
      return;
    }

    // Not published: the revert removes the project, which goes the way of a delete.
    const entry = answer.data === null && file !== SITE_FILE ? entryOfFile(state, file) : undefined;
    const plan = entry && state.doc ? planRemoval(state.doc, entry.key) : null;
    if (plan && 'refused' in plan) {
      setResult({ tone: 'error', text: `Not reverted. ${plan.refused}` });
      return;
    }
    if (plan && plan.refs.length > 0) {
      setPending(plan);
      return;
    }

    const ok = await confirm({
      title: 'Revert this file?',
      message:
        answer.data === null ? (
          <p>
            <span className="adm-mono adm-break">{file}</span> is not on the published site yet. Reverting removes this project from the editor; the
            next save deletes its file from the draft. Nothing else in the content points at it. Undo brings it back.
          </p>
        ) : (
          <p>
            The editor loads {published} of <span className="adm-mono adm-break">{file}</span>, replacing your changes to it that are not
            published. Nothing is written until you save, and Undo brings your version back.
          </p>
        ),
      confirmLabel: 'Revert',
      tone: 'danger',
    });
    if (!ok) return;
    if (plan) {
      remove(plan.key, []);
      return;
    }
    store.revertFile(file, answer.data);
    setResult({ tone: 'ok', text: 'Reverted in the editor. Save to keep it; Undo brings your version back.' });
  };

  const answerRemoval = (choice: ReferencesAnswer) => {
    const current = pending;
    setPending(null);
    if (!current || choice === 'cancel') return;
    remove(current.key, choice === 'update' ? current.patches.filter((p): p is Patch => p !== null) : []);
  };

  return (
    <>
      <span className={cx('adm-revert', className)}>
        <Button size="sm" icon={<History size={16} />} busy={busy} onClick={() => void revert()}>
          {label}
        </Button>
        <span role="status" className={cx('adm-revert__result', result?.tone === 'error' && 'adm-revert__result--error')}>
          {result?.text ?? ''}
        </span>
      </span>
      <ReferencesDialog
        open={pending !== null}
        mode="delete"
        title={pending?.title ?? ''}
        from={pending?.slug ?? ''}
        refs={pending?.refs ?? []}
        patches={pending?.patches ?? []}
        onAnswer={answerRemoval}
      />
    </>
  );
}
