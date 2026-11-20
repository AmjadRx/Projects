import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { devPagesEnabled } from '@/lib/devPages';
import MediaHarness, { RealHarness } from '@/components/admin/media/dev/MediaHarness';
import '../admin/admin.css';

/**
 * The media components' test page (`/dev-media`): the admin's media fields, library, and upload
 * queue on a stand-in project, with every route answered in the browser, for testing them with
 * Playwright without touching the server, public/, or content/. `/dev-media?real=<folder>` shows
 * one folder's library on the real routes instead (sign in first; the test answers every write
 * itself). Outside the (site) group, so no site chrome or sky is mounted. A production
 * deployment answers not found (lib/devPages.ts), so it never ships.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const FOLDER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function DevMediaPage({ searchParams }: { searchParams: { real?: string | string[] } }) {
  if (!devPagesEnabled()) notFound();
  const real = typeof searchParams.real === 'string' && FOLDER.test(searchParams.real) ? searchParams.real : null;
  return real ? <RealHarness folder={real} /> : <MediaHarness />;
}
