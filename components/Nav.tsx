'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import ThemeToggle from './ThemeToggle';

const links = [
  { href: '/projects/raven', label: 'Raven' },
  { href: '/#projects', label: 'Projects' },
  { href: '/#about', label: 'About' },
  { href: '/#experience', label: 'Experience' },
  { href: '/#contact', label: 'Contact' },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled
          ? 'backdrop-blur-xl border-b border-line/8'
          : 'border-b border-transparent',
      )}
      style={{
        backgroundColor: scrolled ? 'rgb(var(--bg) / 0.7)' : 'transparent',
      }}
    >
      <div className="wrap flex h-16 items-center justify-between md:h-[72px]">
        <Link
          href="/"
          onClick={() => setMenuOpen(false)}
          className="group flex items-center gap-3"
        >
          <Mark />
          <span className="hidden font-display text-[15px] font-medium tracking-tight text-fg sm:inline">
            Amjad Rehawi
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3.5 py-1.5 text-[13.5px] font-medium text-fg-dim transition-colors hover:text-fg"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/#contact"
            className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-[13.5px] font-medium text-bg transition-colors hover:bg-accent"
          >
            Get in touch
          </Link>
          <ThemeToggle />
          <Link
            href="/admin"
            aria-label="Admin"
            className="hidden h-9 w-9 place-items-center rounded-full border border-line/15 text-fg-mute transition-colors hover:border-fg/40 hover:text-fg md:grid"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.27 16.96l.06-.06A1.65 1.65 0 0 0 4.66 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
          <button
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            className="md:hidden grid h-9 w-9 place-items-center rounded-full border border-line/15 text-fg-mute"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeWidth="2"
                d={menuOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 8h16M4 16h16'}
              />
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div
          className="md:hidden backdrop-blur-xl border-t border-line/10"
          style={{ backgroundColor: 'rgb(var(--bg) / 0.95)' }}
        >
          <nav className="wrap flex flex-col gap-1 py-5">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="py-2.5 text-base font-medium text-fg-dim hover:text-fg"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/admin"
              onClick={() => setMenuOpen(false)}
              className="mt-2 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-mute hover:text-accent"
            >
              Admin
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

function Mark() {
  return (
    <span className="relative grid h-8 w-8 place-items-center rounded-lg" style={{ background: 'rgb(var(--line) / 0.04)', border: '1px solid rgb(var(--line) / 0.08)' }}>
      <svg viewBox="0 0 28 28" width="18" height="18" fill="none">
        <path
          d="M4 22 L14 5 L24 22"
          stroke="rgb(var(--accent))"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d="M9 17 L19 17"
          stroke="rgb(var(--accent) / 0.55)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
