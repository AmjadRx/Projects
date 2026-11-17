'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export interface NavItem {
  label: string;
  /** Already resolved on the server (lib/site.ts navItemsFor): a page that exists, or a safe address. */
  href: string;
  /** True when the item leaves the site. */
  external?: boolean;
}

/** True when the current path is the item or lies under it ("/projects/raven" under "/projects"). */
export function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function NavLinks({
  items,
  className,
  linkClassName,
  onNavigate,
}: {
  items: NavItem[];
  className?: string;
  linkClassName?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? '/';
  const base = 'inline-flex min-h-[44px] min-w-[44px] items-center text-sm';
  return (
    <ul className={className}>
      {items.map((item) => {
        if (item.external) {
          return (
            <li key={item.href}>
              <a href={item.href} rel="noopener noreferrer" onClick={onNavigate} className={cn(base, 'text-ink-dim hover:text-ink', linkClassName)}>
                {item.label}
              </a>
            </li>
          );
        }
        const current = isCurrent(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={pathname === item.href ? 'page' : current ? 'true' : undefined}
              onClick={onNavigate}
              className={cn(
                base,
                current ? 'text-ink underline decoration-accent decoration-2 underline-offset-[6px]' : 'text-ink-dim hover:text-ink',
                linkClassName,
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
