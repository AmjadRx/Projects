'use client';

/**
 * A save answered 409 conflict: the draft changed since the editor loaded it (another tab, or a
 * merge of the published branch that conflicts). The save never overwrites; the owner chooses to
 * reload (which drops the unsaved changes, and says so) or to keep editing and copy what they
 * need first.
 */
import { RotateCcw } from 'lucide-react';
import type { ApiError } from '@/lib/admin/contract';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useChangedFiles } from './changes';
import { plural } from './format';

export function ConflictDialog({ error, onReload, onKeep }: { error: ApiError | null; onReload: () => void; onKeep: () => void }) {
  const changed = useChangedFiles();
  return (
    <Dialog
      open={error !== null}
      onClose={onKeep}
      role="alertdialog"
      title="The draft changed since you loaded it"
      description={error?.error}
      footer={
        <>
          <Button data-autofocus onClick={onKeep}>
            Keep editing
          </Button>
          <Button variant="danger" icon={<RotateCcw size={16} />} onClick={onReload}>
            Reload and drop my changes
          </Button>
        </>
      }
    >
      {error?.files && error.files.length > 0 ? (
        <>
          <p>Changed on the draft:</p>
          <ul className="adm-changes">
            {error.files.map((file) => (
              <li key={file} className="adm-mono adm-break">
                {file}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p>
        Reload loads the draft as it is now
        {changed.length > 0 ? `, and your unsaved changes in ${plural(changed.length, 'file')} are lost` : ''}. Keep editing leaves your changes
        here so you can copy what you need first; saving keeps failing until you reload.
      </p>
    </Dialog>
  );
}
