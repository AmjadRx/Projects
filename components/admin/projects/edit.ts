'use client';

/**
 * Small client helpers shared by the project list, the project editor, and the block editor:
 * reading one entry from the store, writing a field of it, whether its file has unsaved changes,
 * dragging rows, moving focus after a change, edit options for media fields, and keeping the URL
 * hash on the open project when its slug changes.
 */
import { useCallback, useRef, useState, type PointerEvent } from 'react';
import { formatRoute } from '../shell/route';
import type { LoadInfo, ProjectEntry, EditOptions } from '../state/store';
import { pathOfEntry, textOf } from '../state/store';
import { useAdmin, useAdminStore } from '../state/hooks';
import { dropIndex } from '../ui/list';
import type { MediaRef } from '@/lib/types';
import { setProjectIn } from './logic';

/** The entry with this key, or undefined (removed, or undone). */
export function useEntry(key: string): ProjectEntry | undefined {
  return useAdmin((s) => s.doc?.projects.find((entry) => entry.key === key));
}

/** True when the entry's file differs from its stored text, or the entry is new or renamed. */
export function entryDirty(info: LoadInfo | null, entry: ProjectEntry): boolean {
  if (!info) return false;
  const path = pathOfEntry(entry);
  return info.stored[path] !== textOf(entry.data) || (entry.loadedFile !== null && entry.loadedFile !== path);
}

export function useEntryDirty(key: string): boolean {
  return useAdmin((s) => {
    const entry = s.doc?.projects.find((e) => e.key === key);
    return entry ? entryDirty(s.info, entry) : false;
  });
}

/**
 * A setter for one field path of one project: `set('maturity.label', 'Built', edit)`. A key the
 * project lacks goes in at its place in the schema's order (`setProjectIn`).
 */
export function useProjectSet(key: string): (path: string, value: unknown, edit?: EditOptions) => void {
  const store = useAdminStore();
  return useCallback(
    (path: string, value: unknown, edit?: EditOptions) => store.editProject(key, (p) => setProjectIn(p, path, value), edit),
    [store, key],
  );
}

// ---------------------------------------------------------------------------------------------
// The URL hash
// ---------------------------------------------------------------------------------------------

/**
 * Points the hash at the open project's current slug without a new history entry, so a rename
 * (or undoing one) keeps Reload and Back on the same project. The route hook listens for
 * hashchange, so one is sent.
 */
export function replaceProjectRoute(slug: string): void {
  const next = formatRoute('projects', slug);
  if (window.location.hash === next) return;
  window.history.replaceState(window.history.state, '', next);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// ---------------------------------------------------------------------------------------------
// Dragging rows
// ---------------------------------------------------------------------------------------------

export interface DragState {
  from: number;
  /** The row the dragged row would land before; the count means the end. */
  before: number;
}

/**
 * Dragging rows by a handle, with pointer events (mouse, pen, touch), as ListEditor does: the
 * handle captures the pointer, the row under it decides where the dragged row lands, and the
 * window scrolls a little near its top and bottom edges. `onDrop(from, to)` runs once, on release.
 */
export function useDragSort(count: number, onDrop: (from: number, to: number) => void) {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const countRef = useRef(count);
  countRef.current = count;
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const update = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const onDown = useCallback(
    (index: number, event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || countRef.current < 2) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      update({ from: index, before: index });
    },
    [update],
  );

  const onMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const current = dragRef.current;
      if (!current) return;
      const y = event.clientY;
      let before = countRef.current;
      for (let i = 0; i < countRef.current; i += 1) {
        const el = rows.current[i];
        if (!el) continue;
        const box = el.getBoundingClientRect();
        if (y < box.top + box.height / 2) {
          before = i;
          break;
        }
      }
      const edge = 56;
      if (y < edge) window.scrollBy(0, -12);
      else if (y > window.innerHeight - edge) window.scrollBy(0, 12);
      if (before !== current.before) update({ ...current, before });
    },
    [update],
  );

  const onUp = useCallback(() => {
    const current = dragRef.current;
    if (!current) return;
    update(null);
    const to = dropIndex(current.from, current.before);
    if (to !== current.from) dropRef.current(current.from, to);
  }, [update]);

  const onCancel = useCallback(() => update(null), [update]);

  const setRow = useCallback((index: number, el: HTMLElement | null) => {
    rows.current[index] = el;
  }, []);

  return { drag, onDown, onMove, onUp, onCancel, setRow, rows };
}

/** True when the drop line shows above the row at `index`. */
export function dropsBefore(drag: DragState | null, index: number): boolean {
  return drag !== null && drag.before === index && drag.from !== index && drag.from !== index - 1;
}

/** True when the drop line shows after the last row. */
export function dropsAtEnd(drag: DragState | null, count: number): boolean {
  return drag !== null && drag.before === count && drag.from !== count - 1;
}

/**
 * Focuses a control inside a row once the list has re-rendered: the first selector that matches,
 * else `fallback`.
 */
export function focusInRow(row: () => HTMLElement | null | undefined, selectors: readonly string[], fallback?: () => HTMLElement | null): void {
  window.requestAnimationFrame(() => {
    const el = row();
    if (el && el.isConnected) {
      for (const selector of selectors) {
        const target = el.querySelector<HTMLElement>(selector);
        if (target) {
          target.focus();
          return;
        }
      }
    }
    fallback?.()?.focus();
  });
}

// ---------------------------------------------------------------------------------------------
// Media fields
// ---------------------------------------------------------------------------------------------

/** Keys of a MediaRef the owner types or drags in many small steps. */
const STEPPED_KEYS = new Set(['alt', 'caption', 'focal', 'captions', 'poster']);

function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => !Object.is(a[key], b[key]) && JSON.stringify(a[key]) !== JSON.stringify(b[key]));
}

/**
 * Edit options for a media field's change. Typing alt text or a caption, or dragging the focal
 * point, arrives as many changes; those to one key of one file make one undo step. Choosing or
 * clearing a file is always a step of its own.
 */
export function mediaEdit(id: string, prev: MediaRef | undefined, next: MediaRef | undefined): EditOptions | undefined {
  if (!prev || !next || prev.src !== next.src || prev.kind !== next.kind) return undefined;
  const keys = changedKeys(prev as Record<string, unknown>, next as Record<string, unknown>);
  return keys.length === 1 && STEPPED_KEYS.has(keys[0]) ? { coalesce: `${id}.${keys[0]}` } : undefined;
}

/** The same for a list of media: one key of one item, in a list of the same files. */
export function mediaListEdit(id: string, prev: readonly MediaRef[] | undefined, next: readonly MediaRef[]): EditOptions | undefined {
  if (!prev || prev.length !== next.length) return undefined;
  const changed = next.map((item, i) => (item === prev[i] ? -1 : i)).filter((i) => i !== -1);
  if (changed.length !== 1) return undefined;
  const i = changed[0];
  const step = mediaEdit(`${id}[${i}]`, prev[i], next[i]);
  return step;
}
