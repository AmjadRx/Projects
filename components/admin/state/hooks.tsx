'use client';

/**
 * React bindings for the admin store (./store.ts).
 *
 * - `AdminProvider` creates one store for the admin page.
 * - `useAdmin(selector)` re-renders only when the selected value changes (`Object.is`, or the
 *   `equal` function given), so a keystroke in one field does not re-render every tab.
 * - `useAdminStore()` gives the actions (edit, undo, save bookkeeping) without subscribing.
 * - `FileScope` names the content file the fields inside it belong to, and `useFieldId(path)`
 *   gives each input its DOM id (lib/admin/locate.ts), so a content-check finding can scroll to it.
 */
import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { fieldId } from '@/lib/admin/locate';
import { createAdminStore, type AdminState, type AdminStore } from './store';

const StoreContext = createContext<AdminStore | null>(null);

export function AdminProvider({ children, store }: { children: ReactNode; store?: AdminStore }) {
  const ref = useRef<AdminStore | null>(store ?? null);
  if (ref.current === null) ref.current = createAdminStore();
  return <StoreContext.Provider value={ref.current}>{children}</StoreContext.Provider>;
}

export function useAdminStore(): AdminStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useAdminStore must be used inside <AdminProvider>.');
  return store;
}

/**
 * Subscribes to a slice of the admin state. The selector should return existing objects (or
 * primitives); pass `equal` when it builds a new array or object each time.
 */
export function useAdmin<T>(selector: (state: AdminState) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const store = useAdminStore();
  const last = useRef<{ state: AdminState; selector: (state: AdminState) => T; value: T } | null>(null);
  const getSnapshot = () => {
    const state = store.getState();
    const previous = last.current;
    // The cache is keyed on the selector too: a selector that closes over props (a project key)
    // must be re-run when those props change, even if the state did not.
    if (previous && previous.state === state && previous.selector === selector) return previous.value;
    const value = selector(state);
    if (previous && equal(previous.value, value)) {
      last.current = { state, selector, value: previous.value };
      return previous.value;
    }
    last.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Shallow equality for arrays and plain objects, for selectors that build a new one each time. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const FileContext = createContext<string | null>(null);

/** Names the content file ("content/site.json" or "content/projects/<slug>.json") for the fields inside. */
export function FileScope({ file, children }: { file: string; children: ReactNode }) {
  return <FileContext.Provider value={file}>{children}</FileContext.Provider>;
}

/** The file of the nearest FileScope. */
export function useScopeFile(): string {
  const file = useContext(FileContext);
  if (file === null) throw new Error('Fields must sit inside a <FileScope>.');
  return file;
}

/** The DOM id for the field at `path` in the current file. */
export function useFieldId(path: string): string {
  const file = useScopeFile();
  return useMemo(() => fieldId(file, path), [file, path]);
}
