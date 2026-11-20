/**
 * The Open Graph image each page names in its metadata: the address of its generated image, with
 * a version that changes whenever what the image draws changes (so a link preview never keeps an
 * outdated image), its size, its type, and an alt text built from the fields it shows.
 *
 * The pages name their images themselves rather than leaving it to Next's file convention, which
 * can give an image only one fixed alt text, while each project's image needs its own; a page's
 * own `openGraph.images` also wins over the file-based image (docs/V3_PLAN.md 5.7).
 */
import 'server-only';
import { fillMetadataSegment } from 'next/dist/lib/metadata/get-metadata-route';
import { hasText } from '../format';
import { resolveMedia } from '../media-server';
import type { Site } from '../types';
import { cardAlt, cardVersion, homeCard, OG_HEIGHT, OG_WIDTH, type Card } from './cards';
import { blueprintPalette } from './palette';
import { siteProjectCard } from './site-cards';

export interface MetaImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  type?: string;
}

/**
 * The folder of each image route under app/, as Next names it: a folder inside a route group gets
 * a suffix from Next (app/(site)/projects/[slug]/opengraph-image.tsx answers at
 * /projects/<slug>/opengraph-image-<suffix>), so the address comes from Next's own helper, the one
 * its generated metadata uses. tests/build/hiding.test.ts checks every address against the build.
 */
const HOME_SEGMENT = '';
const PROJECT_SEGMENT = '/(site)/projects/[slug]';
const ROUTE = 'opengraph-image';

export function homeImagePath(): string {
  return fillMetadataSegment(HOME_SEGMENT, {}, ROUTE);
}

export function projectImagePath(slug: string): string {
  return fillMetadataSegment(PROJECT_SEGMENT, { slug }, ROUTE);
}

function generatedImage(card: Card, path: string): MetaImage {
  return {
    url: `${path}?v=${cardVersion(card, blueprintPalette())}`,
    width: OG_WIDTH,
    height: OG_HEIGHT,
    alt: cardAlt(card),
    type: 'image/png',
  };
}

/**
 * The image for the home page and the site's other pages: the owner's own `seo.ogImage` when it is
 * set (an image file, with its own alt text if it has one, never an invented one), else the
 * generated home card.
 */
export function homeMetaImage(site: Site): MetaImage {
  const own = resolveMedia(site.seo.ogImage);
  if (own?.kind === 'image') {
    return {
      url: own.file.src,
      ...(own.width && own.height ? { width: own.width, height: own.height } : {}),
      ...(hasText(own.alt) ? { alt: own.alt.trim() } : {}),
    };
  }
  return generatedImage(homeCard(site), homeImagePath());
}

/** A visible project's generated image; a hidden or unknown slug has none. */
export function projectMetaImage(slug: string): MetaImage | undefined {
  const card = siteProjectCard(slug);
  return card ? generatedImage(card, projectImagePath(slug)) : undefined;
}
