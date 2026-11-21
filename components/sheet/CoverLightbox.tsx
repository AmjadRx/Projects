'use client';

import { LazyLightbox } from '@/components/viewers/image/useLightbox';
import type { ResolvedMedia } from '@/lib/media';

/**
 * The project cover in the site's lightbox. DimensionFigure loads this module only when the
 * cover is opened, so the lightbox code and its words never sit in a page's first load.
 */
export default function CoverLightbox({ media, onClose }: { media: ResolvedMedia; onClose: () => void }) {
  return <LazyLightbox items={[media]} start={0} onClose={onClose} />;
}
