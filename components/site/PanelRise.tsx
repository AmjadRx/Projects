'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { motionOk, useMotionOk } from '@/lib/useMotionOk';
import { startPanelRise } from './risePanels';

/**
 * The panel rise for every public page (motion sheet 7.2): one leaf, mounted once in
 * components/site/SiteChrome, that renders nothing and watches the panels of `main` (./risePanels.ts).
 * No page file takes part. It starts again on every route change, once the new page has painted,
 * so each page view gets its own once; it stops, and draws every waiting or rising panel in place,
 * when motion may no longer play (reduced motion set during the visit) or the page changes.
 */
export default function PanelRise({ mainId }: { mainId: string }) {
  const ok = useMotionOk();
  const pathname = usePathname();

  useEffect(() => {
    if (!ok) return undefined;
    let stop: (() => void) | null = null;
    // One frame on, after the route's scroll to the top, so "below the window" reads the page as
    // the visitor first sees it.
    const frame = window.requestAnimationFrame(() => {
      const main = document.getElementById(mainId);
      if (main && motionOk()) stop = startPanelRise(main);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      stop?.();
    };
  }, [ok, pathname, mainId]);

  return null;
}
