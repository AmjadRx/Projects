'use client';

import Image from 'next/image';
import { Box, Play } from 'lucide-react';
import type { ResolvedMedia } from '@/lib/media';
import { objectPosition } from '@/lib/media';
import { UI } from '@/lib/strings';
import Poster, { canOptimize } from '../shared/Poster';
import type { GalleryProps } from '../types';
import styles from './image.module.css';
import { drawnFraction, scaleSizes } from '@/lib/media';
import { naturalSizeOf, stillOf } from './still';
import { LazyLightbox, useLightbox } from './useLightbox';

const DEFAULT_SIZES = '(min-width: 1280px) 380px, (min-width: 768px) 33vw, 50vw';
const CELL_RATIO = 4 / 3;

/**
 * A gallery of photos, videos, and 3D models (ARCHITECTURE.md 4): a grid of buttons, each
 * opening its item in the lightbox, whose code loads only then. A photo shows through
 * next/image; a video shows its poster with a play mark and a model its poster with a 3D mark
 * (docs/V3_PLAN.md D-63); an item with no poster shows the placeholder. No carousel yet.
 *
 * `sizes` describes one cell; pass it when the gallery sits in a narrow column. A photo contained
 * in its cell (narrower than the cell's 4:3) asks for the share of that width it is drawn at.
 */
export default function Gallery({
  items,
  sizes = DEFAULT_SIZES,
}: GalleryProps & { sizes?: string }) {
  const { openAt, open, close } = useLightbox();
  const count = items.length;
  if (count === 0) return null;
  return (
    <>
      <ul className={styles.grid} aria-label={UI.viewers.gallery.label}>
        {items.map((item, index) => (
          <li key={`${item.file.src}-${index}`}>
            <button
              type="button"
              className={styles.thumb}
              onClick={(event) => open(index, event.currentTarget)}
            >
              <Thumb item={item} sizes={sizes} />
              <span className="sr-only">{UI.viewers.gallery.openItem(index + 1, count)}</span>
            </button>
          </li>
        ))}
      </ul>
      {openAt !== null && (
        <LazyLightbox
          items={items}
          start={openAt}
          onClose={close}
          label={UI.viewers.gallery.label}
        />
      )}
    </>
  );
}

/** The kind of item in words, for items whose kind a mark shows. */
function kindWord(item: ResolvedMedia): string | null {
  if (item.kind === 'video' || item.kind === 'embed') return UI.viewers.video.videoFallback;
  if (item.kind === 'model') return UI.viewers.model.modelFallback;
  return null;
}

/**
 * Fills the cell when the photo has about the cell's ratio and is large enough; otherwise
 * contains it at no more than its natural size in the dark well (docs/V3_PLAN.md R-15).
 */
function fitFor(natural: { width: number; height: number } | undefined): 'cover' | 'contain' {
  if (!natural) return 'cover';
  const offRatio = Math.abs(Math.log(natural.width / natural.height / CELL_RATIO)) > Math.log(1.3);
  return offRatio || natural.width < 320 ? 'contain' : 'cover';
}

function Thumb({ item, sizes }: { item: ResolvedMedia; sizes: string }) {
  const still = stillOf(item);
  const word = kindWord(item);
  if (!still) {
    // The placeholder already shows the kind's icon and the file type.
    return (
      <>
        {word && <span className="sr-only">{word}</span>}
        <Poster media={item} sizes={sizes} />
        {item.alt && <span className="sr-only">{item.alt}</span>}
      </>
    );
  }
  const natural = naturalSizeOf(still);
  const fit = fitFor(natural);
  const drawnSizes = fit === 'contain' ? scaleSizes(sizes, drawnFraction(natural, CELL_RATIO)) : sizes;
  const image = (
    <Image
      src={still.src}
      alt={item.alt}
      fill
      sizes={drawnSizes}
      unoptimized={!canOptimize(still.src)}
      draggable={false}
      className={`${fit === 'cover' ? 'object-cover' : 'object-contain'} ${styles.img}`}
      style={{ objectPosition: objectPosition(item.focal) }}
    />
  );
  const Mark = item.kind === 'model' ? Box : word ? Play : null;
  return (
    <>
      {word && <span className="sr-only">{word}</span>}
      {fit === 'cover' ? (
        image
      ) : (
        <span
          className={styles.containBox}
          style={natural ? { maxWidth: natural.width, maxHeight: natural.height } : undefined}
        >
          {image}
        </span>
      )}
      {Mark && (
        <span className={styles.kindMark} aria-hidden>
          <Mark size={20} />
        </span>
      )}
    </>
  );
}
