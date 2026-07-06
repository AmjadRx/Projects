'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface Status {
  runtime: { nodeEnv: string; vercelEnv: string | null; host: string };
  env: {
    adminPasswordSet: boolean;
    githubTokenSet: boolean;
    githubTokenType: string | null;
    githubRepo: string | null;
    githubBranch: string;
  };
  github: null | {
    ok: boolean;
    status?: number;
    detail: string;
    writeAccess?: boolean;
    branchExists?: boolean;
  };
}

function Row({ label, ok, value }: { label: string; ok: boolean | null; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
      <span className="kicker pt-0.5">{label}</span>
      <span
        className={`text-right font-mono text-xs ${
          ok === null ? 'text-ink-mute' : ok ? 'text-accent' : 'text-red-400'
        }`}
      >
        {ok === true && '✓ '}
        {ok === false && '✗ '}
        {value}
      </span>
    </div>
  );
}

/** Live CMS diagnostics: what the server sees + a real GitHub API test. */
export default function ConnectionStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const envLabel = status
    ? status.runtime.vercelEnv ?? status.runtime.nodeEnv
    : '';
  const onPreview = status?.runtime.vercelEnv === 'preview';

  return (
    <div className="card p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">CMS connection</h3>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-mute hover:text-accent disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Test
        </button>
      </div>

      {error && <p className="font-mono text-xs text-red-400">⚠ {error}</p>}

      {status && (
        <>
          <Row
            label="Deployment"
            ok={null}
            value={`${status.runtime.host} · ${envLabel}`}
          />
          <Row
            label="ADMIN_PASSWORD"
            ok={status.env.adminPasswordSet}
            value={status.env.adminPasswordSet ? 'set' : 'missing (built-in fallback active)'}
          />
          <Row
            label="GITHUB_TOKEN"
            ok={status.env.githubTokenSet}
            value={
              status.env.githubTokenSet
                ? `set (${status.env.githubTokenType})`
                : 'missing at runtime'
            }
          />
          <Row
            label="GITHUB_REPO"
            ok={Boolean(status.env.githubRepo)}
            value={status.env.githubRepo ?? 'missing at runtime'}
          />
          <Row label="Branch" ok={null} value={status.env.githubBranch} />
          {status.github ? (
            <Row
              label="GitHub API"
              ok={status.github.ok}
              value={status.github.detail}
            />
          ) : (
            <Row label="GitHub API" ok={false} value="Not tested: token or repo missing" />
          )}

          {(!status.env.githubTokenSet || !status.env.githubRepo) && (
            <p className="mt-3 text-xs leading-relaxed text-ink-dim">
              The server cannot see these variables. On Vercel: Project → Settings →
              Environment Variables → make sure each variable is enabled for the
              <strong> {onPreview ? 'Preview' : 'Production'}</strong> environment
              {onPreview && ' (you are on a preview deployment right now — Production-only variables do not apply here)'}
              , then trigger a new deploy. Variables never apply to deployments made before they were added.
            </p>
          )}
        </>
      )}
    </div>
  );
}
