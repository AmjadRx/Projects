import { extensionOf, type ResolvedImage, type ResolvedMedia } from '@/lib/media';

/** Extensions that are never a still picture, whatever kind the content gives the file. */
const NOT_STILL = new Set([
  'pdf',
  'doc',
  'docx',
  'mp4',
  'm4v',
  'webm',
  'mov',
  'glb',
  'gltf',
  'stl',
  'obj',
  '3mf',
  'ply',
  'step',
  'stp',
  'mp3',
  'm4a',
  'aac',
  'wav',
  'ogg',
]);

/**
 * The still picture of an item: the photo itself, or the poster of a video, model, or document.
 * Null when there is none, and the caller paints the placeholder instead.
 */
export function stillOf(media: ResolvedMedia): ResolvedImage | null {
  if (media.kind === 'image' && !NOT_STILL.has(media.file.ext)) {
    return { src: media.file.src, width: media.width, height: media.height };
  }
  const poster = media.poster;
  if (poster && !NOT_STILL.has(extensionOf(poster.src))) return poster;
  return null;
}

/** The intrinsic size of a still, when the server could read it. */
export function naturalSizeOf(
  still: ResolvedImage | null,
): { width: number; height: number } | undefined {
  if (still?.width && still.height && still.width > 0 && still.height > 0)
    return { width: still.width, height: still.height };
  return undefined;
}
