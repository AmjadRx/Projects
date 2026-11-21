/**
 * The project cover's srcset (app/(site)/projects/[slug]/page.tsx, COVER_SIZES): next/image reads a
 * vw ratio in `sizes` only after a space, so the space after the last `calc(` is what keeps the
 * srcset, and the cover's preload, to the eight files from 640 px wide up. Without it both list all
 * sixteen widths from 16 px, which no screen of two device px to the CSS px or more can use. Which
 * file Chrome picks at each width was measured in Chrome; this guards the list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getImageProps } from 'next/image';
import { describe, expect, it } from 'vitest';

/** COVER_SIZES as the page writes it (a page module may export only the names Next reads). */
function coverSizes(): string {
  const source = fs.readFileSync(path.resolve('app/(site)/projects/[slug]/page.tsx'), 'utf8');
  const match = /const COVER_SIZES = '([^']+)';/.exec(source);
  if (!match) throw new Error('COVER_SIZES was not found in the project page');
  return match[1];
}

/** The widths a srcset lists, in order ("640w", ...). */
function widths(srcSet: string | undefined): string[] {
  return String(srcSet ?? '')
    .split(', ')
    .map((entry) => entry.trim().split(' ').pop() ?? '');
}

describe('the project cover: sizes and srcset', () => {
  it('draws the cover at its measured widths: 800 px from 1344 px, two thirds of the window less 75 px from 1024 px, else the window less 40 px', () => {
    expect(coverSizes()).toBe('(min-width: 1344px) 800px, (min-width: 1024px) calc(66.67vw - 75px), calc( 100vw - 40px)');
  });

  it('lists in srcset only the eight files from 640 px wide up', () => {
    const { props } = getImageProps({ alt: '', src: '/media/raven/img-7657.jpeg', fill: true, sizes: coverSizes(), priority: true });
    expect(props.sizes).toBe(coverSizes());
    expect(widths(props.srcSet)).toEqual(['640w', '750w', '828w', '1080w', '1200w', '1920w', '2048w', '3840w']);
  });

  it('would list all sixteen widths without the space, which is why it is there', () => {
    const withoutSpace = coverSizes().replace('calc( 100vw', 'calc(100vw');
    const { props } = getImageProps({ alt: '', src: '/media/raven/img-7657.jpeg', fill: true, sizes: withoutSpace, priority: true });
    expect(widths(props.srcSet)).toHaveLength(16);
    expect(widths(props.srcSet)[0]).toBe('16w');
  });
});
