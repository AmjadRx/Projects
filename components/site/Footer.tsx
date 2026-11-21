import type { ReactNode } from 'react';
import TextLink from '@/components/sheet/TextLink';
import { hasText } from '@/lib/format';
import { UI } from '@/lib/strings';
import type { SocialLink } from '@/lib/types';
import PauseMotion from './PauseMotion';

/**
 * The sky's credit line (UI.sky.credits) as text and links, in order. Each link (UI.sky.creditLinks:
 * the licence deed, as the bundle's Footer has it) is found by its words in the line, and is a
 * plain anchor, since it leads to another site.
 */
function creditParts(): ReactNode[] {
  const line = UI.sky.credits;
  const parts: ReactNode[] = [];
  let from = 0;
  for (const link of UI.sky.creditLinks) {
    const at = line.indexOf(link.text, from);
    if (at === -1) continue;
    if (at > from) parts.push(line.slice(from, at));
    parts.push(
      <a key={link.href} className="ar-link ar-link--inline" href={link.href} rel={link.licence ? 'license' : undefined}>
        {link.text}
      </a>,
    );
    from = at + link.text.length;
  }
  if (from < line.length) parts.push(line.slice(from));
  return parts;
}

/**
 * The end of every page (bundle Footer, bundle.css 20): on glass with a rule on top, the tagline,
 * the email and the footer's social links as standalone links (external ones with the arrow), and
 * a meta row with the date of the latest content commit and the copyright year, both set by the
 * build, then, when the background is the sky, the line that credits its sources, and last the
 * pause-motion control (D-67). Desktop: the tagline over six columns, the links from column 8;
 * phones: stacked. Empty fields leave no element.
 */
export default function Footer({
  name,
  tagline,
  email,
  socials,
  updated,
  year,
  credits,
}: {
  name: string;
  tagline: string;
  email: string;
  /** socialLinksFor(site, 'footer'): no mailto (the email comes from `personal.email`). */
  socials: SocialLink[];
  /** The latest content commit date, or undefined when it cannot be known. */
  updated?: string;
  year: number;
  /** True when settings.background is "sky": the sky's credit line shows. */
  credits: boolean;
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
          {credits ? <p className="ar-foot__credits">{creditParts()}</p> : null}
          <PauseMotion labels={{ pause: UI.sky.pauseMotion, play: UI.sky.playMotion }} />
        </div>
      </div>
    </footer>
  );
}
