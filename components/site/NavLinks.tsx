'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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

/** aria-current for a nav item: "page" on the page itself, "true" on a page under it. */
export function currentValue(pathname: string, href: string): 'page' | 'true' | undefined {
  if (pathname === href) return 'page';
  return isCurrent(pathname, href) ? 'true' : undefined;
}

/**
 * The desktop nav's links (bundle Nav, bundle.css 8): ink-dim, ink on hover with the underline
 * drawn from the left; the current page keeps a 2 px underline and aria-current.
 */
export default function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? '/';
  return (
    <ul className="ar-nav__links">
      {items.map((item) => (
        <li key={item.href}>
          {item.external ? (
            <a href={item.href} rel="noopener noreferrer" className="ar-nav__link">
              {item.label}
            </a>
          ) : (
            <Link href={item.href} aria-current={currentValue(pathname, item.href)} className="ar-nav__link">
              {item.label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
