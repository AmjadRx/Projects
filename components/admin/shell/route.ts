'use client';

/**
 * The admin's address: the tab (and the open project) live in the URL hash, so a reload and the
 * browser's Back button return to the same place.
 *
 *   #tab=stats
 *   #tab=projects&project=raven
 *
 * `useAdminRoute()` gives `{ tab, project, go }`. `go(tab, project?)` adds a history entry; a
 * missing or unknown tab reads as Settings, the first tab.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { TABS, type TabId } from '@/lib/admin/locate';

export interface AdminRoute {
  tab: TabId;
  /** The open project's slug on the Projects tab, or null for the list. */
  project: string | null;
}

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reads a hash ("#tab=projects&project=raven"); anything unknown falls back to Settings and no project. */
export function parseRoute(hash: string): AdminRoute {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const tabParam = params.get('tab') ?? '';
  const tab = (TAB_IDS.has(tabParam) ? tabParam : TABS[0].id) as TabId;
  const projectParam = params.get('project');
  const project = tab === 'projects' && projectParam !== null && SLUG.test(projectParam) ? projectParam : null;
  return { tab, project };
}

/** The hash for a route: "#tab=stats", "#tab=projects&project=raven". */
export function formatRoute(tab: TabId, project?: string | null): string {
  const params = new URLSearchParams({ tab });
  if (tab === 'projects' && project) params.set('project', project);
  return `#${params.toString()}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const readHash = () => window.location.hash;
const serverHash = () => '';

/** The current tab and project, and `go` to change them (a new history entry, so Back works). */
export function useAdminRoute(): AdminRoute & { go: (tab: TabId, project?: string | null) => void } {
  const hash = useSyncExternalStore(subscribe, readHash, serverHash);
  const route = parseRoute(hash);
  const go = useCallback((tab: TabId, project?: string | null) => {
    const next = formatRoute(tab, project);
    if (next !== window.location.hash) window.location.hash = next;
  }, []);
  return { ...route, go };
}
