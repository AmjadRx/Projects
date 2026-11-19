'use client';

/**
 * Vercel Web Analytics for the public site only (docs/V3_PLAN.md Q-36): page views of the admin
 * and of the development pages are dropped before they are sent, so the owner's own editing never
 * counts as traffic and no admin address reaches the analytics data. A client component, because
 * `beforeSend` is a function and the root layout is a server component.
 */
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

const PRIVATE_PATH = /^\/(?:admin|dev|dev-[a-z]+)(?:\/|$)/;

export function dropPrivatePages(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    return PRIVATE_PATH.test(new URL(event.url).pathname) ? null : event;
  } catch {
    return event;
  }
}

export default function SiteAnalytics() {
  return <Analytics beforeSend={dropPrivatePages} />;
}
