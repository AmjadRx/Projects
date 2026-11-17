'use client';

import Image from 'next/image';
import { ChevronsLeftRight } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { aspectOf, objectPosition, type ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { naturalSizeOf, stillOf } from '../image/still';
import DownloadLink from '../shared/DownloadLink';
import Poster, { canOptimize } from '../shared/Poster';
import ViewerFrame from '../shared/ViewerFrame';
import { useInView } from '../shared/hooks';
import type { CompareProps } from '../types';
import styles from './Compare.module.css';

const SIZES = '(min-width: 1280px) 1100px, 100vw';

/**
 * Before and after (ARCHITECTURE.md 13A; DESIGN_DIRECTION.md 11): the two photos stacked in one
 * well with a divider between them. The server HTML already shows the divider at 50 percent.
 *
 * The divider is a real range input (labelled, with arrow keys, Page Up and Down, Home and End,
 * and a spoken value), laid over the photos and drawn as the handle, so keyboard and screen
 * reader use work as soon as the page is interactive. Dragging the divider or the photo loads a
 * small module when the viewer comes near the view (docs/V3_PLAN.md D-63).
 *
 * Both photos go through next/image and are contained in the well at no more than their natural
 * size (docs/V3_PLAN.md R-15), so two photos of the same framing line up.
 */
export default function Compare({ before, after }: CompareProps) {
  const [position, setPosition] = useState(50);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const near = useInView(surfaceRef, '200px');

  useEffect(() => {
    if (!near) return undefined;
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    let detach: (() => void) | undefined;
    let cancelled = false;
    import('./drag')
      .then(({ attachCompareDrag }) => {
        if (!cancelled)
          detach = attachCompareDrag(surface, {
            onChange: setPosition,
            focusTarget: inputRef.current,
          });
      })
      .catch(() => {
        // Dragging stays off; the range input still moves the divider.
      });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [near]);

  const beforeStill = stillOf(before);
  const afterStill = stillOf(after);
  const beforeSize = naturalSizeOf(beforeStill);
  const afterSize = naturalSizeOf(afterStill);
  const aspect = aspectOf(beforeSize, aspectOf(afterSize, 3 / 2));
  // Never wider than the smaller photo's natural width (R-15).
  const widths = [beforeSize?.width, afterSize?.width].filter(
    (w): w is number => typeof w === 'number',
  );
  const maxWidth = widths.length > 0 ? Math.min(...widths) : undefined;

  const captions = [
    before.caption ? `${UI.viewers.compare.before}: ${before.caption}` : '',
    after.caption ? `${UI.viewers.compare.after}: ${after.caption}` : '',
  ].filter(Boolean);

  const rounded = Math.round(position);
  const surfaceStyle = { '--compare-position': `${position}%` } as CSSProperties;
  // No empty row: a photo that is not offered for download has no link (R-16).
  const downloads = before.file.downloadHref || after.file.downloadHref;

  return (
    <div className={styles.frame} style={maxWidth ? { maxWidth } : undefined}>
      <ViewerFrame
        label={UI.viewers.compare.label}
        aspect={aspect}
        caption={captions.length > 0 ? captions.join(' ') : undefined}
        toolbar={
          downloads ? (
            <div className={styles.downloads}>
              <DownloadLink file={before.file} label={UI.viewers.compare.downloadBefore} />
              <DownloadLink file={after.file} label={UI.viewers.compare.downloadAfter} />
            </div>
          ) : undefined
        }
      >
        <div ref={surfaceRef} className={styles.surface} style={surfaceStyle}>
          <Layer media={before} still={beforeStill} side="before" />
          <Layer media={after} still={afterStill} side="after" />
          <input
            ref={inputRef}
            type="range"
            min={0}
            max={100}
            step={1}
            value={rounded}
            onChange={(event) => setPosition(Number(event.target.value))}
            aria-label={UI.viewers.compare.divider}
            aria-valuetext={UI.viewers.compare.position(rounded)}
            className={styles.range}
          />
          <div className={styles.divider} aria-hidden>
            <span className={styles.handle}>
              <ChevronsLeftRight size={18} />
            </span>
          </div>
        </div>
      </ViewerFrame>
    </div>
  );
}

/** One photo with its label; each is clipped to its own side of the divider. */
function Layer({
  media,
  still,
  side,
}: {
  media: ResolvedMedia;
  still: ReturnType<typeof stillOf>;
  side: 'before' | 'after';
}) {
  const natural = naturalSizeOf(still);
  return (
    <div className={cn(styles.layer, side === 'before' ? styles.before : styles.after)}>
      <span
        className={styles.fit}
        style={natural ? { maxWidth: natural.width, maxHeight: natural.height } : undefined}
      >
        {still ? (
          <Image
            src={still.src}
            alt={media.alt}
            fill
            sizes={SIZES}
            unoptimized={!canOptimize(still.src)}
            draggable={false}
            className={styles.img}
            style={{ objectPosition: objectPosition(media.focal) }}
          />
        ) : (
          <Poster media={media} />
        )}
      </span>
      <span className={cn(styles.tag, side === 'before' ? styles.tagBefore : styles.tagAfter)}>
        {side === 'before' ? UI.viewers.compare.before : UI.viewers.compare.after}
      </span>
    </div>
  );
}
