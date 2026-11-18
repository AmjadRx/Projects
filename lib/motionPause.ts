/**
 * The visitor's pause-motion choice (docs/V3_PLAN.md D-67 and Q-38): a small toggle in the footer
 * stops the motion that plays by itself. The sky settles to its still image at once; playing
 * starts it again. The choice is kept per browser in localStorage (`stored.motionPaused` in
 * lib/motion.ts, "1" while paused), which the head script (lib/theme.ts) reads before the first
 * paint and mirrors as data-motion-paused on <html>; this store keeps that mark in step.
 *
 * A tiny external store: code outside React reads `motionPaused()` and listens with
 * `subscribeMotionPaused()` (the sky's host); components use `useMotionPaused()`. A change made in
 * another tab arrives through the storage event. Where storage is blocked, the choice still holds
 * for the page. The server render answers "not paused": the server cannot know the choice, and the
 * hook gives React that same answer while it hydrates, so the markup always matches.
 */
import { useSyncExternalStore } from 'react';
import { stored } from './motion';

const PAUSED = '1';

/** The event fired on window when the choice changes in this tab. */
export const MOTION_PAUSED_EVENT = 'ar-motion-paused';

/** The choice when localStorage could not keep it (blocked or full), for the rest of the page. */
let unsaved: boolean | null = null;

/** True while the visitor has paused motion. Outside a browser it answers false. */
export function motionPaused(): boolean {
  if (typeof window === 'undefined') return false;
  if (unsaved !== null) return unsaved;
  try {
    return window.localStorage.getItem(stored.motionPaused) === PAUSED;
  } catch {
    return false;
  }
}

/** Marks <html data-motion-paused> while paused, as the head script does at load. */
function mark(paused: boolean): void {
  const html = document.documentElement;
  if (paused) html.setAttribute('data-motion-paused', 'true');
  else html.removeAttribute('data-motion-paused');
}

/** Pauses or plays motion, remembers the choice in this browser, and tells every listener. */
export function setMotionPaused(paused: boolean): void {
  try {
    if (paused) window.localStorage.setItem(stored.motionPaused, PAUSED);
    else window.localStorage.removeItem(stored.motionPaused);
    unsaved = null;
  } catch {
    unsaved = paused;
  }
  mark(paused);
  window.dispatchEvent(new Event(MOTION_PAUSED_EVENT));
}

/**
 * Calls `onChange` whenever the choice changes, here or in another tab; read `motionPaused()`
 * again inside it. Returns the function that stops listening.
 */
export function subscribeMotionPaused(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    // A null key means another tab cleared all of this site's storage.
    if (event.key !== null && event.key !== stored.motionPaused) return;
    if (unsaved === null) mark(motionPaused());
    onChange();
  };
  window.addEventListener(MOTION_PAUSED_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(MOTION_PAUSED_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function serverSnapshot(): boolean {
  return false;
}

/** For client components: true while the visitor has paused motion. */
export function useMotionPaused(): boolean {
  return useSyncExternalStore(subscribeMotionPaused, motionPaused, serverSnapshot);
}
