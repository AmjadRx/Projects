import type { Metadata, Viewport } from 'next';
import SiteAnalytics from '@/components/site/SiteAnalytics';
import { loadSite } from '@/lib/content';
import { FONT_PRELOADS } from '@/lib/fontFiles';
import { hasText } from '@/lib/format';
import { siteUrl } from '@/lib/site';
import { themeFromSetting, themeScript } from '@/lib/theme';
import { tokenValue } from '@/lib/tokens';
// The order matters: see app/globals.css.
import './fonts.css';
import './tokens.css';
import './globals.css';
import './sheet.css';
import './motion-chrome.css';
import './styles/frame.css';
import './styles/home.css';
import './styles/project.css';
import './styles/site.css';
import './motion-drawing.css';
import './motion-media.css';
import './motion-cards.css';
import './motion-model.css';
import './motion-home.css';
import './palette.css';
import './utilities.css';
import './print.css';

/*
 * The two faces of the design system, Archivo and B612 Mono, self-hosted from the Claude Design
 * bundle's files (SIL Open Font License 1.1, no Reserved Font Name; the licence texts are in
 * licenses/). The pages load subsets of them, which scripts/subset-fonts.py makes from the full
 * files in app/fonts/ (only the Open Graph images read those) and writes to public/fonts/, with
 * their @font-face rules and fallback faces in app/fonts.css (imported first, above) and the list
 * of files to preload in lib/fontFiles.ts. Each face has a core file, with every character the
 * pages use, and an extended file, which a browser fetches only for a character in it, so a word
 * typed in the admin never loses a glyph. Every page preloads the two core files its first view
 * sets text in (Archivo, and B612 Mono's regular weight), in the head below, so on a fast
 * connection the text is laid out once, in its own face. The files carry their content's hash in
 * their names and are cached for good (next.config.mjs).
 */

/**
 * Site-wide defaults from content: `seo.title`, `seo.description`, and the owner's name. The
 * public pages name their own share image (lib/og/meta.ts); a page that names none (the 404 page,
 * /admin, the development pages) gets the home image from app/opengraph-image.tsx, which Next
 * links here, for Open Graph and the large-image Twitter card alike. The icons and the manifest
 * come from app/icon.tsx, app/apple-icon.tsx, and app/manifest.ts.
 */
export function generateMetadata(): Metadata {
  const site = loadSite();
  const name = site.personal.name;
  const title = hasText(site.seo.title) ? site.seo.title : name;
  const description = hasText(site.seo.description) ? site.seo.description : undefined;
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${name}` },
    ...(description ? { description } : {}),
    applicationName: name,
    openGraph: { type: 'website', siteName: name, title, ...(description ? { description } : {}) },
    twitter: { card: 'summary_large_image', title, ...(description ? { description } : {}) },
    robots: { index: true, follow: true },
  };
}

/** The browser's color around the page: each theme's sheet, from app/tokens.css. */
export function generateViewport(): Viewport {
  const blueprint = tokenValue('sheet', 'blueprint');
  const whiteprint = tokenValue('sheet', 'whiteprint');
  return {
    width: 'device-width',
    initialScale: 1,
    ...(blueprint && whiteprint
      ? {
          themeColor: [
            { media: '(prefers-color-scheme: dark)', color: blueprint },
            { media: '(prefers-color-scheme: light)', color: whiteprint },
          ],
        }
      : {}),
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Blueprint unless the content sets "light"; the visitor's own choice (the cookie) wins in the script.
  const theme = themeFromSetting(loadSite().settings.themeDefault);

  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <head>
        {FONT_PRELOADS.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
        <script dangerouslySetInnerHTML={{ __html: themeScript(theme) }} />
      </head>
      <body>
        {children}
        <SiteAnalytics />
      </body>
    </html>
  );
}
