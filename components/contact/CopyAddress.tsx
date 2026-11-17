'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { UI } from '@/lib/strings';

/** Copies the email address, and says so in words for screen readers and sighted visitors. */
export default function CopyAddress({ address }: { address: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button type="button" onClick={copy} className="btn-ghost">
        {state === 'copied' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        {UI.contact.copyAddress}
      </button>
      <span aria-live="polite" className="text-sm text-ink-dim">
        {state === 'copied' ? UI.contact.copied : state === 'failed' ? UI.contact.copyFailed : ''}
      </span>
    </span>
  );
}
