import Link from 'next/link';
import LinkIcon from '@/components/LinkIcon';
import { hasText, statusText } from '@/lib/format';
import type { LinkResolver } from '@/lib/links';
import { UI } from '@/lib/strings';
import type { Project } from '@/lib/types';
import { detectIcon } from '@/lib/utils';
import MaturityScale from './MaturityScale';

/**
 * The title block (DESIGN_DIRECTION.md 5.1): project, sheet number, role, dates, status, revision
 * date, maturity, and links. Labels are drafting capitals; values print exactly as stored. A field
 * with no value has no row. REV is the date of the project's last content commit, left out when
 * it cannot be known (docs/V3_PLAN.md D-09).
 */
export default function TitleBlock({
  project,
  sheet,
  sheets,
  rev,
  resolveLink,
}: {
  project: Project;
  sheet: number;
  sheets: number;
  rev?: string;
  resolveLink: LinkResolver;
}) {
  const links = project.links
    .filter((link) => hasText(link.label))
    .map((link) => ({ link, target: resolveLink(link.url) }));
  const th = 'w-[7.5rem] whitespace-nowrap font-mono text-xs font-medium uppercase tracking-wider text-ink-mute';
  return (
    <table className="table-plain">
      <caption className="sr-only">{UI.titleBlock.caption}</caption>
      <tbody>
        <tr>
          <th scope="row" className={th}>
            {UI.titleBlock.project}
          </th>
          <td className="text-ink">{project.title}</td>
        </tr>
        <tr>
          <th scope="row" className={th}>
            {UI.titleBlock.sheet}
          </th>
          <td className="data">
            {sheet} {UI.titleBlock.of.toUpperCase()} {sheets}
          </td>
        </tr>
        {hasText(project.role) && (
          <tr>
            <th scope="row" className={th}>
              {UI.titleBlock.role}
            </th>
            <td>{project.role}</td>
          </tr>
        )}
        {hasText(project.timeframe) && (
          <tr>
            <th scope="row" className={th}>
              {UI.titleBlock.dates}
            </th>
            <td className="data">{project.timeframe}</td>
          </tr>
        )}
        <tr>
          <th scope="row" className={th}>
            {UI.titleBlock.status}
          </th>
          <td>{statusText(project)}</td>
        </tr>
        {rev && (
          <tr>
            <th scope="row" className={th}>
              {UI.titleBlock.rev}
            </th>
            <td className="data">
              <time dateTime={rev}>{rev}</time>
            </td>
          </tr>
        )}
        {project.maturity && hasText(project.maturity.label) && (
          <tr>
            <th scope="row" className={th}>
              {UI.maturity.label}
            </th>
            <td>
              <MaturityScale maturity={project.maturity} />
            </td>
          </tr>
        )}
        {links.length > 0 && (
          <tr>
            <th scope="row" className={th}>
              {UI.titleBlock.links}
            </th>
            <td>
              <ul className="flex flex-wrap gap-x-4">
                {links.map(({ link, target }, i) => {
                  const icon = <LinkIcon icon={link.icon || detectIcon(link.url)} size={15} />;
                  if (!target) {
                    return (
                      <li key={i} className="inline-flex min-h-[44px] items-center gap-2">
                        {icon}
                        {link.label}
                      </li>
                    );
                  }
                  return (
                    <li key={i}>
                      {target.external ? (
                        <a href={target.href} rel="noopener noreferrer" className="text-link inline-flex min-h-[44px] items-center gap-2">
                          {icon}
                          {link.label}
                        </a>
                      ) : (
                        <Link href={target.href} className="text-link inline-flex min-h-[44px] items-center gap-2">
                          {icon}
                          {link.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
