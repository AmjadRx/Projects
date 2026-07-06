'use client';

import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block font-mono text-[10px] text-ink-mute">{hint}</span>}
    </label>
  );
}

export function Text({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      className="input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Area({
  value,
  onChange,
  rows,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <textarea
      className={`textarea ${mono ? 'font-mono text-xs' : ''}`}
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 py-1"
    >
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface-2'}`}
        style={{ border: '1px solid var(--line)' }}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-ink transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
        />
      </span>
      <span className="text-sm text-ink">{label}</span>
    </button>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly T[] | T[];
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function IconBtn({
  onClick,
  disabled,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-sm text-ink-mute transition-colors disabled:opacity-30 ${danger ? 'hover:text-red-400' : 'hover:text-ink'}`}
      style={{ border: '1px solid var(--line)' }}
    >
      {children}
    </button>
  );
}

export function RowControls({
  onUp,
  onDown,
  onDelete,
  canUp,
  canDown,
}: {
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
  canUp: boolean;
  canDown: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <IconBtn onClick={onUp} disabled={!canUp} label="Move up">
        <ChevronUp size={14} />
      </IconBtn>
      <IconBtn onClick={onDown} disabled={!canDown} label="Move down">
        <ChevronDown size={14} />
      </IconBtn>
      <IconBtn onClick={onDelete} label="Delete" danger>
        <Trash2 size={14} />
      </IconBtn>
    </div>
  );
}

export function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="btn-ghost mt-4 !min-h-0 !px-4 !py-2 text-[13px]">
      + {label}
    </button>
  );
}

export function TabHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink-dim">{subtitle}</p>}
    </header>
  );
}

/** Move an array element; returns a new array. */
export function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
