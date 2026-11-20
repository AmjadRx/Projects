/**
 * The contract between blocks (server components that resolve content) and viewers (client
 * components that render it). Every prop is serializable and holds only what the page shows.
 */
import type { ResolvedFile, ResolvedMedia } from '@/lib/media';

export type ModelView = 'realistic' | 'blueprint' | 'thermal';

/** A photo that zooms and opens in the lightbox. */
export interface ImageZoomProps {
  media: ResolvedMedia;
  /** The `sizes` attribute for the inline image. */
  sizes?: string;
  priority?: boolean;
  /** How the photo fills its well; "natural" keeps the photo's own ratio. */
  fit?: 'natural' | 'contain' | 'cover';
  /** Ratio of the well when `fit` is not "natural" (width over height). */
  aspect?: number;
}

/** Images, videos, and models, mixed (ARCHITECTURE.md 4). Opens each item in the lightbox. */
export interface GalleryProps {
  items: ResolvedMedia[];
  /** The id of the heading the gallery sits under, which names it; without one it is named "Gallery". */
  labelledBy?: string;
}

export interface VideoPlayerProps {
  /** kind "video" (a file) or "embed" (YouTube or Vimeo). */
  media: ResolvedMedia;
  /** Tie playback to scroll position (fine pointers only, and only when motion is allowed). */
  scrub?: boolean;
  /** Start inside the lightbox: load at once. */
  inLightbox?: boolean;
  /**
   * Move focus to the player's first control when it mounts: the lightbox opened on this item.
   * An item reached with the arrow keys or the Previous and Next buttons leaves focus where it was.
   */
  takeFocus?: boolean;
}

export interface AudioPlayerProps {
  media: ResolvedMedia;
  title?: string;
}

export interface DocumentViewerProps {
  media: ResolvedMedia;
  title?: string;
  docType: 'pdf' | 'docx';
}

export interface ModelViewerProps {
  media: ResolvedMedia;
  /** The views to offer, in order; the first is shown first. Never empty. */
  views: ModelView[];
  /** Offer the exploded-view slider when the model has more than one named part. */
  explode: boolean;
  /** Documented values drawn as leaders in the Blueprint view. */
  callouts: { label: string; value: string }[];
  /** Start inside the lightbox: load at once. */
  inLightbox?: boolean;
}

export interface PanZoomProps {
  media: ResolvedMedia;
}

export interface CompareProps {
  before: ResolvedMedia;
  after: ResolvedMedia;
}

/** A row for any file, with its type and size (the `file` block). */
export interface DownloadRowProps {
  label: string;
  file: ResolvedFile;
  note?: string;
}
