'use client';

/**
 * The sticky save bar (ARCHITECTURE.md 7, kept and extended): how many files have unsaved
 * changes, Undo and Redo, Save (Ctrl+S or Cmd+S), the state of the last save, the draft's preview
 * link and build state, Publish and Discard (when content comes from GitHub), and, above it, the
 * findings of a refused save or the warnings of the last one, each linked to its field, and the
 * files that changed on the draft after this editor loaded them, with Reload.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { ExternalLink, Rocket, RotateCw, Save, Trash2 } from 'lucide-react';
import { SITE_FILE, slugOfProjectFile } from '@/lib/admin/contract';
import type { SaveState } from '../state/store';
import { useAdmin } from '../state/hooks';
import { Button } from '../ui/Button';
import { useChangedFiles } from './changes';
import type { DeployView } from './deploy';
import { FindingsList } from './FindingsList';
import { plural, shortSha } from './format';
import { isMac, useShortcuts } from './keys';
import { StatusText, type StatusTone } from './StatusText';
import { UndoRedo } from './UndoRedo';

export interface SaveBarProps {
  deploy: DeployView;
  /** The session watcher found the session ended. */
  sessionEnded: boolean;
  onSave: () => void;
  onPublish: () => void;
  onDiscard: () => void;
  onSignIn: () => void;
  /** Loads the content again (offered while files are stale and nothing is unsaved). */
  onReload: () => void;
}

/** A content file as the owner knows it: a project's slug, or "the site file". */
function fileWords(path: string): string {
  return path === SITE_FILE ? 'the site file' : (slugOfProjectFile(path) ?? path);
}

/**
 * The sentence for files that changed on the draft after this editor loaded them. Pure, for tests.
 * Reloading drops unsaved changes, so with any it asks to save or undo them first.
 */
export function staleLine(stale: readonly string[], liveMerged: boolean, unsavedFiles: number): string {
  const count = stale.length;
  const how = liveMerged ? ' (the published branch was merged into the draft)' : '';
  const next =
    unsavedFiles > 0
      ? 'Save or undo your unsaved changes first, then reload to see the new versions here.'
      : 'Reload to see the new versions here.';
  return `${plural(count, 'file')} changed on the draft after this editor loaded ${count === 1 ? 'it' : 'them'}${how}: ${stale.map(fileWords).join(', ')}. ${next}`;
}

const NO_STALE: string[] = [];

/** The stale files and Reload, which waits until nothing is unsaved (a reload would drop it). */
function StaleNotice({ unsavedFiles, onReload }: { unsavedFiles: number; onReload: () => void }) {
  const stale = useAdmin((s) => s.info?.stale ?? NO_STALE);
  const liveMerged = useAdmin((s) => s.info?.liveMerged ?? false);
  if (stale.length === 0) return null;
  return (
    <div className="adm-savebar__session" role="status">
      <span>{staleLine(stale, liveMerged, unsavedFiles)}</span>
      {unsavedFiles === 0 ? (
        <Button size="sm" icon={<RotateCw size={16} />} onClick={onReload}>
          Reload
        </Button>
      ) : null}
    </div>
  );
}

/** The status line's words for a save state and the number of changed files. Pure, for tests. */
export function statusLine(save: SaveState, changedFiles: number): { text: string; tone: StatusTone } {
  if (save.status === 'saving') return { text: 'Saving', tone: 'busy' };
  if (save.status === 'error') return { text: save.message ?? 'Not saved.', tone: 'error' };
  if (changedFiles > 0) return { text: `Unsaved changes in ${plural(changedFiles, 'file')}`, tone: 'dirty' };
  if (save.status === 'saved') return { text: save.message ?? 'Saved.', tone: 'ok' };
  return { text: 'No unsaved changes', tone: 'idle' };
}

function PreviewLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="adm-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ExternalLink size={14} aria-hidden="true" className="adm-link__icon" />
      <span className="adm-sr"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * The draft's preview under the status line (ARCHITECTURE.md 7.1 and 7.6): once a save made a
 * commit, the preview address of the draft branch and the state of its build; otherwise how many
 * saved commits are not yet published. On disk there is no draft, and it says so.
 */
function DeployLine({ deploy }: { deploy: DeployView }) {
  const info = useAdmin((s) => s.info);
  if (!info) return null;
  if (info.source === 'disk') return <p className="adm-savebar__deploy">Saves write to the content files on this computer.</p>;
  // The deployment's own address once known, else the branch's preview address from the load or the save.
  const url = deploy.url ?? info.preview?.url ?? null;
  const link = (words: string) =>
    url ? (
      <>
        {' '}
        <PreviewLink href={url}>{words}</PreviewLink>
      </>
    ) : null;
  let line: ReactNode = null;
  switch (deploy.phase) {
    case 'waiting':
      line = (
        <>
          Draft preview: waiting for the build of commit {shortSha(deploy.commit)}; until it is ready the preview shows the previous build.
          {link('Open the draft preview')}
        </>
      );
      break;
    case 'building':
      line = (
        <>
          Draft preview: building commit {shortSha(deploy.commit)}; until it is ready the preview shows the previous build.
          {link('Open the draft preview')}
        </>
      );
      break;
    case 'ready':
      line = <>Draft preview ready.{link('Open the draft preview')}</>;
      break;
    case 'failed':
      line = <>The draft preview build failed; Publish stays disabled until a build succeeds.{link('See the build')}</>;
      break;
    case 'unknown':
      line = (
        <>
          {deploy.detail ?? 'The preview build state is not known.'}
          {link('Open the draft preview')}
        </>
      );
      break;
    default:
      if (info.draftAhead > 0) line = <>{plural(info.draftAhead, 'saved commit')} on the draft not yet published.{link('Open the draft preview')}</>;
  }
  return line ? (
    <p className="adm-savebar__deploy" aria-live="polite">
      {line}
    </p>
  ) : null;
}

export function SaveBar({ deploy, sessionEnded, onSave, onPublish, onDiscard, onSignIn, onReload }: SaveBarProps) {
  const changed = useChangedFiles();
  const save = useAdmin((s) => s.save);
  const source = useAdmin((s) => s.info?.source ?? null);
  const listId = useId();
  const [mod, setMod] = useState('Ctrl');
  const [showFindings, setShowFindings] = useState(true);

  useEffect(() => setMod(isMac() ? 'Cmd' : 'Ctrl'), []);
  // A refused save opens its list; the warnings of a successful one start folded.
  useEffect(() => setShowFindings(save.status === 'error'), [save.status, save.findings, save.warnings]);
  useShortcuts({ save: onSave });

  const status = statusLine(save, changed.length);
  const saving = save.status === 'saving';
  const findings = save.status === 'error' ? save.findings : save.status === 'saved' ? save.warnings : [];
  const github = source === 'github';

  return (
    <div className="adm-savebar" role="region" aria-label="Save and publish">
      {findings.length > 0 ? (
        <div className="adm-savebar__findings">
          <button type="button" className="adm-savebar__toggle" aria-expanded={showFindings} aria-controls={listId} onClick={() => setShowFindings(!showFindings)}>
            {save.status === 'error'
              ? `${showFindings ? 'Hide' : 'Show'} the ${plural(findings.length, 'problem')} that stopped the save`
              : `${showFindings ? 'Hide' : 'Show'} ${plural(findings.length, 'warning')} from the last save`}
          </button>
          <div id={listId} className="adm-savebar__list" hidden={!showFindings}>
            <FindingsList findings={findings} label={save.status === 'error' ? 'Problems that stopped the save' : 'Warnings from the last save'} />
          </div>
        </div>
      ) : null}
      {sessionEnded ? (
        <div className="adm-savebar__session">
          <span>Your session has ended. Sign in again before saving; your changes stay here.</span>
          <Button size="sm" onClick={onSignIn}>
            Sign in
          </Button>
        </div>
      ) : null}
      <StaleNotice unsavedFiles={changed.length} onReload={onReload} />
      <div className="adm-savebar__main">
        <div className="adm-savebar__status">
          <StatusText text={status.text} tone={status.tone} />
          <DeployLine deploy={deploy} />
        </div>
        <div className="adm-savebar__actions">
          <UndoRedo />
          {github ? (
            <>
              <Button icon={<Trash2 size={16} />} onClick={onDiscard} disabled={saving}>
                Discard
              </Button>
              <Button icon={<Rocket size={16} />} onClick={onPublish} disabled={saving}>
                Publish
              </Button>
            </>
          ) : null}
          <Button
            variant="primary"
            icon={<Save size={16} />}
            busy={saving}
            disabled={changed.length === 0}
            onClick={onSave}
            title={`Save (${mod}+S)`}
            aria-keyshortcuts="Control+S Meta+S"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
