'use client';

import dynamic from 'next/dynamic';
import type { GalleryProps } from '@/components/viewers/types';

/**
 * The photos of one log entry. The gallery code is its own chunk, loaded only when an entry has
 * media: RevisionTable renders this wrapper for those rows alone, so a log with no photos ships
 * no gallery code. The grid still renders on the server, so the photos paint with the page.
 */
const Gallery = dynamic(() => import('@/components/viewers/image/Gallery'));

export default function LogGallery(props: GalleryProps & { sizes?: string }) {
  return <Gallery {...props} />;
}
