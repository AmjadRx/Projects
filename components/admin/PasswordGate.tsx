'use client';

import { useState } from 'react';

export default function PasswordGate({ onUnlock }: { onUnlock: (password: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-password': value },
        body: '{}',
      });
      if (res.status === 401) {
        setError('Incorrect password.');
        return;
      }
      // 400 (invalid content shape) means password was accepted.
      onUnlock(value);
    } catch (err) {
      setError((err as Error)?.message ?? 'Network error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 md:p-8">
        <div className="font-mono text-xs uppercase tracking-widest text-cyan">⌘ Admin</div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">Sign in</h1>
        <p className="mt-2 text-sm text-ink-dim">
          Shared-secret password. Stored in your session only.
        </p>
        <label className="label mt-6">Password</label>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input"
          placeholder="••••••••"
        />
        {error && <p className="mt-3 font-mono text-xs text-red-400">{error}</p>}
        <button type="submit" disabled={checking || !value} className="btn-primary mt-5 w-full justify-center">
          {checking ? 'Checking…' : 'Unlock'}
        </button>
        <a href="/" className="mt-4 block text-center font-mono text-xs uppercase tracking-widest text-ink-mute hover:text-cyan">
          ← back to site
        </a>
      </form>
    </div>
  );
}
