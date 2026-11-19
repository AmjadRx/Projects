'use client';

/**
 * The media folders that no saved project names (docs/V3_PLAN.md D-27; ARCHITECTURE.md 13A): a
 * project's files stay in their folder when the project is renamed or deleted, so these folders
 * still hold files, public ones in Blob included. The list comes from GET /api/upload?folders=1
 * (MediaFoldersResponse); each folder opens in its own library, where its files can be renamed,
 * replaced, deleted, and found by "Not used anywhere". The Settings tab shows it under Media,
 * beside the site's library.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { FolderOpen, FolderX, RefreshCw } from 'lucide-react';
import { slugOfProjectFile, type MediaFoldersResponse } from '@/lib/admin/contract';
import { plural } from '../shell/format';
import { isApiError } from '../state/api';
import { useAdmin } from '../state/hooks';
import type { ProjectEntry } from '../state/store';
import { Notice, Section } from '../ui/bits';
import { Button } from '../ui/Button';
import { MediaLibraryPanel } from './Library';
import { projectMediaFolder } from './logic';
import styles from './media.module.css';
import { useMediaManager } from './services';

type Folder = MediaFoldersResponse['folders'][number];

const NO_PROJECTS: ProjectEntry[] = [];

/** The folders no saved project names (`owner` null), in name order. */
export function otherFolders(folders: readonly Folder[]): Folder[] {
  return folders.filter((folder) => folder.owner === null).sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
}

/** The titles of the projects in the editor whose files live in each folder. */
function usersOfFolders(projects: readonly ProjectEntry[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of projects) {
    const saved = (entry.loadedFile ? slugOfProjectFile(entry.loadedFile) : null) ?? entry.data.slug;
    const folder = projectMediaFolder(entry.data, saved);
    out.set(folder, [...(out.get(folder) ?? []), entry.data.title.trim() || entry.data.slug]);
  }
  return out;
}

export interface OtherMediaFoldersProps {
  /** The heading level of the list and of an opened folder's library. Default 3. */
  level?: 2 | 3;
}

/** The list of other folders, and the library of the one the owner opens. */
export function OtherMediaFolders({ level = 3 }: OtherMediaFoldersProps) {
  const manager = useMediaManager();
  const projects = useAdmin((state) => state.doc?.projects ?? NO_PROJECTS);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  // A delete, rename, or upload in the open folder changes its file count: list the folders again.
  const openVersion = useSyncExternalStore(
    manager.subscribe,
    () => (open === null ? 0 : manager.version(open)),
    () => 0,
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void manager.api.mediaFolders({ signal: controller.signal }).then((answer) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (isApiError(answer)) setError(answer.error);
      else setFolders(otherFolders(answer.folders));
    });
    return () => controller.abort();
  }, [manager, nonce, openVersion]);

  const users = useMemo(() => usersOfFolders(projects), [projects]);
  const shown = folders ?? [];

  return (
    <>
      <Section
        title="Other folders"
        level={level}
        description="A project's files stay in their folder when the project is renamed or deleted. These folders belong to no saved project; open one to rename, replace, or delete its files, or to find the ones not used anywhere."
        actions={
          <Button size="sm" variant="ghost" icon={<RefreshCw size={16} />} onClick={() => setNonce((n) => n + 1)}>
            Refresh
          </Button>
        }
      >
        {error ? (
          <Notice tone="error" title="The folders could not be listed">
            {error}
          </Notice>
        ) : null}
        {loading && !folders ? <p className={styles.note}>Listing the folders...</p> : null}
        {folders && shown.length === 0 ? <p className={styles.note}>No other folders: every media folder belongs to the site or to a saved project.</p> : null}
        {shown.length > 0 ? (
          <ul className={styles.folders} aria-label="Other media folders">
            {shown.map((folder) => {
              const usedBy = users.get(folder.folder) ?? [];
              const isOpen = open === folder.folder;
              return (
                <li key={folder.folder} className={styles.folder}>
                  <span className={styles.folderName}>/media/{folder.folder}/</span>
                  <span className={styles.note}>
                    {plural(folder.files, 'file')}.{' '}
                    {usedBy.length > 0
                      ? `${usedBy.join(', ')} ${usedBy.length === 1 ? 'keeps its' : 'keep their'} files here.`
                      : 'No project in the editor keeps its files here.'}
                  </span>
                  <Button
                    size="sm"
                    icon={isOpen ? <FolderX size={16} /> : <FolderOpen size={16} />}
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : folder.folder)}
                  >
                    {isOpen ? `Close ${folder.folder}` : `Open ${folder.folder}`}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Section>
      {open !== null ? <MediaLibraryPanel folder={open} title={`Folder ${open}`} level={level} known /> : null}
    </>
  );
}
