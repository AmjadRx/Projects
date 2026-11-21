'use client';

import { Check, Copy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/sheet/Icon';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';

type CopyState = 'idle' | 'copied' | 'failed';

/** How long the button shows the result before it reads "Copy code" again. */
const RESET_MS: Record<Exclude<CopyState, 'idle'>, number> = { copied: 2000, failed: 6000 };

/**
 * The old way to copy, for pages served without HTTPS (a phone testing a dev server on the local
 * network), where the Clipboard API is missing. Returns false when the browser refuses.
 */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  // Off screen without moving the page; 16 px keeps iOS from zooming in.
  Object.assign(area.style, { position: 'fixed', top: '0', left: '-9999px', opacity: '0', fontSize: '16px' });
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/**
 * The code block's copy button (DESIGN_DIRECTION.md 11). It copies the code from its own block,
 * shows "Copied" for two seconds, and announces the result to assistive technology. When copying
 * fails it selects the code so the visitor can copy it by hand, and says so.
 */
export default function CopyButton() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const [state, setState] = useState<CopyState>('idle');
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const schedule = (callback: () => void, ms: number) => {
    timers.current.push(window.setTimeout(callback, ms));
  };

  const copy = async () => {
    const code = buttonRef.current?.closest('[data-code-block]')?.querySelector('pre code');
    const text = code?.textContent ?? '';
    let ok = false;
    if (text !== '') {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        ok = legacyCopy(text);
        buttonRef.current?.focus({ preventScroll: true });
      }
    }
    if (!ok && code) window.getSelection()?.selectAllChildren(code);

    // The same array lives for the whole life of the button, so the unmount cleanup sees every timer.
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.length = 0;
    const result: Exclude<CopyState, 'idle'> = ok ? 'copied' : 'failed';
    setState(result);
    // Clear the live region first, so a second copy is announced again.
    setAnnouncement('');
    schedule(() => setAnnouncement(ok ? UI.viewers.code.copied : UI.viewers.code.copyFailedHint), 60);
    schedule(() => {
      setState('idle');
      setAnnouncement('');
    }, RESET_MS[result]);
  };

  const Glyph = state === 'copied' ? Check : state === 'failed' ? X : Copy;

  return (
    <>
      <button ref={buttonRef} type="button" className="ar-mv__btn ar-mv__btn--text" onClick={copy}>
        <Icon icon={Glyph} size={18} />
        {/* Every label sits in the same cell, so the button keeps its width as the text changes. */}
        <span className="grid">
          <span className={cn('col-start-1 row-start-1', state !== 'idle' && 'invisible')}>{UI.viewers.code.copy}</span>
          <span className={cn('col-start-1 row-start-1', state !== 'copied' && 'invisible')}>{UI.viewers.code.copied}</span>
          <span className={cn('col-start-1 row-start-1', state !== 'failed' && 'invisible')}>{UI.viewers.code.copyFailed}</span>
        </span>
      </button>
      <span role="status" className="ar-sr">
        {announcement}
      </span>
    </>
  );
}
