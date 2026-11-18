import { hasText, statusText } from '@/lib/format';
import type { LinkResolver } from '@/lib/links';
import { UI } from '@/lib/strings';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';
import MaturityScale from './MaturityScale';
import TextLink from './TextLink';

/**
 * The title block (bundle TitleBlock, bundle.css 14; DESIGN_DIRECTION.md 5.1): the table in the
 * corner of a drawing. PROJECT, SHEET, ROLE, DATES, STATUS, REV, MATURITY, and LINKS, in B612 Mono
 * on glass with a line border; the field names are the only capitals (CSS). Values print exactly
 * as stored.
 *
 * Hiding rules: a field with no value leaves no cell (ROLE, DATES, MATURITY without a label, LINKS
 * without one), and REV is left out when the date of the project's last content commit cannot be
 * known (docs/V3_PLAN.md D-09). STATUS then takes the row's full width.
 *
 * `rail` makes it sticky in the right rail from 1024 px (the project page's desktop layout).
 */
export default function TitleBlock({
  project,
  sheet,
  sheets,
  rev,
  resolveLink,
  rail = false,
  className,
}: {
  project: Project;
  /** The project's place among the visible projects, from 1. */
  sheet: number;
  /** How many projects are visible. */
  sheets: number;
  /** REV: the date of the project's last content commit, or undefined. */
  rev?: string;
  resolveLink: LinkResolver;
  rail?: boolean;
  className?: string;
}) {
  const links = project.links
    .filter((link) => hasText(link.label))
    .map((link) => ({ label: link.label, target: resolveLink(link.url) }));
  const maturity = project.maturity && hasText(project.maturity.label) ? project.maturity : null;

  return (
    <dl className={cn('ar-tb', rail && 'ar-tb--rail', className)}>
      <div className="ar-tb__cell ar-tb__cell--project">
        <dt>{UI.titleBlock.project}</dt>
        <dd>{project.title}</dd>
      </div>
      <div className="ar-tb__cell ar-tb__cell--end">
        <dt>{UI.titleBlock.sheet}</dt>
        <dd className="ar-tb__caps">
          {sheet} {UI.titleBlock.of.toUpperCase()} {sheets}
        </dd>
      </div>
      {hasText(project.role) ? (
        <div className="ar-tb__cell ar-tb__cell--wide">
          <dt>{UI.titleBlock.role}</dt>
          <dd>{project.role}</dd>
        </div>
      ) : null}
      {hasText(project.timeframe) ? (
        <div className="ar-tb__cell ar-tb__cell--wide">
          <dt>{UI.titleBlock.dates}</dt>
          <dd>{project.timeframe}</dd>
        </div>
      ) : null}
      <div className={cn('ar-tb__cell', !rev && 'ar-tb__cell--wide')}>
        <dt>{UI.titleBlock.status}</dt>
        <dd>{statusText(project)}</dd>
      </div>
      {rev ? (
        <div className="ar-tb__cell ar-tb__cell--end">
          <dt>{UI.titleBlock.rev}</dt>
          <dd>
            <time dateTime={rev}>{rev}</time>
          </dd>
        </div>
      ) : null}
      {maturity ? (
        <div className="ar-tb__cell ar-tb__cell--wide">
          <dt>{UI.maturity.label}</dt>
          <dd>
            <MaturityScale maturity={maturity} variant="full" />
          </dd>
        </div>
      ) : null}
      {links.length > 0 ? (
        <div className="ar-tb__cell ar-tb__cell--wide">
          <dt>{UI.titleBlock.links}</dt>
          <dd>
            <ul className="ar-tb__links">
              {links.map(({ label, target }, i) => (
                <li key={`${label}-${i}`}>
                  {target ? (
                    <TextLink href={target.href} variant="standalone" external={target.external}>
                      {label}
                    </TextLink>
                  ) : (
                    <span className="ar-tb__text">{label}</span>
                  )}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
