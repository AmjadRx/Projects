import Gallery from '@/components/viewers/image/Gallery';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';

/** Images, videos, and models, mixed. Items with an empty source are left out. */
export default function GalleryBlock({ items }: { items: MediaRef[] }) {
  const resolved = items.map(resolveMedia).filter((m) => m !== null);
  if (resolved.length === 0) return null;
  return <Gallery items={resolved} />;
}
