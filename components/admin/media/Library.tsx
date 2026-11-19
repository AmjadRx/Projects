'use client';

/**
 * The media library of one folder: the site's ("site") or a project's (its slug). ARCHITECTURE.md
 * 13A: drag and drop of many files at once, a progress bar per file, type detection from the
 * bytes, automatic posters, rename, replace, and delete; both stores listed, and a delete that
 * checks for content that still uses the file first. docs/V3_PLAN.md D-25 to D-27.
 *
 * - The grid lists the repository and Blob files with a picture (the poster for video, models,
 *   and documents), name, size, store, and how many fields use each one in the editor, the saved
 *   draft, and the published site.
 * - "Not used anywhere" filters to files nothing uses, such as Blob files left after a discard.
 * - A file whose name looks like a resume is marked (D-22: no resume file is ever served).
 * - Uploads whose field was removed before they were stored are listed here, with their note.
 * - Copy address, Open, Rename (the server rewrites the draft's references in the same commit;
 *   the editor then reloads the content), Replace (a repository file of the same type keeps its
 *   name and address; anything else becomes a new file and the fields that used the old one point
 *   at it, as one undo step), and Delete (refused, with the fields listed, while anything uses
 *   the file; otherwise a confirmation first).
 */
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, LoaderCircle, Pencil, RefreshCw, Replace, Trash2 } from 'lucide-react';
import type { MediaItem, Reference } from '@/lib/admin/contract';
import { formatBytes } from '@/lib/media';
import { megabytes, plural } from '../shell/format';
import { isApiError } from '../state/api';
import { useAdmin, useAdminStore } from '../state/hooks';
import { isDirty } from '../state/store';
import { Badge, Notice, Section } from '../ui/bits';
import { Button, IconButton } from '../ui/Button';
import { useConfirm } from '../ui/Confirm';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { DropZone } from './DropZone';
import {
  ACCEPT_ANY,
  acceptAttribute,
  BLOB_NOT_CONFIGURED,
  countLocalReferences,
  extensionOfName,
  findLocalReferences,
  findPosterItem,
  givenName,
  isPosterName,
  isResumeName,
  isUnused,
  KIND_WORDS,
  kindOfName,
  nameWithoutExtension,
  predictedName,
  replaceInDoc,
  type Replacement,
} from './logic';
import { isUnplaced, type QueueItem, type StoredUpload } from './manager';
import styles from './media.module.css';
import { UploadQueue } from './Queue';
import { noteDraftCommit, useCommitBridge, useFolderSaved, useMediaList, useMediaManager, useQueueItems, useStorageStatus, useUploadTarget } from './services';
import { Thumb } from './Thumb';

interface LibraryNotice {
  tone: 'ok' | 'info' | 'warning' | 'error';
  title?: string;
  text: ReactNode;
  /** Fields that use a file, in the editor or the saved draft (each one opens its field). */
  draft?: Reference[];
  /** Fields of the published site that use a file. */
  live?: Reference[];
  /** Content files a rename rewrote. */
  files?: string[];
}

const DRAFT_IN_USE =
  'The saved draft uses this file in these fields. Remove it from them and save, then delete it. The published site keeps its own copy until the next publish.';
const BLOB_IN_USE =
  'Deleting a file from Vercel Blob removes it from the published site at once, so it can go only when neither the draft nor the published site uses it. Remove it from these fields, save, publish, and then delete it.';
const EDITOR_IN_USE =
  'These fields in the editor use this file. Remove it from them first (a poster goes with the file it belongs to), then delete it.';

function usageWords(item: MediaItem, local: number): string {
  if (!item.refs) return local > 0 ? `Used by ${plural(local, 'field')} in the editor` : '';
  if (isUnused(item, local)) return 'Not used anywhere';
  const bits = [`${plural(local, 'field')} in the editor`];
  if (item.refs.draft !== local) bits.push(`${item.refs.draft} in the saved draft`);
  bits.push(`${item.refs.live} on the published site`);
  return `Used by ${bits.join(', ')}`;
}

function ReferenceList({ refs, onGo }: { refs: readonly Reference[]; onGo?: (ref: Reference) => void }) {
  return (
    <ul className={styles.refs}>
      {refs.map((ref, i) => (
        <li key={`${ref.file}|${ref.path}|${i}`}>
          {onGo ? (
            <button type="button" className={cx('adm-link', styles.refButton)} onClick={() => onGo(ref)}>
              <span className="adm-mono">{ref.file}</span>, <span className="adm-mono">{ref.path}</span>
              <span className="adm-sr"> (go to this field)</span>
            </button>
          ) : (
            <span>
              <span className="adm-mono">{ref.file}</span>, <span className="adm-mono">{ref.path}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function StorageLine() {
  const storage = useStorageStatus();
  if (!storage) {
    return <p className={styles.note}>Files up to 4 MB are committed to the repository; larger files go to Vercel Blob when it is connected.</p>;
  }
  const repoMax = megabytes(storage.limits.repoMaxBytes);
  const blobMax = megabytes(storage.limits.blobMaxBytes);
  return (
    <>
      {storage.blob.configured ? (
        <p className={styles.note}>
          Files up to {repoMax} are committed to the repository; larger files, up to {blobMax}, go to Vercel Blob, which is connected.
        </p>
      ) : (
        <p className={styles.note}>
          Files up to {repoMax} are committed to the repository. {BLOB_NOT_CONFIGURED}
        </p>
      )}
      {storage.repo.problem ? <Notice tone="warning">{storage.repo.problem}</Notice> : null}
    </>
  );
}

interface CardProps {
  item: MediaItem;
  poster: MediaItem | null;
  local: number;
  busy: boolean;
  copied: boolean;
  onCopy: () => void;
  onRename: () => void;
  onReplace: () => void;
  onDelete: () => void;
}

function LibraryCard({ item, poster, local, busy, copied, onCopy, onRename, onReplace, onDelete }: CardProps) {
  const kind = kindOfName(item.name);
  const unused = isUnused(item, local);
  return (
    <li className={styles.card} data-src={item.src}>
      <Thumb kind={kind} src={item.src} previewSrc={item.previewSrc} poster={poster?.src} size="md" className={styles.cardThumb} />
      <div className={styles.cardBody}>
        <p className={styles.cardName}>{item.name}</p>
        <p className={styles.meta}>
          <Badge>{item.store === 'blob' ? 'Blob' : 'Repository'}</Badge>
          <span>{KIND_WORDS[kind]}</span>
          {item.size !== undefined ? <span>{formatBytes(item.size)}</span> : null}
          {isPosterName(item.name) ? <span>poster</span> : null}
        </p>
        <p className={cx(styles.usage, unused && styles.unused)}>{usageWords(item, local)}</p>
        {isResumeName(item.name) ? (
          <p className={styles.resume}>
            <Badge tone="warning">Looks like a resume</Badge> No resume file is ever served on this site; delete it unless it is something else.
          </p>
        ) : null}
      </div>
      <div className={styles.cardTools}>
        <IconButton
          label={copied ? `Copied the address of ${item.name}` : `Copy the address of ${item.name}`}
          icon={copied ? <Check size={16} /> : <Copy size={16} />}
          size="sm"
          onClick={onCopy}
        />
        <a
          className="adm-iconbtn adm-iconbtn--ghost adm-iconbtn--sm"
          href={item.previewSrc}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${item.name} in a new tab`}
          title={`Open ${item.name} in a new tab`}
        >
          <span className="adm-iconbtn__icon" aria-hidden="true">
            <ExternalLink size={16} />
          </span>
        </a>
        <IconButton label={`Rename ${item.name}`} icon={<Pencil size={16} />} size="sm" disabled={busy} onClick={onRename} />
        <IconButton label={`Replace ${item.name}`} icon={<Replace size={16} />} size="sm" disabled={busy} onClick={onReplace} />
        <IconButton
          label={`Delete ${item.name}`}
          icon={busy ? <LoaderCircle className="adm-spin" size={16} /> : <Trash2 size={16} />}
          size="sm"
          disabled={busy}
          onClick={onDelete}
        />
      </div>
    </li>
  );
}

function RenameDialog({ item, onClose, onRename }: { item: MediaItem; onClose: () => void; onRename: (item: MediaItem, name: string) => Promise<string | null> }) {
  const [name, setName] = useState(() => nameWithoutExtension(givenName(item.name)));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const ext = extensionOfName(item.name);
  const stored = name.trim() === '' ? null : predictedName(`${name.trim()}.${ext}`);

  const submit = async () => {
    if (name.trim() === '' || busy) return;
    setBusy(true);
    setProblem(null);
    const failure = await onRename(item, name.trim());
    setBusy(false);
    if (failure) setProblem(failure);
    else onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Rename ${item.name}`}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void submit()}>
            Rename
          </Button>
        </>
      }
    >
      <form
        className={styles.renameForm}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={inputId} className="adm-field__label">
          New name
        </label>
        <input
          id={inputId}
          className="adm-input adm-input--mono"
          value={name}
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          aria-describedby={hintId}
          onChange={(event) => setName(event.target.value)}
        />
        <p id={hintId} className="adm-field__hint">
          The type stays .{ext}.{stored ? ` It is stored as ${stored}${item.store === 'blob' ? ', with a new random ending' : ''}.` : ''}{' '}
          {item.store === 'blob' ? 'Vercel Blob keeps the old copy until nothing uses it.' : "The saved draft's references to it are rewritten in the same commit."}
        </p>
        {problem ? <Notice tone="error">{problem}</Notice> : null}
      </form>
    </Dialog>
  );
}

export interface MediaLibraryPanelProps {
  /** "site", a project's media folder, or another folder the server listed. */
  folder: string;
  title: string;
  /** A sentence under the title. */
  description?: ReactNode;
  /** The heading level inside the page. Default 2. */
  level?: 2 | 3;
  /** The server listed this folder (the folder of a renamed or deleted project), so it exists. */
  known?: boolean;
}

/** The whole library for one folder: upload, list, rename, replace, delete. */
export function MediaLibraryPanel({ folder, title, description, level = 2, known = false }: MediaLibraryPanelProps) {
  const manager = useMediaManager();
  const store = useAdminStore();
  const confirm = useConfirm();
  useCommitBridge();
  const exists = useFolderSaved(folder);
  const saved = known || exists;
  const { files, error, loading, refresh } = useMediaList(folder, { refs: true, enabled: saved });
  // Typing elsewhere changes the working copy on every key; the counts may lag a moment behind.
  const doc = useDeferredValue(useAdmin((state) => state.doc));
  const filterId = useId();
  const [filter, setFilter] = useState<'all' | 'unused'>('all');
  const [notice, setNotice] = useState<LibraryNotice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<MediaItem | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement | null>(null);
  const replacing = useRef<MediaItem | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const target = `library:${folder}`;

  // A refusal or a result may come from a card far down the grid: bring the notice into view.
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [notice]);

  const list = useMemo(() => files ?? [], [files]);
  const srcs = useMemo(() => list.map((item) => item.src), [list]);
  const local = useMemo(() => (doc ? countLocalReferences(doc, srcs) : new Map<string, number>()), [doc, srcs]);
  const unusedCount = useMemo(() => list.filter((item) => isUnused(item, local.get(item.src) ?? 0)).length, [list, local]);
  const shown = filter === 'unused' ? list.filter((item) => isUnused(item, local.get(item.src) ?? 0)) : list;

  /** After a library Replace, the fields that used the old file point at the new one (one undo step). */
  const applyReplace = (result: StoredUpload, item: QueueItem) => {
    const old = item.replaceOf;
    if (!old) return { applied: true };
    const before = store.getState().doc;
    if (!before) return { applied: false, note: 'The new file is stored, but no content is loaded to update.' };
    const to: Replacement = {
      src: result.main.src,
      store: result.main.store,
      poster: result.poster?.src ?? null,
      waveform: result.ref?.waveform ?? null,
    };
    const count = findLocalReferences(before, old.src).length;
    store.edit((current) => replaceInDoc(current, old.src, to));
    const changed = store.getState().doc !== before;
    if (old.src === to.src) {
      return {
        applied: true,
        note: changed
          ? 'Replaced under the same name. The fields that use it now carry the new poster too: save to keep that change.'
          : 'Replaced under the same name, so every field that uses it now uses the new file.',
      };
    }
    if (count === 0) return { applied: true, note: `Stored as ${result.main.name}. Nothing in the editor used the old file.` };
    return {
      applied: true,
      note: `Stored as ${result.main.name}, and ${plural(count, 'field')} now use it instead of ${old.name}. Save to keep the change. The old file stays in the library until nothing uses it.`,
    };
  };
  useUploadTarget(target, applyReplace);
  // This folder's uploads, and those of its fields' uploads whose field was removed meanwhile.
  const queue = useQueueItems((item) => item.target === target || (isUnplaced(item) && item.folder === folder), target);

  const go = (ref: Reference) => store.reveal(ref.file, ref.path);

  const copy = async (item: MediaItem) => {
    try {
      await navigator.clipboard.writeText(item.src);
      setCopied(item.src);
      window.setTimeout(() => setCopied((current) => (current === item.src ? null : current)), 2000);
    } catch {
      setNotice({ tone: 'info', text: <>The browser did not allow copying. The address is <span className="adm-mono adm-break">{item.src}</span></> });
    }
  };

  const startReplace = (item: MediaItem) => {
    const input = replaceInput.current;
    if (!input) return;
    replacing.current = item;
    const kind = kindOfName(item.name);
    input.accept = acceptAttribute([kind]);
    input.multiple = kind === 'model';
    input.click();
  };

  const remove = async (item: MediaItem) => {
    setNotice(null);
    const current = store.getState().doc;
    const inEditor = current ? findLocalReferences(current, item.src) : [];
    if (inEditor.length > 0) {
      setNotice({ tone: 'error', title: `${item.name} is still in use`, text: EDITOR_IN_USE, draft: inEditor });
      return;
    }
    setBusy(item.src);
    const refs = await manager.api.mediaReferences(item.src);
    setBusy(null);
    if (isApiError(refs)) {
      setNotice({ tone: 'error', title: `${item.name} was not deleted`, text: refs.error });
      return;
    }
    const blocking = item.store === 'blob' ? refs.draft.length + refs.live.length : refs.draft.length;
    if (blocking > 0) {
      setNotice({ tone: 'error', title: `${item.name} is still in use`, text: item.store === 'blob' ? BLOB_IN_USE : DRAFT_IN_USE, draft: refs.draft, live: refs.live });
      return;
    }
    const poster = findPosterItem(item, list);
    const posterToo = poster && isUnused(poster, local.get(poster.src) ?? 0) ? poster : null;
    const ok = await confirm({
      title: `Delete ${item.name}?`,
      message: (
        <>
          <p>
            {item.store === 'blob'
              ? 'The file is removed from Vercel Blob at once. Undo cannot bring it back.'
              : 'The file is removed from the draft branch in one commit; the published site keeps its copy until the next publish. Undo cannot bring it back.'}
          </p>
          {posterToo ? <p>Its poster, {posterToo.name}, is deleted too.</p> : null}
        </>
      ),
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(item.src);
    const answer = await manager.api.mediaDelete(item.src);
    if (isApiError(answer)) {
      setBusy(null);
      if (answer.code === 'referenced' && answer.references) {
        setNotice({ tone: 'error', title: `${item.name} is still in use`, text: answer.error, draft: answer.references.draft, live: answer.references.live });
      } else {
        setNotice({ tone: 'error', title: `${item.name} was not deleted`, text: answer.error });
      }
      return;
    }
    manager.noteCommit(answer.commit);
    let posterWords = '';
    if (posterToo) {
      const second = await manager.api.mediaDelete(posterToo.src);
      if (isApiError(second)) posterWords = ` Its poster, ${posterToo.name}, was not deleted: ${second.error}`;
      else {
        manager.noteCommit(second.commit);
        posterWords = ` Its poster, ${posterToo.name}, was deleted too.`;
      }
    }
    setBusy(null);
    manager.invalidateFolder(folder);
    setNotice({ tone: 'ok', text: `Deleted ${item.name}.${posterWords}` });
  };

  const rename = async (item: MediaItem, name: string): Promise<string | null> => {
    const state = store.getState();
    if ((item.refs?.draft ?? 0) > 0 && isDirty(state.doc, state.info)) {
      return 'Save or undo your changes first. The saved draft uses this file, so the rename rewrites that content, and the editor then loads it again.';
    }
    const answer = await manager.api.mediaRename(item.src, name);
    if (isApiError(answer)) return answer.error;
    manager.invalidateFolder(folder);
    if (answer.rewrote.length > 0) {
      const now = store.getState();
      if (isDirty(now.doc, now.info)) {
        // The list was out of date: the draft did use the file. Loading again would drop the
        // unsaved changes, so the owner decides (a save of those files now reports a conflict).
        noteDraftCommit(store);
        setNotice({
          tone: 'warning',
          title: `Renamed to ${answer.file.name}`,
          text: `The saved draft's references were rewritten in ${plural(answer.rewrote.length, 'file')}. The editor still shows the old address there: save your other changes, then load the content again before editing these files.`,
          files: answer.rewrote,
        });
        return null;
      }
      const content = await manager.api.content();
      if (isApiError(content)) {
        setNotice({ tone: 'warning', title: `Renamed to ${answer.file.name}`, text: `The draft's references were rewritten, but the content could not be loaded again (${content.error}). Reload the page before editing.` });
        return null;
      }
      store.load(content);
      setNotice({
        tone: 'ok',
        title: `Renamed to ${answer.file.name}`,
        text: `The saved draft's references were rewritten in the same commit, in ${plural(answer.rewrote.length, 'file')}. The editor loaded the content again, so Undo starts from here.`,
        files: answer.rewrote,
      });
      return null;
    }
    if (answer.commit) noteDraftCommit(store);
    const current = store.getState().doc;
    const inEditor = current ? findLocalReferences(current, item.src).length : 0;
    if (inEditor > 0 && answer.file.src !== item.src) {
      store.edit((doc) => replaceInDoc(doc, item.src, { src: answer.file.src, store: answer.file.store }));
      setNotice({ tone: 'ok', title: `Renamed to ${answer.file.name}`, text: `${plural(inEditor, 'field')} in the editor now use the new name. Save to keep the change.` });
    } else {
      setNotice({ tone: 'ok', text: `Renamed to ${answer.file.name}.` });
    }
    return null;
  };

  return (
    <Section
      title={title}
      description={description}
      level={level}
      className={styles.library}
      actions={
        saved ? (
          <Button size="sm" variant="ghost" icon={<RefreshCw size={16} />} onClick={refresh}>
            Refresh
          </Button>
        ) : null
      }
    >
      <StorageLine />
      {!saved ? (
        <Notice tone="info">This project is not saved yet. Save it to make its media folder, then add files here.</Notice>
      ) : (
        <>
          <DropZone
            onFiles={(dropped) => void manager.add(dropped, { target, folder, accept: ACCEPT_ANY })}
            title="Drop files here to add them to this library"
            inputLabel={`Files to add to ${title}`}
            hint="Many files at once. Photos become WebP of at most 2560 px, MOV video becomes MP4, 3D files (STEP included) become one compressed GLB, and videos, models, and documents get a poster."
          />
          <UploadQueue items={queue} label={`Uploads to ${title}`} />
        </>
      )}

      {notice ? (
        <div ref={noticeRef} className={styles.noticeWrap}>
          <Notice
            tone={notice.tone}
            title={notice.title}
            live
            actions={
              <Button size="sm" onClick={() => setNotice(null)}>
                Dismiss
              </Button>
            }
          >
            <p>{notice.text}</p>
            {notice.draft && notice.draft.length > 0 ? (
              <>
                <p className={styles.refsTitle}>In the editor and the saved draft:</p>
                <ReferenceList refs={notice.draft} onGo={go} />
              </>
            ) : null}
            {notice.live && notice.live.length > 0 ? (
              <>
                <p className={styles.refsTitle}>On the published site:</p>
                <ReferenceList refs={notice.live} />
              </>
            ) : null}
            {notice.files && notice.files.length > 0 ? (
              <ul className={styles.refs}>
                {notice.files.map((path) => (
                  <li key={path} className="adm-mono">
                    {path}
                  </li>
                ))}
              </ul>
            ) : null}
          </Notice>
        </div>
      ) : null}

      {saved ? (
        <div className={styles.toolbar}>
          <div className="adm-filter">
            <label htmlFor={filterId} className="adm-filter__label">
              Show
            </label>
            <select
              id={filterId}
              className="adm-input adm-select adm-select--compact"
              value={filter}
              onChange={(event) => setFilter(event.target.value === 'unused' ? 'unused' : 'all')}
            >
              <option value="all">All files ({list.length})</option>
              <option value="unused">Not used anywhere ({unusedCount})</option>
            </select>
          </div>
          {loading && files ? (
            <span className={styles.note}>
              <LoaderCircle className="adm-spin" size={14} aria-hidden="true" /> Listing again...
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Notice tone="error" title="The files could not be listed" actions={<Button size="sm" icon={<RefreshCw size={16} />} onClick={refresh}>Try again</Button>}>
          {error}
        </Notice>
      ) : null}
      {saved && loading && !files ? <p className={styles.note}>Loading the files...</p> : null}
      {files && list.length === 0 ? <p className={styles.note}>No files in this library yet.</p> : null}
      {files && list.length > 0 && shown.length === 0 ? <p className={styles.note}>Every file here is used somewhere.</p> : null}

      {shown.length > 0 ? (
        <ul className={styles.grid} aria-label={`Files in ${title}`}>
          {shown.map((item) => (
            <LibraryCard
              key={item.src}
              item={item}
              poster={findPosterItem(item, list)}
              local={local.get(item.src) ?? 0}
              busy={busy === item.src}
              copied={copied === item.src}
              onCopy={() => void copy(item)}
              onRename={() => {
                setNotice(null);
                setRenaming(item);
              }}
              onReplace={() => startReplace(item)}
              onDelete={() => void remove(item)}
            />
          ))}
        </ul>
      ) : null}

      <input
        ref={replaceInput}
        type="file"
        hidden
        aria-label={`The file that replaces the chosen one in ${title}`}
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          event.target.value = '';
          const old = replacing.current;
          replacing.current = null;
          if (chosen.length > 0 && old) void manager.add(chosen, { target, folder, accept: ACCEPT_ANY, replaceOf: old });
        }}
      />
      {renaming ? <RenameDialog item={renaming} onClose={() => setRenaming(null)} onRename={rename} /> : null}
    </Section>
  );
}
