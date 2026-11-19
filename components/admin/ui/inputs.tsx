'use client';

/**
 * The admin's inputs. All are controlled and share one shape:
 *
 *   <TextField path="personal.name" label="Name" value={name} onChange={(value, edit) => ...} />
 *
 * - `path` is the field path in the current file (inside a FileScope). It sets the input's DOM id
 *   (`fieldId(file, path)`) and shows the content check's findings for that field (see Field).
 * - `onChange(value, edit)` hands back the new value and the store's edit options,
 *   `{ coalesce: <field id> }`. Pass `edit` on to the store, so typing in one field is one undo
 *   step: `store.editSite((s) => setIn(s, path, value), edit)` (or use `useSiteBinding`).
 * - Text stays text: an emptied field is the empty string, never a missing key (D-18).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { EditOptions } from '../state/store';
import { useFieldId } from '../state/hooks';
import { Field } from './Field';
import { cx } from './cx';

/** What every input takes besides its value. */
export interface InputBaseProps {
  /** The field path in the current file ("personal.name", "stats[2].label"). */
  path: string;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

function useEditOptions(path: string): EditOptions {
  const id = useFieldId(path);
  return { coalesce: id };
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

export interface TextFieldProps extends InputBaseProps {
  value: string | undefined;
  onChange: (value: string, edit: EditOptions) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'tel' | 'search';
  /** Data in the mono face: addresses, slugs, file names, numbers with units. */
  mono?: boolean;
  maxLength?: number;
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'tel' | 'url' | 'numeric' | 'decimal' | 'search';
  spellCheck?: boolean;
  /** A browser-side problem with the value, shown under the field. */
  issue?: string | null;
  issueTone?: 'error' | 'warning';
  /** Text shown before the input, such as "/projects/". */
  prefix?: string;
  /** Rewrites what the owner types before it reaches the store (SlugField lowercases). */
  transform?: (raw: string) => string;
  onBlur?: () => void;
}

/** A one-line text input. */
export function TextField({
  path,
  label,
  hint,
  required,
  disabled,
  className,
  value,
  onChange,
  placeholder,
  type = 'text',
  mono = false,
  maxLength,
  autoComplete = 'off',
  inputMode,
  spellCheck,
  issue,
  issueTone,
  prefix,
  transform,
  onBlur,
}: TextFieldProps) {
  const edit = useEditOptions(path);
  const text = value ?? '';
  return (
    <Field path={path} label={label} hint={hint} required={required} value={text} issue={issue} issueTone={issueTone} className={className}>
      {(control) => {
        const input = (
          <input
            {...control}
            type={type}
            className={cx('adm-input', mono && 'adm-input--mono', prefix && 'adm-input--prefixed')}
            value={text}
            placeholder={placeholder}
            maxLength={maxLength}
            autoComplete={autoComplete}
            inputMode={inputMode}
            spellCheck={spellCheck}
            disabled={disabled}
            onBlur={onBlur}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(transform ? transform(e.target.value) : e.target.value, edit)}
          />
        );
        return prefix ? (
          <div className="adm-affix">
            <span className="adm-affix__text" aria-hidden="true">
              {prefix}
            </span>
            {input}
          </div>
        ) : (
          input
        );
      }}
    </Field>
  );
}

export interface TextAreaProps extends InputBaseProps {
  value: string | undefined;
  onChange: (value: string, edit: EditOptions) => void;
  /** The text is Markdown: says so under the field. */
  markdown?: boolean;
  /** Rows shown before the box grows with its text. */
  rows?: number;
  /** The mono face, for data and code only (DESIGN_DIRECTION.md: B612 Mono is for data); prose stays in the sans face. */
  mono?: boolean;
  placeholder?: string;
  spellCheck?: boolean;
}

/** The Markdown the site renders (components/ui/Markdown.tsx allows no raw HTML). */
export const MARKDOWN_HINT = 'Markdown: **bold**, *italic*, [words](address), and lists of lines that start with a hyphen.';

/** A multi-line text box that grows with its text. */
export function TextArea({
  path,
  label,
  hint,
  required,
  disabled,
  className,
  value,
  onChange,
  markdown = false,
  rows = 3,
  mono = false,
  placeholder,
  spellCheck,
}: TextAreaProps) {
  const edit = useEditOptions(path);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const text = value ?? '';

  // Grow to fit the text (never shrinking below `rows`); runs before paint, so nothing jumps.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  const fullHint =
    markdown && hint ? (
      <>
        {hint} {MARKDOWN_HINT}
      </>
    ) : markdown ? (
      MARKDOWN_HINT
    ) : (
      hint
    );

  return (
    <Field path={path} label={label} hint={fullHint} required={required} value={text} className={className}>
      {(control) => (
        <textarea
          {...control}
          ref={ref}
          rows={rows}
          className={cx('adm-input', 'adm-textarea', mono && 'adm-input--mono')}
          value={text}
          placeholder={placeholder}
          spellCheck={spellCheck}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value, edit)}
        />
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

export interface NumberFieldProps extends InputBaseProps {
  value: number | undefined;
  /** `undefined` when the box is emptied and `optional` is set. */
  onChange: (value: number | undefined, edit: EditOptions) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Whole numbers only. */
  integer?: boolean;
  /** An empty box means "no value" (undefined). Without it, an empty box changes nothing. */
  optional?: boolean;
}

function formatNumber(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '' : String(value);
}

/**
 * A number input. It keeps its own text while the owner types ("1.", "-"), and sends a number to
 * the store only when the text is one, within `min` and `max`.
 */
export function NumberField({
  path,
  label,
  hint,
  required,
  disabled,
  className,
  value,
  onChange,
  min,
  max,
  step,
  integer = false,
  optional = false,
}: NumberFieldProps) {
  const edit = useEditOptions(path);
  const [text, setText] = useState(() => formatNumber(value));
  const [issue, setIssue] = useState<string | null>(null);

  // Follow changes from outside (undo, revert) without fighting the owner's typing.
  useEffect(() => {
    setText((current) => {
      const parsed = current.trim() === '' ? undefined : Number(current);
      return Object.is(parsed, value) ? current : formatNumber(value);
    });
  }, [value]);

  const commit = (raw: string) => {
    setText(raw);
    if (raw.trim() === '') {
      if (optional) {
        setIssue(null);
        onChange(undefined, edit);
      } else {
        setIssue('Enter a number.');
      }
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return setIssue('Enter a number.');
    if (integer && !Number.isInteger(n)) return setIssue('Enter a whole number.');
    if (min !== undefined && n < min) return setIssue(`The smallest value is ${min}.`);
    if (max !== undefined && n > max) return setIssue(`The largest value is ${max}.`);
    setIssue(null);
    onChange(n, edit);
  };

  return (
    <Field path={path} label={label} hint={hint} required={required} value={value} issue={issue} className={className}>
      {(control) => (
        <input
          {...control}
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          className={cx('adm-input', 'adm-input--mono', 'adm-input--short')}
          value={text}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => commit(e.target.value)}
          onBlur={() => {
            if (issue) {
              setText(formatNumber(value));
              setIssue(null);
            }
          }}
        />
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------------------------

export interface ToggleProps extends InputBaseProps {
  checked: boolean | undefined;
  onChange: (checked: boolean, edit: EditOptions) => void;
}

/** An on and off switch (a native checkbox with role="switch"); the label sits after it. */
export function Toggle({ path, label, hint, disabled, className, checked, onChange }: ToggleProps) {
  const edit = useEditOptions(path);
  const on = checked === true;
  return (
    <Field path={path} label={label} hint={hint} value={on} layout="inline" className={className}>
      {(control) => (
        <input
          {...control}
          type="checkbox"
          role="switch"
          className="adm-switch"
          checked={on}
          aria-checked={on}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked, edit)}
        />
      )}
    </Field>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

function toOptions<T extends string>(options: readonly (T | ChoiceOption<T>)[]): ChoiceOption<T>[] {
  return options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
}

export interface SelectProps<T extends string> extends InputBaseProps {
  value: T | undefined;
  onChange: (value: T, edit: EditOptions) => void;
  /** Values, or values with labels. */
  options: readonly (T | ChoiceOption<T>)[];
  /** Shown first when the value is empty or not among the options. */
  placeholder?: string;
}

/** A native select. A value that is not among the options shows as the placeholder and is kept until changed. */
export function Select<T extends string>({ path, label, hint, required, disabled, className, value, onChange, options, placeholder }: SelectProps<T>) {
  const edit = useEditOptions(path);
  const list = toOptions(options);
  const known = value !== undefined && list.some((o) => o.value === value);
  return (
    <Field path={path} label={label} hint={hint} required={required} value={value} className={className}>
      {(control) => (
        <select
          {...control}
          className={cx('adm-input', 'adm-select')}
          value={known ? value : ''}
          disabled={disabled}
          onChange={(e) => {
            const next = list.find((o) => o.value === e.target.value);
            if (next) onChange(next.value, edit);
          }}
        >
          {!known ? (
            <option value="" disabled>
              {placeholder ?? (value ? `${value} (not an option)` : 'Choose one')}
            </option>
          ) : null}
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export interface CheckboxGroupProps<T extends string> extends InputBaseProps {
  values: readonly T[] | undefined;
  onChange: (values: T[], edit: EditOptions) => void;
  options: readonly (T | ChoiceOption<T>)[];
}

/** Several checkboxes in a fieldset. The values come back in the options' order. */
export function CheckboxGroup<T extends string>({ path, label, hint, required, disabled, className, values, onChange, options }: CheckboxGroupProps<T>) {
  const edit = useEditOptions(path);
  const list = toOptions(options);
  const selected = new Set(values ?? []);
  return (
    <Field path={path} label={label} hint={hint} required={required} value={values} layout="group" className={className}>
      {(control) => (
        <div className="adm-checks">
          {list.map((o, i) => {
            const id = `${control.id}-${i}`;
            return (
              <div key={o.value} className="adm-check">
                <input
                  id={id}
                  type="checkbox"
                  className="adm-checkbox"
                  checked={selected.has(o.value)}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(o.value);
                    else next.delete(o.value);
                    onChange(
                      list.filter((x) => next.has(x.value)).map((x) => x.value),
                      edit,
                    );
                  }}
                />
                <label htmlFor={id}>{o.label}</label>
              </div>
            );
          })}
        </div>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------------------------
// Slugs and addresses
// ---------------------------------------------------------------------------------------------

/** The slug rule of content paths (lib/admin/contract.ts): lowercase words joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What the owner types, made slug-like as they type: lowercase, spaces to hyphens, nothing else. */
export function slugifyTyping(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-');
}

/** Why a slug is not valid, or null. */
export function slugIssue(slug: string): string | null {
  if (slug === '') return 'A slug is required.';
  if (!SLUG_PATTERN.test(slug)) return 'Use lowercase letters and digits, with single hyphens between words (no hyphen at either end).';
  return null;
}

export interface SlugFieldProps extends InputBaseProps {
  value: string | undefined;
  onChange: (value: string, edit: EditOptions) => void;
  /** Shown before the input, such as "/projects/". */
  prefix?: string;
  /** A problem the caller found, such as a slug another project already uses. */
  issue?: string | null;
}

/** A slug input: lowercases and hyphenates as the owner types, and says when the slug is not valid. */
export function SlugField({ path, label, hint, required = true, disabled, className, value, onChange, prefix, issue }: SlugFieldProps) {
  const text = value ?? '';
  return (
    <TextField
      path={path}
      label={label}
      hint={hint}
      required={required}
      disabled={disabled}
      className={className}
      value={text}
      onChange={onChange}
      mono
      prefix={prefix}
      spellCheck={false}
      transform={slugifyTyping}
      issue={issue ?? slugIssue(text)}
    />
  );
}

/** The kinds of address a UrlField accepts. */
export type UrlKind = 'path' | 'https' | 'mailto' | 'tel';

const URL_KIND_WORDS: Record<UrlKind, string> = {
  path: 'a site path that starts with /',
  https: 'an https address',
  mailto: 'a mailto: address',
  tel: 'a tel: number',
};

/** The kind of an address, or null when it is none of them. */
export function urlKindOf(value: string): UrlKind | null {
  const v = value.trim();
  if (v.startsWith('/')) return v.startsWith('//') || v.startsWith('/\\') ? null : 'path';
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return 'mailto';
  if (/^tel:\+?[0-9().\s-]{3,}$/i.test(v)) return 'tel';
  try {
    const url = new URL(v);
    return url.protocol === 'https:' && url.hostname !== '' ? 'https' : null;
  } catch {
    return null;
  }
}

/** Why an address is not one of the allowed kinds, or null. Empty is fine unless required. */
export function urlIssue(value: string, allow: readonly UrlKind[], required = false): string | null {
  if (value.trim() === '') return required ? 'An address is required.' : null;
  const kind = urlKindOf(value);
  if (kind !== null && allow.includes(kind)) return null;
  const words = allow.map((k) => URL_KIND_WORDS[k]);
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}` : words[0];
  return `Use ${list}.`;
}

export interface UrlFieldProps extends InputBaseProps {
  value: string | undefined;
  onChange: (value: string, edit: EditOptions) => void;
  /** The kinds of address allowed. Default: a site path or an https address. */
  allow?: readonly UrlKind[];
  placeholder?: string;
  /** A problem the caller found (a page that does not exist), shown as a warning. */
  issue?: string | null;
}

/**
 * An address input in the mono face. It warns (without blocking) when the address is not one of
 * the allowed kinds, and offers to open a site path or an https address in a new tab.
 */
export function UrlField({
  path,
  label,
  hint,
  required,
  disabled,
  className,
  value,
  onChange,
  allow = ['path', 'https'],
  placeholder,
  issue,
}: UrlFieldProps) {
  const edit = useEditOptions(path);
  const text = value ?? '';
  const kind = urlKindOf(text);
  const problem = issue ?? urlIssue(text, allow, required);
  const openable = kind === 'path' || kind === 'https';
  return (
    <Field path={path} label={label} hint={hint} required={required} value={text} issue={problem} issueTone="warning" className={className}>
      {(control) => (
        <div className="adm-affix">
          <input
            {...control}
            type="text"
            inputMode="url"
            className={cx('adm-input', 'adm-input--mono')}
            value={text}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
            onChange={(e) => onChange(e.target.value, edit)}
          />
          {openable ? (
            <a className="adm-affix__link" href={text.trim()} target="_blank" rel="noopener noreferrer" title="Open in a new tab">
              <ExternalLink size={16} aria-hidden="true" />
              <span className="adm-sr">Open this address in a new tab</span>
            </a>
          ) : null}
        </div>
      )}
    </Field>
  );
}
