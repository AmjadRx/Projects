import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A callout block (bundle Callout, bundle.css 30): the content's own sentence on glass, 17 px in
 * ink at the reading measure, role="note". `status` (what is still to come) is drawn in phantom
 * line, a dashed line-colored border; `note` is the plain glass panel with a rule. No icon, no
 * colored edge. `children` is the content's Markdown (components/ui/Markdown).
 *
 * `label` is read before the text by screen readers ("Status", "Note") and is visually hidden: the
 * bundle shows no label, and the tone is drawn as a shape, not only a color.
 */
export default function Callout({
  tone = 'note',
  label,
  children,
  className,
}: {
  tone?: 'note' | 'status';
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('ar-callout', `ar-callout--${tone}`, className)} role="note">
      {label ? <span className="ar-sr">{label}</span> : null}
      <div className="ar-callout__text">{children}</div>
    </div>
  );
}
