/**
 * The admin's editing state: the working copy of every content file, the stored text of each file
 * as last loaded or saved, and the undo and redo history of this editing session
 * (ARCHITECTURE.md 7.5). A small external store, so a keystroke re-renders only the components
 * whose selected slice changed (see ./hooks.tsx).
 *
 * Rules that keep saves honest (docs/V3_PLAN.md D-18):
 * - Edits are immutable: an edit returns new objects along its path and keeps every other object,
 *   so an unedited file serializes to its stored text and never shows as changed.
 * - Dirty files are found by comparing `serializeContent(data)` with the stored text, never by a
 *   flag, so undoing back to the stored state makes a file clean again.
 * - A save records the text it sent, not the text on screen when it returns, because typing may
 *   continue while the request is in flight.
 * - The stored text is the version of each file this editor holds, and a save names it for every
 *   file (`SaveBody.expected`), so the server refuses to overwrite a file that changed on the draft
 *   meanwhile. A save never makes a file count as reloaded: files the server reports changed
 *   elsewhere stay `stale` until the content is loaded again.
 */
import {
  type ContentResponse,
  type Finding,
  type PreviewInfo,
  projectFileOf,
  serializeContent,
  SITE_FILE,
  slugOfProjectFile,
} from '@/lib/admin/contract';
import type { Project, Site } from '@/lib/types';

export interface ProjectEntry {
  /** Stable for React and the editor: the file loaded from, or "new:<n>" for a project made in this session. */
  key: string;
  /** The file this project was loaded from or last saved to; null until a new project is saved. */
  loadedFile: string | null;
  data: Project;
}

/** Everything the owner edits, in display order. */
export interface Doc {
  site: Site;
  projects: ProjectEntry[];
}

export interface LoadInfo {
  source: ContentResponse['source'];
  ref: ContentResponse['ref'];
  /** The draft head as last loaded or saved (the next save's `base`). */
  head: string | null;
  liveHead: string | null;
  draftExists: boolean;
  draftAhead: number;
  liveBranch: string | null;
  draftBranch: string | null;
  preview: PreviewInfo | null;
  /** The stored text of each content file, by path, as loaded or last saved. */
  stored: Record<string, string>;
  /** Schema findings the server reported at load. */
  loadFindings: Finding[];
  /**
   * Content files whose copy here is out of date: they changed on the draft after this editor
   * loaded them (a save from another window, a discard, a rename's rewrite, the published branch
   * merged in), as saves and conflicts reported them. Sorted; empty after a load.
   */
  stale: string[];
  /** True once a save since the load merged the published branch into the draft. */
  liveMerged: boolean;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveState {
  status: SaveStatus;
  /** A plain sentence for the save bar. */
  message: string | null;
  /** Content-check and schema errors from the last refused save; each one links to its field. */
  findings: Finding[];
  /** Guard-rail warnings the server returned with the last save. */
  warnings: Finding[];
  /** When the last save finished, in milliseconds. */
  at: number | null;
  commit: string | null;
}

/** A request to bring a field into view (a content-check failure, a warning the owner clicked). */
export interface Reveal {
  file: string;
  path: string;
  /** Changes on every request, so asking for the same field twice still scrolls. */
  nonce: number;
}

export interface AdminState {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  loadError: string | null;
  doc: Doc | null;
  info: LoadInfo | null;
  past: Doc[];
  future: Doc[];
  /** The last coalescing edit: typing in one field within COALESCE_MS is one undo step. */
  lastEdit: { key: string; at: number } | null;
  save: SaveState;
  reveal: Reveal | null;
}

/** One file a save writes, with the exact text sent and, for a project, its entry key. */
export interface FileWrite {
  path: string;
  data: unknown;
  text: string;
  key?: string;
}

export interface Changes {
  writes: FileWrite[];
  deletes: string[];
}

export const HISTORY_LIMIT = 300;
export const COALESCE_MS = 1000;

const IDLE_SAVE: SaveState = { status: 'idle', message: null, findings: [], warnings: [], at: null, commit: null };

export function initialState(): AdminState {
  return {
    phase: 'idle',
    loadError: null,
    doc: null,
    info: null,
    past: [],
    future: [],
    lastEdit: null,
    save: IDLE_SAVE,
    reveal: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Serialization, cached by object identity (edits are immutable, so unchanged files hit the cache)
// ---------------------------------------------------------------------------------------------

const textCache = new WeakMap<object, string>();

export function textOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) return serializeContent(data);
  const cached = textCache.get(data);
  if (cached !== undefined) return cached;
  const text = serializeContent(data);
  textCache.set(data, text);
  return text;
}

// ---------------------------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------------------------

/** The file a project entry saves to: its slug's file. */
export function pathOfEntry(entry: ProjectEntry): string {
  return projectFileOf(entry.data.slug);
}

/** The writes and deletes a save would send now. */
export function changesOf(doc: Doc, info: LoadInfo): Changes {
  const writes: FileWrite[] = [];
  const siteText = textOf(doc.site);
  if (info.stored[SITE_FILE] !== siteText) writes.push({ path: SITE_FILE, data: doc.site, text: siteText });

  const current = new Set<string>();
  for (const entry of doc.projects) {
    const path = pathOfEntry(entry);
    current.add(path);
    const text = textOf(entry.data);
    if (info.stored[path] !== text) writes.push({ path, data: entry.data, text, key: entry.key });
  }
  const deletes = Object.keys(info.stored)
    .filter((path) => slugOfProjectFile(path) !== null && !current.has(path))
    .sort();
  return { writes, deletes };
}

export function isDirty(doc: Doc | null, info: LoadInfo | null): boolean {
  if (!doc || !info) return false;
  const changes = changesOf(doc, info);
  return changes.writes.length > 0 || changes.deletes.length > 0;
}

/** True when a file differs from its stored text: "content/site.json" or a project's file. */
export function isFileDirty(doc: Doc, info: LoadInfo, path: string): boolean {
  if (path === SITE_FILE) return info.stored[SITE_FILE] !== textOf(doc.site);
  const entry = doc.projects.find((e) => pathOfEntry(e) === path || e.loadedFile === path);
  if (!entry) return path in info.stored;
  return info.stored[pathOfEntry(entry)] !== textOf(entry.data) || (entry.loadedFile !== null && entry.loadedFile !== pathOfEntry(entry));
}

/** Gives projects their display position as `order` (1, 2, 3, ...), touching only those that change. */
export function renumber(projects: ProjectEntry[]): ProjectEntry[] {
  return projects.map((entry, i) =>
    entry.data.order === i + 1 ? entry : { ...entry, data: { ...entry.data, order: i + 1 } },
  );
}

/** `stale` with `more` added and `cleared` taken out, sorted; the same array when nothing changes. */
export function staleAfter(stale: string[], more: readonly string[], cleared: ReadonlySet<string> = new Set()): string[] {
  const next = new Set(stale.filter((path) => !cleared.has(path)));
  for (const path of more) if (!cleared.has(path)) next.add(path);
  const sorted = [...next].sort();
  return sorted.length === stale.length && sorted.every((path, i) => path === stale[i]) ? stale : sorted;
}

// ---------------------------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------------------------

type Listener = () => void;

export interface EditOptions {
  /** Consecutive edits with the same key within COALESCE_MS make one undo step (typing in one field). */
  coalesce?: string;
}

export interface AdminStore {
  getState(): AdminState;
  subscribe(listener: Listener): () => void;

  /** Starts loading; the shell fetches /api/content and calls `load` or `fail`. */
  begin(): void;
  load(content: ContentResponse): void;
  fail(message: string): void;

  /** Any change to the working copy. Returns nothing; the history records the state before it. */
  edit(recipe: (doc: Doc) => Doc, options?: EditOptions): void;
  editSite(recipe: (site: Site) => Site, options?: EditOptions): void;
  editProject(key: string, recipe: (project: Project) => Project, options?: EditOptions): void;
  /** Inserts a project at `index` (the end by default) and renumbers `order`. Returns its key. */
  addProject(project: Project, index?: number): string;
  removeProject(key: string): void;
  moveProject(from: number, to: number): void;
  /** "Revert this file to published": the live branch's version, or null when the file is not on live. */
  revertFile(path: string, published: unknown | null): void;

  undo(): void;
  redo(): void;

  changes(): Changes;
  setSaving(): void;
  /**
   * Records a successful save of exactly `sent`, and the server's answer: `moved` (files changed on
   * the draft that this editor has not loaded) become stale, and `merged` says the published
   * branch was merged in. Neither is reloaded here: the editor keeps what is on screen.
   */
  saved(
    sent: Changes,
    answer: {
      head: string | null;
      commit: string | null;
      warnings: Finding[];
      preview: PreviewInfo | null;
      message: string;
      moved?: string[];
      merged?: boolean;
    },
  ): void;
  saveFailed(message: string, findings?: Finding[]): void;
  /** Files a refused save named as changed on the draft (409 conflict): their copies here are stale. */
  noteStale(paths: readonly string[]): void;
  /** Updates what the save bar knows about the branches without touching the working copy. */
  setBranchInfo(patch: Partial<Pick<LoadInfo, 'head' | 'liveHead' | 'draftExists' | 'draftAhead' | 'preview'>>): void;

  reveal(file: string, path: string): void;
}

let newProjectCounter = 0;

export function createAdminStore(now: () => number = () => Date.now()): AdminStore {
  let state = initialState();
  const listeners = new Set<Listener>();

  function set(next: AdminState): void {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function commitDoc(doc: Doc, options: EditOptions = {}): void {
    if (!state.doc || doc === state.doc) return;
    const at = now();
    const coalescing =
      options.coalesce !== undefined &&
      state.lastEdit !== null &&
      state.lastEdit.key === options.coalesce &&
      at - state.lastEdit.at < COALESCE_MS &&
      state.past.length > 0;
    const past = coalescing ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT);
    set({
      ...state,
      doc,
      past,
      future: [],
      lastEdit: options.coalesce !== undefined ? { key: options.coalesce, at } : null,
    });
  }

  function entryKey(file: string): string {
    return file;
  }

  const store: AdminStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    begin() {
      set({ ...state, phase: 'loading', loadError: null });
    },

    load(content) {
      const stored: Record<string, string> = { [content.site.file]: serializeContent(content.site.data) };
      const projects: ProjectEntry[] = content.projects.map(({ file, data }) => {
        stored[file] = serializeContent(data);
        return { key: entryKey(file), loadedFile: file, data: data as Project };
      });
      projects.sort((a, b) => a.data.order - b.data.order);
      set({
        ...initialState(),
        phase: 'ready',
        doc: { site: content.site.data as Site, projects },
        info: {
          source: content.source,
          ref: content.ref,
          head: content.head,
          liveHead: content.liveHead,
          draftExists: content.draftExists,
          draftAhead: content.draftAhead,
          liveBranch: content.liveBranch,
          draftBranch: content.draftBranch,
          preview: content.preview,
          stored,
          loadFindings: content.findings,
          stale: [],
          liveMerged: false,
        },
      });
    },

    fail(message) {
      set({ ...state, phase: 'error', loadError: message });
    },

    edit(recipe, options) {
      if (!state.doc) return;
      commitDoc(recipe(state.doc), options);
    },

    editSite(recipe, options) {
      if (!state.doc) return;
      const site = recipe(state.doc.site);
      if (site === state.doc.site) return;
      commitDoc({ ...state.doc, site }, options);
    },

    editProject(key, recipe, options) {
      if (!state.doc) return;
      let changed = false;
      const projects = state.doc.projects.map((entry) => {
        if (entry.key !== key) return entry;
        const data = recipe(entry.data);
        if (data === entry.data) return entry;
        changed = true;
        return { ...entry, data };
      });
      if (changed) commitDoc({ ...state.doc, projects }, options);
    },

    addProject(project, index) {
      const key = `new:${++newProjectCounter}`;
      if (!state.doc) return key;
      const projects = [...state.doc.projects];
      const at = index === undefined ? projects.length : Math.max(0, Math.min(index, projects.length));
      projects.splice(at, 0, { key, loadedFile: null, data: project });
      commitDoc({ ...state.doc, projects: renumber(projects) });
      return key;
    },

    removeProject(key) {
      if (!state.doc) return;
      const projects = state.doc.projects.filter((entry) => entry.key !== key);
      if (projects.length === state.doc.projects.length) return;
      commitDoc({ ...state.doc, projects: renumber(projects) });
    },

    moveProject(from, to) {
      if (!state.doc) return;
      const list = [...state.doc.projects];
      if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      commitDoc({ ...state.doc, projects: renumber(list) });
    },

    revertFile(path, published) {
      if (!state.doc) return;
      if (path === SITE_FILE) {
        if (published === null) return;
        commitDoc({ ...state.doc, site: published as Site });
        return;
      }
      const slug = slugOfProjectFile(path);
      if (!slug) return;
      const index = state.doc.projects.findIndex((e) => pathOfEntry(e) === path || e.loadedFile === path);
      let projects = [...state.doc.projects];
      if (published === null) {
        if (index === -1) return;
        projects.splice(index, 1);
      } else if (index === -1) {
        projects.push({ key: entryKey(path), loadedFile: path, data: published as Project });
        projects.sort((a, b) => a.data.order - b.data.order);
      } else {
        projects[index] = { ...projects[index], data: published as Project };
      }
      projects = renumber(projects);
      commitDoc({ ...state.doc, projects });
    },

    undo() {
      if (!state.doc || state.past.length === 0) return;
      const previous = state.past[state.past.length - 1];
      set({
        ...state,
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future].slice(0, HISTORY_LIMIT),
        lastEdit: null,
      });
    },

    redo() {
      if (!state.doc || state.future.length === 0) return;
      const [next, ...rest] = state.future;
      set({
        ...state,
        doc: next,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: rest,
        lastEdit: null,
      });
    },

    changes() {
      if (!state.doc || !state.info) return { writes: [], deletes: [] };
      return changesOf(state.doc, state.info);
    },

    setSaving() {
      set({ ...state, save: { ...state.save, status: 'saving', message: null, findings: [] } });
    },

    saved(sent, answer) {
      if (!state.info || !state.doc) return;
      const stored = { ...state.info.stored };
      for (const write of sent.writes) stored[write.path] = write.text;
      for (const path of sent.deletes) delete stored[path];
      const writtenByKey = new Map(sent.writes.filter((w) => w.key).map((w) => [w.key as string, w.path]));
      const projects = state.doc.projects.map((entry) => {
        const path = writtenByKey.get(entry.key);
        return path && entry.loadedFile !== path ? { ...entry, loadedFile: path } : entry;
      });
      // A file this save wrote or removed passed the server's check, so the draft held this
      // editor's version of it: it is current again. Every other file the server names is not.
      const written = new Set([...sent.writes.map((write) => write.path), ...sent.deletes]);
      // A merge adds its own commit to the unpublished ones, besides the save's commit.
      const added = (answer.commit ? 1 : 0) + (answer.merged ? 1 : 0);
      set({
        ...state,
        doc: projects.some((p, i) => p !== state.doc!.projects[i]) ? { ...state.doc, projects } : state.doc,
        info: {
          ...state.info,
          stored,
          head: answer.head,
          draftExists: state.info.source === 'github' ? true : state.info.draftExists,
          draftAhead: state.info.draftAhead + added,
          preview: answer.preview ?? state.info.preview,
          stale: staleAfter(state.info.stale, answer.moved ?? [], written),
          liveMerged: state.info.liveMerged || answer.merged === true,
        },
        save: {
          status: 'saved',
          message: answer.message,
          findings: [],
          warnings: answer.warnings,
          at: now(),
          commit: answer.commit,
        },
      });
    },

    saveFailed(message, findings = []) {
      set({ ...state, save: { ...state.save, status: 'error', message, findings } });
    },

    noteStale(paths) {
      if (!state.info) return;
      const stale = staleAfter(state.info.stale, paths);
      if (stale !== state.info.stale) set({ ...state, info: { ...state.info, stale } });
    },

    setBranchInfo(patch) {
      if (!state.info) return;
      set({ ...state, info: { ...state.info, ...patch } });
    },

    reveal(file, path) {
      set({ ...state, reveal: { file, path, nonce: now() + Math.random() } });
    },
  };
  return store;
}
