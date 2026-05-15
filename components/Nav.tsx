'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const links = [
  { href: '/#about', label: 'About' },
  { href: '/#projects', label: 'Projects' },
  { href: '/#skills', label: 'Skills' },
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
          ? 'border-b border-white/8 bg-navy/80 backdrop-blur-md'
          : 'border-b border-transparent',
      )}
      style={scrolled ? { borderBottomColor: 'rgb(255 255 255 / 0.08)' } : undefined}
    >
      <div className="wrap flex h-16 items-center justify-between">
        <Link
          href="/"
          className="group flex items-center gap-2 font-mono text-sm tracking-wider"
          onClick={() => setMenuOpen(false)}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-cyan shadow-glow" />
          <span className="text-ink">AMJAD</span>
          <span className="text-ink-mute">·</span>
          <span className="text-cyan">REHAWI</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-mono text-xs uppercase tracking-widest text-ink-dim transition-colors hover:text-cyan"
            >
              {l.label}
            </Link>
          ))}
          <Link href="/admin" className="btn-secondary px-3 py-1.5 text-xs">
            ⌘ Admin
          </Link>
        </nav>

        <button
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          className="md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/5">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeWidth="2"
                d={menuOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 7h16M4 12h16M4 17h16'}
              />
            </svg>
          </span>
        </button>
      </div>

      {menuOpen && (
        <div className="border-t border-white/8 bg-navy/95 backdrop-blur-md md:hidden">
          <nav className="wrap flex flex-col gap-2 py-4">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-md px-2 py-2 font-mono text-sm text-ink-dim hover:bg-white/5 hover:text-cyan"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/admin"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-2 py-2 font-mono text-sm text-ink-dim hover:bg-white/5 hover:text-cyan"
            >
              ⌘ Admin
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
