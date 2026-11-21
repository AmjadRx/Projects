'use client';

import dynamic from 'next/dynamic';
import { LazyMotion, type Variants } from 'motion/react';
import * as m from 'motion/react-m';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { calloutTimeline, type PartTransition } from '@/lib/cardMotion';
import { coverLanding } from '@/lib/cardTransition';
import type { ResolvedMedia } from '@/lib/media';
import { cards } from '@/lib/motion';
import type { Callout } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCard, useCardMotion } from './cardContext';
import CoverImage, { type CoverImageLabels } from './CoverImage';
import { CalloutRow, plateStyle, slotGeometry, slotPaths } from './callouts';
import Icon from './Icon';
import { animationFeatures } from './lazyMotion';

const CoverLightbox = dynamic(() => import('./CoverLightbox'), { ssr: false });

// useLayoutEffect warns during server rendering; the measurement only runs in the browser.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Motion sheet 5.3: the lines draw in 200 ms (settle), the plates fade in over 150 ms from 80 ms and
 * the arrowheads over 120 ms from 120 ms; on leave the same timeline runs backwards. The project
 * page draws with the same parts once its cover has landed (sheet 7.3 times the lines alike:
 * page.cardToPage.callouts).
 */
const TIMELINE = calloutTimeline(cards.callouts);
const AT_ONCE = { duration: 0 };

/** A line is drawn by its length; it shows only while drawn, so a square cap leaves no dot at rest. */
function lineVariants(still: boolean): Variants {
  const draw: PartTransition = TIMELINE.draw.lines;
  const undraw: PartTransition = TIMELINE.undraw.lines;
  return {
    hidden: {
      pathLength: 0,
      opacity: 0,
      transition: still ? AT_ONCE : { pathLength: undraw, opacity: { delay: undraw.delay + undraw.duration, duration: 0 } },
    },
    shown: {
      pathLength: 1,
      opacity: 1,
      transition: still ? AT_ONCE : { pathLength: draw, opacity: { delay: draw.delay, duration: 0 } },
    },
  };
}

function fadeVariants(part: 'arrowheads' | 'plates', still: boolean): Variants {
  return {
    hidden: { opacity: 0, transition: still ? AT_ONCE : TIMELINE.undraw[part] },
    shown: { opacity: 1, transition: still ? AT_ONCE : TIMELINE.draw[part] },
  };
}

/** The three parts' variants, timed (moving) or at once (still: reduced motion). */
const VARIANTS = {
  moving: { lines: lineVariants(false), arrowheads: fadeVariants('arrowheads', false), plates: fadeVariants('plates', false) },
  still: { lines: lineVariants(true), arrowheads: fadeVariants('arrowheads', true), plates: fadeVariants('plates', true) },
};

export interface DimensionFigureLabels extends CoverImageLabels {
  /** The row's name ("Key figures"). */
  keyFigures: string;
  /** The cover button's name when the cover opens in the lightbox ("Open image"). */
  openImage: string;
}

/**
 * The browser half of DimensionCallouts: a photo in its 16:10 well with the dimension lines drawn
 * over it. The lines need the well's rendered size, measured here after the page has painted; they
 * sit in an absolutely placed layer, so measuring moves nothing. On the server and until the
 * measurement the well shows the photo alone.
 *
 * The lines draw with Motion's `pathLength` (sheet 5.3): on a card while a mouse or pen is over it,
 * undrawing in reverse on leave (cardContext); on the project page once, when its photo has loaded
 * and, after a card-to-page transition, once the cover has landed (lib/cardTransition.ts). Under
 * reduced motion, or while motion is paused, they show and go at once. Phones never draw them: the
 * stylesheet hides the layer and shows the row of readouts under the cover instead, on the project
 * page and on a card alike (DESIGN_DIRECTION.md 5.2 and 7). The row is always in the markup; the
 * stylesheet decides where it shows.
 *
 * A photo that does not load turns the figure into the no-photo case: nothing is drawn, and the
 * row shows at every width (layouts auto and row).
 */
export default function DimensionFigure({
  media,
  src,
  alt,
  focal,
  callouts,
  layout,
  drawn,
  zoom,
  retry,
  sizes,
  priority,
  labels,
  className,
}: {
  /** The cover itself, for the lightbox. */
  media: ResolvedMedia;
  src: string;
  alt: string;
  focal?: { x: number; y: number };
  callouts: Callout[];
  layout: 'auto' | 'over' | 'row';
  drawn: boolean;
  zoom: boolean;
  retry: boolean;
  sizes: string;
  priority: boolean;
  labels: DimensionFigureLabels;
  className?: string;
}) {
  const wellRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const [failed, setFailed] = useState(false);
  // The callouts wait for the photo: they draw once it has loaded (the bundle's loading state).
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  // The project page: the cover has landed, and its callouts draw (once).
  const [landed, setLanded] = useState(false);
  const card = useCard();
  const motionOk = useCardMotion();

  useIsomorphicLayoutEffect(() => {
    const el = wellRef.current;
    if (!el) return undefined;
    const update = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w && h) setSize((prev) => (prev[0] === w && prev[1] === h ? prev : [w, h]));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onStatus = useCallback((ok: boolean) => {
    setFailed(!ok);
    if (ok) setLoaded(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus({ preventScroll: true });
  }, []);

  const [w, h] = size;
  const draw = loaded && !failed && callouts.length > 0 && w > 0 && h > 0;
  const slots = draw ? slotGeometry(w, h) : [];

  // On the project page the callouts draw as the cover lands: after a card's transition has
  // finished, or at once when the page was opened any other way.
  useEffect(() => {
    if (!drawn || !draw || landed) return undefined;
    const landing = coverLanding();
    if (!landing) {
      setLanded(true);
      return undefined;
    }
    let current = true;
    void landing.then(() => {
      if (current) setLanded(true);
    });
    return () => {
      current = false;
    };
  }, [drawn, draw, landed]);

  const on = drawn ? landed : Boolean(card?.hovered);
  const still = !motionOk;
  const state = on ? 'shown' : 'hidden';
  const { lines, arrowheads, plates } = still ? VARIANTS.still : VARIANTS.moving;

  // The photo stays mounted in one place whatever happens to it: the button that opens the
  // lightbox is a layer over it, not a wrapper, so a failed photo never moves in the tree, never
  // remounts, and is never fetched again on its own (Try again asks for it).
  return (
    <figure className={cn('ar-dim', `ar-dim--${layout}`, drawn && 'is-drawn', failed && 'ar-dim--nophoto', className)}>
      <div className="ar-well" ref={wellRef}>
        <CoverImage
          src={src}
          alt={alt}
          focal={focal}
          sizes={sizes}
          priority={priority}
          retry={retry}
          labels={labels}
          onStatus={onStatus}
        />
        {zoom && !failed ? (
          <button type="button" ref={openerRef} className="ar-dim__zoom" onClick={() => setOpen(true)}>
            <span className="ar-sr">{labels.openImage}</span>
            <span className="ar-dim__mark" aria-hidden="true">
              <Icon icon={Maximize2} size={14} />
            </span>
          </button>
        ) : null}
        {draw ? (
          <LazyMotion features={animationFeatures}>
            <svg className="ar-dim__svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false">
              {callouts.map((c, i) => {
                const p = slotPaths(slots[i]);
                return (
                  <g key={`${c.label}-${i}`}>
                    {p.lines.map((d, j) => (
                      <m.path key={`c${j}`} className="ar-dim__case" d={d} variants={lines} initial="hidden" animate={state} />
                    ))}
                    {p.lines.map((d, j) => (
                      <m.path key={`l${j}`} className="ar-dim__ln" d={d} variants={lines} initial="hidden" animate={state} />
                    ))}
                    {p.arrows.map((d, j) => (
                      <m.path key={`a${j}`} className="ar-dim__arrow" d={d} variants={arrowheads} initial="hidden" animate={state} />
                    ))}
                  </g>
                );
              })}
            </svg>
            {/* On a card the plates show only on hover, so assistive technology does not read them there; on a phone the row carries them. */}
            <div className="ar-dim__plates" aria-hidden={layout === 'over' ? true : undefined}>
              {callouts.map((c, i) => (
                <m.span
                  key={`${c.label}-${i}`}
                  className="ar-dim__plate"
                  style={plateStyle(slots[i], w)}
                  variants={plates}
                  initial="hidden"
                  animate={state}
                >
                  <span className="ar-dim__label">{c.label}</span>
                  <span className="ar-dim__value">{c.value}</span>
                </m.span>
              ))}
            </div>
          </LazyMotion>
        ) : null}
      </div>
      <CalloutRow callouts={callouts} label={labels.keyFigures} />
      {open ? <CoverLightbox media={media} onClose={close} /> : null}
    </figure>
  );
}
