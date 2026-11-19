'use client';

/**
 * Confirmation dialogs (docs/V3_PLAN.md D-33: a styled dialog instead of window.confirm).
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete this project?', message: '...', confirmLabel: 'Delete', tone: 'danger' })) { ... }
 *
 * `useConfirm()` needs the `ConfirmProvider` that AdminApp puts around the whole admin. Requests
 * queue: a second confirm waits until the first is answered. Esc and Cancel answer false; focus
 * starts on Cancel, so Enter never confirms a removal by accident.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmOptions {
  title: string;
  /** What will happen, in plain words; say whether Undo can bring it back. */
  message?: ReactNode;
  /** The confirming button's words, a verb: "Delete", "Sign out", "Reload". Default "Confirm". */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** `danger` for removals: the confirm button is outlined in the action color. */
  tone?: 'default' | 'danger';
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface Pending {
  id: number;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

/** Holds the confirmation queue for everything inside it. AdminApp renders one around the admin. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Pending | null>(null);
  const queue = useRef<Pending[]>([]);
  const current = useRef<Pending | null>(null);
  const counter = useRef(0);

  const pump = useCallback(() => {
    if (current.current !== null) return;
    const next = queue.current.shift() ?? null;
    current.current = next;
    setActive(next);
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        queue.current.push({ id: ++counter.current, options, resolve });
        pump();
      }),
    [pump],
  );

  const settle = useCallback(
    (ok: boolean) => {
      const done = current.current;
      current.current = null;
      setActive(null);
      done?.resolve(ok);
      pump();
    },
    [pump],
  );

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {active ? <ConfirmDialog key={active.id} open options={active.options} onAnswer={settle} /> : null}
    </ConfirmContext.Provider>
  );
}

/** The confirm function of the nearest ConfirmProvider. */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider> (AdminApp renders one).');
  return confirm;
}

/** The confirm function, or null outside a ConfirmProvider (for primitives that work without one). */
export function useOptionalConfirm(): ConfirmFn | null {
  return useContext(ConfirmContext);
}

export interface ConfirmDialogProps {
  open: boolean;
  options: ConfirmOptions;
  onAnswer: (ok: boolean) => void;
}

/** The dialog `useConfirm` shows. Exported for a caller that keeps its own open state. */
export function ConfirmDialog({ open, options, onAnswer }: ConfirmDialogProps) {
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default' } = options;
  return (
    <Dialog
      open={open}
      onClose={() => onAnswer(false)}
      title={title}
      size="sm"
      role="alertdialog"
      footer={
        <>
          <Button data-autofocus onClick={() => onAnswer(false)}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => onAnswer(true)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message ? <div className="adm-dialog__message">{message}</div> : null}
    </Dialog>
  );
}
