/**
 * Page metadata and JSON-LD, built only from fields the page shows (docs/V3_PLAN.md D-41, D-56).
 * An empty field never reaches the metadata: no empty description, no image for an empty cover.
 */
import type { Metadata } from 'next';
import { hasText } from './format';
import { isRemoteUrl } from './media';
import { siteUrl } from './site';
import { jsonLd } from './jsonld';
import type { Site } from './types';

export { jsonLd };

export function absoluteUrl(path: string): string {
  if (isRemoteUrl(path)) return path;
  return `${siteUrl()}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function pageMetadata(
  site: Site,
  page: { title?: string; description?: string; path: string; image?: string; noindex?: boolean },
): Metadata {
  const name = site.personal.name;
  const title = hasText(page.title) ? page.title : undefined;
  const description = hasText(page.description) ? page.description : undefined;
  const fullTitle = title ? `${title} · ${name}` : hasText(site.seo.title) ? site.seo.title : name;
  const images = hasText(page.image) ? [{ url: absoluteUrl(page.image) }] : undefined;
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    alternates: { canonical: page.path },
    openGraph: {
      type: 'website',
      siteName: name,
      title: fullTitle,
      ...(description ? { description } : {}),
      url: page.path,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title: fullTitle,
      ...(description ? { description } : {}),
      ...(images ? { images: images.map((i) => i.url) } : {}),
    },
    ...(page.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
