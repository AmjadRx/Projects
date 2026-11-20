'use client';

import { useCallback, useEffect, useRef } from 'react';
import { zoneAt } from './chromeMotion';
import { usePageProgress } from './usePageProgress';

/**
 * The zone marks down the side of the sheet frame (A to F), with the reader's zone lit
 * (DESIGN_DIRECTION.md 4; motion sheet 7.1): the letter in the line color with its 2 px bar on the
 * border (`.is-lit`, app/sheet.css 9). The page progress picks the zone, A for its first sixth and
 * F for its last, and the mark moves at once, as a state; reduced motion changes nothing, since a
 * state is not motion (sheet 8.1). The server lights A, the top of the page.
 *
 * The page progress comes from Motion's scroll measurements; when it crosses into another zone,
 * the class moves on the two marks concerned, and React never renders again for a scroll. The
 * marks come from the server (lib/strings.ts), so the site-wide script chunk does not carry the
 * strings module. Shown from a 1024 px frame, with the frame.
 */
export default function LitZone({ marks }: { marks: readonly string[] }) {
  const list = useRef<HTMLOListElement>(null);
  const lit = useRef(0);
  const zones = marks.length;

  const light = useCallback(
    (progress: number) => {
      const zone = zoneAt(progress, zones);
      const items = list.current?.children;
      if (!items || zone === lit.current) return;
      items[lit.current]?.classList.remove('is-lit');
      items[zone]?.classList.add('is-lit');
      lit.current = zone;
    },
    [zones],
  );

  const read = usePageProgress(light);

  useEffect(() => {
    light(read());
  }, [light, read]);

  return (
    <ol ref={list} className="ar-sheetframe__rows">
      {marks.map((mark, i) => (
        <li key={mark} className={i === 0 ? 'is-lit' : undefined}>
          {mark}
        </li>
      ))}
    </ol>
  );
}
