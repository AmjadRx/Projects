'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import Placeholder from '@/components/sheet/Placeholder';
import type { ResolvedMedia } from '@/lib/media';
import { objectPosition } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import Poster, { canOptimize } from '../shared/Poster';
import type { GalleryProps } from '../types';
import styles from './image.module.css';
import { stillOf } from './still';
import { LazyLightbox, useLightbox } from './useLightbox';

/**
 * A build log entry's photos (bundle RevisionTable: "an entry photo sits in a 16:10 well, 128 px
 * wide"): small night wells, each cropped to fill around the focal point and each a button that
 * opens the entry's photos in the lightbox, whose code loads only then. On a phone a single photo
 * takes the column's width, at most 280 px. A small well whose file does not load shows the mark
 * alone, and the words go to screen readers; reloading the page tries again.
 */
export default function PhotoWells({ items }: GalleryProps) {
  const { openAt, open, close } = useLightbox();
  const count = items.length;
  if (count === 0) return null;
  const sizes = count === 1 ? '(max-width: 767px) 280px, 128px' : '128px';
  return (
    <>
      <ul className={cn(styles.wells, count === 1 && styles.one)} aria-label={UI.viewers.gallery.label}>
        {items.map((item, index) => (
          <li key={`${item.file.src}-${index}`} className={styles.wellItem}>
            <Well item={item} sizes={sizes} label={UI.viewers.gallery.openItem(index + 1, count)} onOpen={(from) => open(index, from)} />
          </li>
        ))}
      </ul>
      {openAt !== null && <LazyLightbox items={items} start={openAt} onClose={close} label={UI.viewers.gallery.label} />}
    </>
  );
}

function Well({
  item,
  sizes,
  label,
  onOpen,
}: {
  item: ResolvedMedia;
  sizes: string;
  label: string;
  onOpen: (from: HTMLElement) => void;
}) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const still = stillOf(item);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0 && img.currentSrc) setFailed(true);
  }, []);

  if (failed) {
    return (
      <div className={cn(styles.well, styles.wellFailed)}>
        <Placeholder state="error" size="sm" text={UI.placeholder.didNotLoad} alt={item.alt} />
      </div>
    );
  }
  return (
    <button type="button" className={styles.well} onClick={(event) => onOpen(event.currentTarget)}>
      {still ? (
        <Image
          ref={imgRef}
          src={still.src}
          alt={item.alt}
          fill
          sizes={sizes}
          unoptimized={!canOptimize(still.src)}
          draggable={false}
          style={{ objectFit: 'cover', objectPosition: objectPosition(item.focal) }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Poster media={item} showType={false} />
      )}
      <span className="ar-sr">{label}</span>
    </button>
  );
}
