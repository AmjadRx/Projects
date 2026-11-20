'use client';

import { useScroll, useTransform, type MotionValue } from 'motion/react';
import { useEffect, useRef, type RefObject } from 'react';
import { heroScrollProgress } from './orbit';

/** The hero section around the stage: the element whose scroll the rotors follow. */
function heroOf(stage: Element): Element {
  return stage.closest('section') ?? stage;
}

/**
 * Motion sheet 4.3: the hero's own scroll progress, 0 with the page at rest and 1 when the hero's
 * bottom edge reaches the bottom of the nav, linear and clamped (orbit.ts heroScrollProgress). A
 * motion value from Motion's page scroll (measured on scroll and resize only, so nothing runs at
 * rest), never React state. The hero's height is measured on mount and whenever it resizes.
 */
export function useHeroScroll(stageRef: RefObject<Element>): MotionValue<number> {
  const { scrollY } = useScroll();
  const length = useRef(0);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const section = heroOf(stage);
    const measure = () => {
      length.current = section.getBoundingClientRect().height;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    return () => observer.disconnect();
  }, [stageRef]);

  return useTransform(scrollY, (y) => {
    if (length.current <= 0 && stageRef.current) length.current = heroOf(stageRef.current).getBoundingClientRect().height;
    return heroScrollProgress(y, length.current);
  });
}
