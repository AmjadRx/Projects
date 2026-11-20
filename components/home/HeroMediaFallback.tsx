'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The hero's slot in media mode (./Hero.tsx): the photo, or the video behind its poster, as the
 * server drew it (`children`). If that picture does not load, the plan-view drawing takes the slot,
 * with its caption (the states boards, S.5), and never an empty well or the browser's broken-image
 * icon (S.1). The drawing comes from the server as `fallback`, so it stays server code, as
 * HeroModel's fallback does; this leaf only listens.
 *
 * Nothing shifts when the picture fails (S.5): the drawing takes the slot in a box of the height
 * the slot had, read as the picture fails, and fits inside it (.hm-hero__held, app/styles/home.css).
 * Once the window changes width that height no longer holds, and the drawing takes its own size,
 * as in drawing mode; a window that only grows or shrinks in height (a phone's toolbar) keeps it.
 *
 * An image's error does not bubble, so the slot hears it on its way down (capture). A picture that
 * failed before the page came alive fired its error before anything listened: a finished image
 * with no pixels is that case, read once as the slot mounts. A video that will not play keeps its
 * poster and its Play button, so only a picture's error counts.
 */
export default function HeroMediaFallback({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const slot = useRef<HTMLDivElement>(null);
  /** Null while the picture holds the slot; once it has failed, the slot's height then (0 once let go). */
  const [held, setHeld] = useState<number | null>(null);

  useEffect(() => {
    const el = slot.current;
    if (!el) return undefined;
    const fail = (event?: Event) => {
      if (!event || event.target instanceof HTMLImageElement) setHeld(el.getBoundingClientRect().height);
    };
    if (Array.from(el.querySelectorAll('img')).some((img) => img.complete && img.naturalWidth === 0 && img.currentSrc)) fail();
    el.addEventListener('error', fail, true);
    return () => el.removeEventListener('error', fail, true);
  }, []);

  useEffect(() => {
    if (!held) return undefined;
    const width = window.innerWidth;
    const resize = () => {
      if (window.innerWidth !== width) setHeld(0);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [held]);

  if (held === null) {
    return (
      <div ref={slot} className="hm-hero__art">
        {children}
      </div>
    );
  }
  return held ? (
    <div className="hm-hero__art hm-hero__held" style={{ height: held }}>
      {fallback}
    </div>
  ) : (
    <>{fallback}</>
  );
}
