'use client';

/**
 * A modal dialog on the native <dialog> element (showModal): it sits in the browser's top layer,
 * the rest of the page is inert while it is open (so focus stays inside), and Esc cancels.
 *
 * Render it with `open` and close it by setting `open` to false in `onClose`. Focus moves to
 * `initialFocus`, else to the first element marked `data-autofocus`, else to the first focusable
 * element in the body or the footer, and returns to where it was when the dialog closes. While
 * `busy` (a request is running) Esc and the close button do nothing. A click on the backdrop does
 * not close it: a publish or a delete should never be dismissed by a stray click.
 */
import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { cx } from './cx';

export interface DialogProps {
  open: boolean;
  /** Esc, the close button, or the caller's Cancel. Not called while `busy`. */
  onClose: () => void;
  title: ReactNode;
  /** A sentence under the title, read out with it. */
  description?: ReactNode;
  children?: ReactNode;
  /** The buttons at the bottom: Cancel first, the confirming action last. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  initialFocus?: RefObject<HTMLElement>;
  /** "alertdialog" for a confirmation that interrupts; "dialog" otherwise. */
  role?: 'dialog' | 'alertdialog';
  className?: string;
}

const FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function firstFocusable(root: HTMLElement): HTMLElement | null {
  for (const part of ['.adm-dialog__body', '.adm-dialog__foot', '.adm-dialog__head']) {
    const found = root.querySelector<HTMLElement>(`${part} ${FOCUSABLE.split(', ').join(`, ${part} `)}`);
    if (found) return found;
  }
  return null;
}

export function Dialog(props: DialogProps) {
  return props.open ? <DialogSurface {...props} /> : null;
}

function DialogSurface({ onClose, title, description, children, footer, size = 'md', busy = false, initialFocus, role = 'dialog', className }: DialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Where focus was before the dialog opened. A ref, because React's Strict Mode runs the effect
  // below twice on mount (in development), and the second run must not record the dialog's own field.
  const previousRef = useRef<HTMLElement | null | undefined>(undefined);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (previousRef.current === undefined) {
      previousRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    // Esc: refused while busy. Otherwise the browser closes the dialog and `close` tells the caller.
    const onCancel = (event: Event) => {
      if (busyRef.current) event.preventDefault();
    };
    // The browser closed it (Esc, or its own close request): hand the decision to the caller. A close
    // event that arrives while the dialog is open again, or after it left the page, is stale.
    const onNativeClose = () => {
      if (dialog.open || !dialog.isConnected) return;
      if (busyRef.current) {
        try {
          dialog.showModal();
        } catch {
          // Detached meanwhile: nothing to do.
        }
        return;
      }
      onCloseRef.current();
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onNativeClose);

    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    }
    const target = initialFocus?.current ?? dialog.querySelector<HTMLElement>('[data-autofocus]') ?? firstFocusable(dialog);
    target?.focus();

    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onNativeClose);
      // No dialog.close() here: React removes the element when the dialog unmounts, which takes it
      // out of the top layer, while close() would queue a close event that the Strict Mode re-run
      // would take for the owner closing it. Focus goes back once the element is really gone.
      const previous = previousRef.current;
      window.requestAnimationFrame(() => {
        if (dialog.isConnected) return;
        if (previous && previous.isConnected) previous.focus({ preventScroll: true });
      });
    };
    // Runs once per opening: the dialog mounts when `open` turns true and unmounts when it turns false.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={ref}
      className={cx('adm-dialog', `adm-dialog--${size}`, className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-busy={busy || undefined}
    >
      <div className="adm-dialog__head">
        <h2 id={titleId} className="adm-dialog__title">
          {title}
        </h2>
        <IconButton label="Close" icon={<X size={18} />} disabled={busy} onClick={() => (busyRef.current ? undefined : onCloseRef.current())} />
      </div>
      {description ? (
        <p id={descriptionId} className="adm-dialog__desc">
          {description}
        </p>
      ) : null}
      {children ? <div className="adm-dialog__body">{children}</div> : null}
      {footer ? <div className="adm-dialog__foot">{footer}</div> : null}
    </dialog>
  );
}
