import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import SiteAnalytics from '@/components/site/SiteAnalytics';
import { loadSite } from '@/lib/content';
import { hasText } from '@/lib/format';
import { siteUrl } from '@/lib/site';
import { themeFromSetting, themeScript } from '@/lib/theme';
import { tokenValue } from '@/lib/tokens';
// The order matters: see app/globals.css.
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
import './utilities.css';
import './print.css';

/*
 * The two faces of the design system, self-hosted from the Claude Design bundle's files in
 * app/fonts/ (SIL Open Font License 1.1; the licence texts are in licenses/). next/font serves
 * them from this site with a metric-matched fallback, so the swap moves nothing. The loaders stay
 * in this file: next/font preloads a font only for the layout or page that calls its loader.
 *
 * Archivo is one variable file with a weight axis (100 to 900) and a width axis (62 to 125), set
 * with font-variation-settings ("wdth" 100 for body, 112 to 125 for headlines). B612 Mono is for
 * data only (tables, the title block, readouts, dates, callouts); it is not preloaded, because no
 * first view depends on it. Their variables are read by --font-sans and --font-mono in tokens.css.
 */
const archivo = localFont({
  src: './fonts/Archivo-Variable.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-archivo',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
});

const b612Mono = localFont({
  src: [
    { path: './fonts/B612Mono-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/B612Mono-Bold.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  preload: false,
  variable: '--font-b612-mono',
});

/** Site-wide defaults from content: `seo.title`, `seo.description`, and the owner's name. */
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
    twitter: { card: 'summary', title, ...(description ? { description } : {}) },
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
    <html lang="en" data-theme={theme} className={`${archivo.variable} ${b612Mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(theme) }} />
      </head>
      <body>
        {children}
        <SiteAnalytics />
      </body>
    </html>
  );
}
