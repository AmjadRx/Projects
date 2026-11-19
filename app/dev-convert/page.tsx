import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ConvertHarness from '@/components/admin/dev/ConvertHarness';

/**
 * The upload preparation harness (`/dev-convert`): the admin's in-browser conversion
 * (lib/admin/convert/) on files chosen here, for testing it in a real browser with Playwright.
 * Outside the (site) group, so no site chrome or sky is mounted. It renders notFound() in
 * production builds, so it never ships.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default function DevConvertPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ConvertHarness />;
}
