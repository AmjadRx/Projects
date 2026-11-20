'use client';

import { useMotionValueEvent, useScroll } from 'motion/react';
import { useCallback, useRef } from 'react';
import { pageProgress } from './chromeMotion';

/**
 * The page progress for the chrome (motion sheet 7.1), from Motion's useScroll: `onChange` hears
 * every change of it, and the returned function reads it at any time. Nothing goes through React
 * state, so a scroll never renders a component again (docs/V3_PLAN.md D-55).
 *
 * Motion measures the page on scroll and resize events only, one listener for the whole page
 * however many components ask (the sky's host too), and runs no frame loop at rest. As in
 * components/sky/Sky.tsx, trackContentSize stays off: it would read the page's size on every
 * frame. A page that grows without a scroll is measured at the next scroll; a route change
 * scrolls to the top and so is measured at once.
 */
export function usePageProgress(onChange?: (progress: number) => void): () => number {
  const { scrollY, scrollYLength } = useScroll();
  const listener = useRef(onChange);
  listener.current = onChange;
  const read = useCallback(() => pageProgress(scrollY.get(), scrollYLength.get()), [scrollY, scrollYLength]);
  const notify = useCallback(() => listener.current?.(read()), [read]);
  useMotionValueEvent(scrollY, 'change', notify);
  useMotionValueEvent(scrollYLength, 'change', notify);
  return read;
}
