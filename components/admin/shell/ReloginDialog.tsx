'use client';

/**
 * Asks for the password again when the session has ended (docs/V3_PLAN.md D-20). The editor and
 * its unsaved changes stay as they are underneath; after signing in, whatever was waiting (a
 * save, a publish) runs again once.
 */
import type { SessionState } from '@/lib/admin/contract';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { PasswordForm } from './Login';

export function ReloginDialog({
  open,
  onSignedIn,
  onCancel,
}: {
  open: boolean;
  onSignedIn: (session: SessionState) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      size="sm"
      title="Sign in again"
      description="Your session has ended. Your changes are still here; sign in to keep working."
    >
      <PasswordForm onSignedIn={onSignedIn} cancel={<Button onClick={onCancel}>Cancel</Button>} />
    </Dialog>
  );
}
