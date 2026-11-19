'use client';

/**
 * The save bar's status line ("Unsaved changes in 2 files", "Saving", "Saved as commit abc1234").
 *
 * DESIGN_DIRECTION.md 6.4 gives this text change to Motion+ `ScrambleText` (admin only). That
 * piece needs the motion-plus package, which installs only with MOTION_TOKEN, and it is not
 * installed yet. Until it is, the text is swapped with no animation. Once motion-plus is a
 * dependency, `ScrambleText` replaces the inner span here (keeping the live region, and staying
 * still when `useMotionOk()` is false); nothing else changes.
 */
import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleDot, LoaderCircle } from 'lucide-react';
import { cx } from '../ui/cx';

export type StatusTone = 'idle' | 'dirty' | 'busy' | 'ok' | 'error';

const ICONS: Record<StatusTone, ReactNode> = {
  idle: null,
  dirty: <CircleDot size={16} />,
  busy: <LoaderCircle size={16} className="adm-spin" />,
  ok: <CircleCheck size={16} />,
  error: <CircleAlert size={16} />,
};

/** A status line read out politely by screen readers when it changes. */
export function StatusText({ text, tone = 'idle', className }: { text: string; tone?: StatusTone; className?: string }) {
  return (
    <p className={cx('adm-status', `adm-status--${tone}`, className)} aria-live="polite" aria-atomic="true">
      {ICONS[tone] ? (
        <span className="adm-status__icon" aria-hidden="true">
          {ICONS[tone]}
        </span>
      ) : null}
      <span className="adm-status__text">{text}</span>
    </p>
  );
}
