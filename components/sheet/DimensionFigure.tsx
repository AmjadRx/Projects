'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { ResolvedMedia } from '@/lib/media';
import type { Callout } from '@/lib/types';
import { cn } from '@/lib/utils';
import CoverImage, { type CoverImageLabels } from './CoverImage';
import { CalloutRow, plateStyle, slotGeometry, slotPaths } from './callouts';
import Icon from './Icon';

const CoverLightbox = dynamic(() => import('./CoverLightbox'), { ssr: false });

// useLayoutEffect warns during server rendering; the measurement only runs in the browser.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

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
          <svg className="ar-dim__svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false">
            {callouts.map((c, i) => {
              const p = slotPaths(slots[i]);
              return (
                <g key={`${c.label}-${i}`}>
                  {p.lines.map((d, j) => (
                    <path key={`c${j}`} className="ar-dim__case ar-dim__draw" d={d} pathLength={1} />
                  ))}
                  {p.lines.map((d, j) => (
                    <path key={`l${j}`} className="ar-dim__ln ar-dim__draw" d={d} pathLength={1} />
                  ))}
                  {p.arrows.map((d, j) => (
                    <path key={`a${j}`} className="ar-dim__arrow" d={d} />
                  ))}
                </g>
              );
            })}
          </svg>
        ) : null}
        {draw ? (
          // On a card the plates show only on hover, so assistive technology does not read them there.
          <div className="ar-dim__plates" aria-hidden={layout === 'over' ? true : undefined}>
            {callouts.map((c, i) => (
              <span key={`${c.label}-${i}`} className="ar-dim__plate" style={plateStyle(slots[i], w)}>
                <span className="ar-dim__label">{c.label}</span>
                <span className="ar-dim__value">{c.value}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {layout !== 'over' ? <CalloutRow callouts={callouts} label={labels.keyFigures} /> : null}
      {open ? <CoverLightbox media={media} onClose={close} /> : null}
    </figure>
  );
}
