'use client';

/**
 * Signing in (ARCHITECTURE.md 11): the full-page Login, and the PasswordForm it shares with the
 * ReloginDialog. A wrong password says so; after five wrong passwords from one address in ten
 * minutes the server locks that address, and the form counts down the wait (`retryAfter`)
 * with the button disabled.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import type { SessionState } from '@/lib/admin/contract';
import { api, isApiError } from '../state/api';
import { Button } from '../ui/Button';
import { Notice } from '../ui/bits';
import { countdown } from './format';

export interface PasswordFormProps {
  onSignedIn: (session: SessionState) => void;
  submitLabel?: string;
  /** A Cancel button for the dialog version. */
  cancel?: ReactNode;
}

/** The password field and the Sign in button, with the error and lockout messages. */
export function PasswordForm({ onSignedIn, submitLabel = 'Sign in', cancel }: PasswordFormProps) {
  const inputId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockMinutes, setLockMinutes] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (lockedUntil === null) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        setLockedUntil(null);
        setError(null);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  const locked = lockedUntil !== null;
  const remaining = locked ? (lockedUntil - now) / 1000 : 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || locked || password === '') return;
    setBusy(true);
    setError(null);
    const answer = await api.login(password);
    setBusy(false);
    if (!isApiError(answer)) {
      setPassword('');
      onSignedIn(answer);
      return;
    }
    if (answer.code === 'locked') {
      const seconds = answer.retryAfter ?? 600;
      setNow(Date.now());
      setLockMinutes(Math.max(1, Math.ceil(seconds / 60)));
      setLockedUntil(Date.now() + seconds * 1000);
      return;
    }
    setError(answer.code === 'unauthorized' ? 'Wrong password.' : answer.error);
    input.current?.select();
  };

  return (
    <form className="adm-login" onSubmit={submit} noValidate>
      <div className="adm-field">
        <label htmlFor={inputId} className="adm-field__label">
          Password
        </label>
        <input
          ref={input}
          id={inputId}
          name="password"
          type="password"
          className="adm-input"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          disabled={locked}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || locked ? errorId : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div id={errorId} aria-live="polite">
        {error ? (
          <Notice tone="error" className="adm-login__msg">
            {error}
          </Notice>
        ) : null}
        {locked ? (
          <Notice tone="warning" className="adm-login__msg" title="Too many wrong passwords from this address.">
            Sign-in is paused for this address for up to {lockMinutes === 1 ? '1 minute' : `${lockMinutes} minutes`}.{' '}
            <span aria-hidden="true">Try again in {countdown(remaining)}.</span>
          </Notice>
        ) : null}
      </div>
      <div className="adm-login__actions">
        {cancel}
        <Button type="submit" variant="primary" icon={<LogIn size={16} />} busy={busy} disabled={locked || password === ''}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** The sign-in page: shown when there is no session. */
export function Login({ onSignedIn }: { onSignedIn: (session: SessionState) => void }) {
  return (
    <main className="adm-gate">
      <div className="adm-gate__card">
        <h1 className="adm-gate__title">Admin</h1>
        <p className="adm-gate__text">Sign in to edit the site.</p>
        <PasswordForm onSignedIn={onSignedIn} />
        <p className="adm-gate__foot">
          <a className="adm-link" href="/">
            Back to the site
          </a>
        </p>
      </div>
    </main>
  );
}
