import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type GlassTag = 'div' | 'section' | 'aside' | 'article' | 'figure' | 'ul' | 'ol' | 'dl' | 'nav';

/**
 * Glass (bundle Glass, bundle.css 24): every panel that carries text over the sky. The glass fill,
 * an 8 px backdrop blur that dims the sky behind by a third, a 1 px rule, 2 px corners. On
 * Whiteprint it is the plain white panel. `pad` (on by default) is 24 px, 32 px from 1024 px.
 * Paragraphs never sit on the bare sky: put them on glass.
 */
export default function Glass({
  as: Tag = 'div',
  pad = true,
  className,
  children,
  ...rest
}: { as?: GlassTag; pad?: boolean; className?: string; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn('ar-glass', pad && 'ar-glass--pad', className)} {...rest}>
      {children}
    </Tag>
  );
}
