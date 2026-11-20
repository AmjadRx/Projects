import { iconImage } from '@/lib/og/render';
import { siteData } from '@/lib/site';

/** The home screen icon for Apple devices: the site icon (app/icon.tsx) at 180 px, full bleed, as iOS rounds its corners itself. */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return iconImage(size.width, siteData().site.personal.name);
}
