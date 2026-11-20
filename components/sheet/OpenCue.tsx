'use client';

import * as m from 'motion/react-m';
import type { ReactNode } from 'react';
import { cards } from '@/lib/motion';
import { useCard, useCardMotion } from './cardContext';

/**
 * The arrow after "Open project" on a featured card (motion sheet 5.2, Open cue; sheet 7.7, Arrow
 * nudge): it moves 3 px to the right in 150 ms while a mouse or pen is over the card, and back on
 * leave. Under reduced motion, or while motion is paused, it stays put; focus never moves it.
 */
export default function OpenCue({ children }: { children: ReactNode }) {
  const card = useCard();
  const motionOk = useCardMotion();
  const nudged = Boolean(card?.hovered) && motionOk;
  return (
    <m.span
      className="ar-card__cue"
      initial={false}
      animate={{ x: nudged ? cards.openCue.nudge : 0 }}
      transition={{ duration: cards.openCue.duration, ease: cards.openCue.ease }}
    >
      {children}
    </m.span>
  );
}
