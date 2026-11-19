/**
 * Where a field's upload lands (ARCHITECTURE.md 13A; the Phase 6 review's CLIENT-2 and CLIENT-4).
 *
 * An upload belongs to the field it was started from, not to a position. When the owner chooses
 * Upload (or drops a file on a field), the field's place is recorded as the content it is in
 * ("site", or the project's entry key, which a slug rename does not change) and its path there,
 * and the queue follows that place through every edit of the working copy until the file is
 * stored:
 *
 * - a row that moves (a block, a gallery item, a log entry, an Experience role) keeps its object,
 *   so it is found where it went; a block is also found by its id, which survives a revert;
 * - a row edited where it is (typing its alt text) keeps its position;
 * - a row that is removed is gone: the upload is left unplaced with a note, and the file stays in
 *   the library. Undo brings the row back, and the place with it.
 *
 * When the file is stored, `placeUpload` puts it in place with one functional edit of the store's
 * current state, never through a render's snapshot, so several uploads that finish in one burst
 * all land: every file dropped on a gallery, two blocks of one list, a video and its captions.
 * Each placed upload is one undo step, and its field need not be on the page (a closed block).
 *
 * No React: the fields create a place (`fieldTarget`) when the owner uploads, and the queue
 * (./manager.ts) follows it and calls its `apply` when the file is stored.
 */
import { SITE_FILE } from '@/lib/admin/contract';
import type { MediaRef } from '@/lib/types';
import { pathOfEntry, type AdminState, type AdminStore } from '../state/store';
import { getIn, joinPath, parsePath, updateIn, type PathSegment } from '../ui/paths';
import { describeKinds, type MediaKind } from './logic';
import type { ApplyOutcome, MovingTarget, StoredUpload } from './manager';

/**
 * What a place receives: a MediaRef (`field`), the captions file of the video MediaRef at the
 * path (`captions`), one more item at the end of a list of MediaRefs (`list`), or the address of
 * any stored file (`filepick`, a `file` block).
 */
export type PlaceKind = 'field' | 'captions' | 'list' | 'filepick';

/** The scope of content/site.json. A project's scope is "project:<entry key>". */
export const SITE_SCOPE = 'site';
const PROJECT_SCOPE = 'project:';

/** The scope of the content file a FileScope names, or null when the working copy has no such file. */
export function scopeOfFile(state: Pick<AdminState, 'doc'>, file: string): string | null {
  const doc = state.doc;
  if (!doc) return null;
  if (file === SITE_FILE) return SITE_SCOPE;
  const entry = doc.projects.find((e) => pathOfEntry(e) === file) ?? doc.projects.find((e) => e.loadedFile === file);
  return entry ? `${PROJECT_SCOPE}${entry.key}` : null;
}

/** The content of a scope in the working copy: the site, or the project with that entry key. */
export function contentOf(state: Pick<AdminState, 'doc'>, scope: string): unknown {
  const doc = state.doc;
  if (!doc) return undefined;
  if (scope === SITE_SCOPE) return doc.site;
  if (!scope.startsWith(PROJECT_SCOPE)) return undefined;
  const key = scope.slice(PROJECT_SCOPE.length);
  return doc.projects.find((e) => e.key === key)?.data;
}

/** The queue's name of a place: "field:project:content/projects/raven.json#blocks[2].media". */
export function targetName(kind: PlaceKind, scope: string, path: string): string {
  return `${kind}:${scope}#${path}`;
}

// ---------------------------------------------------------------------------------------------
// Following a path through one change
// ---------------------------------------------------------------------------------------------

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}

function idOf(item: unknown): string | null {
  return isRecord(item) && typeof item.id === 'string' && item.id !== '' ? item.id : null;
}

/** The index of the one item with this id, or -1 when none or more than one has it. */
function indexOfId(list: readonly unknown[], id: string): number {
  let at = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (idOf(list[i]) !== id) continue;
    if (at !== -1) return -1;
    at = i;
  }
  return at;
}

/**
 * Where the item at `index` of `before` is in `after`: in the same place, or where its object
 * went (rows keep their identity when they move), or, for a block, where its id went. Else, unless
 * `strict`, the same index when the list kept its length (the row was edited where it is). -1 when
 * it is gone.
 */
function indexAfter(before: readonly unknown[], after: readonly unknown[], index: number, strict: boolean): number {
  const item = before[index];
  if (index < after.length && after[index] === item) return index;
  if (isObject(item)) {
    const moved = after.indexOf(item);
    if (moved !== -1) return moved;
    const id = idOf(item);
    if (id !== null && indexOfId(before, id) === index) {
      const found = indexOfId(after, id);
      if (found !== -1) return found;
    }
  }
  return !strict && before.length === after.length && index < after.length ? index : -1;
}

/**
 * The path in `after` of the place at `path` in `before`, or null when it is gone. `after` is the
 * content after one change of the working copy; `strict` is for finding a place again after it was
 * gone, across any number of changes: then only an unchanged object or a block's id counts.
 */
export function followPath(before: unknown, after: unknown, path: readonly PathSegment[], strict = false): PathSegment[] | null {
  const out: PathSegment[] = [];
  let a: unknown = before;
  let b: unknown = after;
  for (let i = 0; i < path.length; i += 1) {
    if (a === b) return [...out, ...path.slice(i)];
    const segment = path[i];
    if (typeof segment === 'number') {
      if (!Array.isArray(a) || !Array.isArray(b)) return null;
      const at = indexAfter(a, b, segment, strict);
      if (at === -1) return null;
      out.push(at);
      a = a[segment];
      b = b[at];
    } else {
      if (!isRecord(b)) return null;
      out.push(segment);
      a = isRecord(a) ? a[segment] : undefined;
      b = b[segment];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// A place, followed through every change
// ---------------------------------------------------------------------------------------------

interface Located {
  root: unknown;
  path: PathSegment[];
}

/** A field's place in the working copy, kept up to date with every edit while anything follows it. */
export class UploadPlace {
  readonly kind: PlaceKind;
  readonly scope: string;
  private readonly store: AdminStore;
  /** Where the place is now, or null while it is gone. */
  private now: Located | null;
  /** Where it was last found, so an undo that brings it back finds it again. */
  private last: Located;
  private readonly listeners = new Set<(name: string | null) => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(store: AdminStore, kind: PlaceKind, scope: string, path: string) {
    this.store = store;
    this.kind = kind;
    this.scope = scope;
    const root = contentOf(store.getState(), scope);
    this.last = { root, path: parsePath(path) };
    this.now = root === undefined ? null : this.last;
  }

  /** Brings the place up to date with the working copy. True when its name changed. */
  sync(): boolean {
    const before = this.name();
    const root = contentOf(this.store.getState(), this.scope);
    if (this.now) {
      if (root === this.now.root) return false;
      const path = root === undefined ? null : followPath(this.now.root, root, this.now.path);
      this.now = path ? { root, path } : null;
    } else if (root !== undefined) {
      const path = followPath(this.last.root, root, this.last.path, true);
      if (path) this.now = { root, path };
    }
    if (this.now) this.last = this.now;
    return this.name() !== before;
  }

  /** The place's path now, or null while it is gone. */
  path(): string | null {
    this.sync();
    return this.now ? joinPath(this.now.path) : null;
  }

  /** The queue's name for the place now, or null while it is gone. */
  name(): string | null {
    return this.now ? targetName(this.kind, this.scope, joinPath(this.now.path)) : null;
  }

  /** Follows every edit of the working copy; `moved` hears each change of the name. Returns the stop function. */
  follow(moved: (name: string | null) => void): () => void {
    this.sync();
    this.listeners.add(moved);
    if (!this.unsubscribe) {
      this.unsubscribe = this.store.subscribe(() => {
        if (!this.sync()) return;
        const name = this.name();
        for (const listener of [...this.listeners]) listener(name);
      });
    }
    return () => {
      this.listeners.delete(moved);
      if (this.listeners.size === 0 && this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Putting a stored upload in place
// ---------------------------------------------------------------------------------------------

/** The note on an upload whose field was removed while it was stored. */
export const PLACE_GONE =
  'Stored in the media library. It was not placed, because the field it was uploaded for was removed. Choose it from the library where you want it.';

function isVideoRef(value: unknown): value is MediaRef {
  return isRecord(value) && value.kind === 'video' && typeof value.src === 'string';
}

/** One edit of the scope's current content: `recipe` gets the value at `path` as it is now. */
function editAt(store: AdminStore, scope: string, path: string, recipe: (value: unknown) => unknown): void {
  if (scope === SITE_SCOPE) {
    store.editSite((site) => updateIn(site, path, recipe));
    return;
  }
  if (scope.startsWith(PROJECT_SCOPE)) store.editProject(scope.slice(PROJECT_SCOPE.length), (project) => updateIn(project, path, recipe));
}

/**
 * Puts a stored upload in its place, as one edit (one undo step) of the store's current state.
 * `accept` is what a `field` or a `list` takes. A place that is gone, or a file the place does not
 * take, leaves the upload unplaced with a note; the file stays in the library.
 */
export function placeUpload(store: AdminStore, place: UploadPlace, result: StoredUpload, accept: readonly MediaKind[]): ApplyOutcome {
  const path = place.path();
  const root = contentOf(store.getState(), place.scope);
  if (path === null || root === undefined) return { applied: false, note: PLACE_GONE };
  switch (place.kind) {
    case 'field': {
      const ref = result.ref;
      if (!ref || !accept.includes(ref.kind)) return { applied: false, note: `Stored in the media library, but this field takes ${describeKinds(accept)}.` };
      editAt(store, place.scope, path, () => ref);
      return { applied: true, note: null };
    }
    case 'list': {
      const ref = result.ref;
      if (!ref || !accept.includes(ref.kind)) return { applied: false, note: `Stored in the media library, but this list takes ${describeKinds(accept)}.` };
      editAt(store, place.scope, path, (list) => [...(Array.isArray(list) ? list : []), ref]);
      return { applied: true, note: null };
    }
    case 'captions': {
      if (result.kind !== 'captions' || !isVideoRef(getIn(root, path))) {
        return { applied: false, note: "Stored in the media library, but not set as this video's captions." };
      }
      editAt(store, place.scope, path, (value) => (isVideoRef(value) ? { ...value, captions: result.main.src } : value));
      return { applied: true, note: null };
    }
    case 'filepick':
      editAt(store, place.scope, path, () => result.main.src);
      return { applied: true, note: null };
  }
}

/**
 * The moving target of a field's upload: its place in the content `file` (the FileScope's file)
 * at `path`, followed until the file is stored, then filled by `placeUpload`. Null when the
 * working copy has no such file.
 */
export function fieldTarget(store: AdminStore, kind: PlaceKind, file: string, path: string, accept: readonly MediaKind[] = []): MovingTarget | null {
  const scope = scopeOfFile(store.getState(), file);
  if (scope === null) return null;
  const place = new UploadPlace(store, kind, scope, path);
  return {
    name: () => {
      place.sync();
      return place.name();
    },
    follow: (moved) => place.follow(moved),
    apply: (result) => placeUpload(store, place, result, accept),
  };
}
