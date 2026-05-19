import type { Metadata, Viewport } from 'next';
import { Inter, Inter_Tight, JetBrains_Mono, Instrument_Serif } from 'next/font/google';
import './globals.css';
import ThemeBoot from '@/components/ThemeBoot';

const body = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

const display = Inter_Tight({
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

const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-serif',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://amjadrehawi.com'),
  title: {
    default: 'Amjad Rehawi — Hardware engineer for things that move themselves.',
    template: '%s · Amjad Rehawi',
  },
  description:
    'Senior honors EE + ME at Santa Clara University. Pivoting from EV / power electronics into drones and aerospace — with the Raven eVTOL swarm as the proof.',
  keywords: [
    'Amjad Rehawi',
    'hardware engineer',
    'eVTOL',
    'drone',
    'FSAE',
    'power electronics',
    'BMS',
    'Santa Clara University',
    'Raven',
  ],
  authors: [{ name: 'Amjad Rehawi' }],
  openGraph: {
    type: 'website',
    title: 'Amjad Rehawi — Hardware engineer for things that move themselves.',
    description:
      'Senior honors EE + ME at Santa Clara University. Pivoting from EV / power electronics into drones and aerospace — with the Raven eVTOL swarm as the proof.',
    url: 'https://amjadrehawi.com',
    siteName: 'Amjad Rehawi',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Amjad Rehawi — Hardware engineer for things that move themselves.',
    description: 'Building Raven — an 8-stage eVTOL roadmap toward a 4-drone autonomous swarm.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#06080d' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${display.variable} ${mono.variable} ${serif.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeBoot />
        {children}
      </body>
    </html>
  );
}
