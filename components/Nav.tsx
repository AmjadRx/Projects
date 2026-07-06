'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import type { NavItem, SocialLink } from '@/lib/types';
import { cn, EASE } from '@/lib/utils';
import ThemeToggle from './ThemeToggle';
import LinkIcon from './LinkIcon';

interface NavProps {
  name: string;
  items: NavItem[];
  socials: SocialLink[];
}

export default function Nav({ name, items, socials }: NavProps) {
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const lastY = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 16);
      setHidden(y > 96 && y > lastY.current && !open);
      lastY.current = y;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [open]);

  const navSocials = socials.filter((s) => s.showInNav);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-transform duration-300 ease-out',
        hidden && '-translate-y-full',
      )}
    >
      <div
        className={cn(
          'transition-colors duration-300',
          scrolled || open ? 'bg-bg/85 backdrop-blur-xl' : 'bg-transparent',
        )}
        style={scrolled || open ? { borderBottom: '1px solid var(--line)' } : undefined}
      >
        <div className="wrap flex h-16 items-center justify-between md:h-[72px]">
          <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 28 28" fill="none" aria-hidden>
              <path d="M4 21 L14 6 L24 21" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinejoin="round" />
              <path d="M10 14.5 L18 14.5" stroke="rgb(var(--accent) / 0.5)" strokeWidth="2" />
            </svg>
            <span className="text-sm font-semibold tracking-tight text-ink">{name}</span>
          </Link>

          <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="link-underline text-sm text-ink-dim transition-colors hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            {navSocials.map((s) => (
              <a
                key={s.id}
                href={s.url}
                target={s.url.startsWith('http') ? '_blank' : undefined}
                rel={s.url.startsWith('http') ? 'noopener noreferrer' : undefined}
                aria-label={s.label}
                className="text-ink-dim transition-colors hover:text-accent"
              >
                <LinkIcon icon={s.icon} size={16} />
              </a>
            ))}
            <ThemeToggle />
            <Link href="/#contact" className="btn-primary !min-h-0 !px-4 !py-2 text-[13px]">
              Get in touch
            </Link>
          </nav>

          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <button
              aria-label="Toggle menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="flex h-11 w-11 items-center justify-center text-ink"
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 top-16 z-40 bg-bg md:hidden"
          >
            <nav className="wrap flex flex-col gap-1 py-8" aria-label="Mobile">
              {items.map((item, i) => (
                <motion.div
                  key={item.href}
                  initial={reduced ? false : { opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.35, ease: EASE }}
                >
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block py-3 text-2xl font-semibold tracking-tight text-ink"
                  >
                    {item.label}
                  </Link>
                </motion.div>
              ))}
              <motion.div
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25 }}
                className="mt-6 flex items-center gap-3"
              >
                {socials
                  .filter((s) => s.showInFooter || s.showInNav)
                  .map((s) => (
                    <a
                      key={s.id}
                      href={s.url}
                      aria-label={s.label}
                      className="pill hover:border-accent/60 hover:text-accent"
                    >
                      <LinkIcon icon={s.icon} size={13} />
                      {s.label}
                    </a>
                  ))}
              </motion.div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
