'use client';

import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';

/** A layout effect in the browser and a plain effect on the server, where layout effects do nothing. */
export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The lens follows input capability, not width (D-51): a mouse or a pen, which can hover and
 * point finely, gets the pointer lens; anything else gets the scan and the touch lens. The same
 * query is in app/motion-drawing.css.
 */
export const FINE_POINTER = '(hover: hover) and (pointer: fine)';

function subscribeFinePointer(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(FINE_POINTER);
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  // Safari before version 14 has only the older listener methods.
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

function finePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(FINE_POINTER).matches;
}

/**
 * True where the primary pointer is a mouse or a pen, read live (a tablet can gain a mouse). The
 * server answers false and React hydrates with that answer, so the markup always matches.
 */
export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribeFinePointer, finePointer, () => false);
}
