import VideoPlayer from '@/components/viewers/video/VideoPlayer';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';

export default function VideoBlock({ media, scrub }: { media: MediaRef; scrub?: boolean }) {
  const resolved = resolveMedia(media);
  if (!resolved) return null;
  return <VideoPlayer media={resolved} scrub={scrub === true} />;
}
