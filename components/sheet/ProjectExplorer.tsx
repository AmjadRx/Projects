'use client';

import { AnimatePresence, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useState, type ReactNode } from 'react';
import { cardsForDomain } from '@/lib/cardMotion';
import { page } from '@/lib/motion';
import { useCardMotion } from './cardContext';
import FilterBar, { type FilterWords } from './FilterBar';
import { layoutFeatures } from './lazyMotion';

/** One card on /projects: its slug, its domain keys, and the card itself, drawn on the server. */
export interface ExplorerItem {
  slug: string;
  domains: string[];
  card: ReactNode;
}

const AT_ONCE = { duration: 0 };

/**
 * The projects list with its domain filter (ARCHITECTURE.md 5; motion sheet 7.4; DESIGN_DIRECTION.md
 * 6.3, Filter projects). The cards are server HTML: with no script every card shows, in sheet order.
 * Choosing a domain changes the pressed button and the count at once; then the cards that stay move
 * to their new places by transform (Motion's `layout`, 300 ms, settle), the cards that leave fade
 * out (150 ms) and are lifted out of the grid at once (AnimatePresence `popLayout`), and the cards
 * that arrive fade in from 100 ms (200 ms). The grid's height changes at once, and focus stays on
 * the pressed filter. Under reduced motion, or while motion is paused, the grid changes at once.
 *
 * The layout features load in their own chunk once the page is interactive (./lazyMotion.ts).
 */
export default function ProjectExplorer({ gridId, filter, items }: { gridId: string; filter: FilterWords; items: ExplorerItem[] }) {
  const [selected, setSelected] = useState('');
  const motionOk = useCardMotion();
  const shown = cardsForDomain(items, selected);

  return (
    <>
      <FilterBar {...filter} selected={selected} onSelect={setSelected} controls={gridId} />
      <LazyMotion features={layoutFeatures}>
        <div id={gridId} className="pj-cards">
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map((item) => (
              <m.div
                key={item.slug}
                className="pj-cards__item"
                layout={motionOk ? 'position' : false}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: motionOk ? page.filter.arrive : AT_ONCE }}
                exit={{ opacity: 0, transition: motionOk ? page.filter.leave : AT_ONCE }}
                transition={{ layout: motionOk ? page.filter.move : AT_ONCE }}
              >
                {item.card}
              </m.div>
            ))}
          </AnimatePresence>
        </div>
      </LazyMotion>
    </>
  );
}
