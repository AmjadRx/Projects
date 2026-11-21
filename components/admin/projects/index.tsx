'use client';

/**
 * The Projects tab (ARCHITECTURE.md 7): the project list, or the full-page editor of the project
 * the URL hash names ("#tab=projects&project=raven"), with a link back to the list.
 *
 * The editor follows its project, not its slug: a rename (or undoing one) changes the slug, so the
 * panel remembers the open project's entry key (`resolveEntry`) and points the hash at its current
 * slug without a new history entry. Reload and Back then still land on it.
 */
import { useCallback, useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useAdminRoute } from '../shell/route';
import { FileScope, useAdmin } from '../state/hooks';
import { pathOfEntry, type ProjectEntry } from '../state/store';
import { Notice } from '../ui/bits';
import { Button } from '../ui/Button';
import { replaceProjectRoute } from './edit';
import { resolveEntry, ROUTE_SLUG } from './logic';
import { ProjectEditor } from './ProjectEditor';
import { ProjectList } from './ProjectList';

const NONE: ProjectEntry[] = [];

export function ProjectsPanel() {
  const { project: routeSlug, go } = useAdminRoute();
  const projects = useAdmin((s) => s.doc?.projects ?? NONE);
  const openKey = useRef<string | null>(null);
  const entry = routeSlug === null ? undefined : resolveEntry(projects, routeSlug, openKey.current);
  const entryKey = entry?.key ?? null;
  const entrySlug = entry?.data.slug ?? null;

  useEffect(() => {
    if (entryKey === null || entrySlug === null) return;
    openKey.current = entryKey;
    if (entrySlug !== routeSlug && ROUTE_SLUG.test(entrySlug)) replaceProjectRoute(entrySlug);
  }, [entryKey, entrySlug, routeSlug]);

  const open = useCallback(
    (key: string, slug: string) => {
      openKey.current = key;
      go('projects', slug);
    },
    [go],
  );
  const backToList = useCallback(() => go('projects'), [go]);

  if (routeSlug === null) return <ProjectList onOpen={open} />;

  if (!entry) {
    return (
      <Notice
        tone="warning"
        title="No project here"
        actions={
          <Button icon={<ArrowLeft size={16} />} onClick={backToList}>
            All projects
          </Button>
        }
      >
        No project in the editor has the slug {routeSlug}. It may have been renamed, removed, or undone.
      </Notice>
    );
  }

  return (
    <FileScope file={pathOfEntry(entry)}>
      <ProjectEditor key={entry.key} entryKey={entry.key} onBack={backToList} />
    </FileScope>
  );
}
