import Image from 'next/image';
import { Box, FileText, Film, Image as ImageIcon, Music } from 'lucide-react';
import { extensionOf, isRemoteUrl, objectPosition, type MediaKind, type ResolvedMedia } from '@/lib/media';

const KIND_ICONS: Record<MediaKind, typeof Box> = {
  image: ImageIcon,
  video: Film,
  embed: Film,
  model: Box,
  document: FileText,
  audio: Music,
};

/**
 * True when next/image may optimize the file: local files, and files on the owner's own Blob
 * store when its host is configured (next.config.mjs). SVG and other remote files are served as
 * they are.
 */
export function canOptimize(src: string): boolean {
  if (extensionOf(src) === 'svg') return false;
  if (!isRemoteUrl(src)) return true;
  const blobHost = process.env.NEXT_PUBLIC_BLOB_STORE_HOST;
  if (!blobHost) return false;
  try {
    return new URL(src).hostname === blobHost;
  } catch {
    return false;
  }
}

/**
 * The still image a viewer paints first. With no poster it draws a quiet placeholder with the
 * kind's icon and the file type, so the well never looks broken and never shifts the layout.
 * Works in server and client components.
 */
export default function Poster({
  media,
  sizes = '(min-width: 1280px) 1200px, 100vw',
  fit = 'contain',
  priority = false,
  showType = true,
}: {
  media: ResolvedMedia;
  sizes?: string;
  fit?: 'contain' | 'cover';
  priority?: boolean;
  showType?: boolean;
}) {
  const poster = media.poster;
  if (poster) {
    return (
      <Image
        src={poster.src}
        alt=""
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={!canOptimize(poster.src)}
        className={fit === 'cover' ? 'object-cover' : 'object-contain'}
        style={{ objectPosition: objectPosition(media.focal) }}
      />
    );
  }
  const Icon = KIND_ICONS[media.kind] ?? FileText;
  return (
    <div className="viewer-placeholder" aria-hidden>
      <Icon size={36} strokeWidth={1.25} />
      {showType && <span className="viewer-placeholder__label">{media.file.typeLabel}</span>}
    </div>
  );
}
