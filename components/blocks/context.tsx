import type { LinkResolver } from '@/lib/links';

export type HeadingLevel = 2 | 3 | 4 | 5;

/** What every block needs from the page around it. */
export interface BlockContext {
  /** Resolves content links; a link to a page the site does not render becomes plain text. */
  resolveLink: LinkResolver;
  /** The level a `heading` block renders at (the page title is the only h1). */
  level: HeadingLevel;
  /** Prefix for element ids, so anchors stay unique when blocks from several projects meet. */
  idPrefix: string;
}

export function deeper(level: HeadingLevel): HeadingLevel {
  return Math.min(level + 1, 5) as HeadingLevel;
}

export function Heading({
  level,
  className,
  id,
  children,
}: {
  level: HeadingLevel;
  className?: string;
  id?: string;
  children: React.ReactNode;
}) {
  const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5';
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}
