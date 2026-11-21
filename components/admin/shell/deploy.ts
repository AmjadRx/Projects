'use client';

/**
 * The draft's preview build after a save (ARCHITECTURE.md 7.6). A save that made a commit starts
 * a watch: /api/status is polled every 10 seconds until the build of the commit waited for is
 * ready (with its address) or has failed, or five minutes pass without either. The poll is quiet:
 * an ended session stops it without opening the sign-in dialog.
 *
 * The commit waited for is the newest draft head. Every media upload and delete is its own
 * commit, and so is another save, so the head can move past the saved commit while its build
 * runs; only the newest head's build becomes the draft preview. When an answer names a newer
 * head that holds the commit followed so far (among the draft's unpublished commits), the watch
 * waits for that one and its five minutes start again; a head without it (a stale read, a discard
 * elsewhere) is never followed. Twenty minutes after the save the watch stops in any case.
 */
import { useEffect, useState } from 'react';
import type { ApiResult, StatusResponse } from '@/lib/admin/contract';
import { api, isApiError } from '../state/api';
import { shortSha } from './format';

export const DEPLOY_FIRST_POLL_MS = 5_000;
export const DEPLOY_POLL_MS = 10_000;
export const DEPLOY_WATCH_MS = 5 * 60_000;
/** However often the draft head moves, the watch stops this long after the save. */
export const DEPLOY_WATCH_LIMIT_MS = 20 * 60_000;

const SEE_PANEL = 'The status panel in Settings shows the latest state.';

export const DEPLOY_WATCH_MESSAGES = {
  signedOut: 'Sign in again to see the preview build.',
  timedOut: (commit: string) => `No finished preview build of commit ${shortSha(commit)} after five minutes. ${SEE_PANEL}`,
  unreadState: (commit: string, why: string) =>
    `The state of the preview build of commit ${shortSha(commit)} could not be read, so this bar stopped waiting for it ` +
    `after five minutes. ${why} ${SEE_PANEL}`,
  unread: `The draft's newest commits could not be read for five minutes, so the state of its preview build is not known. ${SEE_PANEL}`,
  left: (commit: string) =>
    `The draft no longer lists commit ${shortSha(commit)} among its unpublished commits (a publish or a discard elsewhere ` +
    `does that), so this bar stopped following its preview build. ${SEE_PANEL}`,
  limit: (commit: string) =>
    `The draft kept changing, so this bar stopped following its preview builds after twenty minutes; the newest it ` +
    `followed is commit ${shortSha(commit)}. ${SEE_PANEL}`,
} as const;

export interface DeployView {
  phase: 'idle' | 'waiting' | 'building' | 'ready' | 'failed' | 'unknown';
  /** The preview's address: the deployment's own, or the branch's preview address. */
  url: string | null;
  /** A plain sentence when the state cannot be known. */
  detail: string | null;
  /** The commit being watched: the saved commit, then the newest draft head. */
  commit: string | null;
}

export const IDLE_DEPLOY: DeployView = { phase: 'idle', url: null, detail: null, commit: null };

/** What /api/status says about the build of `commit`, the draft head it names. Pure, for tests. */
export function deployViewOf(status: StatusResponse, commit: string): DeployView {
  const draft = status.deploy.draft;
  const branchUrl = status.preview?.url ?? null;
  if (!draft || (draft.sha && draft.sha !== commit)) {
    // No deployment of this commit: when the lookup answered for it, its build has not started
    // yet; otherwise the answer says why its state cannot be read.
    const why = status.deploy.source === 'none' ? status.deploy.detail : status.deploy.draftUnknown;
    return why ? { phase: 'unknown', url: branchUrl, detail: why, commit } : { phase: 'waiting', url: branchUrl, detail: null, commit };
  }
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

export interface DeployWatchDeps {
  /** One quiet GET /api/status. */
  status: (signal: AbortSignal) => Promise<ApiResult<StatusResponse>>;
  /** Receives every view the watch shows. */
  show: (view: DeployView) => void;
  /** The time in milliseconds; Date.now by default. */
  now?: () => number;
}

/**
 * The watch of `commit` and of the draft heads after it: the work of `useDeployWatch`, without
 * React, so tests can drive it. Returns a function that stops it.
 *
 * A head is followed only when the answer shows it holds the commit followed so far: it is that
 * commit, or that commit is among the draft's unpublished commits. So every head followed holds
 * the saved commit, and only an answer that names such a head may end the wait with a timeout,
 * for that head. A failed poll, an answer that could not read the head or its commits, and a head
 * without the followed commit keep the last state and poll again; five minutes without a head to
 * follow end the watch with a sentence that says which of these it was.
 */
export function watchDeploy(commit: string, deps: DeployWatchDeps): () => void {
  const now = deps.now ?? Date.now;
  const controller = new AbortController();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let target = commit;
  // When the watch began, when the wait for `target` began, and when an answer last named a head to follow.
  const started = now();
  let since = started;
  let heard = started;
  // Whether the last answer that named a head showed it lacks `target`, and why the last answer
  // that named `target` could not read its build state (null when it could).
  let lacks = false;
  let stateUnread: string | null = null;
  let view: DeployView = { phase: 'waiting', url: null, detail: null, commit };
  const show = (next: DeployView) => {
    view = next;
    deps.show(next);
  };
  show(view);

  const poll = async () => {
    const answer = await deps.status(controller.signal);
    if (stopped) return;
    if (isApiError(answer) && answer.code === 'unauthorized') {
      show({ ...view, phase: 'unknown', detail: DEPLOY_WATCH_MESSAGES.signedOut });
      return;
    }
    const read = isApiError(answer) ? null : answer;
    const named = read?.github.draftHead ?? null;
    // Whether the named head holds `target`: true, false, or null when the answer does not show it.
    const holds = named === null ? null : named === target || (read?.github.draftCommits?.includes(target) ?? null);
    const head = holds ? named : null;
    if (named) lacks = holds === false;
    if (head && read) {
      heard = now();
      stateUnread = read.deploy.draftUnknown ?? null;
      if (head !== target) {
        target = head;
        since = heard;
      }
    }
    if (read && (head || read.deploy.source === 'none')) {
      const next = deployViewOf(read, target);
      show(next);
      if (next.phase === 'ready' || next.phase === 'failed' || read.deploy.source === 'none') return;
    }
    if (head && heard - since + DEPLOY_POLL_MS > DEPLOY_WATCH_MS) {
      const why = stateUnread ? DEPLOY_WATCH_MESSAGES.unreadState(target, stateUnread) : DEPLOY_WATCH_MESSAGES.timedOut(target);
      show({ ...view, phase: 'unknown', detail: why });
      return;
    }
    if (!head && now() - heard + DEPLOY_POLL_MS > DEPLOY_WATCH_MS) {
      show({ ...view, phase: 'unknown', detail: lacks ? DEPLOY_WATCH_MESSAGES.left(target) : DEPLOY_WATCH_MESSAGES.unread });
      return;
    }
    if (now() - started + DEPLOY_POLL_MS > DEPLOY_WATCH_LIMIT_MS) {
      show({ ...view, phase: 'unknown', detail: DEPLOY_WATCH_MESSAGES.limit(target) });
      return;
    }
    timer = setTimeout(() => void poll(), DEPLOY_POLL_MS);
  };
  timer = setTimeout(() => void poll(), DEPLOY_FIRST_POLL_MS);

  return () => {
    stopped = true;
    controller.abort();
    clearTimeout(timer);
  };
}

/**
 * Watches the preview build of `commit`, and of the draft heads after it, while `enabled` (the
 * content comes from GitHub).
 */
export function useDeployWatch(commit: string | null, enabled: boolean): DeployView {
  const [view, setView] = useState<DeployView>(IDLE_DEPLOY);

  useEffect(() => {
    if (!enabled || !commit) {
      setView(IDLE_DEPLOY);
      return;
    }
    return watchDeploy(commit, { status: (signal) => api.status({ quiet: true, signal }), show: setView });
  }, [commit, enabled]);

  return view;
}
