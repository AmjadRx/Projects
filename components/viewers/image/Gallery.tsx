'use client';

import Image from 'next/image';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { animate, useMotionValueEvent, type Transition } from 'motion/react';
import { Carousel, useCarousel, useTicker } from 'motion-plus/react';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import Icon from '@/components/sheet/Icon';
import Placeholder from '@/components/sheet/Placeholder';
import type { ResolvedMedia } from '@/lib/media';
import { objectPosition } from '@/lib/media';
import { UI } from '@/lib/strings';
import { useMotionOk } from '@/lib/useMotionOk';
import Poster, { canOptimize } from '../shared/Poster';
import type { GalleryProps } from '../types';
import { ARRIVAL_STYLE, LoadingWell, usePhotoArrival } from './arrival';
import { naturalSizeOf, stillOf } from './still';
import {
  clampInset,
  frameInset,
  frameInView,
  headsPastEnd,
  nearestFrame,
  nearestRest,
  SAME_PLACE,
  stripMotion,
  swapTransition,
  wheelAlong,
  type FramePosition,
} from './strip';
import { LazyLightbox, useLightbox } from './useLightbox';

/** The strip's height (bundle Gallery, app/sheet.css 18): 440 px, and 360 px on a phone. */
const STRIP_HEIGHT = 440;
const STRIP_HEIGHT_PHONE = 360;
/** The widest the body column draws a single figure: 800 px, and 350 px on a 390 px phone. */
const COLUMN = 800;
const COLUMN_PHONE = 350;
/** Width over height when the server could not read an item's size (the bundle's 3:4). */
const FALLBACK_RATIO = 0.75;
/** The gap between frames, --space-4 (app/sheet.css 18), in px as Carousel measures it. */
const GAP = 16;
/** The strip has been still this long: it has settled (a snap included), and the counter follows. */
const SETTLE_MS = 120;
/**
 * How near the view the strip is when its frames out to the side start to load, and when Carousel
 * is there to move it (Strip says why it is not there at other times).
 */
const NEAR_MARGIN = '300px 0px';

/**
 * The layout Carousel gives its box, its list and each item (motion-plus Ticker, as the strip uses
 * it: no loop, frames aligned to the top), for the still strip that stands in for it: the same
 * size and the same places, so the page never shifts when one takes over from the other.
 */
const STILL_BOX: CSSProperties = { display: 'flex', position: 'relative', overflowX: 'clip', touchAction: 'pan-y' };
const STILL_LIST: CSSProperties = {
  display: 'flex',
  position: 'relative',
  flexDirection: 'row',
  justifyContent: 'flex-start',
  alignItems: 'flex-start',
  gap: `${GAP}px`,
  listStyleType: 'none',
  margin: 0,
  padding: 0,
  width: '100%',
  height: '100%',
  maxWidth: '100%',
  maxHeight: '100%',
};
const STILL_ITEM: CSSProperties = { flexGrow: 0, flexShrink: 0, position: 'relative', height: 'fit-content' };

/** A layout effect in the browser; the server has no layout (and React warns of one there). */
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type ItemKind = 'image' | 'video' | 'model';

function kindOf(item: ResolvedMedia): ItemKind {
  if (item.kind === 'video' || item.kind === 'embed') return 'video';
  if (item.kind === 'model') return 'model';
  return 'image';
}

function ratioOf(item: ResolvedMedia): number {
  const natural = naturalSizeOf(stillOf(item));
  return natural ? natural.width / natural.height : FALLBACK_RATIO;
}

/** Every frame is the strip's height at its own ratio; a single figure is never wider than the column. */
function frameSizes(ratio: number, single: boolean): string {
  const phone = STRIP_HEIGHT_PHONE * ratio;
  const desk = STRIP_HEIGHT * ratio;
  return single
    ? `(max-width: 767px) ${Math.ceil(Math.min(phone, COLUMN_PHONE))}px, ${Math.ceil(Math.min(desk, COLUMN))}px`
    : `(max-width: 767px) ${Math.ceil(phone)}px, ${Math.ceil(desk)}px`;
}

/** A focus the visitor moved by keyboard (a click on a frame focuses it without the ring). */
function keyboardFocus(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** The frame (0, 1, ...) that holds `element`, in the strip whose box is `strip`; -1 outside one. */
function frameIndexOf(element: HTMLElement, strip: HTMLElement): number {
  const item = element.closest('li');
  const list = item?.parentElement;
  if (!item || !list || list.parentElement !== strip) return -1;
  return Array.prototype.indexOf.call(list.children, item) as number;
}

/** The strip's box in the gallery's section: Carousel's, or the still strip's. */
function boxOf(section: HTMLElement | null): HTMLElement | null {
  return section?.querySelector<HTMLElement>(':scope > .mm-gal') ?? null;
}

/**
 * A gallery of photos, videos, and 3D models (bundle Gallery; ARCHITECTURE.md 4): a strip of night
 * wells at one height, each item at its own ratio, that moves sideways, with Previous and Next on a
 * small glass bar, the arrow keys, and a counter. Each item is a button that opens it in the
 * lightbox, whose code loads only then. A video shows its poster with its kind on a tag and the
 * play mark, a model its poster and its tag; an item with no poster shows the placeholder. A photo
 * that does not load turns its frame into the placeholder's error state with Try again.
 *
 * One item: a single figure at the strip's height and its own ratio, never wider than the column,
 * with no drag, no bar and no counter.
 *
 * Motion (motion sheet 6.4, DESIGN_DIRECTION.md 6.3 and 6.4): the strip is Motion+ Carousel. It
 * follows the pointer or finger exactly; on release it glides on its own momentum and snaps so a
 * frame starts at the left edge, past either end it stretches at a fifth of the pointer's travel
 * and springs back, and Previous, Next and the arrow keys move one frame, all with the snap spring
 * (`media.gallery` in lib/motion.ts says how its numbers reach Carousel). A wheel at an end does
 * nothing (Strip). Under reduced motion the strip still follows a drag or a wheel, settles on the
 * nearest frame at once, stops at the ends, and every move takes no time (sheet 8.1). The counter
 * changes at once. A frame whose picture is on its way holds its size and shows the loading well,
 * with the 2 px line along its foot after 600 ms; the picture fades in over 200 ms once it has
 * decoded (Frame; arrival.tsx). The lightbox fades in and out (useLightbox.tsx).
 */
export default function Gallery({ items }: GalleryProps & { sizes?: string }) {
  const { openAt, open, close } = useLightbox();
  const sectionRef = useRef<HTMLElement>(null);
  const motionOk = useMotionOk();
  /** The gallery is near the view (NEAR_MARGIN); null until the first report, and where nothing can tell. */
  const [inRange, setInRange] = useState<boolean | null>(null);
  /**
   * The gallery has come near the view. A lazy image out to the side of the strip would load only
   * when the strip moves to it, so from then on every frame loads at once (a gallery holds a few
   * photos), and a swipe never meets an empty frame.
   */
  const [near, setNear] = useState(false);
  const count = items.length;
  const single = count < 2;

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;
    if (!('IntersectionObserver' in window)) {
      setNear(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        setInRange(entry.isIntersecting);
        if (entry.isIntersecting) setNear(true);
      },
      { rootMargin: NEAR_MARGIN },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  // One element per frame, made again only when the frames change, so Carousel measures them only then.
  const frames = useMemo(
    () =>
      items.map((item, index) => (
        <Frame key={`${item.file.src}-${index}`} item={item} index={index} count={count} eager={near} onOpen={open} />
      )),
    [items, count, near, open],
  );

  if (count === 0) return null;

  const lightbox =
    openAt !== null ? <LazyLightbox items={items} start={openAt} onClose={close} label={UI.viewers.gallery.label} /> : null;

  if (single) {
    return (
      <section ref={sectionRef} className="ar-gal ar-gal--single" aria-label={UI.viewers.gallery.label}>
        <ul className="ar-gal__track">
          <li className="ar-gal__item">{frames[0]}</li>
        </ul>
        {lightbox}
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      className="ar-gal"
      aria-label={UI.viewers.gallery.label}
      aria-roledescription={UI.viewers.gallery.roleDescription}
    >
      <Strip
        frames={frames}
        count={count}
        motionOk={motionOk}
        sectionRef={sectionRef}
        inRange={inRange}
        holding={openAt !== null}
      />
      {lightbox}
    </section>
  );
}

/** What the strip (Strip) asks of the engine inside Carousel, which holds its offsets. */
interface StripApi {
  /** Moves the strip so frame `index` starts at its left edge (or as near as the end allows); the counter says `index`. */
  goTo(index: number): void;
  /** Brings frame `index` wholly into the strip, if it is not already where the strip is heading. */
  reveal(index: number): void;
  /** A pointer pressed the strip: until it lifts, the counter waits. */
  press(): void;
  /** Reduced motion: a press holds the strip where it is drawn. */
  hold(): void;
  /** Reduced motion: a drag let go; the strip settles on the nearest frame, at once. */
  settleNearest(): void;
  /** A wheel moving `along` the strip (wheelAlong) would push it past the end it rests at. */
  atEnd(along: number): boolean;
  /** A press, a move, or a settle still to come: Carousel is still needed. */
  busy(): boolean;
}

/**
 * The strip: Motion+ Carousel, with the gallery's keyboard behavior, Previous, Next, and the
 * counter. Left and right move one frame and take focus with them, so focus never rests on a frame
 * out of view; Tab still visits every frame, and a frame reached by Tab outside the strip's view
 * brings the strip to it. A drag that ends over a frame does not open it.
 *
 * Carousel's Ticker has a focus model of its own, made for the looping ticker: the strip as one
 * tab stop, arrow keys that wrap from the last item to the first and jump without a spring or a
 * limit at the end, and a first keyboard focus sent to item one. It starts on a `focus` event in
 * its box, so the section stops that event on its way down; nothing else here listens for it
 * (React's own focus events are `focusin` and `focusout`). The section also keeps from Carousel a
 * wheel that would push the strip past the end it rests at: Carousel would answer it with a bounce
 * of its own (a spring the sheets do not have, motion or not), and, when every frame fits, move
 * the strip off its frames.
 *
 * Carousel is there only while the strip is near the view (NEAR_MARGIN), or while something still
 * needs it (focus in the strip, the open lightbox, a press or a move not yet settled). Its Ticker
 * keeps Motion's frame loop running every frame for as long as it is mounted, moving or not
 * (motion-plus 4.3.0 calls `useAnimationFrame` with an empty callback at rest), so far from the
 * view the still strip stands in for it: the same frames in the same layout, at rest. Carousel is
 * in the server's markup, so a strip in view never changes hands; one far away does so after the
 * first report. When it comes back near, it rests on the counter's frame, and a frame of the still
 * strip that takes focus (Tab, a screen reader) brings Carousel back with focus on that frame.
 */
function Strip({
  frames,
  count,
  motionOk,
  sectionRef,
  inRange,
  holding,
}: {
  frames: JSX.Element[];
  count: number;
  motionOk: boolean;
  sectionRef: RefObject<HTMLElement>;
  /** The gallery is near the view; null before the first report, and where nothing can tell. */
  inRange: boolean | null;
  /** The lightbox is open: the frame it opened from must still be there when focus goes back to it. */
  holding: boolean;
}) {
  const api = useRef<StripApi | null>(null);
  /** The pointer dragged the strip since it was pressed: the click that ends the drag opens nothing. */
  const dragged = useRef(false);
  const { transition, elastic } = stripMotion(motionOk);
  const [paging] = useState<Record<string, unknown>>(() => ({ ...transition }));
  /** Carousel is mounted (in the server's markup too); the still strip stands in for it otherwise. */
  const [live, setLive] = useState(true);
  /** The counter's frame, kept here so it outlasts Carousel. */
  const [at, setAt] = useState(0);
  /** A frame of the still strip took focus: once Carousel is mounted, focus goes to that frame in it. */
  const refocus = useRef<number | null>(null);
  const restTimer = useRef<number | undefined>(undefined);
  // The latest render's values, for the timer and the handlers, which outlive it.
  const latest = useRef({ inRange, holding });
  latest.current = { inRange, holding };

  useEffect(() => swapTransition(paging, transition), [paging, transition]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;
    const stopFocus = (event: Event) => event.stopPropagation();
    const stopWheel = (event: WheelEvent) => {
      const along = wheelAlong(event);
      if (along === 0 || !api.current?.atEnd(along) || !boxOf(section)?.contains(event.target as Node)) return;
      // As Carousel would (no sideways page scroll, no history swipe), but it never sees the wheel.
      event.preventDefault();
      event.stopPropagation();
    };
    section.addEventListener('focus', stopFocus, true);
    section.addEventListener('wheel', stopWheel, { capture: true, passive: false });
    return () => {
      section.removeEventListener('focus', stopFocus, true);
      section.removeEventListener('wheel', stopWheel, true);
    };
  }, [sectionRef]);

  /** Puts Carousel away while the strip is far from the view, unless something still needs it. */
  const rest = useCallback(() => {
    window.clearTimeout(restTimer.current);
    restTimer.current = undefined;
    const { inRange: near, holding: held } = latest.current;
    if (near !== false || held || refocus.current !== null || api.current?.busy()) return;
    const focused = document.activeElement;
    if (focused && boxOf(sectionRef.current)?.contains(focused)) return;
    setLive(false);
  }, [sectionRef]);

  /** Asks again once the event in hand is over (focus has moved; the page's own effects have run). */
  const restSoon = useCallback(() => {
    window.clearTimeout(restTimer.current);
    restTimer.current = window.setTimeout(rest);
  }, [rest]);

  useEffect(() => () => window.clearTimeout(restTimer.current), []);

  // Near: Carousel. Far: the still strip, after the lightbox has handed focus back to its frame.
  useEffect(() => {
    if (inRange !== false) setLive(true);
    else restSoon();
  }, [inRange, holding, restSoon]);

  const wake = useCallback((index: number) => {
    refocus.current = index;
    setLive(true);
  }, []);

  useClientLayoutEffect(() => {
    const index = refocus.current;
    if (!live || index === null) return;
    refocus.current = null;
    const list = boxOf(sectionRef.current)?.querySelector(':scope > ul');
    list?.children[index]?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [live, sectionRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = frameIndexOf(event.target as HTMLElement, event.currentTarget);
    if (index < 0) return;
    const next = Math.max(0, Math.min(count - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
    event.preventDefault();
    if (next === index) return;
    api.current?.goTo(next);
    const list = event.currentTarget.firstElementChild;
    list?.children[next]?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!keyboardFocus(target)) return;
    const index = frameIndexOf(target, event.currentTarget);
    if (index >= 0) api.current?.reveal(index);
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    // A keyboard's Enter or Space clicks with no pointer (detail 0), and always opens.
    if (dragged.current && event.detail > 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    dragged.current = false;
  };

  const step = (delta: number) => {
    const next = Math.max(0, Math.min(count - 1, at + delta));
    if (next === at) return;
    // The still strip is far from the view: Carousel puts it on this frame when it comes back.
    if (api.current) api.current.goTo(next);
    else setAt(next);
  };

  return (
    <>
      {live ? (
        <Carousel
          className="mm-gal"
          // The section is the labelled region; the strip inside it is not a second one.
          role={undefined}
          aria-roledescription={undefined}
          items={frames}
          loop={false}
          // Without motion no wheel swipe pages the strip: a wheel moves it directly, within its ends.
          snap={motionOk ? 'loose' : false}
          gap={GAP}
          align="start"
          transition={paging as Transition}
          dragElastic={elastic}
          // Without motion the release settles on the nearest frame, not the one a flick heads for.
          onDragEnd={motionOk ? undefined : () => api.current?.settleNearest()}
          onPointerDown={motionOk ? undefined : () => api.current?.hold()}
          onPointerDownCapture={() => {
            dragged.current = false;
            api.current?.press();
          }}
          onDragStart={() => {
            dragged.current = true;
          }}
          onClickCapture={onClickCapture}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={restSoon}
        >
          <StripEngine count={count} motionOk={motionOk} at={at} onAt={setAt} onIdle={restSoon} apiRef={api} />
        </Carousel>
      ) : (
        <StillStrip frames={frames} onFrameFocus={wake} />
      )}
      <div className="ar-gal__bar">
        <button
          type="button"
          className="ar-iconbtn"
          aria-label={UI.viewers.previous}
          title={UI.viewers.previous}
          aria-disabled={at === 0 || undefined}
          onClick={() => step(-1)}
        >
          <Icon icon={ChevronLeft} size={20} />
        </button>
        <button
          type="button"
          className="ar-iconbtn"
          aria-label={UI.viewers.next}
          title={UI.viewers.next}
          aria-disabled={at === count - 1 || undefined}
          onClick={() => step(1)}
        >
          <Icon icon={ChevronRight} size={20} />
        </button>
        <p className="ar-gal__count" aria-live="polite">
          {UI.viewers.itemOf(at + 1, count)}
        </p>
      </div>
    </>
  );
}

/**
 * The strip at rest while Carousel is away (Strip): the same frames in Carousel's layout, starting
 * at the column's edge. It is far from the view, so where it rests is never seen; a frame in it
 * that takes focus calls Carousel back.
 */
function StillStrip({ frames, onFrameFocus }: { frames: JSX.Element[]; onFrameFocus: (index: number) => void }) {
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const index = frameIndexOf(event.target as HTMLElement, event.currentTarget);
    if (index >= 0) onFrameFocus(index);
  };
  return (
    <div className="mm-gal" style={STILL_BOX} onFocus={onFocus}>
      <ul style={STILL_LIST}>
        {frames.map((frame, index) => (
          <li key={frame.key ?? index} className="ticker-item" style={STILL_ITEM}>
            {frame}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Inside Carousel, where its offsets and measurements are: every move the strip makes on its own
 * (Previous, Next, the keys, focus), and the counter's frame once the strip settles. A move
 * animates Carousel's target offset with the snap spring (at once without motion), which the
 * rendered strip follows. After the strip settles from anything else (a drag, a wheel), the counter
 * names the frame starting nearest the left edge, as the native strip did; without motion, a strip
 * left between frames (a wheel) first settles on the nearest frame, at once. It draws nothing.
 */
function StripEngine({
  count,
  motionOk,
  at,
  onAt,
  onIdle,
  apiRef,
}: {
  count: number;
  motionOk: boolean;
  /** The counter's frame (Strip keeps it, so it outlasts Carousel). */
  at: number;
  onAt: (index: number) => void;
  /** Nothing is left to do: the strip has settled, or a press moved nothing. */
  onIdle: () => void;
  apiRef: RefObject<StripApi | null>;
}) {
  const { offset, targetOffset } = useCarousel();
  const { itemPositions, maxInset, direction } = useTicker();
  /** The frame a button, a key, or focus sent the strip to, until it settles there. */
  const heading = useRef<number | null>(null);
  /** A pointer is down on the strip. */
  const pressed = useRef(false);
  /** Lets go of a press's listeners on the window. */
  const unpress = useRef<(() => void) | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const measured = itemPositions.length === count;
  // Carousel's offset runs opposite to the inset on a left-to-right page.
  const sign = direction === 'rtl' ? -1 : 1;

  // The latest render's values, for the handlers, which outlive it.
  const live = useRef({ at, measured, positions: itemPositions as readonly FramePosition[], maxInset, sign, motionOk, onAt, onIdle });
  live.current = { at, measured, positions: itemPositions, maxInset, sign, motionOk, onAt, onIdle };

  const insetNow = () => -targetOffset.get() * live.current.sign;
  const busy = () => pressed.current || settleTimer.current !== undefined || targetOffset.isAnimating();

  const goTo = (index: number) => {
    live.current.at = index;
    live.current.onAt(index);
    // Kept even when the strip is already there (two frames can share the end's place), so a
    // settle still to come keeps the counter on this frame.
    heading.current = index;
    const { measured: ready, positions, maxInset: max, sign: s, motionOk: moving } = live.current;
    // Not measured yet (the strip is not near the view): it is placed once it is.
    if (!ready) return;
    const target = -frameInset(positions, index, max) * s;
    const rendered = offset.get();
    if (Math.abs(target - targetOffset.get()) < SAME_PLACE && Math.abs(target - rendered) < SAME_PLACE) return;
    // Carousel's own paging moves only the drawn offset: start from where the strip is drawn.
    if (Math.abs(rendered - targetOffset.get()) >= SAME_PLACE) targetOffset.jump(rendered);
    animate(targetOffset, target, stripMotion(moving).transition);
  };

  const settle = () => {
    settleTimer.current = undefined;
    // A press still down settles when it lifts.
    if (pressed.current) return;
    const { measured: ready, positions, maxInset: max, motionOk: moving } = live.current;
    if (ready) {
      const inset = insetNow();
      const kept = clampInset(inset, max);
      if (Math.abs(kept - inset) >= SAME_PLACE) {
        // Past an end (the section keeps such a wheel from Carousel; this is the net under it): back to a frame.
        goTo(nearestFrame(positions, kept));
        return;
      }
      const asked = heading.current;
      heading.current = null;
      if (asked === null || Math.abs(inset - frameInset(positions, asked, max)) >= SAME_PLACE) {
        const place = nearestRest(positions, inset, max);
        if (!moving && Math.abs(frameInset(positions, place, max) - inset) >= SAME_PLACE) {
          // Without motion a strip left between frames settles on the nearest one at once, as a drag does (sheet 8.1).
          goTo(place);
          return;
        }
        const nearest = nearestFrame(positions, inset);
        live.current.at = nearest;
        live.current.onAt(nearest);
      }
    }
    live.current.onIdle();
  };

  const settleSoon = () => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(settle, SETTLE_MS);
  };

  useMotionValueEvent(targetOffset, 'change', settleSoon);

  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current);
      unpress.current?.();
    },
    [],
  );

  // Measured, and measured again (Carousel back near the view, a resize, the phone's 360 px strip):
  // the strip rests on the counter's frame.
  useEffect(() => {
    if (!measured || targetOffset.isAnimating() || pressed.current) return;
    const target = -frameInset(itemPositions, live.current.at, maxInset) * sign;
    if (Math.abs(target - targetOffset.get()) < SAME_PLACE) return;
    // The settle this jump brings keeps the counter on its frame, also where two frames share the end.
    heading.current = live.current.at;
    targetOffset.jump(target);
  }, [measured, itemPositions, maxInset, sign, targetOffset]);

  useImperativeHandle(apiRef, () => ({
    goTo,
    reveal(index: number) {
      if (heading.current === index) return;
      const { measured: ready, positions, maxInset: max } = live.current;
      const resting = heading.current !== null ? frameInset(positions, heading.current, max) : insetNow();
      if (ready && frameInView(positions, index, resting, max)) return;
      goTo(index);
    },
    press() {
      unpress.current?.();
      pressed.current = true;
      const from = targetOffset.get();
      const release = () => {
        unpress.current?.();
        pressed.current = false;
        // A drag can end where it let go, with no move after it: the counter still follows. A click moves nothing.
        if (Math.abs(targetOffset.get() - from) >= SAME_PLACE) settleSoon();
        else if (!busy()) live.current.onIdle();
      };
      unpress.current = () => {
        window.removeEventListener('pointerup', release, true);
        window.removeEventListener('pointercancel', release, true);
        unpress.current = null;
      };
      window.addEventListener('pointerup', release, true);
      window.addEventListener('pointercancel', release, true);
    },
    hold() {
      const rendered = offset.get();
      if (Math.abs(rendered - targetOffset.get()) >= SAME_PLACE) targetOffset.jump(rendered);
    },
    settleNearest() {
      const { measured: ready, positions, maxInset: max } = live.current;
      unpress.current?.();
      pressed.current = false;
      if (ready) goTo(nearestRest(positions, insetNow(), max));
    },
    atEnd(along: number) {
      const { measured: ready, maxInset: max, sign: s } = live.current;
      return ready && headsPastEnd(insetNow(), max, along * s);
    },
    busy,
  }));

  return null;
}

/**
 * One frame: the item as a button, or, when its picture did not load, the placeholder with Try
 * again. Its picture arrives once the strip is near (`eager`), when the frames start loading.
 */
function Frame({
  item,
  index,
  count,
  eager,
  onOpen,
}: {
  item: ResolvedMedia;
  index: number;
  count: number;
  /** Load now, wherever the frame is in the strip. */
  eager: boolean;
  onOpen: (index: number, from: HTMLElement | null) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const still = stillOf(item);
  const kind = kindOf(item);
  const ratio = ratioOf(item);
  const single = count < 2;
  const style = { '--r': String(ratio) } as CSSProperties;
  const motionOk = useMotionOk();
  const arrival = usePhotoArrival(imgRef, motionOk && eager && !!still && !failed, attempt);

  // A file that failed before the page became interactive fired its error event too early for React.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0 && img.currentSrc) setFailed(true);
  }, [attempt]);

  if (failed && still) {
    const text =
      kind === 'video'
        ? UI.viewers.gallery.videoDidNotLoad
        : kind === 'model'
          ? UI.viewers.gallery.modelDidNotLoad
          : UI.placeholder.didNotLoad;
    return (
      <div className="ar-gal__frame is-error" style={style}>
        <Placeholder
          state="error"
          text={text}
          alt={item.alt}
          retryLabel={UI.placeholder.tryAgain}
          onRetry={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        />
      </div>
    );
  }

  const kindWord = kind === 'video' ? UI.viewers.kind.video : kind === 'model' ? UI.viewers.kind.model : null;
  return (
    <button type="button" className="ar-gal__frame" style={style} onClick={(event) => onOpen(index, event.currentTarget)}>
      <LoadingWell arrival={arrival} />
      {still ? (
        <Image
          key={attempt}
          ref={imgRef}
          src={still.src}
          alt={item.alt}
          fill
          sizes={frameSizes(ratio, single)}
          loading={eager ? 'eager' : 'lazy'}
          unoptimized={!canOptimize(still.src)}
          draggable={false}
          className="mm-photo"
          data-arrive={arrival.attr}
          style={{ objectFit: 'cover', objectPosition: objectPosition(item.focal), ...ARRIVAL_STYLE }}
          onLoad={arrival.onLoad}
          onError={() => {
            arrival.onError();
            setFailed(true);
          }}
        />
      ) : (
        <Poster media={item} />
      )}
      {kindWord && <span className="ar-gal__kind">{kindWord}</span>}
      {kind === 'video' && still && (
        <span className="ar-gal__play" aria-hidden="true">
          <Icon icon={Play} size={20} />
        </span>
      )}
      <span className="ar-sr">{single ? UI.viewers.image.open : UI.viewers.gallery.openItem(index + 1, count)}</span>
    </button>
  );
}
