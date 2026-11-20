'use client';

import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import Icon from '@/components/sheet/Icon';
import type { PaletteIndex } from '@/lib/palette';
import { UI } from '@/lib/strings';
import { activeResult, paletteKey, paletteStep, PALETTE_START, searchPalette, type PaletteHit, type PaletteResult } from './model';
import { PALETTE_CLASS } from './shortcut';

/**
 * How long the count waits before it is read, so a screen reader hears where typing stopped rather
 * than every letter on the way. An announcement delay, not motion: the list itself changes at once.
 */
const ANNOUNCE_DELAY_MS = 500;

export interface CommandPaletteProps {
  /** The dialog's id, which the nav's button names in aria-controls. */
  id: string;
  index: PaletteIndex;
  /**
   * Closes the palette. `back` is true when focus should return to what opened it (Escape, Close,
   * the scrim, a result for the page already shown); false when a result takes the visitor on.
   */
  onClose: (back: boolean) => void;
  /** Told which result was chosen, before its link is followed. */
  onChoose?: (href: string) => void;
}

/** A label with its matched stretches marked (the bundle's ar-cmdk__hit). */
function Marked({ text, hits }: { text: string; hits: PaletteHit[] }) {
  if (hits.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  hits.forEach((hit, i) => {
    if (hit.start > at) parts.push(text.slice(at, hit.start));
    parts.push(
      <mark key={i} className="ar-cmdk__hit">
        {text.slice(hit.start, hit.end)}
      </mark>,
    );
    at = hit.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** True when the element is drawn (the Close button shows only under 768 px). */
function drawn(element: HTMLElement | null): element is HTMLElement {
  return element !== null && element.getClientRects().length > 0;
}

/**
 * The command palette (ARCHITECTURE.md 5, "Also new"; the bundle's CommandPalette, bundle.css 33;
 * the Palette boards at 1440 px in both themes and at 390 px): a modal dialog over a scrim with one
 * field and the results under it, grouped as Pages, Projects and Sections, each with its line (Page,
 * the project's sheet, Section) and the typed text marked; the keys under the list; and, when
 * nothing matches, what to try. Under 768 px it fills the screen and carries a Close button.
 *
 * The WAI-ARIA combobox with a listbox inside a modal dialog: focus stays in the field, Down and Up
 * move the active result (aria-activedescendant, aria-selected) round the list, Enter opens it,
 * Escape closes, and Tab stays inside (one of the three focus traps ARCHITECTURE.md 10 allows). The
 * count of results is read politely. The results are links, so a click, a middle click, or a
 * link's own menu work as anywhere; they take no Tab stop. The page behind does not scroll.
 *
 * Nothing moves (motion sheets 7 and 8): it opens and closes at once, and the results change at
 * once as the visitor types, with or without reduced motion or the pause control.
 */
export default function CommandPalette({ id, index, onClose, onChoose }: CommandPaletteProps) {
  const [state, dispatch] = useReducer(paletteStep, PALETTE_START);
  const results = useMemo(() => searchPalette(index, state.query), [index, state.query]);
  const active = activeResult(results, state);
  const count = results.flat.length;
  const [said, setSaid] = useState('');
  const base = useId();
  const listId = `${base}list`;
  const optionId = (n: number) => `${base}o${n}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Open: focus in the field, the page held still, and focus kept inside while open.
  useEffect(() => {
    const input = inputRef.current;
    input?.focus({ preventScroll: true });
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    const keepFocus = (event: FocusEvent) => {
      const panel = panelRef.current;
      if (panel && event.target instanceof Node && !panel.contains(event.target)) input?.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.removeEventListener('focusin', keepFocus);
      root.style.overflow = overflow;
    };
  }, []);

  // The active result stays in view as the keys move it (no smooth scrolling: motion sheet 8.3).
  const activeId = active ? `${base}o${active.n}` : '';
  useEffect(() => {
    const option = activeId ? document.getElementById(activeId) : null;
    if (option && typeof option.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' });
  }, [activeId, results]);

  // The count, read politely once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setSaid(UI.palette.count(count)), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [count, state.query]);

  /** A result's link was followed: close, with focus back only when it leads to the page shown. */
  const choose = (result: PaletteResult, event: ReactMouseEvent<HTMLAnchorElement>) => {
    // A click that opens a new tab or window (a modifier key) leaves the palette where it is.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    onChoose?.(result.href);
    onClose(result.href === `${window.location.pathname}${window.location.search}`);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const intent = paletteKey({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing || event.keyCode === 229,
    });
    if (intent === null) return;
    if (intent === 'close') {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (intent === 'tab') {
      event.preventDefault();
      const stops = ([inputRef.current, closeRef.current] as (HTMLElement | null)[]).filter(drawn);
      if (stops.length === 0) return;
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = at < 0 ? 0 : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      stops[next].focus();
      return;
    }
    // The arrows and Enter belong to the field; on the Close button, Enter presses the button.
    if (event.target !== inputRef.current) return;
    event.preventDefault();
    if (intent === 'go') {
      // Through the link itself, so the router follows it as it follows any link.
      if (active) document.getElementById(optionId(active.n))?.click();
      return;
    }
    dispatch({ type: intent, count });
  };

  return (
    <div className={PALETTE_CLASS}>
      <div className="ar-cmdk__scrim" aria-hidden="true" onClick={() => onClose(true)} />
      <div
        ref={panelRef}
        id={id}
        className="ar-cmdk__panel"
        role="dialog"
        aria-modal="true"
        aria-label={UI.palette.label}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => {
          // A press anywhere in the panel but the field keeps the field's focus, so typing goes on.
          if (event.target !== inputRef.current) event.preventDefault();
        }}
      >
        <div className="ar-cmdk__field">
          <Icon icon={Search} size={20} />
          <input
            ref={inputRef}
            className="ar-cmdk__input"
            type="text"
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active ? optionId(active.n) : undefined}
            aria-label={UI.palette.label}
            placeholder={UI.palette.label}
            value={state.query}
            onChange={(event) => dispatch({ type: 'query', query: event.target.value })}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <kbd className="ar-cmdk__esc" aria-hidden="true">
            {UI.palette.keys.esc}
          </kbd>
          <button ref={closeRef} type="button" className="ar-cmdk__close" onClick={() => onClose(true)}>
            {UI.palette.close}
          </button>
        </div>
        <div className="ar-cmdk__list" id={listId} role="listbox" aria-label={UI.palette.results} hidden={count === 0}>
          {results.groups.map((group) => (
            <div key={group.label} className="ar-cmdk__group" role="group" aria-label={group.label}>
              <p className="ar-cmdk__glabel" aria-hidden="true">
                {group.label}
              </p>
              {group.items.map((result) => {
                const on = result.n === active?.n;
                return (
                  <Link
                    key={`${result.n} ${result.href}`}
                    id={optionId(result.n)}
                    href={result.href}
                    prefetch={false}
                    role="option"
                    aria-selected={on}
                    tabIndex={-1}
                    className={on ? 'ar-cmdk__item is-active' : 'ar-cmdk__item'}
                    onClick={(event) => choose(result, event)}
                    onPointerMove={(event) => {
                      if (event.pointerType !== 'touch') dispatch({ type: 'point', n: result.n });
                    }}
                  >
                    <span className="ar-cmdk__label">
                      <Marked text={result.label} hits={result.hits} />
                    </span>
                    <span className="ar-cmdk__meta">{result.meta}</span>
                    <span className="ar-cmdk__go" aria-hidden="true">
                      <Icon icon={ArrowRight} size={16} />
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
        {count === 0 ? <p className="ar-cmdk__empty">{UI.palette.noMatch(state.query.trim(), index.pages)}</p> : null}
        <p className="ar-cmdk__keys" aria-hidden="true">
          <kbd>{UI.palette.keys.up}</kbd>
          <kbd>{UI.palette.keys.down}</kbd>
          <span>{UI.palette.keys.move}</span>
          <kbd>{UI.palette.keys.enter}</kbd>
          <span>{UI.palette.keys.go}</span>
          <kbd>{UI.palette.keys.esc}</kbd>
          <span>{UI.palette.keys.close}</span>
        </p>
        <p className="ar-sr" role="status">
          {said}
        </p>
      </div>
    </div>
  );
}
