'use client';

/**
 * Keyboard shortcuts for the admin.
 *
 * - Ctrl+S (Cmd+S on a Mac) saves, everywhere, text fields included.
 * - Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes (Cmd on a Mac) the session's edits, except
 *   while a text field has focus: there the browser's own undo works on what was just typed in
 *   that field, which is what people expect in a text box. Each change still reaches the store,
 *   so the session's history stays complete, and the Undo and Redo buttons work from anywhere.
 * - Nothing fires while a modal dialog is open (Ctrl+S there only stops the browser's own "Save
 *   page" dialog).
 */
import { useEffect, useRef } from 'react';

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number', '']);

/** True when the element takes typed text, so the browser's own undo should handle Ctrl+Z there. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type.toLowerCase());
  return false;
}

export type ShortcutAction = 'save' | 'undo' | 'redo';

/** The action a key event asks for, or null. Pure, for tests. */
export function shortcutOf(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): ShortcutAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 's' && !event.shiftKey) return 'save';
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

/** True on Apple platforms, where the shortcut hints say Cmd. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Installs the shortcuts on the window. Handlers may change between renders; the listener reads
 * the latest ones.
 */
export function useShortcuts(handlers: Partial<Record<ShortcutAction, () => void>>): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = shortcutOf(event);
      if (!action) return;
      const handler = ref.current[action];
      if (!handler) return;
      if (document.querySelector('dialog[open]')) {
        if (action === 'save') event.preventDefault();
        return;
      }
      if (action !== 'save' && isTextEntry(event.target)) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
