'use client';

/**
 * The project list (ARCHITECTURE.md 7, kept from v2 and extended): one row per project in display
 * order, which is the order on the site. Each row opens the full-page editor and has the visible
 * and featured toggles, reorder (drag the handle, or the up and down buttons and arrow keys),
 * duplicate, and delete, and shows whether its file has unsaved changes and how many warnings it
 * has. New and duplicated projects start hidden and unfeatured (docs/V3_PLAN.md D-21), the last
 * visible project cannot be hidden or deleted (D-06), and a delete first lists every reference
 * to the project and offers to update them in the same edit.
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, GripVertical, Plus, Star, Trash2 } from 'lucide-react';
import { countByFile } from '../state/warnings';
import { formatRoute } from '../shell/route';
import { plural } from '../shell/format';
import { useWarnings } from '../shell/WarningsPanel';
import { useAdmin, useAdminStore } from '../state/hooks';
import { pathOfEntry, type ProjectEntry } from '../state/store';
import { Badge, Notice, PanelHeader } from '../ui/bits';
import { Button, IconButton } from '../ui/Button';
import { useConfirm } from '../ui/Confirm';
import { cx } from '../ui/cx';
import { dropsAtEnd, dropsBefore, entryDirty, focusInRow, useDragSort } from './edit';
import { duplicateProject, isLastVisible, LAST_VISIBLE, newProject, statusWords } from './logic';
import { deleteProject, planRemoval, type Patch, type SlugReference } from './references';
import { ReferencesDialog, type ReferencesAnswer } from './ReferencesDialog';
import styles from './projects.module.css';

const NONE: ProjectEntry[] = [];

interface PendingDelete {
  key: string;
  slug: string;
  title: string;
  refs: SlugReference[];
  patches: (Patch | null)[];
}

export function ProjectList({ onOpen }: { onOpen: (key: string, slug: string) => void }) {
  const store = useAdminStore();
  const confirm = useConfirm();
  const projects = useAdmin((s) => s.doc?.projects ?? NONE);
  const info = useAdmin((s) => s.info);
  const warnings = useWarnings();
  const counts = useMemo(() => new Map(countByFile(warnings).map((c) => [c.file, c])), [warnings]);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const newButton = useRef<HTMLButtonElement | null>(null);

  const sort = useDragSort(projects.length, (from, to) => store.moveProject(from, to));
  const rows = sort.rows;

  const focusRow = useCallback(
    (index: number, selectors: readonly string[]) => focusInRow(() => rows.current[index], selectors, () => newButton.current),
    [rows],
  );

  const create = () => {
    const doc = store.getState().doc;
    if (!doc) return;
    const project = newProject(
      doc.projects.map((e) => e.data.slug),
      doc.projects.length + 1,
    );
    const key = store.addProject(project);
    onOpen(key, project.slug);
  };

  const move = (from: number, to: number, tool: 'up' | 'down' | 'handle') => {
    if (to < 0 || to >= projects.length) return;
    store.moveProject(from, to);
    focusRow(to, [`[data-tool="${tool}"]:not(:disabled)`, '[data-tool="handle"]:not(:disabled)', '[data-tool="title"]']);
  };

  const duplicate = (index: number) => {
    const doc = store.getState().doc;
    const entry = doc?.projects[index];
    if (!doc || !entry) return;
    const copy = duplicateProject(
      entry.data,
      doc.projects.map((e) => e.data.slug),
    );
    store.addProject(copy, index + 1);
    setMessage(`Duplicated as ${copy.slug}. The copy is hidden and not featured until you change that.`);
    focusRow(index + 1, ['[data-tool="title"]']);
  };

  const toggleVisible = (entry: ProjectEntry) => {
    if (entry.data.visible && isLastVisible(store.getState().doc?.projects ?? NONE, entry.key)) {
      setMessage(LAST_VISIBLE);
      return;
    }
    setMessage('');
    store.editProject(entry.key, (p) => ({ ...p, visible: !p.visible }));
  };

  const toggleFeatured = (entry: ProjectEntry) => {
    setMessage('');
    store.editProject(entry.key, (p) => ({ ...p, featured: !p.featured }));
  };

  /** One edit: the project leaves the list, with the reference updates when there are any. */
  const finishDelete = (key: string, patches: Patch[], index: number) => {
    if (patches.length === 0) store.removeProject(key);
    else store.edit((doc) => deleteProject(doc, key, patches));
    focusRow(Math.min(index, projects.length - 2), ['[data-tool="title"]']);
  };

  const remove = async (entry: ProjectEntry, index: number) => {
    const doc = store.getState().doc;
    if (!doc) return;
    const plan = planRemoval(doc, entry.key);
    if (!plan) return;
    if ('refused' in plan) {
      setMessage(plan.refused);
      return;
    }
    setMessage('');
    const slug = plan.slug;
    if (plan.refs.length > 0) {
      setPending(plan);
      return;
    }
    const saved = entry.loadedFile !== null;
    const ok = await confirm({
      title: `Delete ${entry.data.title || slug}?`,
      message: saved
        ? `Nothing else in the content points at it. Its file, ${entry.loadedFile}, is removed from the draft when you save. Undo brings it back.`
        : 'This project has not been saved yet, so deleting removes it from the editor only. Undo brings it back.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) finishDelete(entry.key, [], index);
  };

  const answerDelete = (choice: ReferencesAnswer) => {
    const current = pending;
    setPending(null);
    if (!current || choice === 'cancel') return;
    const index = projects.findIndex((e) => e.key === current.key);
    const patches = choice === 'update' ? current.patches.filter((p): p is Patch => p !== null) : [];
    finishDelete(current.key, patches, Math.max(0, index));
  };

  const onHandleKey = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      move(index, index - 1, 'handle');
    } else if (event.key === 'ArrowDown' && index < projects.length - 1) {
      event.preventDefault();
      move(index, index + 1, 'handle');
    } else if (event.key === 'Escape') {
      sort.onCancel();
    }
  };

  const open = (event: MouseEvent<HTMLAnchorElement>, entry: ProjectEntry) => {
    // A new tab or window keeps the link's own behaviour.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(entry.key, entry.data.slug);
  };

  return (
    <>
      <PanelHeader
        title="Projects"
        description="One file per project. The order here is the order on the site; drag a row by its handle or use its arrows. New and duplicated projects start hidden."
        actions={
          <Button ref={newButton} icon={<Plus size={16} />} onClick={create}>
            New project
          </Button>
        }
      />
      {message ? (
        <Notice tone="info" live className={styles.message}>
          {message}
        </Notice>
      ) : null}
      <div className={cx('adm-list', sort.drag && 'is-sorting')} role="group" aria-label="Projects">
        {projects.length === 0 ? <p className="adm-list__empty">No projects yet.</p> : null}
        <ol className="adm-list__rows">
          {projects.map((entry, index) => {
            const { data } = entry;
            const title = data.title.trim() || 'Untitled project';
            const file = pathOfEntry(entry);
            const count = counts.get(file);
            const dirty = entryDirty(info, entry);
            return (
              <li
                key={entry.key}
                ref={(el) => sort.setRow(index, el)}
                className={cx('adm-list__row', sort.drag?.from === index && 'is-dragging', dropsBefore(sort.drag, index) && 'is-drop-before')}
              >
                <div className={cx('adm-list__head', styles.head)}>
                  <IconButton
                    className="adm-list__handle"
                    data-tool="handle"
                    label={`Reorder ${title}: drag, or use the up and down arrow keys`}
                    icon={<GripVertical size={18} />}
                    size="sm"
                    disabled={projects.length < 2}
                    onPointerDown={(e) => sort.onDown(index, e)}
                    onPointerMove={sort.onMove}
                    onPointerUp={sort.onUp}
                    onPointerCancel={sort.onCancel}
                    onKeyDown={(e) => onHandleKey(index, e)}
                  />
                  <a className={cx('adm-list__title', styles.titleLink)} data-tool="title" href={formatRoute('projects', data.slug)} onClick={(e) => open(e, entry)}>
                    <span className={styles.titleText}>{title}</span>
                    <span className="adm-sr">: edit this project</span>
                  </a>
                  <div className="adm-list__tools">
                    <IconButton
                      label={`Visible on the site: ${title}`}
                      aria-pressed={data.visible}
                      className={data.visible ? styles.pressed : undefined}
                      icon={data.visible ? <Eye size={17} /> : <EyeOff size={17} />}
                      size="sm"
                      onClick={() => toggleVisible(entry)}
                    />
                    <IconButton
                      label={`Featured on the home page: ${title}`}
                      aria-pressed={data.featured}
                      className={data.featured ? styles.pressed : undefined}
                      icon={<Star size={17} fill={data.featured ? 'currentColor' : 'none'} />}
                      size="sm"
                      onClick={() => toggleFeatured(entry)}
                    />
                    <IconButton data-tool="up" label={`Move ${title} up`} icon={<ChevronUp size={18} />} size="sm" disabled={index === 0} onClick={() => move(index, index - 1, 'up')} />
                    <IconButton
                      data-tool="down"
                      label={`Move ${title} down`}
                      icon={<ChevronDown size={18} />}
                      size="sm"
                      disabled={index === projects.length - 1}
                      onClick={() => move(index, index + 1, 'down')}
                    />
                    <IconButton label={`Duplicate ${title}`} icon={<Copy size={16} />} size="sm" onClick={() => duplicate(index)} />
                    <IconButton label={`Delete ${title}`} icon={<Trash2 size={16} />} size="sm" onClick={() => void remove(entry, index)} />
                  </div>
                </div>
                <div className={styles.meta}>
                  <span className={styles.slug}>/projects/{data.slug}</span>
                  <span>{statusWords(data)}</span>
                  {!data.visible ? <Badge tone="info">Hidden</Badge> : null}
                  {data.featured ? <Badge tone="ok">Featured</Badge> : null}
                  {dirty ? <Badge tone="warning">{entry.loadedFile === null ? 'New, not saved' : 'Unsaved changes'}</Badge> : null}
                  {count && count.errors > 0 ? <Badge tone="error">{plural(count.errors, 'error')}</Badge> : null}
                  {count && count.warnings > 0 ? <Badge>{plural(count.warnings, 'warning')}</Badge> : null}
                </div>
              </li>
            );
          })}
        </ol>
        {dropsAtEnd(sort.drag, projects.length) ? <div className="adm-list__drop-end" aria-hidden="true" /> : null}
      </div>
      <ReferencesDialog
        open={pending !== null}
        mode="delete"
        title={pending?.title ?? ''}
        from={pending?.slug ?? ''}
        refs={pending?.refs ?? []}
        patches={pending?.patches ?? []}
        onAnswer={answerDelete}
      />
    </>
  );
}
