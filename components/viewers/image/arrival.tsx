'use client';

/**
 * A photo arriving in its well (motion sheets 6.4 and 8.1; the states boards, S.2 and S.5). The
 * well holds its size from the first paint. A photo still on its way is hidden while the well shows
 * its loading state, where after 600 ms a 2 px line runs along the foot (`LoadingWell`, or the
 * lightbox's own line). Once the photo has decoded it fades in over the well in 200 ms, the well
 * still under it; then the well fades out under the photo and is removed, which shows only where
 * the photo leaves it uncovered (a transparent photo, a contained one). Under reduced motion there
 * is no line and no fade: the photo appears when it arrives.
 */
import { useCallback, useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { cssEasing, media, toMs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * - `idle`: the photo shows as it is. Every photo starts here, in the server's markup too, so
 *   nothing is hidden before scripts run; a photo already painting when the page comes alive, one
 *   that failed, and every photo while motion is not allowed stay here.
 * - `wait`: nothing of the photo has arrived yet: hidden, over the loading well.
 * - `show`: it has decoded (next/image calls `onLoad` after decoding) and fades in over the well,
 *   which then fades out under it.
 * - `done`: both fades are over: the photo is in and the well is gone.
 */
export type ArrivalPhase = 'idle' | 'wait' | 'show' | 'done';

const { photoIn, wellOut } = media.gallery;

/** From `show` to `done`: the photo's fade over the well, then the well's under the photo. */
export const ARRIVAL_SETTLE_MS = toMs(photoIn.duration + wellOut.duration);

/** The next phase when the image is looked at: hidden only while nothing of it has arrived. */
export function arrivalAtStart(image: { complete: boolean; naturalWidth: number } | null, active: boolean): ArrivalPhase {
  if (!active || !image) return 'idle';
  return !image.complete && image.naturalWidth === 0 ? 'wait' : 'idle';
}

/** The two fades (lib/motion.ts), for app/motion-media.css: set on the photo and on its well. */
export const ARRIVAL_STYLE = {
  '--mm-photo-in': `${toMs(photoIn.duration)}ms`,
  '--mm-photo-ease': cssEasing(photoIn.ease),
  '--mm-well-out': `${toMs(wellOut.duration)}ms`,
  '--mm-well-ease': cssEasing(wellOut.ease),
} as CSSProperties;

export interface PhotoArrival {
  phase: ArrivalPhase;
  /** Nothing of the photo has arrived: the loading state shows (the lightbox's line). */
  waiting: boolean;
  /** The loading well is under the photo: while it waits, and while it fades in. */
  underlay: boolean;
  /** For the photo's and its well's `data-arrive`: absent once the photo is in, and while idle. */
  attr: 'wait' | 'show' | undefined;
  onLoad: () => void;
  onError: () => void;
}

/**
 * The arrival of the photo in `imageRef`, while `active` (motion allowed, and the photo is meant to
 * load now). `restart` names what is loading: a new file in the same element (Try again, another
 * item) starts over.
 */
export function usePhotoArrival(imageRef: RefObject<HTMLImageElement>, active: boolean, restart?: unknown): PhotoArrival {
  const [phase, setPhase] = useState<ArrivalPhase>('idle');

  useEffect(() => {
    setPhase(arrivalAtStart(imageRef.current, active));
  }, [active, imageRef, restart]);

  // The photo is in once its fade and the well's are over; the well then goes.
  useEffect(() => {
    if (phase !== 'show') return undefined;
    const timer = window.setTimeout(() => setPhase((current) => (current === 'show' ? 'done' : current)), ARRIVAL_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const onLoad = useCallback(() => setPhase((current) => (current === 'wait' ? 'show' : current)), []);
  // A photo that failed is no longer on its way: its own error state takes the well.
  const onError = useCallback(() => setPhase('idle'), []);

  const attr = phase === 'wait' || phase === 'show' ? phase : undefined;
  return { phase, waiting: phase === 'wait', underlay: attr !== undefined, attr, onLoad, onError };
}

/**
 * A well's loading state (bundle Placeholder, "loading"; app/sheet.css 10): the sheet and its grid
 * at the well's size, and the 2 px line along its foot after 600 ms, 1,400 ms a pass (not drawn
 * under reduced motion). It sits under the photo, which fades in over it, line and all; then it
 * fades out and goes (app/motion-media.css). Decorative: the frame around it keeps its own name.
 * Nothing while the photo needs no well. `small` for wells under 200 px wide.
 */
export function LoadingWell({ arrival, small = false }: { arrival: PhotoArrival; small?: boolean }) {
  if (!arrival.underlay) return null;
  return (
    <span
      className={cn('mm-load ar-ph ar-grid', small && 'ar-ph--sm')}
      data-arrive={arrival.attr}
      style={ARRIVAL_STYLE}
      aria-hidden="true"
    >
      <span className="ar-ph__bar" />
    </span>
  );
}
