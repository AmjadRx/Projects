import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { loadSite } from '@/lib/content';
import './globals.css';

const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-display',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://amjadrehawi.com'),
  title: {
    default: 'Amjad Rehawi · Hardware engineer for things that move themselves',
    template: '%s · Amjad Rehawi',
  },
  description:
    'Senior honors EE + ME at Santa Clara University. High-voltage battery systems, motor control, embedded firmware, and autonomous aircraft.',
  keywords: [
    'Amjad Rehawi', 'hardware engineer', 'eVTOL', 'drone', 'FSAE', 'power electronics',
    'BMS', 'embedded firmware', 'Santa Clara University', 'Raven',
  ],
  authors: [{ name: 'Amjad Rehawi' }],
  openGraph: {
    type: 'website',
    siteName: 'Amjad Rehawi',
    title: 'Amjad Rehawi · Hardware engineer for things that move themselves',
    description:
      'High-voltage battery systems, motor control, embedded firmware, and autonomous aircraft.',
    url: 'https://amjadrehawi.com',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Amjad Rehawi · Hardware engineer for things that move themselves',
    description:
      'High-voltage battery systems, motor control, embedded firmware, and autonomous aircraft.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0f17' },
    { media: '(prefers-color-scheme: light)', color: '#F7F9FC' },
  ],
  width: 'device-width',
  initialScale: 1,
};

import BackgroundFX from '@/components/BackgroundFX';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const site = loadSite();
  const themeDefault = site.settings.themeDefault;
  // Runs before paint. Priority: the visitor's explicit toggle choice (cookie),
  // else the admin-configured default. No OS override: the admin default must win
  // for first-time visitors regardless of their system scheme.
  const themeScript = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=(dark|light)/);document.documentElement.dataset.theme=m?m[1]:'${themeDefault}';}catch(e){document.documentElement.dataset.theme='${themeDefault}';}})();`;

  return (
    <html lang="en" data-theme={themeDefault} className={`${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <BackgroundFX />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
