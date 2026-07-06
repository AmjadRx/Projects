'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { MediaRef } from '@/lib/types';
import MediaView from '@/components/MediaView';
import { cn } from '@/lib/utils';

/** Horizontal scroll-snap carousel with arrows, dots, counter, and a lightbox. */
export default function Gallery({ items }: { items: MediaRef[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const reduced = useReducedMotion();

  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const slide = el.firstElementChild as HTMLElement | null;
    if (!slide) return;
    setIndex(Math.round(el.scrollLeft / (slide.offsetWidth + 16)));
  }, []);

  const scrollTo = (i: number) => {
    const el = track.current;
    if (!el) return;
    const slide = el.firstElementChild as HTMLElement | null;
    if (!slide) return;
    el.scrollTo({ left: i * (slide.offsetWidth + 16), behavior: reduced ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') setLightbox((v) => (v === null ? v : (v + 1) % items.length));
      if (e.key === 'ArrowLeft') setLightbox((v) => (v === null ? v : (v - 1 + items.length) % items.length));
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [lightbox, items.length]);

  return (
    <div>
      <div className="group relative">
        <div
          ref={track}
          onScroll={onScroll}
          className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto"
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => item.kind === 'image' && setLightbox(i)}
              className="relative aspect-[16/10] w-[85%] shrink-0 snap-start overflow-hidden rounded-md bg-surface md:w-[70%]"
              style={{ border: '1px solid var(--line)' }}
              aria-label={item.alt || `Open image ${i + 1}`}
            >
              <MediaView media={item} placeholderLabel={item.alt || `Image ${i + 1}`} sizes="85vw" />
            </button>
          ))}
        </div>

        {items.length > 1 && (
          <>
            <button
              onClick={() => scrollTo(Math.max(0, index - 1))}
              disabled={index === 0}
              aria-label="Previous"
              className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-bg/80 text-ink opacity-0 backdrop-blur transition-opacity disabled:opacity-0 group-hover:opacity-100 md:flex"
              style={{ border: '1px solid var(--line)' }}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => scrollTo(Math.min(items.length - 1, index + 1))}
              disabled={index === items.length - 1}
              aria-label="Next"
              className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-bg/80 text-ink opacity-0 backdrop-blur transition-opacity disabled:opacity-0 group-hover:opacity-100 md:flex"
              style={{ border: '1px solid var(--line)' }}
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>

      {items.length > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  i === index ? 'w-6 bg-accent' : 'w-1.5 bg-ink-mute/40',
                )}
              />
            ))}
          </div>
          <span className="font-mono text-[11px] text-ink-mute">
            {index + 1} / {items.length}
          </span>
        </div>
      )}

      <AnimatePresence>
        {lightbox !== null && (
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/95 p-4 backdrop-blur md:p-10"
            onClick={() => setLightbox(null)}
            role="dialog"
            aria-modal="true"
          >
            <button
              className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full text-ink"
              style={{ border: '1px solid var(--line)' }}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <div
              className="relative max-h-full w-full max-w-5xl overflow-hidden rounded-md"
              onClick={(e) => e.stopPropagation()}
            >
              <MediaView
                media={items[lightbox]}
                fill={false}
                placeholderLabel={items[lightbox].alt}
              />
              {items[lightbox].caption && (
                <p className="mt-3 text-center text-sm text-ink-dim">{items[lightbox].caption}</p>
              )}
            </div>
            {items.length > 1 && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-xs text-ink-mute">
                {lightbox + 1} / {items.length}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
