'use client';

/**
 * The block editor (ARCHITECTURE.md 7: add, reorder, collapse, duplicate, and delete for every
 * block type). Each block is a row like the admin's other lists: a drag handle (the up and down
 * arrow keys move it too), a title that opens and closes it, and tools to add a block after it,
 * move it, duplicate it, and delete it. Two-column blocks hold a block editor per column.
 *
 * - New blocks get an id in the project's pattern that no block has ("rv-k"); a duplicate is a
 *   deep copy with new ids for it and every block inside it (./logic.ts).
 * - Blocks start closed; new and duplicated ones open, and so does a block a reveal targets
 *   (a warning or a refused save that names a field inside it).
 * - Rows are memoized and every edit keeps untouched blocks as they are, so typing in one block
 *   re-renders that block only.
 * - A block's change builds on the project as the store holds it now, not on the list a render
 *   drew: the block is found where it is (by its id), and the keys the change touched are carried
 *   onto it, so two changes before the next render both stay. A two-column block's column builds
 *   on the block as it is now too.
 */
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ChevronUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { Finding } from '@/lib/admin/contract';
import type { Block, TwoColBlock } from '@/lib/schema';
import { plural } from '../shell/format';
import { revealFieldPath, useRevealOpen } from '../shell/reveal';
import { useWarnings } from '../shell/WarningsPanel';
import { useAdmin, useAdminStore, useFieldId, useScopeFile } from '../state/hooks';
import type { EditOptions } from '../state/store';
import { Badge } from '../ui/bits';
import { Button, IconButton } from '../ui/Button';
import { useConfirm } from '../ui/Confirm';
import { useFieldFindings } from '../ui/Field';
import { cx } from '../ui/cx';
import { childPath, getIn, pathWithin, setIn } from '../ui/paths';
import { moveItem, rebaseItem, removeItem, rowIndexNow } from '../ui/list';
import { BlockBody } from './BlockBodies';
import { dropsAtEnd, dropsBefore, focusInRow, useDragSort } from './edit';
import {
  BLOCK_GROUPS,
  BLOCK_INFO,
  BLOCK_TYPES,
  blockIdSource,
  blockKeys,
  blockSummary,
  blockTypeLabel,
  copyBlock,
  insertBlock,
  newBlock,
  setBlockAt,
  withFields,
  type BlockType,
} from './logic';
import styles from './projects.module.css';

const NO_BLOCKS: Block[] = [];

/** The first field inside a row's body, for focus after Add. */
const ROW_FIELD = '.adm-list__body :is(input, select, textarea, button):not(:disabled):not([type="hidden"])';

interface BlockContextValue {
  /** A source of new ids over the whole project as it is now. */
  ids: () => () => string;
  /** The value at a path of the project as the store holds it now. */
  read: (path: string) => unknown;
  isOpen: (key: string) => boolean;
  setOpen: (key: string, open: boolean) => void;
  /** The guard rails and early errors for this project's file. */
  findings: readonly Finding[];
}

/** Where the block a render showed at `index` is in `current`: by its id when it is unique there, else as a row. */
function blockIndexNow(shown: readonly Block[], index: number, current: readonly Block[]): number {
  const id = shown[index]?.id;
  if (typeof id === 'string' && id !== '' && current !== shown) {
    const matches = current.reduce<number[]>((found, block, i) => (block.id === id ? [...found, i] : found), []);
    if (matches.length === 1) return matches[0];
  }
  return rowIndexNow(shown, index, current);
}

const BlockContext = createContext<BlockContextValue | null>(null);

function useBlocks(): BlockContextValue {
  const ctx = useContext(BlockContext);
  if (!ctx) throw new Error('Block lists sit inside <BlockEditor>.');
  return ctx;
}

/** How many findings of a severity fall at or inside a block. */
function countWithin(findings: readonly Finding[], path: string, severity: Finding['severity']): number {
  let n = 0;
  for (const f of findings) if (f.severity === severity && pathWithin(revealFieldPath(f.path), path)) n += 1;
  return n;
}

export interface BlockEditorProps {
  /** The project's entry key (ProjectEntry.key). */
  entryKey: string;
  /** The media folder: the project's slug as saved. */
  folder: string;
}

export function BlockEditor({ entryKey, folder }: BlockEditorProps) {
  const store = useAdminStore();
  const file = useScopeFile();
  const blocks = useAdmin((s) => s.doc?.projects.find((e) => e.key === entryKey)?.data.blocks ?? NO_BLOCKS);
  const warnings = useWarnings();
  const findings = useMemo(() => warnings.filter((f) => f.file === file), [warnings, file]);
  const [open, setOpenState] = useState<{ all: boolean | null; map: Record<string, boolean> }>({ all: null, map: {} });

  const ids = useCallback(() => {
    const project = store.getState().doc?.projects.find((e) => e.key === entryKey)?.data;
    return blockIdSource(project ?? { slug: '', blocks: [] });
  }, [store, entryKey]);
  const read = useCallback((path: string) => getIn(store.getState().doc?.projects.find((e) => e.key === entryKey)?.data, path), [store, entryKey]);
  const isOpen = useCallback((key: string) => open.map[key] ?? open.all ?? false, [open]);
  const setOpen = useCallback(
    (key: string, value: boolean) => setOpenState((s) => ((s.map[key] ?? s.all ?? false) === value ? s : { ...s, map: { ...s.map, [key]: value } })),
    [],
  );
  const ctx = useMemo<BlockContextValue>(() => ({ ids, read, isOpen, setOpen, findings }), [ids, read, isOpen, setOpen, findings]);
  const onChange = useCallback(
    (next: Block[], edit?: EditOptions) => store.editProject(entryKey, (project) => setIn(project, 'blocks', next), edit),
    [store, entryKey],
  );

  return (
    <BlockContext.Provider value={ctx}>
      <div className={styles.blockBar}>
        {blocks.length > 0 ? <p className="adm-muted">{plural(blocks.length, 'block')}, in page order. Blocks start closed; open one to edit it.</p> : null}
        {blocks.length > 0 ? (
          <div className={styles.inlineActions}>
            <Button size="sm" icon={<ChevronsUpDown size={16} />} onClick={() => setOpenState({ all: true, map: {} })}>
              Expand all
            </Button>
            <Button size="sm" icon={<ChevronsDownUp size={16} />} onClick={() => setOpenState({ all: false, map: {} })}>
              Collapse all
            </Button>
          </div>
        ) : null}
      </div>
      <BlockList path="blocks" blocks={blocks} folder={folder} onChange={onChange} label="Blocks" addLabel="Add block" />
    </BlockContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// The Add menu
// ---------------------------------------------------------------------------------------------

function BlockTypeMenu({ title, onPick, onClose }: { title: string; onPick: (type: BlockType) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[data-type]')?.focus();
  }, []);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };
  return (
    <div ref={ref} className={styles.typeMenu} role="group" aria-label={title} onKeyDown={onKey}>
      <div className={styles.typeMenuHead}>
        <p className={styles.typeMenuTitle}>{title}</p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {BLOCK_GROUPS.map((group) => (
        <fieldset key={group} className={styles.typeGroup}>
          <legend className={styles.typeGroupTitle}>{group}</legend>
          <div className={styles.typeGrid}>
            {BLOCK_TYPES.filter((type) => BLOCK_INFO[type].group === group).map((type) => (
              <button key={type} type="button" data-type={type} className={styles.typeButton} onClick={() => onPick(type)}>
                {BLOCK_INFO[type].label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One list of blocks
// ---------------------------------------------------------------------------------------------

interface BlockListProps {
  /** The list's field path: "blocks", "blocks[2].left". */
  path: string;
  blocks: readonly Block[];
  folder: string;
  onChange: (next: Block[], edit?: EditOptions) => void;
  label: string;
  addLabel: string;
}

type Tool = 'handle' | 'title' | 'up' | 'down' | 'add';

function BlockList({ path, blocks, folder, onChange, label, addLabel }: BlockListProps) {
  const ctx = useBlocks();
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const confirm = useConfirm();
  const listId = useFieldId(path);
  const keys = blockKeys(blocks);
  // Ids are unique in the project, so an id names its open state anywhere; a position needs its list.
  const openKeys = keys.map((key) => (key.startsWith('id:') ? key : `${path}|${key}`));
  const latest = useRef(blocks);
  latest.current = blocks;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const addButton = useRef<HTMLButtonElement | null>(null);
  /** Where the Add menu is open: after a row (its index), or at the end (null). */
  const [menu, setMenu] = useState<{ row: number | null } | null>(null);

  const apply = useCallback((next: Block[]) => {
    if (next !== latest.current) changeRef.current(next);
  }, []);

  const sort = useDragSort(blocks.length, (from, to) => apply(moveItem(latest.current, from, to)));
  const { rows, onCancel: cancelDrag } = sort;

  const focusRow = useCallback(
    (index: number, selectors: readonly string[]) => focusInRow(() => rows.current[index], selectors, () => addButton.current),
    [rows],
  );

  /** The open-state key of the row at `index` in `list`: its id, or its position in this list. */
  const keyOf = useCallback(
    (index: number, list: readonly Block[]) => {
      const key = blockKeys(list)[index] ?? `at:${index}`;
      return key.startsWith('id:') ? key : `${path}|${key}`;
    },
    [path],
  );

  /** The list as the store holds it now, else as this render drew it. */
  const currentBlocks = useCallback((): readonly Block[] => {
    const value = ctxRef.current.read(path);
    return Array.isArray(value) ? (value as Block[]) : latest.current;
  }, [path]);

  const updateAt = useCallback(
    (index: number, block: Block, edit?: EditOptions) => {
      // The block where it is now, with what other changes did to it since this render.
      const current = currentBlocks();
      const at = blockIndexNow(latest.current, index, current);
      if (at >= current.length) return;
      const next = setBlockAt(current, at, rebaseItem(latest.current[index], block, current[at]));
      if (next !== current) changeRef.current(next, edit);
    },
    [currentBlocks],
  );

  const move = useCallback(
    (from: number, to: number, tool?: Tool) => {
      const next = moveItem(latest.current, from, to);
      if (next === latest.current) return;
      apply(next);
      if (tool) focusRow(to, [`[data-tool="${tool}"]:not(:disabled)`, '[data-tool="handle"]:not(:disabled)', '[data-tool="title"]']);
    },
    [apply, focusRow],
  );

  const duplicate = useCallback(
    (index: number) => {
      const source = latest.current[index];
      if (!source) return;
      const copy = copyBlock(source, ctxRef.current.ids());
      const next = insertBlock(latest.current, copy, index + 1);
      apply(next);
      ctxRef.current.setOpen(keyOf(index + 1, next), true);
      focusRow(index + 1, ['[data-tool="title"]']);
    },
    [apply, focusRow, keyOf],
  );

  const remove = useCallback(
    async (index: number) => {
      const block = latest.current[index];
      if (!block) return;
      const name = blockTypeLabel(block.type).toLowerCase();
      const children = block.type === 'twoCol' ? ((block as TwoColBlock).left?.length ?? 0) + ((block as TwoColBlock).right?.length ?? 0) : 0;
      const ok = await confirm({
        title: `Delete this ${name} block?`,
        message: children > 0 ? `The ${plural(children, 'block')} in its columns go with it. Undo brings them back.` : 'Undo brings it back.',
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      if (!ok) return;
      const at = latest.current.indexOf(block);
      if (at === -1) return;
      const next = removeItem(latest.current, at);
      apply(next);
      focusRow(Math.min(at, next.length - 1), ['[data-tool="title"]']);
    },
    [apply, confirm, focusRow],
  );

  const insert = useCallback(
    (type: BlockType, at: number) => {
      const id = ctxRef.current.ids()();
      const next = insertBlock(latest.current, newBlock(type, id), at);
      apply(next);
      ctxRef.current.setOpen(`id:${id}`, true);
      setMenu(null);
      focusRow(Math.min(at, next.length - 1), [ROW_FIELD, '[data-tool="title"]']);
    },
    [apply, focusRow],
  );

  const toggleMenu = useCallback((row: number | null) => {
    setMenu((current) => (current !== null && current.row === row ? null : { row }));
  }, []);

  const onHandleKey = useCallback(
    (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowUp' && index > 0) {
        event.preventDefault();
        move(index, index - 1, 'handle');
      } else if (event.key === 'ArrowDown' && index < latest.current.length - 1) {
        event.preventDefault();
        move(index, index + 1, 'handle');
      } else if (event.key === 'Escape') {
        cancelDrag();
      }
    },
    [move, cancelDrag],
  );

  return (
    <div className={cx('adm-list', sort.drag && 'is-sorting')} id={listId} role="group" aria-label={label}>
      {blocks.length === 0 ? <p className="adm-list__empty">No blocks here yet.</p> : null}
      <ol className="adm-list__rows">
        {blocks.map((block, index) => {
          const rowPath = childPath(path, index);
          return (
            <BlockRow
              key={keys[index]}
              block={block}
              index={index}
              count={blocks.length}
              path={rowPath}
              folder={folder}
              openKey={openKeys[index]}
              open={ctx.isOpen(openKeys[index])}
              menuOpen={menu !== null && menu.row === index}
              dragging={sort.drag?.from === index}
              dropBefore={dropsBefore(sort.drag, index)}
              errors={countWithin(ctx.findings, rowPath, 'error')}
              warnings={countWithin(ctx.findings, rowPath, 'warning')}
              onToggle={ctx.setOpen}
              onUpdate={updateAt}
              onMove={move}
              onDuplicate={duplicate}
              onRemove={remove}
              onMenu={toggleMenu}
              onInsert={insert}
              onHandleDown={sort.onDown}
              onHandleMove={sort.onMove}
              onHandleUp={sort.onUp}
              onHandleCancel={sort.onCancel}
              onHandleKey={onHandleKey}
              setRow={sort.setRow}
            />
          );
        })}
      </ol>
      {dropsAtEnd(sort.drag, blocks.length) ? <div className="adm-list__drop-end" aria-hidden="true" /> : null}
      {menu !== null && menu.row === null ? (
        <BlockTypeMenu
          title={blocks.length === 0 ? 'Add the first block' : 'Add a block at the end'}
          onPick={(type) => insert(type, latest.current.length)}
          onClose={() => {
            setMenu(null);
            addButton.current?.focus();
          }}
        />
      ) : null}
      <div className="adm-list__foot">
        <Button ref={addButton} size="sm" icon={<Plus size={16} />} aria-expanded={menu !== null && menu.row === null} onClick={() => toggleMenu(null)}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One block
// ---------------------------------------------------------------------------------------------

interface BlockRowProps {
  block: Block;
  index: number;
  count: number;
  path: string;
  folder: string;
  openKey: string;
  open: boolean;
  menuOpen: boolean;
  dragging: boolean;
  dropBefore: boolean;
  errors: number;
  warnings: number;
  onToggle: (key: string, open: boolean) => void;
  onUpdate: (index: number, block: Block, edit?: EditOptions) => void;
  onMove: (from: number, to: number, tool?: Tool) => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  onMenu: (row: number | null) => void;
  onInsert: (type: BlockType, at: number) => void;
  onHandleDown: (index: number, event: PointerEvent<HTMLElement>) => void;
  onHandleMove: (event: PointerEvent<HTMLElement>) => void;
  onHandleUp: () => void;
  onHandleCancel: () => void;
  onHandleKey: (index: number, event: KeyboardEvent<HTMLButtonElement>) => void;
  setRow: (index: number, el: HTMLElement | null) => void;
}

const BlockRow = memo(function BlockRow({
  block,
  index,
  count,
  path,
  folder,
  openKey,
  open,
  menuOpen,
  dragging,
  dropBefore,
  errors,
  warnings,
  onToggle,
  onUpdate,
  onMove,
  onDuplicate,
  onRemove,
  onMenu,
  onInsert,
  onHandleDown,
  onHandleMove,
  onHandleUp,
  onHandleCancel,
  onHandleKey,
  setRow,
}: BlockRowProps) {
  const id = useFieldId(path);
  const bodyId = `${id}-body`;
  const addRef = useRef<HTMLButtonElement | null>(null);
  const revealed = useRevealOpen(path);
  useEffect(() => {
    if (revealed) onToggle(openKey, true);
  }, [revealed, onToggle, openKey]);
  const shown = open || revealed;
  const own = useFieldFindings(path);
  const typeLabel = blockTypeLabel(block.type);
  const name = `${typeLabel} block ${index + 1}`;

  const update = useCallback((next: Block, edit?: EditOptions) => onUpdate(index, next, edit), [onUpdate, index]);
  const rowRef = useCallback((el: HTMLLIElement | null) => setRow(index, el), [setRow, index]);
  const columns = useCallback(
    (two: TwoColBlock): ReactNode => (
      <div className={styles.columns}>
        <div className={styles.column}>
          <p className={styles.columnTitle}>Left column</p>
          <BlockList
            path={`${path}.left`}
            blocks={Array.isArray(two.left) ? two.left : NO_BLOCKS}
            folder={folder}
            label="Left column"
            addLabel="Add block to the left column"
            onChange={(left, edit) => update(withFields(two, { left }), edit)}
          />
        </div>
        <div className={styles.column}>
          <p className={styles.columnTitle}>Right column</p>
          <BlockList
            path={`${path}.right`}
            blocks={Array.isArray(two.right) ? two.right : NO_BLOCKS}
            folder={folder}
            label="Right column"
            addLabel="Add block to the right column"
            onChange={(right, edit) => update(withFields(two, { right }), edit)}
          />
        </div>
      </div>
    ),
    [path, folder, update],
  );

  return (
    <li
      ref={rowRef}
      id={id}
      className={cx('adm-list__row', dragging && 'is-dragging', dropBefore && 'is-drop-before', own.errors.length > 0 && 'is-invalid')}
    >
      <div className={cx('adm-list__head', styles.head)}>
        <IconButton
          className="adm-list__handle"
          data-tool="handle"
          label={`Reorder ${name}: drag, or use the up and down arrow keys`}
          icon={<GripVertical size={18} />}
          size="sm"
          disabled={count < 2}
          onPointerDown={(e) => onHandleDown(index, e)}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleCancel}
          onKeyDown={(e) => onHandleKey(index, e)}
        />
        <button type="button" className="adm-list__title" data-tool="title" aria-expanded={shown} aria-controls={bodyId} onClick={() => onToggle(openKey, !shown)}>
          {shown ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          <span className={styles.typeBadge}>{typeLabel}</span>
          <span className={styles.summary}>{blockSummary(block)}</span>
          <span className="adm-sr">
            , block {index + 1} of {count}
          </span>
        </button>
        {errors > 0 || warnings > 0 ? (
          <span className={styles.counts}>
            {errors > 0 ? <Badge tone="error">{plural(errors, 'error')}</Badge> : null}
            {warnings > 0 ? <Badge>{plural(warnings, 'warning')}</Badge> : null}
          </span>
        ) : null}
        <div className="adm-list__tools">
          <IconButton ref={addRef} data-tool="add" label={`Add a block after ${name}`} icon={<Plus size={16} />} size="sm" aria-expanded={menuOpen} onClick={() => onMenu(index)} />
          <IconButton data-tool="up" label={`Move ${name} up`} icon={<ChevronUp size={18} />} size="sm" disabled={index === 0} onClick={() => onMove(index, index - 1, 'up')} />
          <IconButton
            data-tool="down"
            label={`Move ${name} down`}
            icon={<ChevronDown size={18} />}
            size="sm"
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1, 'down')}
          />
          <IconButton label={`Duplicate ${name}`} icon={<Copy size={16} />} size="sm" onClick={() => onDuplicate(index)} />
          <IconButton label={`Delete ${name}`} icon={<Trash2 size={16} />} size="sm" onClick={() => void onRemove(index)} />
        </div>
      </div>
      {own.errors.length > 0 || own.warnings.length > 0 ? (
        <div className="adm-list__msgs">
          {own.errors.map((f, i) => (
            <p key={`e${i}`} className="adm-field__msg adm-field__msg--error">
              <span className="adm-field__rule">{f.rule}</span> {f.message}
            </p>
          ))}
          {own.warnings.map((f, i) => (
            <p key={`w${i}`} className="adm-field__msg adm-field__msg--warning">
              <span className="adm-field__rule">{f.rule}</span> {f.message}
            </p>
          ))}
        </div>
      ) : null}
      {menuOpen ? (
        <div className={styles.rowMenu}>
          <BlockTypeMenu
            title={`Add a block after ${name}`}
            onPick={(type) => onInsert(type, index + 1)}
            onClose={() => {
              onMenu(index);
              addRef.current?.focus();
            }}
          />
        </div>
      ) : null}
      <div id={bodyId} className="adm-list__body" hidden={!shown}>
        {shown ? <BlockBody block={block} path={path} folder={folder} onChange={update} columns={columns} /> : null}
      </div>
    </li>
  );
});
