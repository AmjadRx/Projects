'use client';

/**
 * Discard (ARCHITECTURE.md 7.1): resets the draft branch to the published branch, after a plain
 * warning of what is lost. Blob files stay in the store (docs/V3_PLAN.md D-27).
 *
 * Opening the dialog asks the server for the draft as it is now (GET /api/publish): its head and
 * how many saved commits are not published, which the warning shows. Confirming sends that head,
 * so a save made in another window after the dialog opened is never discarded unseen: the server
 * answers 409 conflict, and the dialog shows the draft as it is now for a second look.
 */
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { DiscardResponse, PublishPlan } from '@/lib/admin/contract';
import { api, isApiError, withReauth } from '../state/api';
import { useAdmin } from '../state/hooks';
import { Notice } from '../ui/bits';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useChangedFiles } from './changes';
import { plural, shortSha } from './format';

/** What the dialog says the discard removes from the draft. Pure, for tests. */
export function discardLine(plan: Pick<PublishPlan, 'draftHead' | 'ahead' | 'files'>): string {
  if (!plan.draftHead || plan.ahead === 0) return 'The draft has no saved changes that are not published, so the branch stays as it is.';
  const files = plan.files.length > 0 ? `, changing ${plural(plan.files.length, 'file')},` : '';
  return `${plural(plan.ahead, 'saved commit')} not yet published${files} ${plan.ahead === 1 ? 'is' : 'are'} removed from the draft (now at commit ${shortSha(plan.draftHead)}).`;
}

export function DiscardDialog({ open, onClose, onDiscarded }: { open: boolean; onClose: () => void; onDiscarded: (answer: DiscardResponse) => void }) {
  const info = useAdmin((s) => s.info);
  const changed = useChangedFiles();
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  // The draft as it is now, each time the dialog opens and after a refused discard.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPlan(null);
    setLoadError(null);
    void withReauth(() => api.publishPlan()).then((answer) => {
      if (!live) return;
      if (isApiError(answer)) setLoadError(answer.error);
      else setPlan(answer);
    });
    return () => {
      live = false;
    };
  }, [open, round]);

  const draft = info?.draftBranch ?? 'the draft branch';
  const live = info?.liveBranch ?? 'the published branch';

  const discard = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const head = plan.draftHead;
    const answer = await withReauth(() => api.discard(head));
    setBusy(false);
    if (!isApiError(answer)) {
      onDiscarded(answer);
      return;
    }
    setError(answer.error);
    // The draft moved since the dialog showed it: show it as it is now, for a second look.
    if (answer.code === 'conflict') setRound((n) => n + 1);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      role="alertdialog"
      title="Discard the draft?"
      description={`This resets ${draft} to ${live}. Undo cannot bring it back.`}
      footer={
        <>
          <Button data-autofocus onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={<Trash2 size={16} />} busy={busy} disabled={!plan} onClick={() => void discard()}>
            Discard the draft
          </Button>
        </>
      }
    >
      <ul className="adm-plainlist">
        <li>{plan ? discardLine(plan) : loadError ? 'The draft could not be checked, so nothing can be discarded yet.' : 'Checking the draft.'}</li>
        {changed.length > 0 ? <li>Unsaved changes in {plural(changed.length, 'file')} are lost.</li> : null}
        <li>Files already uploaded to Blob stay in the store; the media library lists them as not used anywhere, so you can delete them.</li>
      </ul>
      {loadError ? (
        <Notice tone="error" title="Could not check the draft" live>
          {loadError}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" title="Not discarded" live>
          {error}
        </Notice>
      ) : null}
    </Dialog>
  );
}
