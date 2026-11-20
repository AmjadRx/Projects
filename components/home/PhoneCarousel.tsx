'use client';

import { Carousel, useCarousel, useTicker } from 'motion-plus/react';
import { animate, useDragControls, type DragControls, type Transition } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { page } from '@/lib/motion';
import { cardTarget, nearestCardTarget } from './tickerMotion';

/** What the strip around the carousel needs from it: where it is, and how to turn it. */
export interface StripApi {
  page: number;
  pages: number;
  canPrev: boolean;
  canNext: boolean;
  /** Brings card `index` to the strip's start (the last cards as far as the strip goes). */
  toCard: (index: number) => void;
  /**
   * The browser has taken the press over (a page scroll that started on the carousel): its drag
   * ends where it is, with no release, and it comes to rest on the nearest card.
   */
  release: () => void;
}

export interface PhoneCarouselProps {
  id: string;
  items: ReactNode[];
  /** The card to start on: the one the strip showed, or where the carousel last was. */
  start: number;
  /** The gap between cards, px: the scrolling strip's own (app/styles/home.css). */
  gap: number;
  /** Its name, for assistive technology. */
  label: string;
  /** What assistive technology calls it (aria-roledescription; lib/strings.ts). */
  kind: string;
  onApi: (api: StripApi) => void;
  onDragStart: () => void;
}

/**
 * The phone strip of featured projects as a Motion+ Carousel (DESIGN_DIRECTION.md 6.4 and 7;
 * motion sheet 6.4), loaded on demand by FeaturedStrip and mounted only while the strip is in view
 * or just outside it, with motion allowed and not paused (a mounted Carousel keeps Motion's frame
 * loop running; under reduced motion and the pause control the scrolling strip stays). It follows
 * the finger, snaps to a card with the snap spring after a drag, and past either end stretches at a
 * fifth of the pointer's travel. It does not loop: a card is never drawn twice. The cards are the
 * server's own (their tilt, callouts and covers work as anywhere else), each 84% of the strip, in
 * the strip's own box (app/motion-home.css).
 *
 * The Carousel draws its cards only once it has measured them. On the first card, before it has
 * measured, they lie exactly where they will be, and where the strip drew them, so there they show
 * from the start (hm-feat--from-start); on any other card they wait unseen for the measure, which
 * FeaturedStrip lets happen out of the window.
 */
export default function PhoneCarousel({ id, items, start, gap, label, kind, onApi, onDragStart }: PhoneCarouselProps) {
  // The page prop moves the carousel whenever it changes: it is read once, as it mounts.
  const [first] = useState(start);
  const controls = useDragControls();
  const transition: Transition = page.strip.snap;
  const slides = useMemo(
    () =>
      items.map((item, i) => (
        <div key={i} className="hm-feat__item">
          {item}
        </div>
      )),
    [items],
  );
  return (
    <Carousel
      id={id}
      items={slides}
      loop={false}
      snap="page"
      page={first}
      gap={gap}
      // Top-aligned, each card at its own height, as the scrolling strip lays them out.
      align="start"
      transition={transition}
      dragElastic={page.strip.overdrag}
      dragControls={controls}
      className={first === 0 ? 'hm-feat hm-feat--carousel hm-feat--from-start' : 'hm-feat hm-feat--carousel'}
      aria-label={label}
      aria-roledescription={kind}
      onDragStart={onDragStart}
    >
      <StripBridge onApi={onApi} transition={transition} controls={controls} />
    </Carousel>
  );
}

/**
 * Reports the carousel's place to the strip, from inside it (useCarousel, useTicker), and turns it
 * to a card (cardTarget). The turn moves the carousel's own target, as its drag does on release,
 * with the same transition: the Carousel's page steps measure a page a little shorter than a card
 * here and can skip one, and its page jump writes to the console.
 *
 * A page scroll that starts on the carousel starts its drag too, before the browser takes the press
 * over; the Carousel's release, with no sideways speed, would then pick between the next and the
 * previous card and, resting on a card, land on the previous one. `release` ends that drag before
 * the release (DragControls.cancel) and settles on the nearest card instead.
 */
export function StripBridge({ onApi, transition, controls }: { onApi: (api: StripApi) => void; transition: Transition; controls: DragControls }) {
  const { currentPage, totalPages, isPrevActive, isNextActive, targetOffset } = useCarousel();
  const { itemPositions, maxInset, offset } = useTicker();
  const place = useRef({ itemPositions, maxInset, offset });
  place.current = { itemPositions, maxInset, offset };
  useEffect(() => {
    onApi({
      page: currentPage,
      pages: totalPages,
      canPrev: isPrevActive,
      canNext: isNextActive,
      toCard: (index) => {
        const target = cardTarget(place.current.itemPositions, place.current.maxInset, index);
        if (target !== null) animate(targetOffset, target, transition);
      },
      release: () => {
        controls.cancel();
        const target = nearestCardTarget(place.current.itemPositions, place.current.maxInset, place.current.offset.get());
        if (target !== null && target !== targetOffset.get()) animate(targetOffset, target, transition);
      },
    });
  }, [currentPage, totalPages, isPrevActive, isNextActive, targetOffset, transition, controls, onApi]);
  return null;
}
