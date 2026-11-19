'use client';

/**
 * The slug, renamed on purpose rather than as the owner types (docs/V3_PLAN.md D-21): the field
 * holds the new slug until Rename (or Enter), which first lists every reference to the old one
 * and offers to update them in the same edit. The store moves the file: the next save writes the
 * project under its new name and deletes the old file. Its media files stay in their folder and
 * keep working, and the editor keeps using that folder (`mediaFolderOf`); both the dialog and the
 * status line say so.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useAdmin, useAdminStore } from '../state/hooks';
import type { ProjectEntry } from '../state/store';
import { Button } from '../ui/Button';
import { SlugField, slugIssue } from '../ui/inputs';
import { slugTaken } from './logic';
import { findSlugReferences, renamePatches, renameProject, type Patch, type SlugReference } from './references';
import { ReferencesDialog, renameMediaNote, type ReferencesAnswer } from './ReferencesDialog';
import styles from './projects.module.css';

const NONE: ProjectEntry[] = [];

interface Pending {
  to: string;
  refs: SlugReference[];
  patches: Patch[];
}

export function SlugRename({ entryKey, slug, title, folder }: { entryKey: string; slug: string; title: string; folder: string | null }) {
  const store = useAdminStore();
  const projects = useAdmin((s) => s.doc?.projects ?? NONE);
  const [draft, setDraft] = useState(slug);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);

  // A slug changed from outside (Undo, Revert) shows as it is now.
  useEffect(() => setDraft(slug), [slug]);

  const changed = draft !== slug;
  const taken = changed && slugTaken(projects, entryKey, draft);
  const problem = slugIssue(draft) ?? (taken ? 'Another project already uses this slug.' : null);
  const canRename = changed && problem === null;

  const apply = (to: string, patches: Patch[], updated: number) => {
    store.edit((doc) => renameProject(doc, entryKey, to, patches));
    setStatus(
      `Renamed to ${to}${updated > 0 ? `, with ${updated === 1 ? 'one reference' : `${updated} references`} updated` : ''}. ${folder ? `${renameMediaNote(folder)} ` : ''}Save to keep it; Undo takes it back.`,
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canRename) return;
    const doc = store.getState().doc;
    if (!doc) return;
    const refs = findSlugReferences(doc, slug);
    if (refs.length === 0) {
      apply(draft, [], 0);
      return;
    }
    setPending({ to: draft, refs, patches: renamePatches(refs, slug, draft) });
  };

  const answer = (choice: ReferencesAnswer) => {
    const current = pending;
    setPending(null);
    if (!current || choice === 'cancel') return;
    if (choice === 'update') apply(current.to, current.patches, current.patches.length);
    else apply(current.to, [], 0);
  };

  return (
    <div>
      <form className={styles.slugRow} onSubmit={submit}>
        <SlugField
          path="slug"
          label="Slug"
          prefix="/projects/"
          hint="The page address. Type a new slug and choose Rename; links to this project can be updated with it."
          value={draft}
          issue={taken ? 'Another project already uses this slug.' : null}
          onChange={(value) => {
            setDraft(value);
            setStatus('');
          }}
        />
        <Button type="submit" size="sm" disabled={!canRename}>
          Rename
        </Button>
        {changed ? (
          <Button size="sm" variant="ghost" onClick={() => setDraft(slug)}>
            Keep {slug}
          </Button>
        ) : null}
      </form>
      <p className={styles.status} role="status">
        {status}
      </p>
      <ReferencesDialog
        open={pending !== null}
        mode="rename"
        title={title}
        from={slug}
        to={pending?.to}
        refs={pending?.refs ?? []}
        patches={pending?.patches ?? []}
        folder={folder ?? slug}
        onAnswer={answer}
      />
    </div>
  );
}
