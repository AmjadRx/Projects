'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const links = [
  { href: '/#projects', label: 'Projects' },
  { href: '/#skills', label: 'Capabilities' },
  { href: '/#experience', label: 'Experience' },
  { href: '/projects/raven', label: 'Raven' },
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
        'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
        scrolled ? 'bg-navy/85 backdrop-blur-xl' : 'bg-transparent',
      )}
      style={
        scrolled
          ? { borderBottom: '1px solid rgb(255 255 255 / 0.08)' }
          : { borderBottom: '1px solid transparent' }
      }
    >
      <div className="wrap flex h-16 items-center justify-between md:h-20">
        <Link
          href="/"
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-3"
        >
          <Mark />
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink">
            Amjad Rehawi
          </span>
        </Link>

        <nav className="hidden items-center gap-9 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-dim transition-colors hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/admin"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute transition-colors hover:text-cyan"
          >
            Admin
          </Link>
        </nav>

        <button
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          className="md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{ border: '1px solid rgb(255 255 255 / 0.15)' }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeWidth="2"
                d={menuOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 8h16M4 16h16'}
              />
            </svg>
          </span>
        </button>
      </div>

      {menuOpen && (
        <div
          className="bg-navy/95 backdrop-blur-xl md:hidden"
          style={{ borderTop: '1px solid rgb(255 255 255 / 0.08)' }}
        >
          <nav className="wrap flex flex-col gap-1 py-5">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="py-2 font-mono text-sm uppercase tracking-widest text-ink-dim hover:text-cyan"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/admin"
              onClick={() => setMenuOpen(false)}
              className="py-2 font-mono text-sm uppercase tracking-widest text-ink-mute hover:text-cyan"
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
    <span className="relative flex h-7 w-7 items-center justify-center">
      <svg viewBox="0 0 28 28" width="22" height="22" fill="none">
        <path
          d="M4 21 L14 6 L24 21"
          stroke="rgb(61 224 255)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M10 14 L18 14"
          stroke="rgb(61 224 255 / 0.5)"
          strokeWidth="1.5"
        />
      </svg>
    </span>
  );
}
