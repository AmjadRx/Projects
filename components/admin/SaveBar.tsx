'use client';

export default function SaveBar({
  dirty,
  saving,
  savedAt,
  error,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  savedAt: string | null;
  error: string | null;
  onSave: () => void;
}) {
  let statusEl: React.ReactNode = null;
  if (error) {
    statusEl = <span className="font-mono text-xs text-red-400">⚠ {error}</span>;
  } else if (saving) {
    statusEl = <span className="font-mono text-xs text-ink-dim">Saving…</span>;
  } else if (dirty) {
    statusEl = <span className="font-mono text-xs text-purple">● Unsaved changes</span>;
  } else if (savedAt) {
    statusEl = (
      <span className="font-mono text-xs text-cyan">
        ✓ Saved · {new Date(savedAt).toLocaleTimeString()}
      </span>
    );
  } else {
    statusEl = <span className="font-mono text-xs text-ink-mute">All synced</span>;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-navy/85 backdrop-blur-md md:left-64" style={{ borderTopColor: 'rgb(255 255 255 / 0.08)' }}>
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-3 md:px-10">
        <div>{statusEl}</div>
        <button
          onClick={onSave}
          disabled={!dirty || saving}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
