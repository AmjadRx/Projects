import Image from 'next/image';
import { canOptimize } from '@/components/viewers/shared/Poster';
import { drawnFraction, objectPosition, scaleSizes, type ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';

/**
 * How a photo sits in a fixed-ratio well. Small or off-ratio photos are contained at no more
 * than their natural size inside the dark well; the rest fill it, cropped around the stored focal
 * point (docs/V3_PLAN.md R-15).
 */
export function fitFor(media: ResolvedMedia, wellAspect: number, minWidth = 900): 'cover' | 'contain' {
  if (!media.width || !media.height) return 'cover';
  const ratio = media.width / media.height;
  const offRatio = Math.abs(Math.log(ratio / wellAspect)) > Math.log(1.3);
  return offRatio || media.width < minWidth ? 'contain' : 'cover';
}

/**
 * A still image inside a positioned well (the parent sets the size and ratio). For a video or a
 * model it shows the poster; with no image at all it shows the "Photo to come" placeholder.
 */
export default function MediaImage({
  media,
  sizes,
  wellAspect,
  priority = false,
}: {
  media: ResolvedMedia | null;
  sizes: string;
  /** The well ratio (width over height), used to choose between filling and containing. */
  wellAspect: number;
  priority?: boolean;
}) {
  const still = media?.kind === 'image' ? { src: media.file.src, width: media.width, height: media.height } : media?.poster;
  if (!media || !still) return <PhotoPlaceholder />;

  const fit = media.kind === 'image' ? fitFor(media, wellAspect) : 'contain';
  const unoptimized = !canOptimize(still.src);
  if (fit === 'contain' && still.width && still.height) {
    // A contained picture fills only part of the well's width; ask for a file that size.
    const drawnSizes = scaleSizes(sizes, drawnFraction({ width: still.width, height: still.height }, wellAspect));
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Image
          src={still.src}
          alt={media.alt}
          width={still.width}
          height={still.height}
          sizes={drawnSizes}
          priority={priority}
          unoptimized={unoptimized}
          style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
        />
      </div>
    );
  }
  return (
    <Image
      src={still.src}
      alt={media.alt}
      fill
      sizes={sizes}
      priority={priority}
      unoptimized={unoptimized}
      className={fit === 'cover' ? 'object-cover' : 'object-contain'}
      style={{ objectPosition: objectPosition(media.focal) }}
    />
  );
}

/** "Photo to come": the grid and a crosshair, no stock or generated picture (DESIGN_DIRECTION.md 5.7). */
export function PhotoPlaceholder() {
  return (
    <div className="placeholder-photo">
      <span className="placeholder-photo__label">{UI.placeholder.photoToCome}</span>
    </div>
  );
}
