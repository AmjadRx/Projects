import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A Lucide icon on the design system's terms (bundle Icon): drawn on the 24 px grid at stroke 1.75,
 * in currentColor, and hidden from assistive technology unless it carries a `title`. Pass the icon
 * component itself, so a page's bundle holds only the icons it draws:
 * `<Icon icon={ArrowRight} size={18} />`. Icons sit beside words; an icon-only control carries its
 * label as the control's own accessible name.
 */
export default function Icon({
  icon: Glyph,
  size = 20,
  strokeWidth = 1.75,
  title,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
  /** A text alternative, only for an icon that stands alone and means something. */
  title?: string;
  className?: string;
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={cn('ar-icon', className)}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      focusable="false"
    />
  );
}
