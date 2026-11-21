'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canOptimize, objectPosition } from '@/lib/media';
import Placeholder from './Placeholder';

export interface CoverImageLabels {
  didNotLoad: string;
  tryAgain: string;
}

/**
 * A photo that fills its well (an .ar-well, which sets the 16:10 size), cropped around the
 * content's focal point, through next/image with the caller's `sizes` (the bundle: covers are
 * cropped to fill). The well's night grid shows while it loads, so nothing shifts; a photo still
 * loading once the page is interactive gets the loading line along the well's foot, drawn after
 * 600 ms so a fast file never shows it, and never under reduced motion (bundle.css 10).
 *
 * If the file does not load, the well shows the Placeholder's error state ("Photo did not load",
 * the alt text, and Try again when `retry` is on), never the browser's broken-image icon.
 * `onStatus(true)` tells a parent (DimensionFigure) that the photo has loaded, so it may draw over
 * it, and `onStatus(false)` that it did not. Only real outcomes are reported, never a mount: the
 * parent may move this component in its tree when the photo fails (out of the cover's zoom
 * button), and a fresh copy that reported success on mounting would move it back, for ever.
 */
export default function CoverImage({
  src,
  alt,
  focal,
  sizes,
  priority = false,
  retry = false,
  labels,
  onStatus,
}: {
  src: string;
  alt: string;
  focal?: { x: number; y: number };
  sizes: string;
  priority?: boolean;
  /** Offer Try again on a failed load. Never inside a link (a card is one link). */
  retry?: boolean;
  labels: CoverImageLabels;
  onStatus?: (ok: boolean) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLImageElement>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  const fail = useCallback(() => {
    setLoading(false);
    setFailed(true);
    statusRef.current?.(false);
  }, []);

  // A file that failed before the page became interactive fired its error event too early for
  // React; a finished image with no pixels is that case. One still on its way gets the line once
  // it is in view (a lazy photo starts loading as it nears the window), so its 600 ms wait counts
  // from when the visitor can see the well.
  useEffect(() => {
    const img = ref.current;
    if (!img) return undefined;
    if (img.complete) {
      if (img.naturalWidth === 0 && img.currentSrc) fail();
      else if (img.naturalWidth > 0) statusRef.current?.(true);
      return undefined;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setLoading(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      if (!img.complete) setLoading(true);
    });
    observer.observe(img);
    return () => observer.disconnect();
  }, [attempt, fail]);

  if (failed) {
    return (
      <Placeholder
        state="error"
        text={labels.didNotLoad}
        alt={alt}
        retryLabel={labels.tryAgain}
        onRetry={
          retry
            ? () => {
                setAttempt((n) => n + 1);
                setFailed(false);
              }
            : undefined
        }
      />
    );
  }

  return (
    <>
      <Image
        key={attempt}
        ref={ref}
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={!canOptimize(src)}
        draggable={false}
        style={{ objectFit: 'cover', objectPosition: objectPosition(focal) }}
        onLoad={() => {
          setLoading(false);
          statusRef.current?.(true);
        }}
        onError={fail}
      />
      {loading ? <span className="ar-ph__bar ar-well__bar" aria-hidden="true" /> : null}
    </>
  );
}
