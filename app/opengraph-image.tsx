import { cardAlt } from '@/lib/og/cards';
import { cardImage, OG_SIZE } from '@/lib/og/render';
import { siteHomeCard } from '@/lib/og/site-cards';

/**
 * The home page's Open Graph image (ARCHITECTURE.md 5, "Also new"): the owner's name and the
 * headline on a Blueprint sheet (lib/og/sheet.tsx), drawn once at build time. Every page names its
 * image in its own metadata (lib/og/meta.ts), so this file's alt text is the one Next falls back to
 * on pages that name none.
 */
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = cardAlt(siteHomeCard());

export default function Image() {
  return cardImage(siteHomeCard());
}
