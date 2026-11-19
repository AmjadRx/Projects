'use client';

/**
 * The connection-status panel (ARCHITECTURE.md 7, kept; docs/V3_PLAN.md D-31, D-32), rendered by
 * the Settings tab. It shows what /api/status reports, in plain sentences: every variable by name
 * with whether it is set (never a value), the GitHub connection and both branches, storage, the
 * content check, the latest deployment of the draft and the live branch, the draft's preview
 * address, and when the session ends. Refresh asks again.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import type { DeployState, StatusResponse } from '@/lib/admin/contract';
import { api, isApiError, withReauth } from '../state/api';
import { Badge, Notice, Section } from '../ui/bits';
import { Button } from '../ui/Button';
import { dateTimeOf, deployTone, deployWords, megabytes, plural, shortSha, timeOf } from './format';

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="adm-dl__row">
      <dt className="adm-dl__term">{term}</dt>
      <dd className="adm-dl__desc">{children}</dd>
    </div>
  );
}

/** A variable name that may wrap after an underscore on a phone, and never inside a word. */
function VariableName({ name }: { name: string }) {
  const parts = name.split('_');
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? (
            <>
              _<wbr />
            </>
          ) : null}
        </span>
      ))}
    </>
  );
}

function Yes({ value, yes = 'yes', no = 'no' }: { value: boolean | null; yes?: string; no?: string }) {
  if (value === null) return <Badge>not known</Badge>;
  return <Badge tone={value ? 'ok' : 'error'}>{value ? yes : no}</Badge>;
}

function ExternalAddress({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="adm-link adm-link--wrap" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ExternalLink size={14} aria-hidden="true" className="adm-link__icon" />
      <span className="adm-sr"> (opens in a new tab)</span>
    </a>
  );
}

function Deploy({ label, state }: { label: string; state: DeployState | null }) {
  if (!state) return <Row term={label}>No deployment found.</Row>;
  return (
    <Row term={label}>
      <Badge tone={deployTone(state.state)}>{deployWords(state.state)}</Badge>{' '}
      {state.sha ? <span className="adm-mono">commit {shortSha(state.sha)}</span> : null}
      {state.createdAt ? <span className="adm-muted"> {dateTimeOf(state.createdAt)}</span> : null}
      {state.url ? (
        <>
          {' '}
          <ExternalAddress href={state.url}>Open</ExternalAddress>
        </>
      ) : null}
    </Row>
  );
}

function storageSentence(status: StatusResponse): string {
  const { repo } = status.storage;
  if (repo.target === 'github') return 'Small files are committed to the repository through GitHub.';
  if (repo.target === 'disk') return 'Small files are written to public/media on this computer.';
  return `Repository files cannot be stored here${repo.problem ? `: ${repo.problem}` : '.'}`;
}

export function StatusPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    const answer = await withReauth(() => api.status());
    setBusy(false);
    if (isApiError(answer)) setError(answer.error);
    else setStatus(answer);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Section
      title="Connection status"
      description="What this deployment's server sees. Variables are listed by name with whether they are set; no value is ever shown."
      actions={
        <Button size="sm" icon={<RefreshCw size={16} />} onClick={() => void refresh()} busy={busy}>
          Refresh
        </Button>
      }
    >
      {error ? (
        <Notice tone="error" title="Could not read the status" live>
          {error}
        </Notice>
      ) : null}
      {!status && !error ? <p className="adm-muted">Checking</p> : null}
      {status ? <StatusDetails status={status} /> : null}
    </Section>
  );
}

function StatusDetails({ status }: { status: StatusResponse }) {
  const { github, storage, contentCheck, deploy, preview, runtime, session } = status;
  const missingRequired = status.env.filter((v) => v.required && !v.present);
  return (
    <div className="adm-status-panel">
      {missingRequired.length > 0 ? (
        <Notice tone="warning" title={`${plural(missingRequired.length, 'required variable')} not set`}>
          Set {missingRequired.map((v) => v.name).join(', ')} in Vercel (Settings, Environment Variables) for this environment, then
          redeploy. A deployment only sees the variables that existed when it was built.
        </Notice>
      ) : null}

      <h3 className="adm-subhead">Variables</h3>
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">State</th>
              <th scope="col">What it is for</th>
            </tr>
          </thead>
          <tbody>
            {status.env.map((v) => (
              <tr key={v.name}>
                <th scope="row" className="adm-mono">
                  <VariableName name={v.name} />
                </th>
                <td>
                  <Badge tone={v.present ? 'ok' : v.required ? 'error' : 'neutral'}>{v.present ? 'set' : 'missing'}</Badge>
                  {v.required ? null : <span className="adm-muted"> optional</span>}
                </td>
                <td>{v.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="adm-subhead">GitHub</h3>
      <dl className="adm-dl">
        <Row term="Connection">
          {github.configured ? <Yes value={github.ok} yes="working" no="failing" /> : <Badge>not set up</Badge>} {github.detail}
        </Row>
        {github.repo ? (
          <Row term="Repository">
            <span className="adm-mono">{github.repo}</span>
          </Row>
        ) : null}
        {github.tokenKind ? <Row term="Token">{github.tokenKind === 'fine-grained' ? 'Fine-grained token' : `${github.tokenKind} token`}</Row> : null}
        {github.configured ? (
          <Row term="Write access">
            <Yes value={github.writeAccess} />
          </Row>
        ) : null}
        {github.liveBranch ? (
          <Row term="Published branch">
            <span className="adm-mono">{github.liveBranch}</span> <Yes value={github.liveExists} yes="exists" no="missing" />
          </Row>
        ) : null}
        {github.draftBranch ? (
          <Row term="Draft branch">
            <span className="adm-mono">{github.draftBranch}</span> <Yes value={github.draftExists} yes="exists" no="not created yet" />
          </Row>
        ) : null}
        {github.ahead !== null || github.behind !== null ? (
          <Row term="Unpublished">
            The draft has {plural(github.ahead ?? 0, 'commit')} the published branch lacks
            {github.behind ? `, and lacks ${plural(github.behind, 'commit')} the published branch has` : ''}.
          </Row>
        ) : null}
      </dl>

      <h3 className="adm-subhead">Storage</h3>
      <dl className="adm-dl">
        <Row term="Repository files">{storageSentence(status)}</Row>
        <Row term="Vercel Blob">
          {storage.blob.configured ? (
            <>
              <Badge tone="ok">connected</Badge> {storage.blob.host ? <span className="adm-mono">{storage.blob.host}</span> : null}
            </>
          ) : (
            <>
              <Badge>not connected</Badge> Files over {megabytes(storage.limits.repoMaxBytes)} are refused until a Blob store is connected to
              this environment.
            </>
          )}
        </Row>
        <Row term="Limits">
          Repository files up to {megabytes(storage.limits.repoMaxBytes)}; Blob files up to {megabytes(storage.limits.blobMaxBytes)}.
        </Row>
      </dl>

      <h3 className="adm-subhead">Content check</h3>
      <dl className="adm-dl">
        <Row term="Public rules">{plural(contentCheck.publicRules, 'rule')} from content-rules.public.json.</Row>
        <Row term="Private terms">
          {contentCheck.blocklistSet ? (
            <>
              <Badge tone="ok">set</Badge> CONTENT_BLOCKLIST is checked on every save.
            </>
          ) : contentCheck.failClosed ? (
            <>
              <Badge tone="error">missing</Badge> Saves on this deployment are refused until CONTENT_BLOCKLIST is set.
            </>
          ) : (
            <>
              <Badge tone="warning">missing</Badge> Saves here run the public rules only. Add CONTENT_BLOCKLIST to .env.local.
            </>
          )}
        </Row>
      </dl>

      <h3 className="adm-subhead">Deployments</h3>
      <p className="adm-muted">{deploy.detail}</p>
      <dl className="adm-dl">
        <Deploy label="Draft" state={deploy.draft} />
        <Deploy label="Published" state={deploy.live} />
        <Row term="Draft preview">
          {preview?.url ? (
            <ExternalAddress href={preview.url}>{preview.url}</ExternalAddress>
          ) : github.configured ? (
            'The address of the draft preview could not be worked out. Set DRAFT_PREVIEW_URL to name it.'
          ) : (
            'There is no draft branch here: without the GitHub variables, saves write to the content files on this computer.'
          )}
        </Row>
      </dl>

      <h3 className="adm-subhead">This session and server</h3>
      <dl className="adm-dl">
        <Row term="Session">Ends at {timeOf(session.expiresAt)}. Signing in again starts a new eight hours.</Row>
        <Row term="Login lockout">
          <Badge tone={status.security.loginLimit === 'runtime-cache' ? 'ok' : status.runtime.vercelEnv ? 'warning' : 'neutral'}>
            {status.security.loginLimit === 'runtime-cache' ? 'Vercel Runtime Cache' : 'instance memory'}
          </Badge>{' '}
          {status.security.detail}
        </Row>
        <Row term="Environment">
          {runtime.vercelEnv ? `Vercel ${runtime.vercelEnv}` : 'Not on Vercel'}
          {runtime.branch ? (
            <>
              , branch <span className="adm-mono">{runtime.branch}</span>
            </>
          ) : null}
          {runtime.commit ? (
            <>
              , commit <span className="adm-mono">{shortSha(runtime.commit)}</span>
            </>
          ) : null}
          , Node {runtime.node}.
        </Row>
      </dl>
    </div>
  );
}
