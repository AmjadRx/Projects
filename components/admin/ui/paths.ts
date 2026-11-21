/**
 * Field paths, the way the content check writes them ("stats[2].proof",
 * "blocks[3].items[1].alt"), and immutable reads and writes along them. Pure functions with no
 * imports, safe in the browser and in tests.
 *
 * `setIn` returns new objects only along the path and keeps every other object as it is, so an
 * edit never touches a file it does not change (docs/V3_PLAN.md D-18), and it returns the very
 * same root when the value is already equal, so a no-op edit makes no undo step.
 */

export type PathSegment = string | number;

/** "stats[2].proof" becomes ["stats", 2, "proof"]. An empty path is the root. */
export function parsePath(path: string): PathSegment[] {
  const out: PathSegment[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    if (match[2] !== undefined) out.push(Number(match[2]));
    else out.push(match[1]);
  }
  return out;
}

/** ["stats", 2, "proof"] becomes "stats[2].proof"; the same notation as `formatPath` in lib/lint.ts. */
export function joinPath(segments: readonly PathSegment[]): string {
  let out = '';
  for (const segment of segments) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out === '' ? segment : `.${segment}`;
  }
  return out;
}

/** The path of a child: ("stats", 2) gives "stats[2]"; ("personal", "name") gives "personal.name". */
export function childPath(parent: string, key: PathSegment): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  return parent === '' ? key : `${parent}.${key}`;
}

/**
 * True when `path` is `ancestor` or lies inside it, on segment boundaries: "blocks[3].md" is
 * within "blocks[3]", and "blocks[30]" is not.
 */
export function pathWithin(path: string, ancestor: string): boolean {
  if (ancestor === '') return true;
  return path === ancestor || path.startsWith(`${ancestor}.`) || path.startsWith(`${ancestor}[`);
}

/** The value at `path`, or undefined when any step is missing. */
export function getIn(root: unknown, path: string | readonly PathSegment[]): unknown {
  const segments = typeof path === 'string' ? parsePath(path) : path;
  let node: unknown = root;
  for (const segment of segments) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<PathSegment, unknown>)[segment];
  }
  return node;
}

/**
 * A copy of `root` with `value` at `path`. Missing objects on the way are created (arrays for
 * numeric segments). Setting `undefined` keeps the key in place with no value, so the key keeps
 * its position if it is set again, and JSON leaves it out. An array index may be at most the
 * array's length (append); anything further is refused, because JSON has no holes.
 */
export function setIn<T>(root: T, path: string | readonly PathSegment[], value: unknown): T {
  const segments = typeof path === 'string' ? parsePath(path) : path;
  return setAt(root, segments, 0, value) as T;
}

function setAt(node: unknown, segments: readonly PathSegment[], i: number, value: unknown): unknown {
  if (i === segments.length) return value;
  const key = segments[i];
  if (typeof key === 'number') {
    const list = Array.isArray(node) ? (node as unknown[]) : [];
    if (key > list.length) throw new RangeError(`Index ${key} is past the end of a list of ${list.length}.`);
    const current = list[key];
    const next = setAt(current, segments, i + 1, value);
    if (list === node && key < list.length && Object.is(current, next)) return node;
    const copy = list.slice();
    copy[key] = next;
    return copy;
  }
  const isRecord = node !== null && typeof node === 'object' && !Array.isArray(node);
  const record = isRecord ? (node as Record<string, unknown>) : {};
  const has = Object.prototype.hasOwnProperty.call(record, key);
  const current = has ? record[key] : undefined;
  const next = setAt(current, segments, i + 1, value);
  if (isRecord && Object.is(current, next) && (has || next === undefined)) return node;
  return { ...record, [key]: next };
}

/** `setIn` with a function of the current value. */
export function updateIn<T, V>(root: T, path: string | readonly PathSegment[], recipe: (current: V) => V): T {
  return setIn(root, path, recipe(getIn(root, path) as V));
}
