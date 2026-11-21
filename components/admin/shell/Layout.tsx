'use client';

/**
 * The admin's frame: the twelve tabs (TABS in lib/admin/locate.ts) in a left sidebar from 768 px
 * of admin width, and in a horizontal strip under a slim top bar below that; "View site" and
 * "Sign out"; the main panel; and the save bar pinned to the bottom of the panel. No sheet frame
 * and no motion: the admin is a tool, not a showcase (ARCHITECTURE.md 7).
 *
 * Tabs are links to their hash ("#tab=stats"), so they can be opened in a new tab, and the
 * current one carries aria-current="page".
 */
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { ExternalLink, LogOut } from 'lucide-react';
import { TABS, type TabId } from '@/lib/admin/locate';
import { revealInProgress } from './reveal';
import { formatRoute } from './route';

export const MAIN_ID = 'adm-main';

export interface AdminLayoutProps {
  tab: TabId;
  onSignOut: () => void;
  /** The save bar, once content is loaded. */
  saveBar?: ReactNode;
  children: ReactNode;
}

export function AdminLayout({ tab, onSignOut, saveBar, children }: AdminLayoutProps) {
  const active = useRef<HTMLAnchorElement | null>(null);

  // A new tab starts at the top of the page (unless a reveal is taking the owner to a field in it),
  // and its link stays in view in the phone strip.
  useEffect(() => {
    if (!revealInProgress()) window.scrollTo(0, 0);
    const link = active.current;
    const strip = link?.closest('.adm-tabs');
    if (link && strip && strip.scrollWidth > strip.clientWidth) link.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [tab]);

  // The skip link focuses the panel without touching the hash, which holds the route.
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById(MAIN_ID)?.focus();
  };

  return (
    <div className="adm-shell">
      <a href={`#${MAIN_ID}`} className="adm-skip" onClick={skip}>
        Skip to the editor
      </a>
      <header className="adm-side">
        <div className="adm-side__top">
          <p className="adm-side__brand">Admin</p>
          <div className="adm-side__links">
            <a className="adm-sidelink" href="/" target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} aria-hidden="true" />
              <span>View site</span>
              <span className="adm-sr"> (opens in a new tab)</span>
            </a>
            <button type="button" className="adm-sidelink" onClick={onSignOut}>
              <LogOut size={16} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
        <nav className="adm-tabs" aria-label="Sections">
          <ul className="adm-tabs__list">
            {TABS.map((t) => (
              <li key={t.id}>
                <a
                  ref={t.id === tab ? active : undefined}
                  className="adm-tab"
                  href={formatRoute(t.id)}
                  aria-current={t.id === tab ? 'page' : undefined}
                >
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div className="adm-main">
        <main id={MAIN_ID} className="adm-panel" tabIndex={-1}>
          {children}
        </main>
        {saveBar}
      </div>
    </div>
  );
}

/** A centered message while the admin starts or loads. */
export function Waiting({ text }: { text: string }) {
  return (
    <p className="adm-waiting" role="status">
      <span className="adm-waiting__dot" aria-hidden="true" />
      {text}
    </p>
  );
}
