'use client';

/**
 * Bindings between a field path and the store, so an editor needs no setter of its own:
 *
 *   const [name, setName] = useSiteBinding<string>('personal.name');
 *   <TextField path="personal.name" label="Name" value={name} onChange={setName} />
 *
 * The setter writes with `setIn` (./paths.ts), which keeps every other object, and passes the
 * input's edit options to the store, so typing in one field is one undo step. The value is read
 * from the working copy; the component re-renders only when that value changes.
 */
import { useCallback } from 'react';
import type { EditOptions } from '../state/store';
import { useAdmin, useAdminStore } from '../state/hooks';
import { getIn, setIn } from './paths';

/** The value at `path` in content/site.json, and its setter. */
export function useSiteBinding<V>(path: string): [V, (value: V, edit?: EditOptions) => void] {
  const store = useAdminStore();
  const value = useAdmin((s) => getIn(s.doc?.site, path) as V);
  const set = useCallback(
    (next: V, edit?: EditOptions) => store.editSite((site) => setIn(site, path, next), edit),
    [store, path],
  );
  return [value, set];
}

/** The value at `path` in the project whose entry key is `key` (ProjectEntry.key), and its setter. */
export function useProjectBinding<V>(key: string, path: string): [V, (value: V, edit?: EditOptions) => void] {
  const store = useAdminStore();
  const value = useAdmin((s) => getIn(s.doc?.projects.find((entry) => entry.key === key)?.data, path) as V);
  const set = useCallback(
    (next: V, edit?: EditOptions) => store.editProject(key, (project) => setIn(project, path, next), edit),
    [store, key, path],
  );
  return [value, set];
}
