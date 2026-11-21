'use client';

/**
 * The admin's two layers.
 *
 * `Shell` is the gate: it asks GET /api/auth on load. 503 not-configured shows the SetupNotice
 * with the missing variable names, 401 shows the Login, and a session opens the Editor.
 *
 * `Editor` is the signed-in admin: it loads the content into the store, renders the tab from the
 * URL hash (SiteTabPanel inside FileScope for content/site.json, or ProjectsPanel), and runs the
 * save bar, Save, Publish, Discard, the sign-in-again dialog, the session watcher, the reveal
 * handler, the deploy watch, the reload offered when files changed on the draft elsewhere, and
 * the warning before leaving with unsaved changes.
 */
import { useCallback, useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { SITE_FILE, type ApiError, type Finding, type PublishPlan, type SessionState } from '@/lib/admin/contract';
import type { TabId } from '@/lib/admin/locate';
import { ProjectsPanel } from '../projects';
import { SiteTabPanel } from '../tabs';
import { api, isApiError, sessionGate, withReauth } from '../state/api';
import { FileScope, useAdmin, useAdminStore } from '../state/hooks';
import { Notice } from '../ui/bits';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/Confirm';
import { useChangedFiles } from './changes';
import { ConflictDialog } from './ConflictDialog';
import { useDeployWatch } from './deploy';
import { DiscardDialog } from './DiscardDialog';
import { FindingsList } from './FindingsList';
import { plural } from './format';
import { AdminLayout, Waiting } from './Layout';
import { Login } from './Login';
import { PublishDialog } from './PublishDialog';
import { ReloginDialog } from './ReloginDialog';
import { useRevealHandler } from './reveal';
import { useAdminRoute } from './route';
import { runSave } from './saveFlow';
import { SaveBar } from './SaveBar';
import { useSessionWatcher } from './session';
import { SetupNotice } from './SetupNotice';

type Gate =
  | { phase: 'checking' }
  | { phase: 'setup'; missing: string[]; message: string }
  | { phase: 'signed-out' }
  | { phase: 'unreachable'; message: string }
  | { phase: 'signed-in'; expiresAt: number };

export function Shell() {
  const [gate, setGate] = useState<Gate>({ phase: 'checking' });

  const check = useCallback(async () => {
    setGate({ phase: 'checking' });
    const answer = await api.session();
    if (!isApiError(answer)) setGate({ phase: 'signed-in', expiresAt: answer.expiresAt });
    else if (answer.code === 'not-configured') setGate({ phase: 'setup', missing: answer.missing ?? [], message: answer.error });
    else if (answer.code === 'unauthorized') setGate({ phase: 'signed-out' });
    else setGate({ phase: 'unreachable', message: answer.error });
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  switch (gate.phase) {
    case 'checking':
      return (
        <main className="adm-gate">
          <Waiting text="Checking the session" />
        </main>
      );
    case 'setup':
      return <SetupNotice missing={gate.missing} message={gate.message} />;
    case 'signed-out':
      return <Login onSignedIn={(session) => setGate({ phase: 'signed-in', expiresAt: session.expiresAt })} />;
    case 'unreachable':
      return (
        <main className="adm-gate">
          <div className="adm-gate__card">
            <h1 className="adm-gate__title">The admin could not start</h1>
            <Notice tone="error" actions={<Button icon={<RotateCw size={16} />} onClick={() => void check()}>Try again</Button>}>
              {gate.message}
            </Notice>
          </div>
        </main>
      );
    case 'signed-in':
      return (
        <Editor
          expiresAt={gate.expiresAt}
          onSession={(expiresAt) => setGate({ phase: 'signed-in', expiresAt })}
          onSignedOut={() => setGate({ phase: 'signed-out' })}
        />
      );
  }
}

const NO_FINDINGS: Finding[] = [];

/** The tab's editor: projects, or a site tab inside the FileScope of content/site.json. */
function TabPanel({ tab }: { tab: TabId }) {
  const loadFindings = useAdmin((s) => s.info?.loadFindings ?? NO_FINDINGS);
  return (
    <>
      {loadFindings.length > 0 ? (
        <Notice tone="error" title={`${plural(loadFindings.length, 'problem')} in the stored content`}>
          <p>These files do not pass schema version 3, so they cannot be saved until they are fixed.</p>
          <FindingsList findings={loadFindings} />
        </Notice>
      ) : null}
      {tab === 'projects' ? (
        <ProjectsPanel />
      ) : (
        <FileScope file={SITE_FILE}>
          <SiteTabPanel key={tab} tab={tab} />
        </FileScope>
      )}
    </>
  );
}

export function Editor({
  expiresAt,
  onSession,
  onSignedOut,
}: {
  expiresAt: number;
  onSession: (expiresAt: number) => void;
  onSignedOut: () => void;
}) {
  const store = useAdminStore();
  const confirm = useConfirm();
  const { tab, go } = useAdminRoute();
  const phase = useAdmin((s) => s.phase);
  const loadError = useAdmin((s) => s.loadError);
  const source = useAdmin((s) => s.info?.source ?? null);
  const commit = useAdmin((s) => s.save.commit);
  const changed = useChangedFiles();

  const [relogin, setRelogin] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [conflict, setConflict] = useState<ApiError | null>(null);
  const [dialog, setDialog] = useState<'publish' | 'discard' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A 401 anywhere opens the sign-in dialog; whoever waits on the gate retries once it is answered.
  useEffect(() => sessionGate.subscribe(() => setRelogin(true)), []);
  useSessionWatcher(expiresAt, () => setSessionEnded(true), onSession);

  const load = useCallback(async () => {
    store.begin();
    const answer = await withReauth(() => api.content());
    if (isApiError(answer)) store.fail(answer.error);
    else store.load(answer);
  }, [store]);

  useEffect(() => {
    void load();
  }, [load]);

  useRevealHandler(go);
  const deploy = useDeployWatch(commit, source === 'github');

  const save = useCallback(() => {
    void runSave({
      store,
      save: (body) => api.save(body),
      reauthenticate: () => sessionGate.wait(),
      onConflict: setConflict,
    });
  }, [store]);

  // Leaving the page with unsaved changes asks first.
  const dirty = changed.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const signOut = async () => {
    if (changed.length > 0) {
      const ok = await confirm({
        title: 'Sign out with unsaved changes?',
        message: `Your unsaved changes in ${plural(changed.length, 'file')} are lost when you sign out.`,
        confirmLabel: 'Sign out',
        tone: 'danger',
      });
      if (!ok) return;
    }
    await api.logout();
    onSignedOut();
  };

  const signedInAgain = (session: SessionState) => {
    setRelogin(false);
    setSessionEnded(false);
    onSession(session.expiresAt);
    sessionGate.settle(true);
  };

  const cancelSignIn = () => {
    setRelogin(false);
    setSessionEnded(true);
    sessionGate.settle(false);
  };

  const afterPublish = async (plan: PublishPlan) => {
    setDialog(null);
    await load();
    setNotice(`Published: ${plan.liveBranch} now matches the draft, and the live site is rebuilding.`);
  };

  const afterDiscard = async () => {
    setDialog(null);
    await load();
    setNotice('The draft was discarded. The editor now shows the published content.');
  };

  const reloadAfterConflict = async () => {
    setConflict(null);
    await load();
  };

  return (
    <>
      <AdminLayout
        tab={tab}
        onSignOut={() => void signOut()}
        saveBar={
          phase === 'ready' ? (
            <SaveBar
              deploy={deploy}
              sessionEnded={sessionEnded}
              onSave={save}
              onPublish={() => setDialog('publish')}
              onDiscard={() => setDialog('discard')}
              onSignIn={() => sessionGate.notify()}
              onReload={() => void load()}
            />
          ) : null
        }
      >
        {notice ? (
          <Notice
            tone="ok"
            live
            className="adm-panel__notice"
            actions={
              <Button size="sm" onClick={() => setNotice(null)}>
                Dismiss
              </Button>
            }
          >
            {notice}
          </Notice>
        ) : null}
        {phase === 'error' ? (
          <Notice
            tone="error"
            title="Could not load the content"
            actions={
              <Button icon={<RotateCw size={16} />} onClick={() => void load()}>
                Try again
              </Button>
            }
          >
            {loadError}
          </Notice>
        ) : phase === 'ready' ? (
          <TabPanel tab={tab} />
        ) : (
          <Waiting text="Loading the content" />
        )}
      </AdminLayout>
      <ReloginDialog open={relogin} onSignedIn={signedInAgain} onCancel={cancelSignIn} />
      <ConflictDialog error={conflict} onReload={() => void reloadAfterConflict()} onKeep={() => setConflict(null)} />
      <PublishDialog
        open={dialog === 'publish'}
        onClose={() => setDialog(null)}
        onPublished={(_, plan) => void afterPublish(plan)}
        onDraftUpdated={load}
      />
      <DiscardDialog open={dialog === 'discard'} onClose={() => setDialog(null)} onDiscarded={() => void afterDiscard()} />
    </>
  );
}
