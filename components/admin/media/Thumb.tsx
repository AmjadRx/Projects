'use client';

/**
 * A small picture of a stored file: the photo itself, the poster of a video, model, or document,
 * the waveform of an audio file, or an icon for the kind. Pictures load from the address
 * `displayAddress` gives (a local object address right after an upload, the session route for a
 * repository file, the Blob address otherwise), lazily, and fall back to the icon when they fail.
 * The picture is decorative: the file's name and kind are always written beside it.
 */
import { useEffect, useState } from 'react';
import { AudioLines, Box, Captions, Clapperboard, File, FileText, Film, Image as ImageIcon } from 'lucide-react';
import { cx } from '../ui/cx';
import type { LibraryKind } from './logic';
import styles from './media.module.css';
import { useDisplayAddress } from './services';

const ICONS: Record<LibraryKind, typeof File> = {
  image: ImageIcon,
  video: Film,
  embed: Clapperboard,
  model: Box,
  document: FileText,
  audio: AudioLines,
  captions: Captions,
  file: File,
};

export function KindIcon({ kind, size = 22 }: { kind: LibraryKind; size?: number }) {
  const Icon = ICONS[kind];
  return <Icon size={size} aria-hidden="true" />;
}

/** Peaks from 0 to 1, drawn as bars (at most 48, the loudest of each run). */
function Waveform({ peaks }: { peaks: readonly number[] }) {
  const bars = 48;
  const run = Math.max(1, Math.ceil(peaks.length / bars));
  const values: number[] = [];
  for (let i = 0; i < peaks.length; i += run) values.push(Math.max(...peaks.slice(i, i + run)));
  const width = 100 / Math.max(1, values.length);
  return (
    <svg className={styles.wave} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {values.map((value, i) => {
        const height = Math.max(1.5, value * 38);
        return <rect key={i} x={i * width + width * 0.15} width={width * 0.7} y={20 - height / 2} height={height} />;
      })}
    </svg>
  );
}

export interface ThumbProps {
  kind: LibraryKind;
  /** The file's address: shown itself when it is an image. */
  src?: string | null;
  /** An address to show instead (a library item's preview address). */
  previewSrc?: string | null;
  /** The poster's address, for video, models, and documents. */
  poster?: string | null;
  waveform?: readonly number[] | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Thumb({ kind, src, previewSrc, poster, waveform, size = 'md', className }: ThumbProps) {
  const own = useDisplayAddress(src);
  const posterAddress = useDisplayAddress(poster);
  // A photo shows itself (this session's local copy first); anything else shows its poster.
  const shown = kind === 'image' ? (own && own.startsWith('blob:') ? own : (previewSrc ?? own)) : posterAddress;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [shown]);

  return (
    <div className={cx(styles.thumb, styles[`thumb_${size}`], className)}>
      {shown && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.thumbImg} src={shown} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      ) : kind === 'audio' && waveform && waveform.length > 0 ? (
        <Waveform peaks={waveform} />
      ) : (
        <span className={styles.thumbIcon}>
          <KindIcon kind={kind} size={size === 'sm' ? 18 : 24} />
        </span>
      )}
    </div>
  );
}
