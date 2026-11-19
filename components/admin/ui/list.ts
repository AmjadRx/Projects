/**
 * Immutable list operations for the editors (ListEditor, the project list, block lists). Each
 * returns a new array, or the same array when nothing changes, so a no-op makes no undo step.
 * Pure functions, safe in tests.
 */

/** Moves the item at `from` to `to` (both clamped to the list); the same array when it does not move. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list as T[];
  const target = Math.max(0, Math.min(to, list.length - 1));
  if (target === from) return list as T[];
  const copy = list.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(target, 0, item);
  return copy;
}

/** Inserts `item` at `index` (clamped; the end by default). */
export function insertItem<T>(list: readonly T[], item: T, index: number = list.length): T[] {
  const at = Math.max(0, Math.min(index, list.length));
  const copy = list.slice();
  copy.splice(at, 0, item);
  return copy;
}

/** Removes the item at `index`; the same array when the index is outside the list. */
export function removeItem<T>(list: readonly T[], index: number): T[] {
  if (index < 0 || index >= list.length) return list as T[];
  const copy = list.slice();
  copy.splice(index, 1);
  return copy;
}

/** Replaces the item at `index`; the same array when it is the same item. */
export function replaceItem<T>(list: readonly T[], index: number, item: T): T[] {
  if (index < 0 || index >= list.length || Object.is(list[index], item)) return list as T[];
  const copy = list.slice();
  copy[index] = item;
  return copy;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * An edit of a row made from an older copy of it (`shown`, the row a render drew), carried onto the
 * row as it is now (`current`): the keys `next` changed, added, or removed are applied to `current`,
 * and its other keys are kept, so two changes to one row in one burst both stay. `next` itself when
 * the row did not change meanwhile, or when either is not a plain object.
 */
export function rebaseItem<T>(shown: T, next: T, current: T): T {
  if (Object.is(current, shown) || !isPlainObject(shown) || !isPlainObject(next) || !isPlainObject(current)) return next;
  const out: Record<string, unknown> = { ...current };
  let changed = false;
  for (const key of new Set([...Object.keys(shown), ...Object.keys(next)])) {
    const had = Object.prototype.hasOwnProperty.call(shown, key);
    const has = Object.prototype.hasOwnProperty.call(next, key);
    if (had && !has) {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        delete out[key];
        changed = true;
      }
    } else if (!Object.is(shown[key], next[key]) || (!had && has)) {
      if (!Object.is(out[key], next[key]) || !Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = next[key];
        changed = true;
      }
    }
  }
  return (changed ? out : current) as T;
}

/**
 * Where the row a render showed at `index` is in `current`, the list as it is now: the same index
 * while it holds the same row; else, for a row object, wherever that object went; else the same
 * index. A text row is found by its position only, since two rows may hold the same words.
 */
export function rowIndexNow<T>(shownList: readonly T[], index: number, current: readonly T[]): number {
  const shown = shownList[index];
  if (current === shownList || Object.is(current[index], shown)) return index;
  if (shown !== null && typeof shown === 'object') {
    const at = current.indexOf(shown);
    if (at !== -1) return at;
  }
  return index;
}

/**
 * Inserts a copy of the item at `index` right after it. `clone` makes the copy (a deep copy by
 * default); a block list passes one that also gives the copy a new id.
 */
export function duplicateItem<T>(list: readonly T[], index: number, clone: (item: T) => T = deepCopy): T[] {
  if (index < 0 || index >= list.length) return list as T[];
  return insertItem(list, clone(list[index]), index + 1);
}

/** A deep copy of plain JSON data. */
export function deepCopy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Where a dragged row lands: the index the row at `from` takes when it is dropped before the row
 * at `before` (or at the end when `before` equals the length).
 */
export function dropIndex(from: number, before: number): number {
  return before > from ? before - 1 : before;
}
