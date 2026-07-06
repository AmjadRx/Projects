'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { MediaRef } from '@/lib/types';
import { cn, embedSrc } from '@/lib/utils';

interface MediaViewProps {
  media: MediaRef;
  className?: string;
  /** Fill parent (parent must be relative with fixed aspect). */
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  /** Label shown inside the schematic placeholder. */
  placeholderLabel?: string;
}

/** Neutral schematic-grid placeholder per §4.2 — used when media is missing. */
export function MediaPlaceholder({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        'relative flex h-full w-full items-center justify-center overflow-hidden bg-surface-2',
        className,
      )}
      aria-hidden
    >
      <svg className="absolute inset-0 h-full w-full opacity-40" aria-hidden>
        <defs>
          <pattern id="schematic-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path
              d="M 28 0 L 0 0 0 28"
              fill="none"
              stroke="rgb(var(--ink-mute) / 0.25)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#schematic-grid)" />
      </svg>
      <div className="relative flex flex-col items-center gap-2">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden>
          <path d="M6 27 L18 9 L30 27" stroke="rgb(var(--ink-mute))" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M12 20 L24 20" stroke="rgb(var(--ink-mute) / 0.5)" strokeWidth="1.5" />
        </svg>
        {label && (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-mute">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

export default function MediaView({
  media,
  className,
  fill = true,
  sizes = '(max-width: 768px) 100vw, 60vw',
  priority,
  placeholderLabel,
}: MediaViewProps) {
  const [errored, setErrored] = useState(false);
  const missing = media.exists === false || errored;

  if (media.kind === 'embed') {
    const src = embedSrc(media.src);
    if (!src) return <MediaPlaceholder label={placeholderLabel} className={className} />;
    return (
      <div className={cn('relative aspect-video w-full overflow-hidden', className)}>
        <iframe
          src={src}
          title={media.alt ?? 'Embedded video'}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    );
  }

  if (missing) return <MediaPlaceholder label={placeholderLabel} className={className} />;

  if (media.kind === 'video') {
    return (
      <video
        className={cn('h-full w-full object-cover', className)}
        src={media.src}
        poster={media.poster}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        controls
        onError={() => setErrored(true)}
      />
    );
  }

  if (fill) {
    return (
      <Image
        src={media.src}
        alt={media.alt ?? ''}
        fill
        sizes={sizes}
        priority={priority}
        className={cn('object-cover', className)}
        onError={() => setErrored(true)}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={media.src}
      alt={media.alt ?? ''}
      className={cn('h-auto w-full', className)}
      onError={() => setErrored(true)}
    />
  );
}
