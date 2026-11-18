'use client';

import Link from 'next/link';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import AvailabilityBadge from '@/components/sheet/AvailabilityBadge';
import Icon from '@/components/sheet/Icon';
import TextLink from '@/components/sheet/TextLink';
import { useFocusTrap } from '@/components/viewers/shared/hooks';
import type { Theme } from '@/lib/theme';
import { currentValue, type NavItem } from './NavLinks';
import ThemeToggle, { type ThemeToggleLabels } from './ThemeToggle';

export interface MenuSocial {
  label: string;
  url: string;
  external: boolean;
}

export interface MenuLabels {
  /** The button's word and the dialog's name ("Menu"). */
  menu: string;
  /** The close button's word ("Close"). */
  close: string;
  /** The nav landmark's name. */
  nav: string;
  theme: ThemeToggleLabels;
}

/** The container width (the page frame, .ar-frame) from which the inline nav shows and this menu hides. */
const WIDE = 1024;

/**
 * The phone and tablet menu (bundle MobileMenu, bundle.css 19), under 1024 px: the Menu button in
 * the nav and a full-screen glass sheet with the name, Close, the nav links (28 px, the current
 * page in the line color), the nav's social links, the full theme toggle, and the availability
 * badge. It opens at once (the unroll is Phase 5).
 *
 * A modal dialog with the shared focus trap: focus moves to Close, Tab stays inside, Escape closes,
 * focus returns to the Menu button, and the page does not scroll behind it. It also closes on a
 * link, on a route change, and when the page frame reaches 1024 px (a tablet turned sideways),
 * measured on the frame itself so it agrees with the container queries that hide the button
 * (docs/V3_PLAN.md D-63). The sheet is drawn in a portal on <body>, outside the frame. Every word
 * comes from the server (lib/strings.ts).
 */
export default function MobileMenu({
  name,
  items,
  socials,
  availability,
  labels,
  initialTheme,
}: {
  name: string;
  items: NavItem[];
  socials: MenuSocial[];
  /** The hiring line, only when the setting shows it. */
  availability?: string;
  labels: MenuLabels;
  initialTheme: Theme;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const pathname = usePathname() ?? '/';

  useFocusTrap(panelRef, open, () => setOpen(false), { initialFocus: closeRef });

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // An open menu on a frame that has become wide would leave the page locked behind a hidden
  // button. Close it as soon as the frame reaches the width of the inline nav.
  useEffect(() => {
    if (!open) return undefined;
    const frame = buttonRef.current?.closest<HTMLElement>('.ar-frame') ?? null;
    const wide = () => (frame ? frame.getBoundingClientRect().width : window.innerWidth) >= WIDE;
    if (wide()) {
      setOpen(false);
      return undefined;
    }
    const check = () => {
      if (wide()) setOpen(false);
    };
    if (frame && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(check);
      observer.observe(frame);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ar-menubtn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(true)}
      >
        <span>{labels.menu}</span>
        <Icon icon={Menu} size={20} />
      </button>
      {open
        ? createPortal(
            <div ref={panelRef} id={menuId} className="ar-mmenu" role="dialog" aria-modal="true" aria-label={labels.menu}>
              <div className="ar-mmenu__roll">
                <div className="ar-mmenu__sheet">
                  <div className="ar-mmenu__top">
                    <Link href="/" className="ar-nav__name" onClick={close}>
                      {name}
                    </Link>
                    <button ref={closeRef} type="button" className="ar-menubtn" onClick={close}>
                      <span>{labels.close}</span>
                      <Icon icon={X} size={20} />
                    </button>
                  </div>
                  <nav aria-label={labels.nav}>
                    <ul className="ar-mmenu__links">
                      {items.map((item) => (
                        <li key={item.href}>
                          {item.external ? (
                            <a href={item.href} rel="noopener noreferrer" className="ar-mmenu__link" onClick={close}>
                              <span>{item.label}</span>
                              <Icon icon={ArrowRight} size={22} />
                            </a>
                          ) : (
                            <Link
                              href={item.href}
                              aria-current={currentValue(pathname, item.href)}
                              className="ar-mmenu__link"
                              onClick={close}
                            >
                              <span>{item.label}</span>
                              <Icon icon={ArrowRight} size={22} />
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </nav>
                  <div className="ar-mmenu__foot">
                    {socials.length > 0 ? (
                      <ul className="ar-mmenu__social">
                        {socials.map((social) => (
                          <li key={social.url}>
                            <TextLink href={social.url} variant="standalone" external={social.external}>
                              {social.label}
                            </TextLink>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <ThemeToggle variant="full" labels={labels.theme} initial={initialTheme} />
                    {availability ? <AvailabilityBadge text={availability} /> : null}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
