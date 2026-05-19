'use client';

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block font-mono text-[10px] text-fg-mute">{hint}</span>}
    </label>
  );
}

export function TabHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-8">
      <h1 className="text-2xl font-bold tracking-tight text-fg md:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-fg-dim">{subtitle}</p>}
    </header>
  );
}

export function SectionCard({ title, children, action }: { title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card p-5 md:p-6">
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between">
          {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
