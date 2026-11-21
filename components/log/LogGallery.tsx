'use client';

import dynamic from 'next/dynamic';
import type { GalleryProps } from '@/components/viewers/types';

/**
 * The photos of one log entry, as the bundle's small 16:10 wells (components/viewers/image/
 * PhotoWells.tsx). Their code is its own chunk, loaded only when an entry has media: RevisionTable
 * renders this wrapper for those rows alone, so a log with no photos ships no gallery code. The
 * wells still render on the server, so the photos paint with the page. The wells set their own
 * image `sizes` (128 px, and up to 280 px for a single photo on a phone).
 */
const PhotoWells = dynamic(() => import('@/components/viewers/image/PhotoWells'));

export default function LogGallery({ items }: GalleryProps) {
  return <PhotoWells items={items} />;
}
