'use client';

import dynamic from 'next/dynamic';
import { Maximize2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import CoverImage, { type CoverImageLabels } from '@/components/sheet/CoverImage';
import Icon from '@/components/sheet/Icon';
import type { ResolvedMedia } from '@/lib/media';

const CoverLightbox = dynamic(() => import('@/components/sheet/CoverLightbox'), { ssr: false });

export interface HeadshotLabels extends CoverImageLabels {
  /** The button's name: the photo opens larger ("Open image"). */
  openImage: string;
}

/**
 * The headshot on /about, as the About board draws it: a 3:4 well on the night color with a rule,
 * the photo cropped to fill around the content's focal point. It keeps the Phase 3 behavior of
 * opening in the site's lightbox, whose code loads on the first open only; a small corner mark
 * says so, as on the project cover. The button lies over the photo, so the photo stays mounted:
 * if it does not load, the button goes and the well shows the error state with Try again.
 */
export default function Headshot({
  media,
  src,
  alt,
  focal,
  sizes,
  priority = false,
  labels,
}: {
  /** The photo itself, for the lightbox. */
  media: ResolvedMedia;
  /** The still to paint: the photo, or a poster. */
  src: string;
  alt: string;
  focal?: { x: number; y: number };
  sizes: string;
  priority?: boolean;
  labels: HeadshotLabels;
}) {
  const openerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const onStatus = useCallback((ok: boolean) => setFailed(!ok), []);
  const close = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <figure className="st-photo">
      <CoverImage
        src={src}
        alt={alt}
        focal={focal}
        sizes={sizes}
        priority={priority}
        retry
        labels={labels}
        onStatus={onStatus}
      />
      {failed ? null : (
        <button type="button" ref={openerRef} className="st-photo__open" onClick={() => setOpen(true)}>
          <span className="ar-sr">{labels.openImage}</span>
          <span className="st-photo__mark" aria-hidden="true">
            <Icon icon={Maximize2} size={14} />
          </span>
        </button>
      )}
      {open ? <CoverLightbox media={media} onClose={close} /> : null}
    </figure>
  );
}
