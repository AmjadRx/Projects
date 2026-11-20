'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import Icon from '@/components/sheet/Icon';
import { startPanelRise } from '@/components/site/risePanels';
import { useReducedMotion } from '@/components/viewers/shared/hooks';
import { page } from '@/lib/motion';
import { motionOk } from '@/lib/useMotionOk';
import { inWindow, useBrowserLayoutEffect, useFrameWidth, useNearView, useOnScreen } from './nearView';
import type { PhoneCarouselProps, StripApi } from './PhoneCarousel';
import SwipeDots from './SwipeDots';

export interface FeaturedStripLabels {
  /** The carousel's name, for assistive technology. */
  region: string;
  /** What assistive technology calls the carousel (aria-roledescription). */
  kind: string;
  previous: string;
  next: string;
}

/** The strip's cards, in order, in either form. */
function cardsOf(box: HTMLElement | null): HTMLElement[] {
  return box ? Array.from(box.querySelectorAll<HTMLElement>('.hm-feat__item')) : [];
}

/** The index of the card that holds `target`, or -1. */
function cardIndex(box: HTMLElement | null, target: EventTarget | null): number {
  return target instanceof Node ? cardsOf(box).findIndex((card) => card.contains(target)) : -1;
}

/** Scrolls the scrolling strip `el` so that card `index` rests where it snaps. */
function scrollStripTo(el: HTMLElement | null, index: number, behavior: ScrollBehavior): void {
  const card = el?.children[index];
  if (!el || !(card instanceof HTMLElement)) return;
  const pad = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
  el.scrollTo({ left: el.scrollLeft + card.getBoundingClientRect().left - el.getBoundingClientRect().left - pad, behavior });
}

/**
 * Selected work's featured cards (DESIGN_DIRECTION.md 7; the canvas's hm-feat): two across from
 * 768 px, and on a phone a swipe strip where the next card peeks in, with the marks and Previous
 * and Next under it. The server draws the strip, which scrolls natively and snaps with CSS: a
 * tablet or a desktop keeps that grid, and a phone shows it until the carousel comes.
 *
 * On a phone the Motion+ Carousel (./PhoneCarousel.tsx) takes the strip's place, on the card the
 * strip showed: momentum and snap, a stretch at the ends. Its code starts to load once the strip is
 * within page.strip.load window heights of the view. A mounted Carousel asks for every frame even
 * at rest, so it is mounted only once the strip is within page.strip.near of the view, and gives way
 * to the strip again, on its last card, beyond page.strip.far. It takes the strip's place only while
 * the strip is out of the window: the Carousel draws nothing until it has measured itself, and a
 * strip in view may be under a finger. A strip that is in view stays as it is (it scrolls, snaps
 * and answers the buttons by itself) until it has left the window.
 * - Previous, Next and the arrow keys move one card (motion sheet 6.4), so a drag is never the only
 *   way. The buttons always show (docs/V3_PLAN.md D-67); at either end the unavailable one is
 *   phantom.
 * - Focus moves through the cards' links as anywhere else; the carousel brings a card that takes
 *   focus into view, and the arrow keys take focus to the next or previous card. A card that holds
 *   focus when the strip and the carousel trade places holds it after (WCAG 2.4.3).
 * - The click that ends a drag never opens a card, and a mouse press on a card starts the
 *   carousel's drag, never the browser's own drag of its link. A page scroll that starts on the
 *   carousel leaves it on its card.
 * - Cards still waiting to rise into view (components/site/risePanels.ts) when the carousel takes
 *   over rise as they come into view in it, once a page view, as they would have.
 */
export default function FeaturedStrip({ id, items, labels }: { id: string; items: ReactNode[]; labels: FeaturedStripLabels }) {
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const count = items.length;
  const many = count > 1;
  const frameWidth = useFrameWidth(box);
  const swipe = frameWidth !== null && frameWidth <= page.strip.maxWidth && many;
  const reduced = useReducedMotion();
  const [Carousel, setCarousel] = useState<ComponentType<PhoneCarouselProps> | null>(null);
  const coming = useNearView(box, page.strip.load, page.strip.load, swipe && Carousel === null);
  const near = useNearView(box, page.strip.near, page.strip.far, swipe);
  const onScreen = useOnScreen(box, swipe);
  const [mode, setMode] = useState<'strip' | 'carousel'>('strip');
  const [api, setApi] = useState<StripApi | null>(null);
  /** On the scrolling strip: the card in view. */
  const [active, setActive] = useState(0);
  /** The card shown last, by the strip or by the carousel: where the other one starts. */
  const last = useRef(0);
  /** The card that held focus as the strip and the carousel traded places, or -1. */
  const refocus = useRef(-1);
  const gap = useRef(0);
  const rise = useRef(false);
  const dragged = useRef(false);
  const wanted = swipe && near && Carousel !== null && (mode === 'carousel' || onScreen === false);
  /** The carousel, once it has measured itself and said where it is. */
  const live = mode === 'carousel' && api !== null && api.pages > 0 ? api : null;
  const latest = useRef(live);
  latest.current = live;

  useEffect(() => {
    if (!swipe || !coming || Carousel) return undefined;
    let current = true;
    import('./PhoneCarousel').then(
      (mod) => {
        if (current) setCarousel(() => mod.default);
      },
      () => {
        // The scrolling strip stays: it does everything the carousel does, natively.
      },
    );
    return () => {
      current = false;
    };
  }, [swipe, coming, Carousel]);

  /** Before the strip and the carousel trade places: the card that holds focus keeps it, and shows. */
  const keepFocus = () => {
    refocus.current = cardIndex(box.current, document.activeElement);
    if (refocus.current >= 0) last.current = refocus.current;
  };

  // The strip and the carousel trade places before a paint; what the carousel needs from the
  // strip is read while the strip is still in the page.
  useBrowserLayoutEffect(() => {
    if (wanted && mode === 'strip') {
      const el = strip.current;
      // The observers report a moment late: the window may have just reached the strip.
      if (!box.current || inWindow(box.current)) return;
      gap.current = el ? parseFloat(getComputedStyle(el).columnGap) || 0 : 0;
      rise.current = Boolean(el?.querySelector('[data-ar-rise]')) && motionOk();
      keepFocus();
      setMode('carousel');
    } else if (!wanted && mode === 'carousel') {
      keepFocus();
      setApi(null);
      setMode('strip');
    }
  }, [wanted, mode]);

  /** Scrolls the strip to a card: smoothly, or at once under reduced motion (sheet 8.1). */
  const scrollStrip = (index: number) => scrollStripTo(strip.current, index, reduced ? 'auto' : 'smooth');

  // Once they have traded places: back from the carousel, the strip shows at once the card the
  // carousel showed last; and the card that held focus has it again.
  useBrowserLayoutEffect(() => {
    if (mode === 'strip' && last.current !== 0) {
      scrollStripTo(strip.current, last.current, 'auto');
      setActive(last.current);
    }
    const index = refocus.current;
    refocus.current = -1;
    if (index >= 0) cardsOf(box.current)[index]?.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true });
  }, [mode]);

  // The scrolling strip's card in view, for the marks and the buttons.
  useEffect(() => {
    const el = strip.current;
    if (mode !== 'strip' || !swipe || !el || typeof IntersectionObserver === 'undefined') return undefined;
    const cards = Array.from(el.children);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < page.strip.shown) continue;
          const index = cards.indexOf(entry.target);
          last.current = index;
          setActive(index);
        }
      },
      { root: el, threshold: [page.strip.shown] },
    );
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [mode, swipe]);

  // The Carousel's own focus handling expects items that take focus themselves and moves the
  // strip by the focused element's offset, which inside a card is its offset in the card. Focus
  // here moves through the cards' links as anywhere else, and the carousel follows it (onFocus).
  useEffect(() => {
    const el = box.current;
    if (mode !== 'carousel' || !el) return undefined;
    const keep = (event: Event) => event.stopPropagation();
    el.addEventListener('focus', keep, true);
    return () => el.removeEventListener('focus', keep, true);
  }, [mode]);

  // A press on the carousel that the browser takes over (a page scroll that starts on it) ends with
  // no click, and the carousel rests on its card (StripApi.release), never on the next or the
  // previous one. Motion's drag hears the cancel on the window, in the capture phase, through a
  // listener it sets at each press; this one, set as the carousel mounts, is heard first.
  useEffect(() => {
    const el = box.current;
    if (mode !== 'carousel' || !el) return undefined;
    const cancel = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !el.contains(event.target)) return;
      dragged.current = false;
      latest.current?.release();
    };
    window.addEventListener('pointercancel', cancel, true);
    return () => window.removeEventListener('pointercancel', cancel, true);
  }, [mode]);

  // Cards that were waiting below the window rise as they come into view in the carousel.
  useEffect(() => {
    const el = box.current;
    if (mode !== 'carousel' || !rise.current || !el) return undefined;
    let stop: (() => void) | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (motionOk()) stop = startPanelRise(el);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      stop?.();
    };
  }, [mode]);

  const onApi = useCallback((next: StripApi) => {
    setApi(next);
    last.current = next.page;
  }, []);

  const onDragStart = useCallback(() => {
    dragged.current = true;
  }, []);

  const shown = live ? live.page : active;
  const canPrev = live ? live.canPrev : shown > 0;
  const canNext = live ? live.canNext : shown < count - 1;

  /** Brings card `to` into view: the carousel turns to it, the strip scrolls to it. */
  const turn = (to: number) => {
    const target = Math.max(0, Math.min(count - 1, to));
    if (live) live.toCard(target);
    else scrollStrip(target);
  };

  const go = (delta: 1 | -1) => {
    if (delta > 0 ? canNext : canPrev) turn(shown + delta);
  };

  // The arrow keys take focus to the next or previous card; the carousel follows focus (onFocus),
  // the strip scrolls to it.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!many || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = cardIndex(box.current, event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(count - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
    if (next === index) return;
    cardsOf(box.current)[next]?.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true });
    if (mode === 'strip') scrollStrip(next);
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!live) return;
    const index = cardIndex(box.current, event.target);
    if (index >= 0 && index !== live.page) turn(index);
  };

  // A new press starts afresh. The click that ends a drag opens nothing; a click with no press
  // before it (detail 0: Enter on a card's link, or assistive technology) always goes through.
  const onPointerDownCapture = () => {
    dragged.current = false;
  };
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!dragged.current || event.detail === 0) return;
    dragged.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  // In the carousel a mouse press on a card starts its drag, never the browser's own drag of the
  // card's link or picture, which would take the pointer from it.
  const onDragStartCapture = (event: DragEvent<HTMLDivElement>) => {
    if (mode === 'carousel') event.preventDefault();
  };

  return (
    <>
      <div
        ref={box}
        className="hm-feat-box"
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onPointerDownCapture={onPointerDownCapture}
        onClickCapture={onClickCapture}
        onDragStartCapture={onDragStartCapture}
      >
        {mode === 'carousel' && Carousel ? (
          <Carousel
            // Reduced motion changes how it moves: it starts afresh, on the same card.
            key={reduced ? 'still' : 'moving'}
            id={id}
            items={items}
            start={last.current}
            gap={gap.current}
            reduced={reduced}
            label={labels.region}
            kind={labels.kind}
            onApi={onApi}
            onDragStart={onDragStart}
          />
        ) : (
          <div ref={strip} className="hm-feat" id={id}>
            {items.map((item, i) => (
              <div key={i} className="hm-feat__item">
                {item}
              </div>
            ))}
          </div>
        )}
      </div>
      {many ? (
        <div className="hm-swipe">
          <SwipeDots count={count} active={shown} />
          <span className="hm-swipe__nav">
            <button
              type="button"
              className="ar-iconbtn"
              aria-label={labels.previous}
              title={labels.previous}
              aria-controls={id}
              aria-disabled={!canPrev || undefined}
              onClick={() => go(-1)}
            >
              <Icon icon={ChevronLeft} size={20} />
            </button>
            <button
              type="button"
              className="ar-iconbtn"
              aria-label={labels.next}
              title={labels.next}
              aria-controls={id}
              aria-disabled={!canNext || undefined}
              onClick={() => go(1)}
            >
              <Icon icon={ChevronRight} size={20} />
            </button>
          </span>
        </div>
      ) : null}
    </>
  );
}
