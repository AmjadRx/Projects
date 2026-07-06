'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { MediaRef } from '@/lib/types';
import MediaView, { MediaPlaceholder } from '@/components/MediaView';

const DroneScene = dynamic(() => import('./DroneScene'), { ssr: false });

interface HeroVisualProps {
  mode: 'scene3d' | 'media';
  media?: MediaRef;
}

/**
 * Hero right column. 3D scene only on ≥768px viewports without reduced motion;
 * otherwise the uploaded media (or a schematic placeholder).
 */
export default function HeroVisual({ mode, media }: HeroVisualProps) {
  const reduced = useReducedMotion();
  const [desktop, setDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const use3d = mode === 'scene3d' && desktop === true && !reduced;

  return (
    <figure className="w-full">
      <div
        className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface md:aspect-square"
        style={{ border: '1px solid var(--line)' }}
      >
        {use3d ? (
          <DroneScene />
        ) : media ? (
          <MediaView media={media} placeholderLabel="Raven" sizes="(max-width: 768px) 100vw, 45vw" priority />
        ) : (
          <MediaPlaceholder label="Raven" />
        )}
      </div>
      <figcaption className="mt-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute">
        Raven · tilt-rotor eVTOL · Stage 1 of 8
      </figcaption>
    </figure>
  );
}
