import Link from 'next/link';
import Markdown from '@/components/ui/Markdown';
import { hasText } from '@/lib/format';
import type { LinkResolver } from '@/lib/links';
import { newestFirst } from '@/lib/log';
import type { ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import LogGallery from './LogGallery';

export { newestFirst };

/** One gallery cell in the entry column (at most 36rem wide): three columns from 768 px, two below. */
const LOG_GALLERY_SIZES = '(min-width: 768px) 184px, 45vw';

export interface RevisionRow {
  /** Stable, unique key. */
  key: string;
  date: string;
  title: string;
  md: string;
  media: ResolvedMedia[];
  /** On /log: the project the entry belongs to. */
  project?: { title: string; href: string };
}

/**
 * A drawing revision table (DESIGN_DIRECTION.md 5.6): REV, DATE, DESCRIPTION, newest first,
 * with photos per entry. REV counts up from the oldest entry. On phones the rows stack.
 */
export default function RevisionTable({
  rows,
  resolveLink,
  anchorPrefix,
  showProject = false,
}: {
  rows: RevisionRow[];
  resolveLink: LinkResolver;
  /** Element ids are `${anchorPrefix}${rev}`, unique on the page. */
  anchorPrefix: string;
  showProject?: boolean;
}) {
  if (rows.length === 0) return null;
  const sorted = newestFirst(rows);
  const total = sorted.length;
  return (
    <table className="table-plain max-md:block">
      <caption className="sr-only">{UI.revisions.caption}</caption>
      <thead className="max-md:sr-only">
        <tr>
          <th scope="col" className="w-16">
            {UI.revisions.rev}
          </th>
          <th scope="col" className="w-32">
            {UI.revisions.date}
          </th>
          <th scope="col">{UI.revisions.description}</th>
          {showProject && <th scope="col">{UI.revisions.project}</th>}
        </tr>
      </thead>
      <tbody className="max-md:block">
        {sorted.map((row, i) => {
          const rev = total - i;
          return (
            <tr key={row.key} id={`${anchorPrefix}${rev}`} className="max-md:block max-md:py-3">
              <td className="data text-ink max-md:inline-block max-md:border-0 max-md:px-0 max-md:py-0 max-md:pr-3">
                <span className="md:sr-only">{UI.revisions.rev} </span>
                {rev}
              </td>
              <td className="data whitespace-nowrap max-md:inline-block max-md:border-0 max-md:px-0 max-md:py-0">
                {row.date}
              </td>
              <td className="max-md:block max-md:border-0 max-md:px-0 max-md:pb-0 max-md:pt-1">
                {hasText(row.title) && <p className="font-semibold text-ink">{row.title}</p>}
                {row.md.trim() !== '' && <Markdown md={row.md} resolveLink={resolveLink} className="mt-1 text-sm md:text-base" />}
                {row.media.length > 0 && (
                  <div className="mt-3 max-w-xl">
                    <LogGallery items={row.media} sizes={LOG_GALLERY_SIZES} />
                  </div>
                )}
              </td>
              {showProject && (
                <td className="max-md:block max-md:border-0 max-md:px-0 max-md:pt-1">
                  {row.project && (
                    <Link href={row.project.href} className="text-link inline-flex min-h-[44px] items-center">
                      {row.project.title}
                    </Link>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
