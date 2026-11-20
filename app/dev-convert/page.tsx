import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { devPagesEnabled } from '@/lib/devPages';
import ConvertHarness from '@/components/admin/dev/ConvertHarness';

/**
 * The upload preparation harness (`/dev-convert`): the admin's in-browser conversion
 * (lib/admin/convert/) on files chosen here, for testing it in a real browser with Playwright.
 * Outside the (site) group, so no site chrome or sky is mounted. A production deployment answers
 * not found (lib/devPages.ts), so it never ships.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default function DevConvertPage() {
  if (!devPagesEnabled()) notFound();
  return <ConvertHarness />;
}
