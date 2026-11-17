import Link from 'next/link';
import LinkIcon from '@/components/LinkIcon';
import { hasText } from '@/lib/format';
import { detectIcon } from '@/lib/utils';
import type { Link as ContentLink } from '@/lib/types';
import type { BlockContext } from './context';

export default function LinkRowBlock({ links, ctx }: { links: ContentLink[]; ctx: BlockContext }) {
  const shown = links.filter((link) => hasText(link.label));
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2">
      {shown.map((link, i) => {
        const target = ctx.resolveLink(link.url);
        const icon = <LinkIcon icon={link.icon || detectIcon(link.url)} size={16} />;
        if (!target) {
          return (
            <li key={i} className="inline-flex min-h-[44px] items-center gap-2 text-ink-dim">
              {icon}
              {link.label}
            </li>
          );
        }
        const className = 'text-link inline-flex min-h-[44px] items-center gap-2';
        return (
          <li key={i}>
            {target.external ? (
              <a href={target.href} rel="noopener noreferrer" className={className}>
                {icon}
                {link.label}
              </a>
            ) : (
              <Link href={target.href} className={className}>
                {icon}
                {link.label}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
