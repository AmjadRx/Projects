import ImageZoom from '@/components/viewers/image/ImageZoom';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';

/**
 * A photo in the media frame (bundle PhotoViewer): cover-fitted in a 16:10 well around its focal
 * point, opening whole in the lightbox. "Photo to come" belongs to an empty cover only
 * (DESIGN_DIRECTION.md 5.7); an empty image block leaves no trace.
 */
export default function ImageBlock({ media }: { media: MediaRef }) {
  const resolved = resolveMedia(media);
  if (!resolved) return null;
  return <ImageZoom media={resolved} fit="cover" aspect={16 / 10} />;
}
