import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import Icon from '@/components/sheet/Icon';
import { linkGlyph } from '@/components/sheet/linkGlyph';
import { hasText } from '@/lib/format';
import type { Link as ContentLink } from '@/lib/types';
import type { BlockContext } from './context';

/**
 * A link row block: standalone links in the line color, each with its Lucide glyph (the bundle
 * allows LinkedIn and GitHub as its only brand marks) and, when it leaves the site, the arrow. A
 * link the resolver refuses (a hidden project, an unsafe address) prints as plain words.
 */
export default function LinkRowBlock({ links, ctx }: { links: ContentLink[]; ctx: BlockContext }) {
  const shown = links.filter((link) => hasText(link.label));
  if (shown.length === 0) return null;
  return (
    <ul className="pj-links">
      {shown.map((link, i) => {
        const target = ctx.resolveLink(link.url);
        const glyph = linkGlyph(link.icon, link.url);
        const icon = glyph ? <Icon icon={glyph} size={18} /> : null;
        if (!target) {
          return (
            <li key={i} className="pj-links__plain">
              {icon}
              {link.label}
            </li>
          );
        }
        const body = (
          <>
            {icon}
            <span className="ar-link__text">{link.label}</span>
            {target.external ? <Icon icon={ArrowUpRight} size={16} /> : null}
          </>
        );
        const internal = !target.external && target.href.startsWith('/') && !target.href.startsWith('//');
        return (
          <li key={i}>
            {internal ? (
              <Link href={target.href} className="ar-link ar-link--standalone">
                {body}
              </Link>
            ) : (
              <a href={target.href} rel={target.external ? 'noopener noreferrer' : undefined} className="ar-link ar-link--standalone">
                {body}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
