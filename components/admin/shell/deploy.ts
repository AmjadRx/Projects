'use client';

/**
 * The draft's preview build after a save (ARCHITECTURE.md 7.6). A save that made a commit starts
 * a watch: /api/status is polled every 10 seconds for up to five minutes, until the draft's
 * latest deployment for that commit is ready (with its address) or has failed. The poll is quiet:
 * an ended session stops it without opening the sign-in dialog.
 */
import { useEffect, useState } from 'react';
import type { StatusResponse } from '@/lib/admin/contract';
import { api, isApiError } from '../state/api';

export const DEPLOY_FIRST_POLL_MS = 5_000;
export const DEPLOY_POLL_MS = 10_000;
export const DEPLOY_WATCH_MS = 5 * 60_000;

export interface DeployView {
  phase: 'idle' | 'waiting' | 'building' | 'ready' | 'failed' | 'unknown';
  /** The preview's address: the deployment's own, or the branch's preview address. */
  url: string | null;
  /** A plain sentence when the state cannot be known. */
  detail: string | null;
  /** The commit being watched. */
  commit: string | null;
}

export const IDLE_DEPLOY: DeployView = { phase: 'idle', url: null, detail: null, commit: null };

/** What /api/status says about the build of `commit`. Pure, for tests. */
export function deployViewOf(status: StatusResponse, commit: string): DeployView {
  const draft = status.deploy.draft;
  const branchUrl = status.preview?.url ?? null;
  if (!draft) return { phase: 'unknown', url: branchUrl, detail: status.deploy.detail, commit };
  if (draft.sha && draft.sha !== commit) return { phase: 'waiting', url: branchUrl, detail: null, commit };
  const url = draft.url ?? branchUrl;
  switch (draft.state) {
    case 'queued':
    case 'building':
      return { phase: 'building', url, detail: null, commit };
    case 'ready':
      return { phase: 'ready', url, detail: null, commit };
    case 'error':
    case 'canceled':
      return { phase: 'failed', url, detail: null, commit };
    default:
      return { phase: 'unknown', url, detail: status.deploy.detail, commit };
  }
}

/** Watches the preview build of `commit` while `enabled` (the content comes from GitHub). */
export function useDeployWatch(commit: string | null, enabled: boolean): DeployView {
  const [view, setView] = useState<DeployView>(IDLE_DEPLOY);

  useEffect(() => {
    if (!enabled || !commit) {
      setView(IDLE_DEPLOY);
      return;
    }
    const controller = new AbortController();
    const started = Date.now();
    let timer = 0;
    let stopped = false;
    setView({ phase: 'waiting', url: null, detail: null, commit });

    const poll = async () => {
      const answer = await api.status({ quiet: true, signal: controller.signal });
      if (stopped) return;
      if (isApiError(answer)) {
        if (answer.code === 'unauthorized') {
          setView((v) => ({ ...v, phase: 'unknown', detail: 'Sign in again to see the preview build.' }));
          return;
        }
        // A failed poll keeps the last state and tries again.
      } else {
        const next = deployViewOf(answer, commit);
        setView(next);
        if (next.phase === 'ready' || next.phase === 'failed' || answer.deploy.source === 'none') return;
      }
      if (Date.now() - started + DEPLOY_POLL_MS > DEPLOY_WATCH_MS) {
        setView((v) => ({
          ...v,
          phase: 'unknown',
          detail: 'No finished preview build after five minutes. The status panel in Settings shows the latest state.',
        }));
        return;
      }
      timer = window.setTimeout(() => void poll(), DEPLOY_POLL_MS);
    };
    timer = window.setTimeout(() => void poll(), DEPLOY_FIRST_POLL_MS);

    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [commit, enabled]);

  return view;
}
