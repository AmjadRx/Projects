'use client';

/**
 * The dialog that lists every reference to a project before its slug is renamed or the project
 * is deleted (docs/V3_PLAN.md D-21), and offers to update them in the same edit: one undo step
 * takes back the rename or the delete together with every reference change.
 */
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { plural } from '../shell/format';
import { describePatch, REFERENCE_KIND_LABELS, type Patch, type SlugReference } from './references';
import styles from './projects.module.css';

export type ReferencesAnswer = 'update' | 'leave' | 'cancel';

export interface ReferencesDialogProps {
  open: boolean;
  mode: 'rename' | 'delete';
  /** The project's title, for the dialog's words. */
  title: string;
  from: string;
  /** The new slug (rename only). */
  to?: string;
  refs: readonly SlugReference[];
  /** What each reference becomes, in the order of `refs` (null: left as is). */
  patches: readonly (Patch | null)[];
  /** The project's media folder (rename only): its files stay there. Default: `from`. */
  folder?: string;
  onAnswer: (answer: ReferencesAnswer) => void;
}

const TEXT_MAX = 160;

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > TEXT_MAX ? `${line.slice(0, TEXT_MAX - 1).trimEnd()}...` : line;
}

/** What a slug rename does to a project's media files, for the rename's words. */
export function renameMediaNote(folder: string): string {
  return `Its media files stay in /media/${folder}/ and keep working: their addresses do not change, and the library, Choose, and Upload keep using that folder.`;
}

export function ReferencesDialog({ open, mode, title, from, to, refs, patches, folder, onAnswer }: ReferencesDialogProps) {
  const changing = patches.filter((p) => p !== null).length;
  const count = plural(refs.length, 'reference');
  const rename = mode === 'rename';
  return (
    <Dialog
      open={open}
      onClose={() => onAnswer('cancel')}
      size="lg"
      role="alertdialog"
      title={rename ? `Rename ${from} to ${to}?` : `Delete ${title || from}?`}
      description={
        rename
          ? `${count} in the content point at /projects/${from}. Rename and update them in the same edit, or rename only and leave them (they then lead to no page). Undo takes back all of it in one step.`
          : `${count} in the content point at this project. Delete it and update them in the same edit, or delete only and leave them (the site prints them as plain text). Its file is removed from the draft when you save, and Undo brings everything back.`
      }
      footer={
        <>
          <Button data-autofocus onClick={() => onAnswer('cancel')}>
            Cancel
          </Button>
          <Button variant={rename ? 'secondary' : 'danger'} onClick={() => onAnswer('leave')}>
            {rename ? 'Rename only' : 'Delete only'}
          </Button>
          <Button variant={rename ? 'primary' : 'danger'} onClick={() => onAnswer('update')} disabled={changing === 0}>
            {rename ? `Rename and update ${plural(changing, 'reference')}` : `Delete and update ${plural(changing, 'reference')}`}
          </Button>
        </>
      }
    >
      <ul className={styles.refs} aria-label="References">
        {refs.map((ref, i) => (
          <li key={`${ref.file}|${ref.path}`} className={styles.ref}>
            <span className={styles.refWhere}>
              <span>{REFERENCE_KIND_LABELS[ref.kind]}</span>
              <span>{ref.file}</span>
              <span>{ref.path}</span>
            </span>
            <span className={styles.refText}>{clip(ref.text)}</span>
            <span className={styles.refChange}>{clip(describePatch(ref, patches[i] ?? null))}</span>
          </li>
        ))}
      </ul>
      {!rename ? (
        <p className="adm-muted">
          Its media files are not deleted with it. After you save, its folder is listed in Settings under Media, Other folders, where they can be deleted.
        </p>
      ) : null}
      {rename ? <p className="adm-muted">{renameMediaNote(folder ?? from)}</p> : null}
    </Dialog>
  );
}
