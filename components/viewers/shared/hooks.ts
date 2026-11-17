'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/** False while the tab is hidden. Canvases, videos, and readers pause then (docs/V3_PLAN.md D-66). */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/**
 * True when the visitor asks for reduced motion. False on the server and until mount, so the
 * server HTML and the first client render are the same tree (docs/V3_PLAN.md D-49).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** True on a device whose main pointer is fine and can hover (a mouse or trackpad). */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setFine(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return fine;
}

/** True while the element is at least partly inside the viewport. */
export function useInView(ref: RefObject<Element>, rootMargin = '0px'): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setInView(entry.isIntersecting);
    }, { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return inView;
}

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && el.getClientRects().length > 0,
  );
}

/**
 * The active focus traps, in the order they opened: the last one is on top. Traps can nest (a
 * viewer's own full-screen overlay inside the lightbox), and only the top one answers Escape and
 * Tab, so one Escape closes one layer.
 */
interface ActiveTrap {
  container: HTMLElement;
  escape: () => void;
}
const traps: ActiveTrap[] = [];

function onTrapKey(event: KeyboardEvent): void {
  const trap = traps[traps.length - 1];
  if (!trap) return;
  if (event.key === 'Escape') {
    event.stopImmediatePropagation();
    trap.escape();
    return;
  }
  if (event.key !== 'Tab') return;
  const { container } = trap;
  const items = focusables(container);
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const firstItem = items[0];
  const lastItem = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === firstItem || document.activeElement === container)) {
    event.preventDefault();
    lastItem.focus();
  } else if (!event.shiftKey && document.activeElement === lastItem) {
    event.preventDefault();
    firstItem.focus();
  } else if (!container.contains(document.activeElement)) {
    event.preventDefault();
    firstItem.focus();
  }
}

function pushTrap(trap: ActiveTrap): void {
  if (traps.length === 0) document.addEventListener('keydown', onTrapKey, true);
  traps.push(trap);
}

function removeTrap(trap: ActiveTrap): void {
  // By identity, not from the top: React releases a closing lightbox before the overlay inside it.
  const index = traps.indexOf(trap);
  if (index >= 0) traps.splice(index, 1);
  if (traps.length === 0) document.removeEventListener('keydown', onTrapKey, true);
}

/**
 * One page scroll lock shared by every layer that asks for it: the page locks when the first
 * layer opens and unlocks only when the last one closes, in whatever order they close.
 */
let scrollLocks = 0;
let unlockedOverflow = '';

function lockPageScroll(): void {
  const root = document.documentElement;
  if (scrollLocks === 0) {
    unlockedOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockPageScroll(): void {
  if (scrollLocks === 0) return;
  scrollLocks -= 1;
  if (scrollLocks === 0) document.documentElement.style.overflow = unlockedOverflow;
}

/**
 * Traps focus inside `containerRef` while `active`, closes on Escape, locks page scrolling, and
 * returns focus to the element that had it before. Used by the menu, the lightbox, its loading
 * cover, and full screen without the Fullscreen API (docs/V3_PLAN.md D-63). When traps nest, only
 * the newest one handles Escape and Tab.
 *
 * `restoreFocus: false` leaves focus where it is on release, for a layer that hands over to the
 * next one (the lightbox's loading cover).
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  active: boolean,
  onEscape: () => void,
  options: { lockScroll?: boolean; initialFocus?: RefObject<HTMLElement>; restoreFocus?: boolean } = {},
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const { lockScroll = true, initialFocus, restoreFocus = true } = options;

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const first = initialFocus?.current ?? focusables(container)[0] ?? container;
    if (first === container && !container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
    first.focus({ preventScroll: true });

    const trap: ActiveTrap = { container, escape: () => onEscapeRef.current() };
    pushTrap(trap);
    if (lockScroll) lockPageScroll();

    return () => {
      removeTrap(trap);
      if (lockScroll) unlockPageScroll();
      if (restoreFocus && previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [active, containerRef, initialFocus, lockScroll, restoreFocus]);
}
