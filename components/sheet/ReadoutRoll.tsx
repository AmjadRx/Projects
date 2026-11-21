'use client';

import { AnimateNumber } from 'motion-plus/react';
import { useMemo } from 'react';
import { load } from '@/lib/motion';
import { COUNT_LOCALE, countDelay, type RollProps } from './readoutPlan';

/**
 * One value's count (motion sheet 2.3), loaded on demand by ./readoutCount.ts and never part of a
 * first load: Motion+ AnimateNumber at 0 until `on`, then rolling up to the value, starting
 * `countDelay(index)` after its row (40 ms apart) and running load.readouts.duration with the
 * settle curve. Only the digits move, by transform: the format prints 0 at the value's own width,
 * so no digit comes or goes, and a change of width or a digit's fade would happen at once (sheet
 * 8.3: width never animates).
 */
export default function ReadoutRoll({ plan, index, on }: RollProps) {
  const transition = useMemo(
    () => ({
      y: { duration: load.readouts.duration, ease: load.readouts.ease, delay: countDelay(index) },
      width: { duration: 0 },
      opacity: { duration: 0 },
    }),
    [index],
  );
  return (
    <AnimateNumber locales={COUNT_LOCALE} format={plan.format} trend={1} transition={transition}>
      {on ? plan.n : 0}
    </AnimateNumber>
  );
}
