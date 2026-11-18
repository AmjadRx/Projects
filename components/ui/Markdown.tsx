import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { LinkResolver } from '@/lib/links';

/**
 * Markdown from content with a strict allow-list (ARCHITECTURE.md 2): paragraphs, emphasis,
 * links, inline code, and lists. Raw HTML is dropped. A link to a page the site does not render
 * (a hidden project, a mistyped path) prints as plain text, so it leaves no trace.
 */
const ALLOWED = ['p', 'strong', 'em', 'del', 'a', 'code', 'ul', 'ol', 'li', 'br'];
const INLINE_ALLOWED = ['p', 'strong', 'em', 'del', 'a', 'code', 'br'];

function components(resolveLink: LinkResolver, inline: boolean): Components {
  return {
    a: ({ href, children }) => {
      const target = resolveLink(href);
      if (!target) return <span>{children}</span>;
      if (target.external || /^(mailto|tel):/i.test(target.href)) {
        return (
          <a href={target.href} rel={target.external ? 'noopener noreferrer' : undefined}>
            {children}
          </a>
        );
      }
      return <Link href={target.href}>{children}</Link>;
    },
    ...(inline ? { p: ({ children }) => <>{children}</> } : {}),
  };
}

export default function Markdown({
  md,
  resolveLink,
  inline = false,
  className,
}: {
  md: string;
  resolveLink: LinkResolver;
  /** Render without paragraph or list elements, for table cells and short lines. */
  inline?: boolean;
  /** Styles the text: the caller's sheet or page class (`pj-text`, `ar-rev__text`, ...). */
  className?: string;
}) {
  const body = (
    <ReactMarkdown
      skipHtml
      allowedElements={inline ? INLINE_ALLOWED : ALLOWED}
      unwrapDisallowed
      components={components(resolveLink, inline)}
    >
      {md}
    </ReactMarkdown>
  );
  if (inline) return body;
  return <div className={className}>{body}</div>;
}
