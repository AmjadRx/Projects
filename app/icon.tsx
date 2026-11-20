import { iconImage } from '@/lib/og/render';
import { siteData } from '@/lib/site';

/**
 * The site icon (docs/V3_PLAN.md Q-42): the owner's initials in the display face, in the line
 * color on the Blueprint sheet. No icon design exists in the design canvas or the handoff, so this
 * mark stands until the owner supplies one. Drawn once at build time; Next links it from every page.
 */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return iconImage(size.width, siteData().site.personal.name);
}
