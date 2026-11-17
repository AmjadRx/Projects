import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { loadSite } from '@/lib/content';
import { hasText } from '@/lib/format';
import { siteUrl } from '@/lib/site';
import './globals.css';

// Phase 1 replaces these with Archivo and B612 Mono (docs/V3_PLAN.md Q-16).
const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-display',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
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

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0e14' },
    { media: '(prefers-color-scheme: light)', color: '#f8f9fb' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `themeDefault` is validated by the schema ("dark" or "light"), so it is safe in the script.
  const themeDefault = loadSite().settings.themeDefault;
  // Runs before paint: the visitor's own choice (a cookie) wins, else the content's default.
  const themeScript = `(function () { var d = '${themeDefault}'; try { var m = document.cookie.match(/(?:^|; )theme=(dark|light)/); document.documentElement.dataset.theme = m ? m[1] : d; } catch (e) { document.documentElement.dataset.theme = d; } })();`;

  return (
    <html
      lang="en"
      data-theme={themeDefault}
      className={`${display.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
