'use client';

import type { ReactNode } from 'react';
import { PAGE_COVER_ATTR } from '@/lib/cardTransition';

/**
 * The project page's cover, where a card's cover lands (motion sheet 7.3): `data-cover-page` marks
 * it for the card-to-page transition and its reverse on Back (lib/cardTransition.ts).
 */
export default function CoverStage({ slug, children }: { slug: string; children: ReactNode }) {
  return (
    <div className="pj-cover" {...{ [PAGE_COVER_ATTR]: slug }}>
      {children}
    </div>
  );
}
