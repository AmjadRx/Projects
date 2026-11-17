import ImageZoom from '@/components/viewers/image/ImageZoom';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';

export default function ImageBlock({ media }: { media: MediaRef }) {
  const resolved = resolveMedia(media);
  // "Photo to come" belongs to an empty cover only (DESIGN_DIRECTION.md 5.7); an empty image block leaves no trace.
  if (!resolved) return null;
  return <ImageZoom media={resolved} fit="natural" sizes="(min-width: 1280px) 1100px, 100vw" />;
}
