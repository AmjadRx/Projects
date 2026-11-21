'use client';

/** The files with unsaved changes, for the save bar, the dialogs, and the unload warning. */
import { changesOf } from '../state/store';
import { shallowEqual, useAdmin } from '../state/hooks';

const NONE: string[] = [];

/** Paths a save would write or remove right now, written files first. */
export function useChangedFiles(): string[] {
  return useAdmin((s) => {
    if (!s.doc || !s.info) return NONE;
    const changes = changesOf(s.doc, s.info);
    if (changes.writes.length === 0 && changes.deletes.length === 0) return NONE;
    return [...changes.writes.map((w) => w.path), ...changes.deletes];
  }, shallowEqual);
}
