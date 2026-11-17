'use client';

import { Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import LinkIcon from '@/components/LinkIcon';
import { useFocusTrap } from '@/components/viewers/shared/hooks';
import NavLinks, { type NavItem } from './NavLinks';
import ThemeToggle, { type ThemeLabels } from './ThemeToggle';

export interface MenuSocial {
  label: string;
  url: string;
  icon: string;
}

export interface MenuLabels extends ThemeLabels {
  open: string;
  close: string;
  title: string;
  nav: string;
  home: string;
}

/** The width from which the inline nav shows and this menu is hidden (Tailwind's `lg`). */
const WIDE = '(min-width: 1024px)';

/**
 * The phone and tablet menu: a full-screen sheet with a focus trap that closes on Escape, on a
 * link, on its close button, and when the window becomes wide enough for the inline nav (a tablet
 * turned sideways), and returns focus to the menu button (docs/V3_PLAN.md D-63). No animation in
 * this phase. The labels come from the server (lib/strings.ts).
 */
export default function MobileMenu({ items, socials, labels }: { items: NavItem[]; socials: MenuSocial[]; labels: MenuLabels }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const pathname = usePathname();

  useFocusTrap(panelRef, open, () => setOpen(false));

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // The sheet is hidden from the `lg` width up, so an open menu would keep the page locked with
  // no visible way out. Close it as soon as the window reaches that width.
  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia(WIDE);
    if (query.matches) {
      setOpen(false);
      return;
    }
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm text-ink lg:hidden"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Menu size={20} aria-hidden />
        <span className="sr-only">{labels.open}</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg lg:hidden"
        >
          <div className="wrap flex min-h-[64px] items-center justify-between border-b border-line">
            <p id={titleId} className="font-medium text-ink">
              {labels.title}
            </p>
            <button
              type="button"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm text-ink"
              onClick={() => setOpen(false)}
            >
              <X size={20} aria-hidden />
              <span className="sr-only">{labels.close}</span>
            </button>
          </div>
          <nav aria-label={labels.nav} className="wrap py-6">
            <NavLinks
              items={[{ label: labels.home, href: '/' }, ...items]}
              className="flex flex-col gap-1"
              linkClassName="text-2xl"
              onNavigate={() => setOpen(false)}
            />
          </nav>
          <div className="wrap mt-auto flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line py-6">
            {socials.map((social) => (
              <a
                key={social.url}
                href={social.url}
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 text-ink-dim hover:text-ink"
              >
                <LinkIcon icon={social.icon} size={18} />
                <span>{social.label}</span>
              </a>
            ))}
            <ThemeToggle labels={labels} withLabel />
          </div>
        </div>
      )}
    </>
  );
}
