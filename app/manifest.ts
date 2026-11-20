import type { MetadataRoute } from 'next';
import { hasText } from '@/lib/format';
import { initials } from '@/lib/og/cards';
import { siteData } from '@/lib/site';
import { themeFromSetting } from '@/lib/theme';
import { tokenValue } from '@/lib/tokens';

/** A home screen label longer than this is cut by most systems, so a longer name gives its initials. */
const SHORT_NAME = 12;

/**
 * The web app manifest (/manifest.webmanifest), linked from every page: the owner's name, the site
 * description, the home page as the start, the site in the browser's own window (it is a site, not
 * an app), the colors of the default theme's sheet (app/tokens.css), and the site icons
 * (app/icon.tsx, app/apple-icon.tsx).
 */
export default function manifest(): MetadataRoute.Manifest {
  const { site } = siteData();
  const name = site.personal.name.trim();
  const sheet = tokenValue('sheet', themeFromSetting(site.settings.themeDefault));
  return {
    ...(name ? { name, short_name: name.length <= SHORT_NAME ? name : initials(name) } : {}),
    ...(hasText(site.seo.description) ? { description: site.seo.description.trim() } : {}),
    start_url: '/',
    display: 'browser',
    ...(sheet ? { background_color: sheet, theme_color: sheet } : {}),
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
