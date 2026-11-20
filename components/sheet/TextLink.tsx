import Link from 'next/link';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import Icon from './Icon';

/**
 * A link (bundle Link, bundle.css 4), in the line color.
 * - inline: inside running text; a resting 1 px underline in the rule color takes the link color
 *   on hover, so a link never depends on color alone.
 * - standalone: in lists, link rows and proof links, 44 px tall; the underline draws from the left
 *   on hover in 150 ms and goes back the same way (motion sheet 7.7), at once under reduced motion;
 *   focus shows the ring, not the underline. An external standalone link carries the arrow.
 *
 * `href` must already be resolved (lib/links.ts): a link to a hidden or unknown page is plain text,
 * so callers render the words without this component when the resolver returns null.
 */
export default function TextLink({
  href,
  variant = 'inline',
  external = false,
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: 'inline' | 'standalone';
  /** True when the address leaves the site: adds the arrow (standalone) and rel noopener noreferrer. */
  external?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className' | 'children'>) {
  const cls = cn('ar-link', `ar-link--${variant}`, className);
  const body =
    variant === 'inline' ? (
      children
    ) : (
      <>
        <span className="ar-link__text">{children}</span>
        {external ? <Icon icon={ArrowUpRight} size={16} /> : null}
      </>
    );
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link href={href} className={cls} {...rest}>
        {body}
      </Link>
    );
  }
  return (
    <a href={href} className={cls} rel={external ? 'noopener noreferrer' : undefined} {...rest}>
      {body}
    </a>
  );
}
