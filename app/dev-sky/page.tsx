import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SkyHarness, { type HarnessProps } from '@/components/sky/dev/SkyHarness';

/**
 * The sky's harness (`/dev-sky`): the live scene alone, with no chrome and no host, at a size and
 * with options from the query, for the still images (scripts/render-stills.mjs) and for looking at
 * the scene while it is built. Outside the (site) group, so the sky host is not mounted here. It
 * renders notFound() in production builds, so it never ships.
 *
 *   theme      blueprint (default) or whiteprint
 *   tier       full (default) or light
 *   w, h       the scene's size in CSS px (default: the window)
 *   time       the clock time in Unix ms (default: now)
 *   still=1    one still frame through renderStill(time); then window.__skyStill is 'ready', or
 *              'error:<reason>'
 *   progress   a fixed scroll progress, 0 to 1 (live only; default: the harness page's own scroll)
 *   pointer    x,y in CSS px: the pointer rests there from the start (live only)
 *   ripple     x,y in CSS px: one ripple from there at the start (live only)
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

function one(search: Search, key: string): string | undefined {
  const v = search[key];
  return typeof v === 'string' ? v : undefined;
}

function number(search: Search, key: string): number | null {
  const v = one(search, key);
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function size(search: Search, key: string): number | null {
  const n = number(search, key);
  return n !== null && n >= 1 && n <= 8192 ? Math.round(n) : null;
}

function point(search: Search, key: string): [number, number] | null {
  const v = one(search, key);
  if (!v) return null;
  const parts = v.split(',').map(Number);
  return parts.length === 2 && parts.every(Number.isFinite) ? [parts[0], parts[1]] : null;
}

export default function DevSkyPage({ searchParams }: { searchParams: Search }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const progress = number(searchParams, 'progress');
  const props: HarnessProps = {
    theme: one(searchParams, 'theme') === 'whiteprint' ? 'whiteprint' : 'blueprint',
    tier: one(searchParams, 'tier') === 'light' ? 'light' : 'full',
    width: size(searchParams, 'w'),
    height: size(searchParams, 'h'),
    time: number(searchParams, 'time'),
    still: one(searchParams, 'still') === '1',
    progress: progress === null ? null : Math.min(1, Math.max(0, progress)),
    pointer: point(searchParams, 'pointer'),
    ripple: point(searchParams, 'ripple'),
  };
  return <SkyHarness {...props} />;
}
