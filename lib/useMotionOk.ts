/**
 * May this page move? `useMotionOk()` is false under `prefers-reduced-motion` and inside /admin,
 * and true otherwise (ARCHITECTURE.md 8; motion sheets 1.1 and 8.2). When it is false, every
 * animated component renders its final state at once and loses no content. The setting is read
 * live: changing it during a visit takes effect at once, without a reload.
 *
 * Hydration. The public pages are static and the server cannot read the visitor's setting, so the
 * server render answers true on public paths (and false on /admin, which the server does know).
 * That cannot cause a hydration mismatch: the hook reads the setting through
 * useSyncExternalStore, and React renders with the same server answer while it hydrates, so the
 * first client render always matches the server HTML. The visitor's real setting arrives in the
 * render right after hydration, and on every change after that. So that the server's answer never
 * shows a reduced-motion visitor anything that moves, server markup stays in its final state: no
 * start state that hides content (sheet 2.4); start states are set on the client only, once the
 * hook has answered.
 *
 * `motionOk()` gives the same answer to code outside React (the sky's render loop, event
 * handlers), and `subscribeMotionOk()` tells such code when the setting changes. Call them in
 * effects, handlers and loops, never during a render, where the hook belongs.
 */
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True on /admin and every path under it. */
export function isAdminPath(pathname: string | null | undefined): boolean {
  return typeof pathname === 'string' && (pathname === '/admin' || pathname.startsWith('/admin/'));
}

let reducedQuery: MediaQueryList | null = null;

/** The reduced-motion media query, made once; null outside a browser. */
function reducedMotionQuery(): MediaQueryList | null {
  if (reducedQuery) return reducedQuery;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  reducedQuery = window.matchMedia(REDUCED_MOTION);
  return reducedQuery;
}

function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
}

/** The server render's answer: the server cannot read the setting (see the file comment). */
function serverPrefersReducedMotion(): boolean {
  return false;
}

/**
 * Calls `onChange` whenever the visitor changes the reduced-motion setting; read `motionOk()`
 * again inside it. Returns the function that stops listening.
 */
export function subscribeMotionOk(onChange: () => void): () => void {
  const query = reducedMotionQuery();
  if (!query) return () => {};
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  // Safari before version 14 has only the older listener methods.
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

/**
 * The same answer as the hook, for code outside React: false under reduced motion and on /admin.
 * Outside a browser it answers false, because nothing moves without one.
 */
export function motionOk(): boolean {
  if (typeof window === 'undefined') return false;
  return !prefersReducedMotion() && !isAdminPath(window.location?.pathname);
}

/** For client components: false under reduced motion (read live) and on /admin, true otherwise. */
export function useMotionOk(): boolean {
  const pathname = usePathname();
  const reduced = useSyncExternalStore(subscribeMotionOk, prefersReducedMotion, serverPrefersReducedMotion);
  return !reduced && !isAdminPath(pathname);
}
