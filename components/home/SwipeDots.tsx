'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * The marks under the phone's strip of featured cards (the canvas's hm-swipe): one per card, the
 * card in view drawn in the line color. Decorative (the cards themselves are the content), so it
 * is hidden from assistive technology. An IntersectionObserver on the strip, not a scroll
 * listener, follows the card in view; without script the first stays lit. Shown under 768 px only.
 */
export default function SwipeDots({ stripId, count }: { stripId: string; count: number }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const strip = document.getElementById(stripId);
    if (!strip || typeof IntersectionObserver === 'undefined') return undefined;
    const items = Array.from(strip.children);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) setActive(items.indexOf(entry.target));
        }
      },
      { root: strip, threshold: [0.6] },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [stripId]);

  return (
    <div className="hm-swipe" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn('hm-swipe__dot', i === active && 'is-on')} />
      ))}
    </div>
  );
}
