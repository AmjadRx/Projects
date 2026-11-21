'use client';

/**
 * Publish (ARCHITECTURE.md 7.1; docs/V3_PLAN.md D-20, D-27, Q-30). Opening the dialog asks the
 * server what a publish would do (GET /api/publish) and lists it: every changed file with its
 * status, Blob files the draft adds or no longer uses, how many commits are unpublished, and the
 * draft's preview build. When the server says Publish is not allowed, the reasons are listed and
 * the button stays disabled. It is also disabled while the editor has unsaved changes, because a
 * publish reloads the editor from the draft.
 *
 * Confirming sends the draft head shown here, so a save made after the dialog opened cannot slip
 * into the publish; the server refuses a head that moved.
 *
 * Publish waits for the draft head's preview build (queued, building, failed, canceled, or not
 * started yet are reasons); "Check again" asks the server once more. When the build state cannot
 * be read at all, the plan says so (`deployDetail`) and Publish does not wait for it.
 */
import { useEffect, useState } from 'react';
import { RotateCw, Rocket } from 'lucide-react';
import type { PublishPlan, PublishResponse } from '@/lib/admin/contract';
import { api, isApiError, withReauth } from '../state/api';
import { useAdminStore } from '../state/hooks';
import { Badge, Notice } from '../ui/bits';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useChangedFiles } from './changes';
import { deployTone, deployWords, plural, shortSha } from './format';
import { expectedOf } from './saveFlow';

const STATUS_TONE = { added: 'ok', modified: 'info', removed: 'error', renamed: 'warning' } as const;

/** Why Publish cannot run now: the server's reasons, plus unsaved changes and an empty draft. */
export function publishBlockers(plan: PublishPlan, unsavedFiles: number): string[] {
  const reasons = [...plan.reasons];
  if (unsavedFiles > 0) {
    reasons.push(`Save or undo your unsaved changes first (${plural(unsavedFiles, 'file')}): publishing reloads the editor from the draft.`);
  }
  if (reasons.length === 0 && !plan.draftHead) reasons.push('There is no draft to publish.');
  if (reasons.length === 0 && plan.ahead === 0) reasons.push('The draft has nothing the published branch lacks.');
  return reasons;
}

export function PublishDialog({
  open,
  onClose,
  onPublished,
  onDraftUpdated,
}: {
  open: boolean;
  onClose: () => void;
  onPublished: (answer: PublishResponse, plan: PublishPlan) => void;
  /** After "Bring the draft up to date" merged the published branch into the draft: reload the editor. */
  onDraftUpdated: () => Promise<void>;
}) {
  const store = useAdminStore();
  const changed = useChangedFiles();
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPlan(null);
    setLoadError(null);
    setError(null);
    void withReauth(() => api.publishPlan()).then((answer) => {
      if (!live) return;
      if (isApiError(answer)) setLoadError(answer.error);
      else setPlan(answer);
    });
    return () => {
      live = false;
    };
  }, [open, round]);

  /**
   * The published branch moved on after the draft was last saved, so Publish cannot fast-forward
   * (Q-30). A save with no files makes the server merge the published branch into the draft
   * (D-20) without changing anything else; the editor then reloads and the plan is asked again.
   * A merge that conflicts, or merged content that fails the content check, is shown as an error.
   */
  const updateDraft = async () => {
    setBusy(true);
    setError(null);
    const info = store.getState().info;
    const base = info?.head ?? null;
    const expected = expectedOf(info?.stored ?? {}, { writes: [], deletes: [] });
    const answer = await withReauth(() => api.save({ base, files: [], deletes: [], expected }));
    if (isApiError(answer)) {
      setBusy(false);
      setError(answer.error);
      return;
    }
    await onDraftUpdated();
    setBusy(false);
    setRound((n) => n + 1);
  };

  const reasons = plan ? publishBlockers(plan, changed.length) : [];
  const allowed = plan !== null && plan.allowed && plan.draftHead !== null && reasons.length === 0;

  const publish = async () => {
    if (!plan || !plan.draftHead || !allowed) return;
    setBusy(true);
    setError(null);
    const head = plan.draftHead;
    const answer = await withReauth(() => api.publish(head));
    setBusy(false);
    if (isApiError(answer)) {
      setError(answer.error);
      return;
    }
    onPublished(answer, plan);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Publish the draft"
      description="Publishing makes the saved draft the live site. Check the preview first."
      footer={
        <>
          <Button data-autofocus onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Rocket size={16} />} busy={busy} disabled={!allowed} onClick={() => void publish()}>
            Publish
          </Button>
        </>
      }
    >
      {!plan && !loadError ? <p className="adm-muted">Checking what a publish would change.</p> : null}
      {loadError ? (
        <Notice tone="error" title="Could not prepare the publish" live>
          {loadError}
        </Notice>
      ) : null}
      {plan ? <PlanDetails plan={plan} /> : null}
      {plan && reasons.length > 0 ? (
        <Notice
          tone="warning"
          title="Publish is not available yet"
          actions={
            plan.behind > 0 && changed.length === 0 ? (
              <Button busy={busy} onClick={() => void updateDraft()}>
                Bring the draft up to date
              </Button>
            ) : plan.behind === 0 && !plan.allowed ? (
              // A build that is queued, running, or not started yet ends by itself.
              <Button icon={<RotateCw size={16} />} disabled={busy} onClick={() => setRound((n) => n + 1)}>
                Check again
              </Button>
            ) : undefined
          }
        >
          <ul className="adm-plainlist">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" title="Not published" live>
          {error}
        </Notice>
      ) : null}
    </Dialog>
  );
}

function PlanDetails({ plan }: { plan: PublishPlan }) {
  return (
    <div className="adm-plan">
      <p>
        Publishing moves <span className="adm-mono">{plan.liveBranch}</span> forward to <span className="adm-mono">{plan.draftBranch}</span>
        {plan.draftHead ? (
          <>
            {' '}
            at commit <span className="adm-mono">{shortSha(plan.draftHead)}</span>
          </>
        ) : null}
        : {plural(plan.ahead, 'commit')} not yet published. The live site then rebuilds from it.
      </p>

      <h3 className="adm-subhead">Changed files ({plan.files.length})</h3>
      {plan.files.length === 0 ? (
        <p className="adm-muted">No files differ.</p>
      ) : (
        <ul className="adm-changes">
          {plan.files.map((file) => (
            <li key={`${file.status}:${file.path}`}>
              <Badge tone={STATUS_TONE[file.status]}>{file.status}</Badge> <span className="adm-mono adm-break">{file.path}</span>
              {file.previous ? <span className="adm-muted"> (was {file.previous})</span> : null}
            </li>
          ))}
        </ul>
      )}

      {plan.blob.added.length > 0 || plan.blob.removed.length > 0 ? (
        <>
          <h3 className="adm-subhead">Blob files</h3>
          {plan.blob.added.length > 0 ? (
            <>
              <p>The draft starts using {plural(plan.blob.added.length, 'Blob file')}:</p>
              <ul className="adm-changes">
                {plan.blob.added.map((src) => (
                  <li key={src} className="adm-mono adm-break">
                    {src}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {plan.blob.removed.length > 0 ? (
            <>
              <p>
                The live site stops using {plural(plan.blob.removed.length, 'Blob file')}. They stay in the store; the media library lists them
                as not used anywhere, so you can delete them after publishing.
              </p>
              <ul className="adm-changes">
                {plan.blob.removed.map((src) => (
                  <li key={src} className="adm-mono adm-break">
                    {src}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}

      <h3 className="adm-subhead">Draft preview build</h3>
      {plan.deploy ? (
        <p>
          <Badge tone={deployTone(plan.deploy.state)}>{deployWords(plan.deploy.state)}</Badge>
          {plan.deploy.sha ? <span className="adm-mono"> commit {shortSha(plan.deploy.sha)}</span> : null}
          {plan.deploy.url ? (
            <>
              {' '}
              <a className="adm-link" href={plan.deploy.url} target="_blank" rel="noopener noreferrer">
                Open the preview<span className="adm-sr"> (opens in a new tab)</span>
              </a>
            </>
          ) : null}
        </p>
      ) : plan.deployDetail ? (
        <p className="adm-muted">{plan.deployDetail}</p>
      ) : plan.draftHead && plan.ahead > 0 ? (
        <p className="adm-muted">This commit has no preview build yet.</p>
      ) : (
        <p className="adm-muted">The draft&apos;s build state is not known. The status panel in Settings says why.</p>
      )}
      {plan.deploy && plan.deployDetail ? <p className="adm-muted">{plan.deployDetail}</p> : null}
    </div>
  );
}
