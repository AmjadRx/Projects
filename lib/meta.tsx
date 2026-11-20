/**
 * Page metadata and JSON-LD, built only from fields the page shows (docs/V3_PLAN.md D-41, D-56;
 * ARCHITECTURE.md 5 and 15, item 2). Every public page gets a title, a canonical address, Open
 * Graph and Twitter fields, and its sheet-style image (lib/og/meta.ts) with a large-image card.
 * An empty field never reaches the metadata: no empty description, no image for an empty cover.
 */
import type { Metadata } from 'next';
import { hasText } from './format';
import { isRemoteUrl } from './media';
import { siteUrl } from './site';
import { jsonLd } from './jsonld';
import type { MetaImage } from './og/meta';
import type { Site } from './types';

export { jsonLd };

export function absoluteUrl(path: string): string {
  if (isRemoteUrl(path)) return path;
  return `${siteUrl()}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** The title every share card and tab shows: the page's title and the owner's name, or the site title. */
export function fullTitle(site: Site, title?: string): string {
  const name = site.personal.name.trim();
  if (hasText(title)) return hasText(name) ? `${title.trim()} · ${name}` : title.trim();
  return hasText(site.seo.title) ? site.seo.title.trim() : name;
}

/**
 * A share image as Open Graph and Twitter name it: its address, its size and type when known, and
 * its alt text when it has one (never an empty one). A site path stays relative: Next makes it
 * absolute against metadataBase, or against the deployment's own address on a Vercel preview, so
 * a preview's links show the preview's images.
 */
export function shareImage(image: MetaImage | undefined) {
  if (!image || !hasText(image.url)) return undefined;
  const og = {
    url: image.url,
    ...(image.width && image.height ? { width: image.width, height: image.height } : {}),
    ...(hasText(image.alt) ? { alt: image.alt.trim() } : {}),
    ...(hasText(image.type) ? { type: image.type } : {}),
  };
  return { og, twitter: { url: og.url, ...(og.alt ? { alt: og.alt } : {}) } };
}

export function pageMetadata(
  site: Site,
  page: { title?: string; description?: string; path: string; image?: MetaImage; noindex?: boolean },
): Metadata {
  const name = site.personal.name.trim();
  const title = hasText(page.title) ? page.title.trim() : undefined;
  const description = hasText(page.description) ? page.description.trim() : undefined;
  const shareTitle = fullTitle(site, title);
  const image = shareImage(page.image);
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    alternates: { canonical: page.path },
    openGraph: {
      type: 'website',
      ...(hasText(name) ? { siteName: name } : {}),
      ...(hasText(shareTitle) ? { title: shareTitle } : {}),
      ...(description ? { description } : {}),
      url: page.path,
      ...(image ? { images: [image.og] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      ...(hasText(shareTitle) ? { title: shareTitle } : {}),
      ...(description ? { description } : {}),
      ...(image ? { images: [image.twitter] } : {}),
    },
    ...(page.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
