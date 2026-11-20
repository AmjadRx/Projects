'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { loadPalette, prefetchPalette, prefetchWhenIdle, type LoadedPalette } from './load';
import { inPalette, isPaletteShortcut, isTypingTarget, otherLayerOpen } from './shortcut';

/** closed: nothing drawn. loading: asked for, its code or index still on the way. open: drawn. */
type Phase = 'closed' | 'loading' | 'open';

/** A section the visitor chose: focused once its page shows it. */
interface Landing {
  /** The path the section's page is at, and the path the visitor chose it from. */
  path: string;
  from: string;
  id: string;
}

/** The element focus would return to, if it is still on the page and can take focus. */
function focusable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element !== document.body && element.isConnected;
}

/**
 * Focuses a section's heading without scrolling (the router has scrolled it into view), so the next
 * Tab and a screen reader go on from it, as after a skip link. The heading stays focusable only
 * until focus leaves it.
 */
function land(element: HTMLElement): void {
  if (!element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '-1');
    element.addEventListener('blur', () => element.removeAttribute('tabindex'), { once: true });
  }
  element.focus({ preventScroll: true });
}

/**
 * The nav's search button and the palette's shortcut (ARCHITECTURE.md 5: "Ctrl or Cmd with K, and a
 * nav button"). This file, the shortcut's rules (./shortcut.ts) and the loader (./load.ts) are all
 * of the palette that a page's first load carries: the palette itself and its index arrive on
 * demand, fetched ahead on a hover, a press or focus on the button, or an idle moment after the
 * page has loaded.
 *
 * The button is the bundle's (Nav, bundle.css 8): the icon, the word "Search" from 1280 px, and the
 * shortcut from 1024 px; under 1024 px the icon alone, a 44 px square beside Menu. Its children
 * (the icon and words) come from the server, so this file carries no strings or icons.
 *
 * The shortcut opens the palette from anywhere on the page but a field the visitor types in, and
 * not over another layer (the menu, the lightbox, full screen); pressed in the open palette it
 * closes it. Every other key, and this one where it does not act, is left to the page and the
 * browser. Escape, Close, and the scrim close it and return focus to what opened it: the button,
 * or whatever had focus when the shortcut was pressed. A result that leads elsewhere closes it and
 * leaves focus to the new page, or to the section it names. A route change closes it.
 */
export default function PaletteTrigger({ label, children }: { label: string; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('closed');
  const [loaded, setLoaded] = useState<LoadedPalette | null>(null);
  const phaseRef = useRef<Phase>('closed');
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** What had focus when the palette was asked for. */
  const opener = useRef<HTMLElement | null>(null);
  /** Where focus goes once the palette has closed: what opened it, or nothing. */
  const returnTo = useRef<HTMLElement | null>(null);
  const landing = useRef<Landing | null>(null);
  const dialogId = useId();
  const pathname = usePathname() ?? '/';
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const open = useCallback(
    (from: Element | null) => {
      if (phaseRef.current !== 'closed') return;
      opener.current = focusable(from) ? from : null;
      go('loading');
      loadPalette().then(
        (palette) => {
          if (phaseRef.current !== 'loading') return;
          setLoaded(palette);
          go('open');
        },
        () => {
          // Offline, or a new deployment took the old files away: the next press tries again.
          if (phaseRef.current === 'loading') go('closed');
        },
      );
    },
    [go],
  );

  const close = useCallback(
    (back: boolean) => {
      if (phaseRef.current === 'closed') return;
      returnTo.current = back ? opener.current : null;
      opener.current = null;
      go('closed');
    },
    [go],
  );

  // A section chosen: once its page is shown, its heading takes focus.
  const choose = useCallback((href: string) => {
    const hash = href.indexOf('#');
    if (hash < 0) {
      landing.current = null;
      return;
    }
    const path = href.slice(0, hash) || pathRef.current;
    landing.current = { path, from: pathRef.current, id: decodeURIComponent(href.slice(hash + 1)) };
  }, []);

  // After the palette has gone (so its own focus guard has gone too): focus back to what opened it.
  useEffect(() => {
    if (phase !== 'closed') return;
    const back = returnTo.current;
    returnTo.current = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }, [phase]);

  // A section's page is shown: focus its heading. Another page meanwhile: forget it.
  useEffect(() => {
    const target = landing.current;
    if (!target || phase !== 'closed') return;
    if (pathname !== target.path) {
      if (pathname !== target.from) landing.current = null;
      return;
    }
    landing.current = null;
    const heading = document.getElementById(target.id);
    if (heading) land(heading);
  }, [pathname, phase]);

  // A route change (Back, a link) closes it.
  useEffect(() => {
    if (phaseRef.current !== 'closed') close(false);
  }, [pathname, close]);

  // The shortcut.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      const inside = inPalette(event.target);
      if (!inside && (isTypingTarget(event.target) || otherLayerOpen(document))) return;
      event.preventDefault();
      if (event.repeat) return;
      if (phaseRef.current === 'open') close(true);
      else open(document.activeElement);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Fetched ahead at an idle moment, so the shortcut opens it at once.
  useEffect(() => prefetchWhenIdle(), []);

  const host = phase === 'open' && loaded ? (buttonRef.current?.closest('.ar-frame') ?? document.body) : null;
  const Palette = loaded?.Palette;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ar-nav__search"
        aria-label={label}
        aria-keyshortcuts="Control+K Meta+K"
        aria-haspopup="dialog"
        aria-expanded={phase === 'open'}
        aria-controls={phase === 'open' ? dialogId : undefined}
        onClick={() => open(buttonRef.current)}
        onPointerEnter={prefetchPalette}
        onPointerDown={prefetchPalette}
        onFocus={prefetchPalette}
      >
        {children}
      </button>
      {host && Palette && loaded
        ? createPortal(<Palette id={dialogId} index={loaded.index} onClose={close} onChoose={choose} />, host)
        : null}
    </>
  );
}
