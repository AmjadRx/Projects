'use client';

import { createContext, useContext } from 'react';
import { useMotionPaused } from '@/lib/motionPause';
import { useMotionOk } from '@/lib/useMotionOk';

/**
 * What a project card tells the pieces inside it (motion sheet 5): whether a mouse or pen is over
 * it. The callouts draw, a video cover plays, a model cover turns and the "Open project" arrow
 * nudges while it is. Touch and keyboard focus never set it.
 */
export interface CardState {
  hovered: boolean;
}

const CardContext = createContext<CardState | null>(null);

export const CardProvider = CardContext.Provider;

/** The enclosing card's state; null outside a card (the project page's cover). */
export function useCard(): CardState | null {
  return useContext(CardContext);
}

/**
 * May the cards move? False under reduced motion, on /admin (useMotionOk), and while the visitor's
 * "Pause motion" control is on (docs/V3_PLAN.md D-67): then every card piece takes its final state
 * at once, as under reduced motion, and loses nothing.
 */
export function useCardMotion(): boolean {
  const motionOk = useMotionOk();
  const paused = useMotionPaused();
  return motionOk && !paused;
}
