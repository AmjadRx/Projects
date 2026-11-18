import { hasText } from '@/lib/format';
import type { Site } from '@/lib/types';
import { cn } from '@/lib/utils';

type Role = Site['experience'][number];

/**
 * The roles on the Experience page, newest first as the content orders them (bundle Timeline,
 * bundle.css 32): a rule datum line with a diamond node per role, filled for a role whose dates run
 * "to present", open otherwise. Dates in B612 Mono, left of the line from 1024 px and above the
 * role below that. Each role sits on glass: the role as a heading (h2 on /experience, D-67), the
 * company and location, and the bullets with a short line leader.
 *
 * Hiding rules: a role with neither a role nor a company is left out; with no role the company
 * takes the heading and is not repeated; empty dates, location and bullets leave no element.
 * A role's optional logo is not drawn: the bundle allows no logos beyond the two Lucide brand
 * glyphs.
 */
export default function Timeline({
  roles,
  label,
  headingLevel = 2,
  className,
}: {
  roles: Role[];
  /** The list's accessible name (the page heading's words). */
  label: string;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const shown = roles.filter((role) => hasText(role.role) || hasText(role.company));
  if (shown.length === 0) return null;
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  return (
    <ol className={cn('ar-tl', className)} aria-label={label}>
      {shown.map((role, i) => {
        const heading = hasText(role.role) ? role.role : role.company;
        const company = hasText(role.role) && hasText(role.company) ? role.company : '';
        const bullets = role.bullets.filter(hasText);
        const now = /to present$/i.test(role.dates.trim());
        return (
          <li key={`${role.company}-${role.role}-${i}`} className={cn('ar-tl__item', now && 'is-now')}>
            {hasText(role.dates) ? <p className="ar-tl__dates">{role.dates}</p> : null}
            <span className="ar-tl__node" aria-hidden="true" />
            <div className="ar-tl__body">
              <Heading className="ar-tl__role">{heading}</Heading>
              {hasText(company) || hasText(role.location) ? (
                <p className="ar-tl__org">
                  {hasText(company) ? <span>{company}</span> : null}
                  {/* A word space, so the two never run together in text; the flex gap draws the room. */}
                  {hasText(company) && hasText(role.location) ? ' ' : null}
                  {hasText(role.location) ? <span className="ar-tl__loc">{role.location}</span> : null}
                </p>
              ) : null}
              {bullets.length > 0 ? (
                <ul className="ar-tl__bullets">
                  {bullets.map((bullet, b) => (
                    <li key={b}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
