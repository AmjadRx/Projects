'use client';

import Link from 'next/link';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import AvailabilityBadge from '@/components/sheet/AvailabilityBadge';
import Icon from '@/components/sheet/Icon';
import TextLink from '@/components/sheet/TextLink';
import { useFocusTrap } from '@/components/viewers/shared/hooks';
import { page } from '@/lib/motion';
import type { Theme } from '@/lib/theme';
import { motionOk } from '@/lib/useMotionOk';
import { drawOpen, rollUp, unroll, type MenuParts, type RollUp, type Unroll } from './menuMotion';
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

/** Layout effects warn in the server render; the animations only start in the browser. */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * closed: nothing drawn. open: the dialog, unrolling (motion sheet 7.5) and then at rest.
 * closing: rolling back up, the Menu button already in charge again; then closed, or open again
 * if Menu is pressed before the sheet is up.
 */
type Phase = 'closed' | 'open' | 'closing';

/**
 * The phone and tablet menu (bundle MobileMenu, bundle.css 19), under 1024 px: the Menu button in
 * the nav and a full-screen glass sheet with the name, Close, the nav links (28 px, the current
 * page in the line color), the nav's social links, the full theme toggle, and the availability
 * badge.
 *
 * Motion (sheet 7.5, ./menuMotion.ts): the sheet unrolls from the top, the outer roll moving down
 * while the sheet counter-moves, with a 1 px line on the roll's edge while it opens; the links drop
 * 8 px and fade in, 40 ms apart from 80 ms; Close and Escape roll it back up in 240 ms, the links
 * with it. Menu pressed while it rolls up brings it back down from where it is. Under reduced
 * motion it opens and closes at once (sheet 8.1).
 *
 * A modal dialog with the shared focus trap: focus moves to Close as it starts to unroll, Tab stays
 * inside, Escape closes, and the page does not scroll behind it. Closing hands control back at
 * once: the trap and the scroll lock go, the rolling sheet turns inert, and focus returns to the
 * Menu button, unless a link is taking the visitor to another page, where the new page has focus.
 * It also closes on a route change, and at once when the page frame reaches 1024 px (a tablet
 * turned sideways), measured on the frame itself so it agrees with the container queries that hide
 * the button (docs/V3_PLAN.md D-63). The sheet is drawn in a portal on <body>, outside the frame.
 * Every word comes from the server (lib/strings.ts).
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
  const [phase, setPhase] = useState<Phase>('closed');
  /** The phase as last asked for, read by handlers between renders. */
  const phaseRef = useRef<Phase>('closed');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const unrolling = useRef<Unroll | null>(null);
  /**
   * The drawn sheet's last roll-up (under way, or ended and holding its last frame), for a reopen
   * to start from; dropped when the closed phase is drawn.
   */
  const rolling = useRef<RollUp | null>(null);
  const returnFocus = useRef(false);
  const menuId = useId();
  const pathname = usePathname() ?? '/';

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /** Opens the menu, from closed or while it rolls up (then from where the sheet has got to). */
  const openMenu = () => {
    if (phaseRef.current !== 'open') go('open');
  };

  /** Closes an open menu: rolled up where motion may play, at once otherwise. */
  const close = useCallback(
    (restoreFocus: boolean) => {
      if (phaseRef.current !== 'open') return;
      returnFocus.current = restoreFocus;
      go(motionOk() ? 'closing' : 'closed');
    },
    [go],
  );

  /** A link closes the menu; focus goes back to the Menu button unless the link leaves this page. */
  const closeFor = (href: string, external: boolean) => close(external || href === pathname);

  useFocusTrap(panelRef, phase === 'open', () => close(true), { initialFocus: closeRef, restoreFocus: false });

  useEffect(() => {
    if (phase === 'open' || !returnFocus.current) return;
    returnFocus.current = false;
    buttonRef.current?.focus({ preventScroll: true });
  }, [phase]);

  useEffect(() => {
    close(false);
  }, [pathname, close]);

  // An open menu on a frame that has become wide would leave the page locked behind a hidden
  // button. Close it at once as soon as the frame reaches the width of the inline nav.
  useEffect(() => {
    if (phase === 'closed') return undefined;
    const frame = buttonRef.current?.closest<HTMLElement>('.ar-frame') ?? null;
    const wide = () => (frame ? frame.getBoundingClientRect().width : window.innerWidth) >= WIDE;
    if (wide()) {
      go('closed');
      return undefined;
    }
    const check = () => {
      if (wide()) go('closed');
    };
    if (frame && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(check);
      observer.observe(frame);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [phase, go]);

  /** The drawn menu's animated parts, or null where the browser has no Web Animations. */
  const parts = useCallback((): MenuParts | null => {
    const roll = rollRef.current;
    const sheet = sheetRef.current;
    const edge = edgeRef.current;
    if (!roll || !sheet || !edge || typeof roll.animate !== 'function') return null;
    return { roll, sheet, edge, links: Array.from(sheet.querySelectorAll<HTMLElement>('.ar-mmenu__link')) };
  }, []);

  // A closed menu is no longer drawn, so it unrolls from the top when it next opens. The roll-up is
  // dropped only once the closed phase is drawn, not when it is asked for: Menu pressed after the
  // roll-up ends but before that render keeps the same sheet, which must still come down from
  // where the roll-up left it, with the roll-up's held last frame cancelled.
  useBrowserLayoutEffect(() => {
    if (phase === 'closed') rolling.current = null;
  }, [phase]);

  // Before the first paint of the open menu, so its first frame is the rolled-up sheet, or, opened
  // again during a roll-up, the sheet where that roll-up has got to. It takes input again before
  // the focus trap (a passive effect) moves focus to Close.
  useBrowserLayoutEffect(() => {
    if (phase !== 'open') return;
    const from = rolling.current;
    rolling.current = null;
    panelRef.current?.removeAttribute('inert');
    const menu = parts();
    if (menu && motionOk()) {
      unrolling.current = unroll(menu, from);
      return;
    }
    if (from) drawOpen(from);
    unrolling.current = null;
  }, [phase, parts]);

  useBrowserLayoutEffect(() => {
    if (phase !== 'closing') return undefined;
    const menu = parts();
    if (!menu) {
      go('closed');
      return undefined;
    }
    panelRef.current?.setAttribute('inert', '');
    const up = rollUp(menu, unrolling.current);
    unrolling.current = null;
    rolling.current = up;
    let current = true;
    up.finished.then(
      () => {
        if (current) go('closed');
      },
      () => {},
    );
    // The roll-up is left running when the phase moves on: a reopen takes the sheet down from
    // where it has got to, and a closed menu is no longer drawn.
    return () => {
      current = false;
    };
  }, [phase, parts, go]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ar-menubtn"
        aria-haspopup="dialog"
        aria-expanded={phase === 'open'}
        aria-controls={phase === 'closed' ? undefined : menuId}
        onClick={openMenu}
      >
        <span>{labels.menu}</span>
        <Icon icon={Menu} size={20} />
      </button>
      {phase !== 'closed'
        ? createPortal(
            <div
              ref={panelRef}
              id={menuId}
              className="ar-mmenu"
              role="dialog"
              aria-modal="true"
              aria-label={labels.menu}
              data-phase={phase}
            >
              <div ref={rollRef} className="ar-mmenu__roll">
                <div ref={sheetRef} className="ar-mmenu__sheet">
                  <div className="ar-mmenu__top">
                    <Link href="/" className="ar-nav__name" onClick={() => closeFor('/', false)}>
                      {name}
                    </Link>
                    <button ref={closeRef} type="button" className="ar-menubtn" onClick={() => close(true)}>
                      <span>{labels.close}</span>
                      <Icon icon={X} size={20} />
                    </button>
                  </div>
                  <nav aria-label={labels.nav}>
                    <ul className="ar-mmenu__links">
                      {items.map((item) => (
                        <li key={item.href}>
                          {item.external ? (
                            <a
                              href={item.href}
                              rel="noopener noreferrer"
                              className="ar-mmenu__link"
                              onClick={() => closeFor(item.href, true)}
                            >
                              <span>{item.label}</span>
                              <Icon icon={ArrowRight} size={22} />
                            </a>
                          ) : (
                            <Link
                              href={item.href}
                              aria-current={currentValue(pathname, item.href)}
                              className="ar-mmenu__link"
                              onClick={() => closeFor(item.href, false)}
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
                <div ref={edgeRef} className="ar-mmenu__edge" style={{ height: page.menu.edgeLine }} aria-hidden="true" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
