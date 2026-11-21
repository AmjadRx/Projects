import PanZoom from '@/components/viewers/panzoom/PanZoom';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';

export default function PanzoomBlock({ media }: { media: MediaRef }) {
  const resolved = resolveMedia(media);
  if (!resolved) return null;
  return <PanZoom media={resolved} />;
}
