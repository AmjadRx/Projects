import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import Icon from './Icon';

type Variant = 'primary' | 'secondary' | 'text';

interface Common {
  /**
   * primary: the action fill, one per page, the only filled amber element (its hover sweeps the
   * ramp along the bottom edge, one of the ramp's eight places). secondary: a line outline on glass.
   * text: a line-colored label whose underline draws on hover.
   */
  variant?: Variant;
  /** A Lucide icon after the label (lucide-react component). */
  icon?: LucideIcon;
  className?: string;
  /** The label: says what the button does ("See the work", "Email me"). */
  children: ReactNode;
}

type LinkButton = Common & {
  /** An address already resolved (lib/links.ts). A site path renders next/link. */
  href: string;
  /** True when the address leaves the site: adds rel noopener noreferrer. */
  external?: boolean;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className' | 'children'>;

type PlainButton = Common & { href?: undefined; external?: undefined } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'className' | 'children'
  >;

/**
 * A button (bundle Button, bundle.css 3): 48 px tall (text buttons 44 px), 2 px corners, the label
 * in Archivo 15 px at width 112. With `href` it is a link that looks like a button. Works in server
 * and client components; it holds no words of its own.
 */
export default function Button(props: LinkButton | PlainButton) {
  const { variant = 'primary', icon, className, children } = props;
  const cls = cn('ar-btn', `ar-btn--${variant}`, className);
  const inner = (
    <>
      <span className="ar-btn__label">{children}</span>
      {icon ? <Icon icon={icon} size={18} /> : null}
      {variant === 'primary' ? <span className="ar-btn__sweep" aria-hidden="true" /> : null}
    </>
  );

  if (props.href !== undefined) {
    const { variant: _v, icon: _i, className: _c, children: _ch, href, external, ...rest } = props;
    if (href.startsWith('/') && !href.startsWith('//')) {
      return (
        <Link href={href} className={cls} {...rest}>
          {inner}
        </Link>
      );
    }
    return (
      <a href={href} className={cls} rel={external ? 'noopener noreferrer' : undefined} {...rest}>
        {inner}
      </a>
    );
  }

  const { variant: _v, icon: _i, className: _c, children: _ch, href: _h, external: _e, type = 'button', ...rest } = props;
  return (
    <button type={type} className={cls} {...rest}>
      {inner}
    </button>
  );
}
