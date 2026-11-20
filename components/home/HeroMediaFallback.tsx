'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The hero's slot in media mode (./Hero.tsx): the photo, or the video behind its poster, as the
 * server drew it (`children`). If that picture does not load, the plan-view drawing takes the slot,
 * with its caption (the states boards, S.5), and never an empty well or the browser's broken-image
 * icon (S.1). The drawing comes from the server as `fallback`, so it stays server code, as
 * HeroModel's fallback does; this leaf only listens.
 *
 * An image's error does not bubble, so the slot hears it on its way down (capture). A picture that
 * failed before the page came alive fired its error before anything listened: a finished image
 * with no pixels is that case, read once as the slot mounts. A video that will not play keeps its
 * poster and its Play button, so only a picture's error counts.
 */
export default function HeroMediaFallback({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const slot = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = slot.current;
    if (!el) return undefined;
    const fail = (event: Event) => {
      if (event.target instanceof HTMLImageElement) setFailed(true);
    };
    if (Array.from(el.querySelectorAll('img')).some((img) => img.complete && img.naturalWidth === 0 && img.currentSrc)) setFailed(true);
    el.addEventListener('error', fail, true);
    return () => el.removeEventListener('error', fail, true);
  }, []);

  return failed ? (
    <>{fallback}</>
  ) : (
    <div ref={slot} className="hm-hero__art">
      {children}
    </div>
  );
}
