'use client';

/**
 * The admin at /admin (ARCHITECTURE.md 7 and 11). One store for the page (AdminProvider), one
 * confirmation queue (ConfirmProvider), and the shell, which signs in, loads the content, and
 * renders the twelve tabs with the save bar. Styles: app/admin/admin.css, scoped under `.adm`.
 */
import { AdminProvider } from './state/hooks';
import { ConfirmProvider } from './ui/Confirm';
import { Shell } from './shell/Shell';

export default function AdminApp() {
  return (
    <div className="adm">
      <AdminProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </AdminProvider>
    </div>
  );
}
