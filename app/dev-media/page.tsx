import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import MediaHarness, { RealHarness } from '@/components/admin/media/dev/MediaHarness';
import '../admin/admin.css';

/**
 * The media components' test page (`/dev-media`): the admin's media fields, library, and upload
 * queue on a stand-in project, with every route answered in the browser, for testing them with
 * Playwright without touching the server, public/, or content/. `/dev-media?real=<folder>` shows
 * one folder's library on the real routes instead (sign in first; the test answers every write
 * itself). Outside the (site) group, so no site chrome or sky is mounted. It renders notFound()
 * in production builds, so it never ships.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const FOLDER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function DevMediaPage({ searchParams }: { searchParams: { real?: string | string[] } }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const real = typeof searchParams.real === 'string' && FOLDER.test(searchParams.real) ? searchParams.real : null;
  return real ? <RealHarness folder={real} /> : <MediaHarness />;
}
