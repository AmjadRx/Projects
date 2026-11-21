import { notFound } from 'next/navigation';
import { cardImage, OG_SIZE } from '@/lib/og/render';
import { imageSlugs, siteProjectCard } from '@/lib/og/site-cards';

type Params = { slug: string };

/**
 * A project's Open Graph image (ARCHITECTURE.md 5, "Also new"): its title, subtitle, and title
 * block on a Blueprint sheet (lib/og/sheet.tsx), drawn once at build time for each visible project.
 * A hidden project has no image (it is not in the static params, and no other slug is served), and
 * its sheet number is never counted. The page names the image with its own alt text
 * (lib/og/meta.ts).
 */
export const size = OG_SIZE;
export const contentType = 'image/png';
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return imageSlugs();
}

export default async function Image({ params }: { params: Params | Promise<Params> }) {
  const { slug } = await params;
  const card = siteProjectCard(slug);
  if (!card) notFound();
  return cardImage(card);
}
