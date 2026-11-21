import type { Metadata } from 'next';
import AdminApp from '@/components/admin/AdminApp';
import './admin.css';

/**
 * The admin. A static shell: everything it shows comes from the session-checked API routes, so
 * nothing about the content or the session is in this page's HTML. The root layout gives the
 * tokens, the fonts, and the theme; the public pages' sky, nav, and footer (the (site) group) do
 * not apply here.
 */
export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-static';

export default function AdminPage() {
  return <AdminApp />;
}
