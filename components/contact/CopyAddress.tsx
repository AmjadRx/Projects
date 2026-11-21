'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/sheet/Icon';

export interface CopyAddressLabels {
  /** The button's accessible name and tooltip ("Copy address"). */
  copy: string;
  /** Said once the address is on the clipboard. */
  copied: string;
  /** Said when the browser refuses the clipboard. */
  failed: string;
}

/** How long the button shows its check mark and the status its words. */
const COPIED_MS = 2400;

/**
 * The copy action beside the email button (the bundle's 44 px icon button, the Contact board): it
 * copies the address and says so in words in a polite status, for screen readers and sighted
 * visitors alike. The check mark and the words go back after a moment; a failure stays, so the
 * visitor can read how to copy the address by hand. Every word comes from the server as a prop.
 */
export default function CopyAddress({ address, labels }: { address: string; labels: CopyAddressLabels }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(address);
      setState('copied');
      timer.current = window.setTimeout(() => setState('idle'), COPIED_MS);
    } catch {
      setState('failed');
    }
  };

  return (
    <>
      <button type="button" className="ar-iconbtn" onClick={copy} aria-label={labels.copy} title={labels.copy}>
        <Icon icon={state === 'copied' ? Check : Copy} size={20} />
      </button>
      <span className="st-copied" role="status">
        {state === 'copied' ? labels.copied : state === 'failed' ? labels.failed : ''}
      </span>
    </>
  );
}
