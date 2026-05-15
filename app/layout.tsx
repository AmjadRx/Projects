import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
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
    default: 'Amjad Rehawi — Hardware engineer for things that move themselves.',
    template: '%s · Amjad Rehawi',
  },
  description:
    'Senior honors EE + ME at Santa Clara University. Building Raven — an 8-stage eVTOL roadmap toward a 4-drone autonomous swarm.',
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
      'Senior honors EE + ME at Santa Clara University. Building Raven — an 8-stage eVTOL roadmap toward a 4-drone autonomous swarm.',
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
  themeColor: '#0b0f17',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
