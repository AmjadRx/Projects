'use client';

/**
 * Undo and Redo for the editing session (ARCHITECTURE.md 7.5): two buttons, and the shortcuts
 * Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y (Cmd on a Mac). Inside a text field the shortcuts are left to
 * the browser's own undo for that field (see ./keys.ts); the buttons work from anywhere.
 */
import { useEffect, useState } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { useAdmin, useAdminStore } from '../state/hooks';
import { IconButton } from '../ui/Button';
import { isMac, useShortcuts } from './keys';

export function UndoRedo() {
  const store = useAdminStore();
  const canUndo = useAdmin((s) => s.doc !== null && s.past.length > 0);
  const canRedo = useAdmin((s) => s.doc !== null && s.future.length > 0);
  const [mod, setMod] = useState('Ctrl');
  useEffect(() => setMod(isMac() ? 'Cmd' : 'Ctrl'), []);

  useShortcuts({ undo: () => store.undo(), redo: () => store.redo() });

  return (
    <div className="adm-undo" role="group" aria-label="Edit history">
      <IconButton label={`Undo (${mod}+Z)`} icon={<Undo2 size={18} />} variant="secondary" disabled={!canUndo} onClick={() => store.undo()} />
      <IconButton label={`Redo (${mod}+Shift+Z)`} icon={<Redo2 size={18} />} variant="secondary" disabled={!canRedo} onClick={() => store.redo()} />
    </div>
  );
}
