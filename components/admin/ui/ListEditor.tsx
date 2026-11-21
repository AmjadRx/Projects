'use client';

/**
 * An editor for a list of rows (stats, nav items, facts, block rows): add, remove, duplicate,
 * move up and down, drag by the handle, collapse and expand.
 *
 *   <ListEditor
 *     path="stats"
 *     items={site.stats}
 *     onChange={(stats, edit) => store.editSite((s) => ({ ...s, stats }), edit)}
 *     newItem={() => ({ value: '', label: '' })}
 *     rowLabel={(stat, i) => stat.label || `Stat ${i + 1}`}
 *     renderRow={({ item, path, update }) => (
 *       <TextField path={`${path}.label`} label="Label" value={item.label}
 *         onChange={(label, edit) => update({ ...item, label }, edit)} />
 *     )}
 *   />
 *
 * - The list gets the DOM id of `path` and each row the id of its row path ("stats[2]"), so a
 *   finding on a whole row lands on it, and the row opens when a reveal targets a field inside.
 * - Everything works from the keyboard: each row has Move up, Move down, Duplicate, and Remove
 *   buttons, and its handle also moves the row with the up and down arrow keys. Dragging the
 *   handle (mouse, pen, or touch) shows where the row will land. Focus follows the row: after a
 *   move it stays on the same control of the moved row, after Add or Duplicate it goes to the new
 *   row's first field, and after Remove to the row that took its place (or the Add button).
 * - Adding, removing, moving, and duplicating are one undo step each; `update` passes the input's
 *   edit options through, so typing in a row's field stays one step.
 * - `update` builds on the list as the store holds it now (the value at `path` in the FileScope's
 *   file), not on the list this render drew, so two updates before the next render both stay.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import { SITE_FILE } from '@/lib/admin/contract';
import { pathOfEntry, type AdminState, type EditOptions } from '../state/store';
import { useAdminStore, useFieldId, useScopeFile } from '../state/hooks';
import { useCollapsible } from '../shell/reveal';
import { Button, IconButton } from './Button';
import { useOptionalConfirm } from './Confirm';
import { useFieldFindings } from './Field';
import { childPath, getIn } from './paths';
import { deepCopy, dropIndex, duplicateItem, insertItem, moveItem, rebaseItem, removeItem, replaceItem, rowIndexNow } from './list';
import { cx } from './cx';

/** The working copy of a content file: the site, or the project saved to (or loaded from) `file`. */
function contentOfFile(state: AdminState, file: string): unknown {
  const doc = state.doc;
  if (!doc) return undefined;
  if (file === SITE_FILE) return doc.site;
  return (doc.projects.find((entry) => pathOfEntry(entry) === file) ?? doc.projects.find((entry) => entry.loadedFile === file))?.data;
}

export interface ListRowContext<T> {
  item: T;
  index: number;
  /** The row's field path, such as "stats[2]". Build child paths with `${path}.label` or childPath. */
  path: string;
  /** Replaces this row's item. Pass an input's edit options so typing stays one undo step. */
  update: (next: T, edit?: EditOptions) => void;
}

export interface ListEditorProps<T> {
  /** The list's field path in the current file ("stats", "blocks[2].rows"). */
  path: string;
  /** The rows. The row type `T` is taken from here (never from `newItem`, which may leave optional fields out). */
  items: readonly T[] | undefined;
  /** The whole new list. `edit` is set when a row's input changed (for coalescing). */
  onChange: (items: T[], edit?: EditOptions) => void;
  /** A new, empty row for Add. */
  newItem: () => NoInfer<T>;
  renderRow: (row: ListRowContext<T>) => ReactNode;
  /** The row's name in its header and in the buttons' names: "Stat 2", or the stat's label. */
  rowLabel: (item: T, index: number) => string;
  /** At most this many rows: Add and Duplicate are disabled at the limit. */
  max?: number;
  /** The list's accessible name ("Stats"). */
  label?: string;
  /** Add button words. Default "Add". */
  addLabel?: string;
  /** A stable key for rows that have one (a block's id); otherwise rows are tracked by position. */
  itemKey?: (item: T, index: number) => string;
  /** How Duplicate copies a row (a block needs a new id). `false` hides Duplicate. Default: a deep copy. */
  duplicate?: ((item: T) => NoInfer<T>) | false;
  /** Rows can collapse to their header. Default true. */
  collapsible?: boolean;
  /** Rows start open. Default true; new rows always start open. */
  defaultOpen?: boolean;
  /** Ask before removing a row: true for a plain question, or a function that words it. */
  confirmRemove?: boolean | ((item: T, index: number) => string);
  /** Shown when the list is empty. */
  emptyText?: ReactNode;
  /** More buttons in each row's header. */
  rowActions?: (row: ListRowContext<T>) => ReactNode;
  className?: string;
}

interface DragState {
  from: number;
  /** The row the dragged row would land before; the length means the end. */
  before: number;
}

/** A row control that keeps focus after a change (each carries `data-tool`). */
type RowTool = 'handle' | 'title' | 'up' | 'down' | 'field';

/** The first field inside a row's body. */
const ROW_FIELD = '.adm-list__body :is(input, select, textarea, button):not(:disabled):not([type="hidden"])';

export function ListEditor<T>({
  path,
  items,
  onChange,
  newItem,
  renderRow,
  rowLabel,
  max,
  label,
  addLabel = 'Add',
  itemKey,
  duplicate,
  collapsible = true,
  defaultOpen = true,
  confirmRemove = false,
  emptyText = 'Nothing here yet.',
  rowActions,
  className,
}: ListEditorProps<T>) {
  const list = (items ?? []) as T[];
  const listId = useFieldId(path);
  const confirm = useOptionalConfirm();
  const store = useAdminStore();
  const file = useScopeFile();

  /** The list as the store holds it now ("#rows" and other helper suffixes are not content). */
  const currentList = (): readonly T[] => {
    const value = getIn(contentOfFile(store.getState(), file), path.split('#')[0]);
    return Array.isArray(value) ? (value as T[]) : list;
  };

  // Stable keys for rows without ids, so a row keeps its open state when it moves. Our own
  // operations update the keys with the list; a change from outside (undo) that changes the
  // length starts the keys over.
  const counter = useRef(0);
  const keysRef = useRef<string[]>([]);
  const fresh = useRef(new Set<string>());
  const nextKey = () => `r${++counter.current}`;
  if (!itemKey && keysRef.current.length !== list.length) keysRef.current = list.map(() => nextKey());
  const keys = itemKey ? list.map(itemKey) : keysRef.current;

  const rowEls = useRef<(HTMLElement | null)[]>([]);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const full = max !== undefined && list.length >= max;
  const copyRow = duplicate === false ? null : (duplicate ?? deepCopy);

  const apply = (next: T[], nextKeys?: string[]) => {
    if (!itemKey && nextKeys) keysRef.current = nextKeys;
    onChange(next);
  };

  /**
   * Focuses a control of the row at `index` once the list has re-rendered: the given tool when it
   * is enabled, else the row's handle or title, else the Add button.
   */
  const focusRow = (index: number, tool: RowTool) => {
    window.requestAnimationFrame(() => {
      const row = index >= 0 ? rowEls.current[index] : null;
      const pick = (selector: string) => (row && row.isConnected ? row.querySelector<HTMLElement>(selector) : null);
      const target =
        (tool === 'field' ? pick(ROW_FIELD) : pick(`[data-tool="${tool}"]:not(:disabled)`)) ??
        pick('[data-tool="handle"]:not(:disabled)') ??
        pick('[data-tool="title"]') ??
        addButton.current;
      target?.focus();
    });
  };

  const add = () => {
    if (full) return;
    const item = newItem();
    const key = itemKey ? itemKey(item, list.length) : nextKey();
    fresh.current.add(key);
    apply(insertItem(list, item), insertItem(keys, key));
    focusRow(list.length, 'field');
  };

  const remove = async (index: number) => {
    if (confirmRemove && confirm) {
      const name = rowLabel(list[index], index);
      const message = typeof confirmRemove === 'function' ? confirmRemove(list[index], index) : `Remove "${name}"? Undo brings it back.`;
      const ok = await confirm({ title: 'Remove this row?', message, confirmLabel: 'Remove', tone: 'danger' });
      if (!ok) return;
    }
    apply(removeItem(list, index), removeItem(keys, index));
    focusRow(Math.min(index, list.length - 2), 'title');
  };

  const move = (from: number, to: number, tool?: RowTool) => {
    if (to < 0 || to >= list.length || to === from) return;
    apply(moveItem(list, from, to), moveItem(keys, from, to));
    if (tool) focusRow(to, tool);
  };

  const copy = (index: number) => {
    if (full || !copyRow) return;
    const next = duplicateItem(list, index, copyRow);
    const key = itemKey ? itemKey(next[index + 1], index + 1) : nextKey();
    fresh.current.add(key);
    apply(next, insertItem(keys, key, index + 1));
    focusRow(index + 1, 'field');
  };

  // Dragging by the handle, with pointer events so mouse, pen, and touch all work.
  const onHandleDown = (index: number, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || list.length < 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ from: index, before: index });
  };
  const onHandleMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const y = event.clientY;
    let before = list.length;
    for (let i = 0; i < list.length; i += 1) {
      const el = rowEls.current[i];
      if (!el) continue;
      const box = el.getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        before = i;
        break;
      }
    }
    // Scroll a little when the pointer nears the window's top or bottom edge.
    const edge = 56;
    if (y < edge) window.scrollBy(0, -12);
    else if (y > window.innerHeight - edge) window.scrollBy(0, 12);
    if (before !== drag.before) setDrag({ ...drag, before });
  };
  const onHandleUp = () => {
    if (!drag) return;
    const to = dropIndex(drag.from, drag.before);
    setDrag(null);
    move(drag.from, to);
  };
  const onHandleKey = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      move(index, index - 1, 'handle');
    } else if (event.key === 'ArrowDown' && index < list.length - 1) {
      event.preventDefault();
      move(index, index + 1, 'handle');
    } else if (event.key === 'Escape' && drag) {
      setDrag(null);
    }
  };

  return (
    <div className={cx('adm-list', drag && 'is-sorting', className)} id={listId} role="group" aria-label={label}>
      {list.length === 0 ? <p className="adm-list__empty">{emptyText}</p> : null}
      <ol className="adm-list__rows">
        {list.map((item, index) => {
          const key = keys[index] ?? `i${index}`;
          const rowPath = childPath(path, index);
          const ctx: ListRowContext<T> = {
            item,
            index,
            path: rowPath,
            update: (next, edit) => {
              // The row where it is now, with the changes other updates made to it since this render.
              const current = currentList();
              const at = rowIndexNow(list, index, current);
              if (at >= current.length) return;
              const nextList = replaceItem(current, at, rebaseItem(item, next, current[at]));
              if (nextList !== current) onChange(nextList, edit);
            },
          };
          return (
            <ListRow
              key={key}
              path={rowPath}
              name={rowLabel(item, index)}
              index={index}
              count={list.length}
              collapsible={collapsible}
              initialOpen={defaultOpen || fresh.current.has(key)}
              dragging={drag?.from === index}
              dropBefore={drag !== null && drag.before === index && drag.from !== index && drag.from !== index - 1}
              canCopy={copyRow !== null && !full}
              rowRef={(el) => {
                rowEls.current[index] = el;
              }}
              onMove={(to) => move(index, to, to < index ? 'up' : 'down')}
              onCopy={() => copy(index)}
              onRemove={() => void remove(index)}
              onHandleDown={(e) => onHandleDown(index, e)}
              onHandleMove={onHandleMove}
              onHandleUp={onHandleUp}
              onHandleCancel={() => setDrag(null)}
              onHandleKey={(e) => onHandleKey(index, e)}
              actions={rowActions ? rowActions(ctx) : null}
            >
              {renderRow(ctx)}
            </ListRow>
          );
        })}
      </ol>
      {drag !== null && drag.before === list.length && drag.from !== list.length - 1 ? <div className="adm-list__drop-end" aria-hidden="true" /> : null}
      <div className="adm-list__foot">
        <Button ref={addButton} size="sm" icon={<Plus size={16} />} onClick={add} disabled={full}>
          {addLabel}
        </Button>
        {max !== undefined ? (
          <span className="adm-list__count">
            {list.length} of at most {max}
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface ListRowProps {
  path: string;
  name: string;
  index: number;
  count: number;
  collapsible: boolean;
  initialOpen: boolean;
  dragging: boolean;
  dropBefore: boolean;
  canCopy: boolean;
  rowRef: (el: HTMLLIElement | null) => void;
  onMove: (to: number) => void;
  onCopy: () => void;
  onRemove: () => void;
  onHandleDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onHandleMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onHandleUp: () => void;
  onHandleCancel: () => void;
  onHandleKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  actions: ReactNode;
  children: ReactNode;
}

function ListRow({
  path,
  name,
  index,
  count,
  collapsible,
  initialOpen,
  dragging,
  dropBefore,
  canCopy,
  rowRef,
  onMove,
  onCopy,
  onRemove,
  onHandleDown,
  onHandleMove,
  onHandleUp,
  onHandleCancel,
  onHandleKey,
  actions,
  children,
}: ListRowProps) {
  const id = useFieldId(path);
  const bodyId = `${id}-body`;
  const [open, setOpen] = useCollapsible(path, !collapsible || initialOpen);
  const shown = !collapsible || open;
  const { errors, warnings } = useFieldFindings(path);
  const title = name.trim() === '' ? `Row ${index + 1}` : name;

  return (
    <li
      ref={rowRef}
      id={id}
      className={cx('adm-list__row', dragging && 'is-dragging', dropBefore && 'is-drop-before', errors.length > 0 && 'is-invalid')}
    >
      <div className="adm-list__head">
        <IconButton
          className="adm-list__handle"
          data-tool="handle"
          label={`Reorder ${title}: drag, or use the up and down arrow keys`}
          icon={<GripVertical size={18} />}
          size="sm"
          disabled={count < 2}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleCancel}
          onKeyDown={onHandleKey}
        />
        {collapsible ? (
          <button
            type="button"
            className="adm-list__title"
            data-tool="title"
            aria-expanded={shown}
            aria-controls={bodyId}
            onClick={() => setOpen(!shown)}
          >
            {shown ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            <span className="adm-list__name">{title}</span>
          </button>
        ) : (
          <span className="adm-list__title adm-list__title--static" data-tool="title" tabIndex={-1}>
            <span className="adm-list__name">{title}</span>
          </span>
        )}
        <div className="adm-list__tools">
          {actions}
          <IconButton data-tool="up" label={`Move ${title} up`} icon={<ChevronUp size={18} />} size="sm" disabled={index === 0} onClick={() => onMove(index - 1)} />
          <IconButton data-tool="down" label={`Move ${title} down`} icon={<ChevronDown size={18} />} size="sm" disabled={index === count - 1} onClick={() => onMove(index + 1)} />
          {canCopy ? <IconButton label={`Duplicate ${title}`} icon={<Copy size={16} />} size="sm" onClick={onCopy} /> : null}
          <IconButton label={`Remove ${title}`} icon={<Trash2 size={16} />} size="sm" onClick={onRemove} />
        </div>
      </div>
      {errors.length > 0 || warnings.length > 0 ? (
        <div className="adm-list__msgs">
          {errors.map((f, i) => (
            <p key={`e${i}`} className="adm-field__msg adm-field__msg--error">
              <span className="adm-field__rule">{f.rule}</span> {f.message}
            </p>
          ))}
          {warnings.map((f, i) => (
            <p key={`w${i}`} className="adm-field__msg adm-field__msg--warning">
              <span className="adm-field__rule">{f.rule}</span> {f.message}
            </p>
          ))}
        </div>
      ) : null}
      <div id={bodyId} className="adm-list__body" hidden={!shown}>
        {shown ? children : null}
      </div>
    </li>
  );
}
