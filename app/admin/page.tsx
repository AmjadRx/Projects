import AdminApp from '@/components/admin/AdminApp';

export const metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return <AdminApp />;
}
