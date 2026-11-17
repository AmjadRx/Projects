'use client';

import Image from 'next/image';
import { Maximize2 } from 'lucide-react';
import { useRef, type CSSProperties } from 'react';
import { objectPosition } from '@/lib/media';
import { UI } from '@/lib/strings';
import Poster, { canOptimize } from '../shared/Poster';
import ViewerFrame from '../shared/ViewerFrame';
import type { ImageZoomProps } from '../types';
import styles from './image.module.css';
import { drawnFraction, scaleSizes } from '@/lib/media';
import { naturalSizeOf, stillOf } from './still';
import { LazyLightbox, useLightbox } from './useLightbox';

const DEFAULT_SIZES = '(min-width: 1280px) 1100px, 100vw';

/** A photo in its own ratio is never taller than this share of the window. */
const NATURAL_MAX_VH = 80;

/**
 * A photo in the viewer frame (DESIGN_DIRECTION.md 11), served through next/image with the
 * caller's `sizes` and the stored focal point (ARCHITECTURE.md 9). The whole photo is a button:
 * a click, Enter, or Space opens it in the lightbox, whose code loads only then.
 *
 * - `natural`: the well takes the photo's own ratio. The frame is never wider than the photo's
 *   natural width, nor so wide that the photo would be taller than 80 percent of the window.
 * - `contain` and `cover` fill a well of `aspect`. A contained photo is never enlarged past its
 *   natural size; it sits in the middle of the dark well (docs/V3_PLAN.md R-15).
 *
 * The alt text is exactly the content's, often empty. The photo's own alt is its text
 * alternative, so it is not repeated as a description.
 */
export default function ImageZoom({
  media,
  sizes = DEFAULT_SIZES,
  priority = false,
  fit = 'natural',
  aspect,
}: ImageZoomProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { openAt, open, close } = useLightbox();
  const still = stillOf(media);
  const natural = naturalSizeOf(still);
  const ownRatio = natural ? natural.width / natural.height : undefined;
  const wellAspect = (fit === 'natural' ? (ownRatio ?? aspect) : (aspect ?? ownRatio)) ?? 4 / 3;

  // A contained photo narrower than its well is drawn at a share of the well's width: ask for that.
  const containSizes = scaleSizes(sizes, drawnFraction(natural, wellAspect));

  const wrapperStyle: CSSProperties | undefined =
    fit === 'natural' && natural && ownRatio
      ? { maxWidth: `min(${natural.width}px, calc(${NATURAL_MAX_VH}vh * ${ownRatio.toFixed(5)}))` }
      : undefined;

  const picture = still ? (
    fit === 'cover' ? (
      <Image
        src={still.src}
        alt={media.alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={!canOptimize(still.src)}
        draggable={false}
        className={`object-cover ${styles.img}`}
        style={{ objectPosition: objectPosition(media.focal) }}
      />
    ) : (
      <span
        className={styles.containBox}
        style={natural ? { maxWidth: natural.width, maxHeight: natural.height } : undefined}
      >
        <Image
          src={still.src}
          alt={media.alt}
          fill
          sizes={containSizes}
          priority={priority}
          unoptimized={!canOptimize(still.src)}
          draggable={false}
          className={`object-contain ${styles.img}`}
          style={{ objectPosition: objectPosition(media.focal) }}
        />
      </span>
    )
  ) : (
    <Poster media={media} />
  );

  return (
    <div className={styles.frame} style={wrapperStyle}>
      <ViewerFrame
        label={UI.viewers.image.lightbox}
        aspect={wellAspect}
        caption={media.caption}
        download={media.file}
        allowFullscreen={false}
        maxWellHeight={fit === 'natural' ? `${NATURAL_MAX_VH}vh` : undefined}
      >
        <button
          ref={buttonRef}
          type="button"
          className={styles.open}
          onClick={() => open(0, buttonRef.current)}
        >
          {picture}
          <span className="sr-only">{UI.viewers.image.open}</span>
          <span className={styles.mark} aria-hidden>
            <Maximize2 size={14} />
          </span>
        </button>
      </ViewerFrame>
      {openAt !== null && <LazyLightbox items={[media]} start={0} onClose={close} />}
    </div>
  );
}
