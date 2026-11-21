'use client';

import { useMotionPaused } from '@/lib/motionPause';
import { useMotionOk } from '@/lib/useMotionOk';

/**
 * May the model viewers move? False under reduced motion, on /admin (useMotionOk), and while the
 * visitor's "Pause motion" control is on (D-67): then the model does not turn by itself, a drag
 * follows with no glide, zoom, reset and view switches are at once, and the hero has no lens, no
 * rotor tilt, and no return to its view. The visitor's own drag still orbits (sheet 1.1).
 *
 * Like useMotionOk, the server render and the first client render answer true; the engine only
 * mounts later, after the visitor's real setting has arrived.
 */
export function useModelMotion(): boolean {
  const ok = useMotionOk();
  const paused = useMotionPaused();
  return ok && !paused;
}
