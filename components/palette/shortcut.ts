/**
 * The palette's shortcut (ARCHITECTURE.md 5: Ctrl or Cmd with K) as plain tests on a key event and
 * the page, so the listener that every page carries stays a few lines (PaletteTrigger.tsx). They
 * decide when the shortcut is the palette's; any other key, and this one wherever these tests say
 * no, is left to the page and the browser untouched.
 */

/** The class of the palette's outer element (CommandPalette.tsx, app/palette.css). */
export const PALETTE_CLASS = 'ar-cmdk';

/** The parts of a KeyboardEvent the tests read. */
export interface ShortcutKey {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

/**
 * Ctrl+K, or Cmd+K on a Mac (each works on any system, as the button's aria-keyshortcuts says),
 * with no other modifier: Ctrl+Shift+K, Ctrl+Alt+K (AltGr+K), Cmd+Option+K and Ctrl+Cmd+K stay the
 * browser's. The letter is read from `key`, so where the K key types another Latin letter (Dvorak's
 * T) Ctrl+T stays the browser's; a layout with no Latin letters (Cyrillic) is read by the key's
 * place, `code`. A key the page already handled, or one typed while an input method composes, is
 * left alone.
 */
export function isPaletteShortcut(event: ShortcutKey): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.altKey || event.shiftKey || event.ctrlKey === event.metaKey) return false;
  const key = event.key ?? '';
  if (/^[a-z]$/i.test(key)) return key.toLowerCase() === 'k';
  return event.code === 'KeyK';
}

/** Input types that take no typing: the shortcut works on them as anywhere else. */
const NOT_TYPED = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/** Roles of widgets that take typing although they are no form field. */
const TYPED_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

/**
 * True while the visitor types in a field: a text input of any kind, a text area, a select, an
 * editable region, or a widget with a typing role. Ctrl+K there belongs to the field and the
 * browser (Safari's "delete to the end of the line", the browser's own search key).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  if (element.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  const tag = element.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NOT_TYPED.has(((element as HTMLInputElement).type || 'text').toLowerCase());
  return TYPED_ROLES.has(element.getAttribute('role') ?? '');
}

/** True when the event came from inside the open palette. */
export function inPalette(target: EventTarget | null): boolean {
  return Boolean(target && typeof (target as Element).closest === 'function' && (target as Element).closest(`.${PALETTE_CLASS}`));
}

/**
 * True while another layer holds the page: the phone menu, the lightbox, a viewer's full screen
 * (each a modal dialog), or the browser's own full screen. The palette does not open over them;
 * their own traps answer Escape and Tab, so a second layer would leave one of them stranded.
 */
export function otherLayerOpen(doc: Document): boolean {
  if (doc.fullscreenElement) return true;
  return Array.from(doc.querySelectorAll('[aria-modal="true"]')).some((layer) => !layer.closest(`.${PALETTE_CLASS}`));
}
