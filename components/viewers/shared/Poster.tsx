import Image from 'next/image';
import { Box, FileText, Film, Image as ImageIcon, Music } from 'lucide-react';
import Icon from '@/components/sheet/Icon';
import { canOptimize, drawnFraction, objectPosition, scaleSizes, type MediaKind, type ResolvedMedia } from '@/lib/media';
import { BODY_SIZES } from './sizes';

/** Lives in lib/media.ts (Phase 4); exported here too for the viewers that import it from this file. */
export { canOptimize };

const KIND_ICONS: Record<MediaKind, typeof Box> = {
  image: ImageIcon,
  video: Film,
  embed: Film,
  model: Box,
  document: FileText,
  audio: Music,
};

/**
 * The still image a viewer paints first. With no poster it draws the well's quiet placeholder
 * (bundle .ar-mv__ph): the kind's mark and the file type in on-night-dim over the grid, so the well
 * never looks broken and never shifts the layout. Works in server and client components.
 *
 * `sizes` describes the well (a viewer in the project body by default); with `wellAspect`, a
 * contained poster narrower than its well asks for the share of that width it is drawn at.
 */
export default function Poster({
  media,
  sizes = BODY_SIZES,
  fit = 'contain',
  priority = false,
  showType = true,
  wellAspect,
}: {
  media: ResolvedMedia;
  sizes?: string;
  fit?: 'contain' | 'cover';
  priority?: boolean;
  showType?: boolean;
  /** The well's width over height. */
  wellAspect?: number;
}) {
  const poster = media.poster;
  if (poster) {
    const natural =
      poster.width && poster.height ? { width: poster.width, height: poster.height } : undefined;
    const drawn = fit === 'contain' && wellAspect ? scaleSizes(sizes, drawnFraction(natural, wellAspect)) : sizes;
    return (
      <Image
        src={poster.src}
        alt=""
        fill
        sizes={drawn}
        priority={priority}
        unoptimized={!canOptimize(poster.src)}
        className={fit === 'cover' ? 'object-cover' : 'object-contain'}
        style={{ objectPosition: objectPosition(media.focal) }}
      />
    );
  }
  return (
    <div className="ar-mv__ph" aria-hidden="true">
      <Icon icon={KIND_ICONS[media.kind] ?? FileText} size={32} strokeWidth={1.25} />
      {showType && <span>{media.file.typeLabel}</span>}
    </div>
  );
}
