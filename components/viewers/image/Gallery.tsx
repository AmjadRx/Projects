'use client';

import Image from 'next/image';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import Icon from '@/components/sheet/Icon';
import Placeholder from '@/components/sheet/Placeholder';
import type { ResolvedMedia } from '@/lib/media';
import { objectPosition } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import Poster, { canOptimize } from '../shared/Poster';
import { useReducedMotion } from '../shared/hooks';
import type { GalleryProps } from '../types';
import { naturalSizeOf, stillOf } from './still';
import { LazyLightbox, useLightbox } from './useLightbox';

/** The strip's height (bundle Gallery, app/sheet.css 18): 440 px, and 360 px on a phone. */
const STRIP_HEIGHT = 440;
const STRIP_HEIGHT_PHONE = 360;
/** The widest the body column draws a single figure: 800 px, and 350 px on a 390 px phone. */
const COLUMN = 800;
const COLUMN_PHONE = 350;
/** Width over height when the server could not read an item's size (the bundle's 3:4). */
const FALLBACK_RATIO = 0.75;
/** A scroll that has been still this long has settled (snap included). */
const SETTLE_MS = 120;
/** How near the view the strip is when its frames out to the side start to load. */
const NEAR_MARGIN = '300px 0px';

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

/**
 * A gallery of photos, videos, and 3D models (bundle Gallery; ARCHITECTURE.md 4): a strip of night
 * wells at one height, each item at its own ratio, that scrolls sideways and snaps, with Previous
 * and Next on a small glass bar, the arrow keys, and a counter. Each item is a button that opens it
 * in the lightbox, whose code loads only then. A video shows its poster with its kind on a tag and
 * the play mark, a model its poster and its tag; an item with no poster shows the placeholder.
 * A photo that does not load turns its frame into the placeholder's error state with Try again.
 *
 * One item: a single figure at the strip's height and its own ratio, never wider than the column,
 * with no bar and no counter. The glide, the momentum, and the stretch at the ends are Phase 5.
 */
export default function Gallery({ items }: GalleryProps & { sizes?: string }) {
  const { openAt, open, close } = useLightbox();
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState(0);
  /**
   * The strip has come near the view. A lazy image out to the side of a scrolling strip would
   * load only when the strip is scrolled to it, so from then on every frame loads at once (a
   * gallery holds a few photos), and a swipe never meets an empty frame.
   */
  const [near, setNear] = useState(false);
  /** The item a button or a key scrolled to, until that scroll settles. */
  const pending = useRef<number | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const reducedMotion = useReducedMotion();
  const count = items.length;
  const single = count < 2;
  const last = count - 1;

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  useEffect(() => {
    const section = sectionRef.current;
    if (near || !section) return undefined;
    if (!('IntersectionObserver' in window)) {
      setNear(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: NEAR_MARGIN },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [near]);

  const nearest = useCallback((): number => {
    const track = trackRef.current;
    if (!track) return 0;
    let best = 0;
    let distance = Infinity;
    Array.from(track.children).forEach((child, index) => {
      const gap = Math.abs((child as HTMLElement).offsetLeft - track.scrollLeft);
      if (gap < distance) {
        distance = gap;
        best = index;
      }
    });
    return best;
  }, []);

  const scrollToItem = (index: number) => {
    const track = trackRef.current;
    const child = track?.children[index] as HTMLElement | undefined;
    if (!track || !child) return;
    const left = Math.min(child.offsetLeft, track.scrollWidth - track.clientWidth);
    if (Math.abs(left - track.scrollLeft) < 1) {
      pending.current = null;
      return;
    }
    pending.current = index;
    track.scrollTo({ left, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const go = (delta: number) => {
    const next = Math.max(0, Math.min(last, at + delta));
    if (next === at) return;
    setAt(next);
    scrollToItem(next);
  };

  // The counter follows a scroll the visitor made (a swipe, a trackpad, Tab to a hidden item).
  const onScroll = () => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      if (pending.current !== null) {
        pending.current = null;
        return;
      }
      setAt(nearest());
    }, SETTLE_MS);
  };

  // Left and right move one frame and take focus with them, so focus never rests on a frame out of view.
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (single || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const item = (event.target as HTMLElement).closest('li');
    const track = trackRef.current;
    if (!item || !track) return;
    const index = Array.prototype.indexOf.call(track.children, item) as number;
    const next = Math.max(0, Math.min(last, index + (event.key === 'ArrowRight' ? 1 : -1)));
    event.preventDefault();
    if (next === index) return;
    track.children[next]?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    setAt(next);
    scrollToItem(next);
  };

  if (count === 0) return null;

  return (
    <section
      ref={sectionRef}
      className={cn('ar-gal', single && 'ar-gal--single')}
      aria-label={UI.viewers.gallery.label}
      aria-roledescription={single ? undefined : UI.viewers.gallery.roleDescription}
    >
      <ul ref={trackRef} className="ar-gal__track" onScroll={single ? undefined : onScroll} onKeyDown={onKeyDown}>
        {items.map((item, index) => (
          <li key={`${item.file.src}-${index}`} className="ar-gal__item">
            <Frame item={item} index={index} count={count} eager={near} onOpen={open} />
          </li>
        ))}
      </ul>
      {!single && (
        <div className="ar-gal__bar">
          <button
            type="button"
            className="ar-iconbtn"
            aria-label={UI.viewers.previous}
            title={UI.viewers.previous}
            aria-disabled={at === 0 || undefined}
            onClick={() => go(-1)}
          >
            <Icon icon={ChevronLeft} size={20} />
          </button>
          <button
            type="button"
            className="ar-iconbtn"
            aria-label={UI.viewers.next}
            title={UI.viewers.next}
            aria-disabled={at === last || undefined}
            onClick={() => go(1)}
          >
            <Icon icon={ChevronRight} size={20} />
          </button>
          <p className="ar-gal__count" aria-live="polite">
            {UI.viewers.itemOf(at + 1, count)}
          </p>
        </div>
      )}
      {openAt !== null && (
        <LazyLightbox items={items} start={openAt} onClose={close} label={UI.viewers.gallery.label} />
      )}
    </section>
  );
}

/** One frame: the item as a button, or, when its picture did not load, the placeholder with Try again. */
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
          style={{ objectFit: 'cover', objectPosition: objectPosition(item.focal) }}
          onError={() => setFailed(true)}
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
