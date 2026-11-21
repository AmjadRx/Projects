'use client';

/**
 * The frame every admin input sits in: label, hint, the control, and the findings for its field.
 *
 * Each field has a `path` in its content file ("personal.name", "stats[2].label"). The control
 * gets the DOM id `fieldId(file, path)` (lib/admin/locate.ts) from the nearest FileScope, so a
 * finding the content check reports on that path scrolls here, and the field shows the finding:
 *
 * - errors from the last refused save and from the load set aria-invalid and are read out
 *   through aria-describedby;
 * - warnings the server returned with the last save show under the field without aria-invalid;
 * - once the owner changes the value, an error is marked "changed since the check" and no longer
 *   sets aria-invalid; the next save checks it again.
 *
 * Use `Field` directly for a custom control (a media picker, a project picker): it passes the id
 * and the aria attributes to the render function.
 */
import { useId, useMemo, useRef, type ReactNode } from 'react';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { Finding } from '@/lib/admin/contract';
import { candidatePaths } from '@/lib/admin/locate';
import { useAdmin, useFieldId, useScopeFile } from '../state/hooks';
import { cx } from './cx';

const NONE: Finding[] = [];

/** True when a finding names this file and this field (its first field, for a composed path). */
export function findingTargets(finding: Finding, file: string, path: string): boolean {
  return finding.file === file && (candidatePaths(finding.path)[0] ?? '') === path;
}

/**
 * The findings the store holds for the field at `path` in the current file: errors from the last
 * refused save and from the load, and the warnings the last save returned. Stable arrays: the
 * component re-renders only when a save or a load changes them, never on a keystroke elsewhere.
 */
export function useFieldFindings(path: string): { errors: Finding[]; warnings: Finding[] } {
  const file = useScopeFile();
  const saveFindings = useAdmin((s) => s.save.findings);
  const saveWarnings = useAdmin((s) => s.save.warnings);
  const loadFindings = useAdmin((s) => s.info?.loadFindings ?? NONE);
  return useMemo(() => {
    const errors = [...saveFindings, ...loadFindings].filter((f) => f.severity === 'error' && findingTargets(f, file, path));
    const warnings = [...saveFindings, ...saveWarnings].filter((f) => f.severity === 'warning' && findingTargets(f, file, path));
    return { errors: errors.length > 0 ? errors : NONE, warnings: warnings.length > 0 ? warnings : NONE };
  }, [file, path, saveFindings, saveWarnings, loadFindings]);
}

export interface FieldStatus {
  errors: Finding[];
  warnings: Finding[];
  /** True once the value changed after the errors arrived. */
  stale: boolean;
  /** Errors that still apply: sets aria-invalid. */
  invalid: boolean;
}

/** `useFieldFindings` plus whether the value changed since the findings arrived. */
export function useFieldStatus(path: string, value: unknown): FieldStatus {
  const { errors, warnings } = useFieldFindings(path);
  // Remember the value the field held when this set of errors arrived; any later edit makes them stale.
  const seen = useRef<{ errors: Finding[]; value: unknown } | null>(null);
  if (seen.current === null || seen.current.errors !== errors) seen.current = { errors, value };
  const stale = errors.length > 0 && !Object.is(seen.current.value, value);
  return { errors, warnings, stale, invalid: errors.length > 0 && !stale };
}

/** The attributes a control inside `Field` must carry. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

export interface FieldProps {
  /** The field path in the current file; sets the control's id and links its findings. */
  path: string;
  label: ReactNode;
  /** One short sentence under the label: what the field is for, or the format it takes. */
  hint?: ReactNode;
  required?: boolean;
  /** The field's current value, so an error is marked stale once the owner changes it. */
  value?: unknown;
  /** A problem found in the browser before saving (a slug with capitals, a link of the wrong kind). */
  issue?: string | null;
  /** `error` (the default) sets aria-invalid; `warning` only shows the message. */
  issueTone?: 'error' | 'warning';
  /** `stacked` (label above, the default), `inline` (control first, then the label: switches, checkboxes), or `group` (a fieldset with a legend). */
  layout?: 'stacked' | 'inline' | 'group';
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({
  path,
  label,
  hint,
  required = false,
  value,
  issue = null,
  issueTone = 'error',
  layout = 'stacked',
  className,
  children,
}: FieldProps) {
  const id = useFieldId(path);
  const hintId = useId();
  const messagesId = useId();
  const status = useFieldStatus(path, value);
  const hasIssue = issue !== null && issue !== '';
  const invalid = status.invalid || (hasIssue && issueTone === 'error');
  const hasMessages = status.errors.length > 0 || status.warnings.length > 0 || hasIssue;
  const describedBy = [hint ? hintId : null, hasMessages ? messagesId : null].filter(Boolean).join(' ') || undefined;

  const control: FieldControlProps = {
    id,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(invalid ? { 'aria-invalid': true as const } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  };

  const labelText = (
    <>
      {label}
      {required ? <span className="adm-field__req"> (required)</span> : null}
    </>
  );
  const hintNode = hint ? (
    <p id={hintId} className="adm-field__hint">
      {hint}
    </p>
  ) : null;
  const messages = hasMessages ? (
    <div id={messagesId} className="adm-field__msgs">
      {hasIssue ? (
        <p className={cx('adm-field__msg', issueTone === 'error' ? 'adm-field__msg--error' : 'adm-field__msg--warning')}>
          {issueTone === 'error' ? <CircleAlert size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
          <span>{issue}</span>
        </p>
      ) : null}
      {status.errors.map((finding, i) => (
        <p key={`e${i}`} className={cx('adm-field__msg', 'adm-field__msg--error', status.stale && 'is-stale')}>
          <CircleAlert size={15} aria-hidden="true" />
          <span>
            <span className="adm-field__rule">{finding.rule}</span> {finding.message}
            {status.stale ? ' (Changed since the check; the next save checks it again.)' : ''}
          </span>
        </p>
      ))}
      {status.warnings.map((finding, i) => (
        <p key={`w${i}`} className="adm-field__msg adm-field__msg--warning">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>
            <span className="adm-field__rule">{finding.rule}</span> {finding.message}
          </span>
        </p>
      ))}
    </div>
  ) : null;

  if (layout === 'group') {
    return (
      <fieldset
        id={id}
        className={cx('adm-field', 'adm-field--group', invalid && 'is-invalid', className)}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
      >
        <legend className="adm-field__label">{labelText}</legend>
        {hintNode}
        {children({ id: `${id}-control` })}
        {messages}
      </fieldset>
    );
  }

  if (layout === 'inline') {
    return (
      <div className={cx('adm-field', 'adm-field--inline', invalid && 'is-invalid', className)}>
        <div className="adm-field__row">
          {children(control)}
          <label htmlFor={id} className="adm-field__label">
            {labelText}
          </label>
        </div>
        {hintNode}
        {messages}
      </div>
    );
  }

  return (
    <div className={cx('adm-field', invalid && 'is-invalid', className)}>
      <label htmlFor={id} className="adm-field__label">
        {labelText}
      </label>
      {hintNode}
      {children(control)}
      {messages}
    </div>
  );
}
