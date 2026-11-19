'use client';

/**
 * Buttons for the admin (app/admin/admin.css, `.adm-btn`). Plain and dense: the admin is a tool.
 *
 * - `primary` is the one filled action-colored button in a view (Save in the save bar, the
 *   confirm button of an open dialog). Use it once.
 * - `secondary` (the default) is outlined; `ghost` has no border (row tools); `danger` is
 *   outlined in the action color for a confirm that removes something.
 * - `busy` shows a spinner, sets aria-busy, and disables the button.
 *
 * Every button defaults to type="button", so a button inside a form never submits by accident.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** `sm` for row tools and dense lists; `md` (the default) elsewhere. */
  size?: 'sm' | 'md';
  /** An icon before the label (a lucide-react element). */
  icon?: ReactNode;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, busy = false, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('adm-btn', `adm-btn--${variant}`, size === 'sm' && 'adm-btn--sm', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <LoaderCircle className="adm-spin" size={16} aria-hidden="true" /> : icon ? <span className="adm-btn__icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The accessible name, also shown as the tooltip. Say what the button does: "Move Stat 2 up". */
  label: string;
  icon: ReactNode;
  variant?: Exclude<ButtonVariant, 'primary'>;
  size?: 'sm' | 'md';
}

/** A square button that shows only an icon; `label` is its accessible name and its tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', className, type = 'button', title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx('adm-iconbtn', `adm-iconbtn--${variant}`, size === 'sm' && 'adm-iconbtn--sm', className)}
      {...rest}
    >
      <span aria-hidden="true" className="adm-iconbtn__icon">
        {icon}
      </span>
    </button>
  );
});
