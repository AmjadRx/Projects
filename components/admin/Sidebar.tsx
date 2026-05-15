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
    <aside className="md:fixed md:inset-y-0 md:left-0 md:z-40 md:w-64 md:border-r md:border-white/8 md:bg-navy-2/70 md:backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/8 px-6 py-4" style={{ borderColor: 'rgb(255 255 255 / 0.08)' }}>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-cyan">⌘ Admin</div>
          <div className="mt-0.5 text-sm font-semibold text-ink">Portfolio CMS</div>
        </div>
        <button
          onClick={onLogout}
          className="font-mono text-[10px] uppercase tracking-widest text-ink-mute hover:text-cyan"
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
              <li key={t.id} className={showDivider ? 'md:mt-3 md:border-t md:border-white/8 md:pt-3' : ''} style={showDivider ? { borderColor: 'rgb(255 255 255 / 0.08)' } : undefined}>
                <button
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'w-full whitespace-nowrap rounded-md px-3 py-2 text-left font-mono text-xs uppercase tracking-widest transition-colors',
                    tab === t.id
                      ? 'bg-cyan/10 text-cyan'
                      : 'text-ink-dim hover:bg-white/5 hover:text-ink',
                  )}
                >
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 hidden border-t border-white/8 px-3 pt-4 md:block" style={{ borderColor: 'rgb(255 255 255 / 0.08)' }}>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="block font-mono text-[10px] uppercase tracking-widest text-ink-mute hover:text-cyan"
          >
            ↗ open public site
          </a>
        </div>
      </nav>
    </aside>
  );
}
