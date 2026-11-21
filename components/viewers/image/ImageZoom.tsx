'use client';

import Image from 'next/image';
import { Maximize2 } from 'lucide-react';
import { useRef, type CSSProperties } from 'react';
import Icon from '@/components/sheet/Icon';
import { objectPosition } from '@/lib/media';
import { UI } from '@/lib/strings';
import { useMotionOk } from '@/lib/useMotionOk';
import { cn } from '@/lib/utils';
import Poster, { canOptimize } from '../shared/Poster';
import ViewerFrame from '../shared/ViewerFrame';
import { BODY_SIZES } from '../shared/sizes';
import type { ImageZoomProps } from '../types';
import styles from './image.module.css';
import { drawnFraction, scaleSizes } from '@/lib/media';
import { ARRIVAL_STYLE, LoadingWell, usePhotoArrival } from './arrival';
import { naturalSizeOf, stillOf } from './still';
import { LazyLightbox, useLightbox } from './useLightbox';

/** A photo in its own ratio is never taller than this share of the window. */
const NATURAL_MAX_VH = 80;

/**
 * A photo in the media frame (bundle PhotoViewer): the poster is the photo in its well, served
 * through next/image with the caller's `sizes` and the stored focal point (ARCHITECTURE.md 9). The
 * whole well is one button, marked with the full-screen plate in its top right corner: a click,
 * Enter, or Space opens the lightbox (the photo viewer's full screen), whose code loads only then;
 * zoom and pan happen there.
 *
 * - `cover` (the image block): cover-fitted in a well of `aspect`, 16:10 in the bundle, cropped
 *   around the focal point.
 * - `natural`: the well takes the photo's own ratio, never wider than the photo's natural width,
 *   nor so wide that the photo would be taller than 80 percent of the window.
 * - `contain`: in a well of `aspect`, never enlarged past its natural size (docs/V3_PLAN.md R-15).
 *
 * The alt text is exactly the content's, often empty. The photo's own alt is its text
 * alternative, so it is not repeated as a description.
 *
 * A photo on its way leaves the well at its size with the loading state, and fades in over 200 ms
 * once decoded (motion sheet 8.1; arrival.tsx). A `priority` photo, a likely Largest Contentful
 * Paint, is never held back.
 */
export default function ImageZoom({
  media,
  sizes = BODY_SIZES,
  priority = false,
  fit = 'natural',
  aspect,
  className,
}: ImageZoomProps & { className?: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const { openAt, open, close } = useLightbox();
  const still = stillOf(media);
  const natural = naturalSizeOf(still);
  const motionOk = useMotionOk();
  const arrival = usePhotoArrival(imageRef, motionOk && !priority && !!still);
  const arriving = {
    ref: imageRef,
    'data-arrive': arrival.attr,
    onLoad: arrival.onLoad,
    onError: arrival.onError,
  };
  const ownRatio = natural ? natural.width / natural.height : undefined;
  const wellAspect = (fit === 'natural' ? (ownRatio ?? aspect) : (aspect ?? ownRatio)) ?? 16 / 10;

  // A contained photo narrower than its well is drawn at a share of the well's width: ask for that.
  const containSizes = scaleSizes(sizes, drawnFraction(natural, wellAspect));

  const wrapperStyle: CSSProperties | undefined =
    fit === 'natural' && natural && ownRatio
      ? { maxWidth: `min(${natural.width}px, calc(${NATURAL_MAX_VH}vh * ${ownRatio.toFixed(5)}))` }
      : undefined;

  const picture = still ? (
    fit === 'contain' ? (
      <span
        className={styles.containBox}
        style={natural ? { maxWidth: natural.width, maxHeight: natural.height } : undefined}
      >
        <Image
          {...arriving}
          src={still.src}
          alt={media.alt}
          fill
          sizes={containSizes}
          priority={priority}
          unoptimized={!canOptimize(still.src)}
          draggable={false}
          className={`object-contain ${styles.img} mm-photo`}
          style={{ objectPosition: objectPosition(media.focal), ...ARRIVAL_STYLE }}
        />
      </span>
    ) : (
      <Image
        {...arriving}
        src={still.src}
        alt={media.alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={!canOptimize(still.src)}
        draggable={false}
        className={`object-cover ${styles.img} mm-photo`}
        style={{ objectPosition: objectPosition(media.focal), ...ARRIVAL_STYLE }}
      />
    )
  ) : (
    <Poster media={media} sizes={sizes} />
  );

  const button = (
    <button ref={buttonRef} type="button" className={styles.open} onClick={() => open(0, buttonRef.current)}>
      <LoadingWell arrival={arrival} />
      {picture}
      <span className="ar-sr">{UI.viewers.image.open}</span>
      <span className={cn('ar-mv__full', styles.mark)} aria-hidden="true">
        <span className="ar-mv__btn">
          <Icon icon={Maximize2} size={18} />
        </span>
      </span>
    </button>
  );

  const lightbox = openAt !== null && <LazyLightbox items={[media]} start={0} onClose={close} />;

  return (
    <div className={cn(styles.frame, className)} style={wrapperStyle}>
      <ViewerFrame
        label={UI.viewers.image.lightbox}
        kind={UI.viewers.kind.photo}
        aspect={wellAspect}
        caption={media.caption}
        fileName={media.file.name}
        downloads={[{ file: media.file }]}
        allowFullscreen={false}
        maxWellHeight={fit === 'natural' ? `${NATURAL_MAX_VH}vh` : undefined}
      >
        {button}
      </ViewerFrame>
      {lightbox}
    </div>
  );
}
