'use client';

import type { TabId } from './AdminApp';
import { cn } from '@/lib/utils';

const tabs: Array<{ id: TabId; label: string; group: 1 | 2 | 3 }> = [
  { id: 'personal', label: 'Personal', group: 1 },
  { id: 'brandThesis', label: 'Brand thesis', group: 1 },
  { id: 'about', label: 'About', group: 1 },
  { id: 'stats', label: 'Stats', group: 1 },
  { id: 'projects', label: 'Projects', group: 2 },
  { id: 'skills', label: 'Skills', group: 2 },
  { id: 'experience', label: 'Experience', group: 2 },
  { id: 'honors', label: 'Honors', group: 3 },
  { id: 'education', label: 'Education', group: 3 },
  { id: 'contact', label: 'Contact', group: 3 },
];

export default function Sidebar({
  tab,
  setTab,
  onLogout,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  onLogout: () => void;
}) {
  return (
    <aside className="md:fixed md:inset-y-0 md:left-0 md:z-40 md:w-64 md:border-r md:border-line/8 md:bg-bg-2/70 md:backdrop-blur">
      <div className="flex items-center justify-between border-b border-line/8 px-6 py-4" style={{ borderColor: 'rgb(var(--line) / 0.08)' }}>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-accent">⌘ Admin</div>
          <div className="mt-0.5 text-sm font-semibold text-fg">Portfolio CMS</div>
        </div>
        <button
          onClick={onLogout}
          className="font-mono text-[10px] uppercase tracking-widest text-fg-mute hover:text-accent"
        >
          sign out
        </button>
      </div>

      <nav className="scrollbar-thin overflow-x-auto px-3 py-4 md:overflow-x-visible md:py-6">
        <ul className="flex flex-row gap-1 md:flex-col">
          {tabs.map((t, i) => {
            const prevGroup = i > 0 ? tabs[i - 1].group : null;
            const showDivider = prevGroup !== null && prevGroup !== t.group;
            return (
              <li key={t.id} className={showDivider ? 'md:mt-3 md:border-t md:border-line/8 md:pt-3' : ''} style={showDivider ? { borderColor: 'rgb(var(--line) / 0.08)' } : undefined}>
                <button
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'w-full whitespace-nowrap rounded-md px-3 py-2 text-left font-mono text-xs uppercase tracking-widest transition-colors',
                    tab === t.id
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-dim hover:bg-line/5 hover:text-fg',
                  )}
                >
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 hidden border-t border-line/8 px-3 pt-4 md:block" style={{ borderColor: 'rgb(var(--line) / 0.08)' }}>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="block font-mono text-[10px] uppercase tracking-widest text-fg-mute hover:text-accent"
          >
            ↗ open public site
          </a>
        </div>
      </nav>
    </aside>
  );
}
