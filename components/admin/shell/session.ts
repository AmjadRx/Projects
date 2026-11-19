'use client';

/**
 * The session watcher (ARCHITECTURE.md 11: an eight-hour session). When the session's expiry
 * passes, or the tab comes back into view after it, the watcher asks the server; a 401 marks the
 * session as ended. The admin then shows a quiet "Sign in" prompt in the save bar instead of
 * opening a dialog over the owner's typing (which could send typed text into the password field
 * and use up login attempts). The sign-in dialog opens when the owner chooses it, or when an
 * action that needs the server comes back 401.
 */
import { useEffect, useRef } from 'react';
import { api, isApiError } from '../state/api';

/** Checks this long before the expiry when the tab regains focus. */
const NEAR_EXPIRY_MS = 60_000;
/** setTimeout's longest delay. */
const MAX_DELAY_MS = 2_147_000_000;

export function useSessionWatcher(expiresAt: number, onEnded: () => void, onRenewed: (expiresAt: number) => void): void {
  const ended = useRef(onEnded);
  ended.current = onEnded;
  const renewed = useRef(onRenewed);
  renewed.current = onRenewed;

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const answer = await api.session({ quiet: true });
      if (cancelled) return;
      if (isApiError(answer)) {
        if (answer.code === 'unauthorized') ended.current();
        return;
      }
      if (answer.expiresAt !== expiresAt) renewed.current(answer.expiresAt);
    };
    const timer = window.setTimeout(() => void check(), Math.min(Math.max(0, expiresAt - Date.now()) + 1000, MAX_DELAY_MS));
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= expiresAt - NEAR_EXPIRY_MS) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [expiresAt]);
}
