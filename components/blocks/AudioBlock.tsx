import AudioPlayer from '@/components/viewers/audio/AudioPlayer';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';

export default function AudioBlock({ media, title }: { media: MediaRef; title?: string }) {
  const resolved = resolveMedia(media);
  if (!resolved) return null;
  return <AudioPlayer media={resolved} title={title?.trim() || undefined} />;
}
