import Gallery from '@/components/viewers/image/Gallery';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';

/**
 * Images, videos, and models, mixed. Items with an empty source are left out. `labelledBy` is the
 * id of the heading the gallery sits under, which names it (Project.dc.html names each gallery by
 * its heading, "Build photos").
 */
export default function GalleryBlock({ items, labelledBy }: { items: MediaRef[]; labelledBy?: string }) {
  const resolved = items.map(resolveMedia).filter((m) => m !== null);
  if (resolved.length === 0) return null;
  return <Gallery items={resolved} labelledBy={labelledBy} />;
}
