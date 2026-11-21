'use client';

/**
 * Taking the owner to a field (ARCHITECTURE.md 7.2: "the admin scrolls to the field").
 *
 * When `store.reveal(file, path)` is called (a finding clicked, a refused save), the shell's
 * `useRevealHandler` works out where the field lives (`locate` in lib/admin/locate.ts), switches
 * to its tab (and project), and then, over a few animation frames while the editors render, finds
 * the field's DOM id, scrolls it to the middle of the window, focuses it, and highlights it for
 * two seconds.
 *
 * Collapsed things open on the way: while a reveal is running, `useRevealOpen(path)` is true in
 * every component whose path contains the target ("blocks[3]" for "blocks[3].items[1].alt"), in
 * the same FileScope. `useCollapsible(path)` wraps that in an open state that opens itself; the
 * ListEditor rows use it, and so can the project blocks.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { candidatePaths, locate, type TabId } from '@/lib/admin/locate';
import { useAdmin, useScopeFile } from '../state/hooks';
import { pathWithin } from '../ui/paths';

export interface RevealTarget {
  file: string;
  path: string;
  nonce: number;
}

// The reveal in progress, shared by every component (one admin per page).
let current: RevealTarget | null = null;
const listeners = new Set<() => void>();

function setTarget(next: RevealTarget | null): void {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * True while a reveal is taking the owner to a field. The layout reads it so that the switch to
 * the field's tab does not scroll the page back to the top.
 */
export function revealInProgress(): boolean {
  return current !== null;
}

/** The reveal in progress, or null. It clears itself shortly after the field was shown. */
export function useRevealTarget(): RevealTarget | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** The field a finding's path starts from: "stats[2]" for "stats[2] (as printed)". */
export function revealFieldPath(path: string): string {
  return candidatePaths(path)[0] ?? '';
}

/**
 * True while a reveal is taking the owner to a field at or inside `path` in the current file.
 * Use it to open a collapsed group (set your open state in an effect when it turns true), not to
 * hold the open state: it turns false again about a second after the field was shown.
 */
export function useRevealOpen(path: string): boolean {
  const file = useScopeFile();
  const target = useRevealTarget();
  return target !== null && target.file === file && pathWithin(revealFieldPath(target.path), path);
}

/**
 * An open state for a collapsible group at `path` that opens itself when a reveal targets a
 * field inside it, and stays open afterwards. Returns [open, setOpen].
 */
export function useCollapsible(path: string, initialOpen = false): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(initialOpen);
  const revealed = useRevealOpen(path);
  useEffect(() => {
    if (revealed) setOpen(true);
  }, [revealed]);
  return [open || revealed, setOpen];
}

const FOCUSABLE = 'input, select, textarea, button, a[href], summary, [tabindex]:not([tabindex="-1"])';
/** Frames to wait for the exact field before settling for its row or group. */
const EXACT_FRAMES = 12;
/** Frames to keep looking at all (about a second and a half). */
const MAX_FRAMES = 90;
/** How long the highlight stays. */
const FLASH_MS = 2000;
/** How long the target stays set after the field was shown, so late renders still open. */
const LINGER_MS = 800;

/** Scrolls an element to the middle of the window, focuses it, and highlights it briefly. */
export function bringIntoView(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  if (!el.matches(FOCUSABLE) && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  el.classList.add('adm-flash');
  window.setTimeout(() => el.classList.remove('adm-flash'), FLASH_MS);
}

/**
 * The shell's reveal handler: run it once, with the router's `go`. Each new `store.reveal`
 * switches the tab (and project) and brings the field into view.
 */
export function useRevealHandler(go: (tab: TabId, project?: string) => void): void {
  const reveal = useAdmin((s) => s.reveal);
  useEffect(() => {
    if (!reveal) return;
    const target: RevealTarget = { file: reveal.file, path: reveal.path, nonce: reveal.nonce };
    setTarget(target);
    const where = locate(reveal.file, reveal.path);
    let raf = 0;
    let timer = 0;
    const finish = () => {
      timer = window.setTimeout(() => {
        if (current === target) setTarget(null);
      }, LINGER_MS);
    };
    if (!where || where.ids.length === 0) {
      finish();
      return () => window.clearTimeout(timer);
    }
    go(where.tab, where.slug);
    let frame = 0;
    const attempt = () => {
      frame += 1;
      const exact = document.getElementById(where.ids[0]);
      const found =
        exact ??
        (frame > EXACT_FRAMES ? where.ids.slice(1).map((id) => document.getElementById(id)).find((el) => el !== null) ?? null : null);
      if (found) {
        bringIntoView(found);
        finish();
        return;
      }
      if (frame < MAX_FRAMES) raf = window.requestAnimationFrame(attempt);
      else finish();
    };
    raf = window.requestAnimationFrame(attempt);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      if (current === target) setTarget(null);
    };
  }, [reveal, go]);
}
