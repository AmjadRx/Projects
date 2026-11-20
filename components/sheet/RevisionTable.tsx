import LogGallery from '@/components/log/LogGallery';
import Markdown from '@/components/ui/Markdown';
import { hasText } from '@/lib/format';
import type { LinkResolver } from '@/lib/links';
import { newestFirst } from '@/lib/log';
import type { ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import TextLink from './TextLink';

export { newestFirst };

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

/** Drawing revision letters: the oldest entry is A, then B, ..., Z, AA. */
export function revLetter(indexFromOldest: number): string {
  let n = indexFromOldest;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * The build log as a drawing's revision table (bundle RevisionTable, bundle.css 15;
 * DESIGN_DIRECTION.md 5.6): REV, DATE, (PROJECT on /log), DESCRIPTION, newest first. Dates print as
 * the content writes them ("2026-08-13", "2026-07"). An entry's photos open in the lazy gallery
 * under its text; a log with no photos ships no gallery code.
 *
 * REV letters run from A for the oldest entry, as on a drawing. Each row keeps the Phase 3 anchor,
 * `${anchorPrefix}${n}` with n counting up from 1 for the oldest, so links to an entry still land.
 * The PROJECT cell links through the link resolver; a page it does not know prints as plain text.
 * One entry is one row, REV A, with the header and the closing rule as for any count; nothing pages
 * or collapses. On phones REV and DATE share a line and the entry follows. Put it on Glass over
 * the sky.
 */
export default function RevisionTable({
  rows,
  resolveLink,
  anchorPrefix,
  showProject = false,
  className,
}: {
  rows: RevisionRow[];
  resolveLink: LinkResolver;
  /** Element ids are `${anchorPrefix}${n}`, unique on the page. */
  anchorPrefix: string;
  /** The merged /log table: adds the PROJECT column. */
  showProject?: boolean;
  className?: string;
}) {
  if (rows.length === 0) return null;
  const sorted = newestFirst(rows);
  const total = sorted.length;
  return (
    <table className={cn('ar-table ar-rev', className)}>
      <caption className="ar-sr">{UI.revisions.logCaption}</caption>
      <colgroup>
        <col className="ar-rev__rev-col" />
        <col className="ar-rev__date-col" />
        {showProject ? <col className="ar-rev__proj-col" /> : null}
        <col />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="ar-th-caps">
            {UI.revisions.rev}
          </th>
          <th scope="col" className="ar-th-caps">
            {UI.revisions.date}
          </th>
          {showProject ? (
            <th scope="col" className="ar-th-caps">
              {UI.revisions.project}
            </th>
          ) : null}
          <th scope="col" className="ar-th-caps">
            {UI.revisions.description}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, i) => {
          const n = total - i;
          const target = showProject && row.project ? resolveLink(row.project.href) : null;
          return (
            <tr key={row.key} id={`${anchorPrefix}${n}`} className="ar-rev__row">
              <td className="ar-rev__rev">{revLetter(n - 1)}</td>
              <td className="ar-rev__date">{row.date}</td>
              {showProject ? (
                <td className="ar-rev__proj ar-rev__cell-proj">
                  {row.project && target ? (
                    <TextLink href={target.href} variant="standalone">
                      {row.project.title}
                    </TextLink>
                  ) : row.project ? (
                    row.project.title
                  ) : null}
                </td>
              ) : null}
              <td className="ar-rev__cell-desc">
                <div className="ar-rev__desc">
                  <div>
                    {hasText(row.title) ? <p className="ar-rev__title">{row.title}</p> : null}
                    {hasText(row.md) ? <Markdown md={row.md} resolveLink={resolveLink} className="ar-rev__text" /> : null}
                    {row.media.length > 0 ? (
                      <div className="ar-rev__media">
                        <LogGallery items={row.media} />
                      </div>
                    ) : null}
                  </div>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
