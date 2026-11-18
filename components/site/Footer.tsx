import TextLink from '@/components/sheet/TextLink';
import { hasText } from '@/lib/format';
import { UI } from '@/lib/strings';
import type { SocialLink } from '@/lib/types';

/**
 * The end of every page (bundle Footer, bundle.css 20): on glass with a rule on top, the tagline,
 * the email and the footer's social links as standalone links (external ones with the arrow), and
 * a meta row with the date of the latest content commit and the copyright year, both set by the
 * build. The sky's credit line joins it when the sky renders (Phase 5). Desktop: the tagline over
 * six columns, the links from column 8; phones: stacked. Empty fields leave no element.
 */
export default function Footer({
  name,
  tagline,
  email,
  socials,
  updated,
  year,
}: {
  name: string;
  tagline: string;
  email: string;
  /** socialLinksFor(site, 'footer'): no mailto (the email comes from `personal.email`). */
  socials: SocialLink[];
  /** The latest content commit date, or undefined when it cannot be known. */
  updated?: string;
  year: number;
}) {
  const showEmail = hasText(email);
  return (
    <footer className="ar-foot">
      <div className="ar-foot__in">
        {hasText(tagline) ? <p className="ar-foot__tag">{tagline}</p> : null}
        {showEmail || socials.length > 0 ? (
          <ul className="ar-foot__links" aria-label={UI.site.footerNav}>
            {showEmail ? (
              <li>
                <TextLink href={`mailto:${email.trim()}`} variant="standalone">
                  {email.trim()}
                </TextLink>
              </li>
            ) : null}
            {socials.map((social) => (
              <li key={social.id}>
                <TextLink href={social.url} variant="standalone" external={/^https?:\/\//i.test(social.url)}>
                  {social.label}
                </TextLink>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="ar-foot__meta">
          {updated ? (
            <p>
              {UI.site.lastUpdated}{' '}
              <time className="ar-foot__date" dateTime={updated}>
                {updated}
              </time>
            </p>
          ) : null}
          <p>{UI.site.copyright(year, name)}</p>
        </div>
      </div>
    </footer>
  );
}
