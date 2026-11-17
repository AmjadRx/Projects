'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type Theme = 'dark' | 'light';

export interface ThemeLabels {
  toBlueprint: string;
  toWhiteprint: string;
}

/**
 * Switches between Blueprint (dark) and Whiteprint (light). The choice is kept in a cookie that
 * the head script reads before the first paint, so the theme never flashes. The labels come from
 * the server (lib/strings.ts), so the site-wide script chunk does not carry the strings module.
 */
export default function ThemeToggle({
  labels,
  className,
  withLabel = false,
}: {
  labels: ThemeLabels;
  className?: string;
  withLabel?: boolean;
}) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === 'light' ? 'light' : 'dark');
  }, []);

  const label = theme === 'light' ? labels.toBlueprint : labels.toWhiteprint;

  const toggle = () => {
    const next: Theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    document.cookie = `theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={withLabel ? undefined : label}
      title={label}
      className={cn('inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-sm text-ink-dim hover:text-accent', className)}
    >
      {theme === 'light' ? <Moon size={18} aria-hidden /> : <Sun size={18} aria-hidden />}
      {withLabel && <span className="text-sm">{label}</span>}
    </button>
  );
}
