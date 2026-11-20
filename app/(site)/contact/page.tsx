import type { Metadata } from 'next';
import { ArrowUpRight, Calendar, Github, Globe, Linkedin, Mail, Phone, type LucideIcon } from 'lucide-react';
import CopyAddress from '@/components/contact/CopyAddress';
import Button from '@/components/sheet/Button';
import Glass from '@/components/sheet/Glass';
import Icon from '@/components/sheet/Icon';
import { hasText, isExternalUrl } from '@/lib/format';
import { pageMetadata } from '@/lib/meta';
import { navLabel, siteData, socialLinksFor } from '@/lib/site';
import { UI } from '@/lib/strings';
import type { SocialLink } from '@/lib/types';
import { cn, detectIcon } from '@/lib/utils';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { title: navLabel(site, '/contact', 'Contact'), description: site.seo.description, path: '/contact' });
}

/** Lucide outline glyphs for the contact links: the bundle allows the linkedin and github marks. */
const CONTACT_ICONS: Record<string, LucideIcon> = {
  linkedin: Linkedin,
  github: Github,
  mail: Mail,
  calendar: Calendar,
  phone: Phone,
};

function contactIcon(link: SocialLink): LucideIcon {
  return CONTACT_ICONS[link.icon] ?? CONTACT_ICONS[detectIcon(link.url)] ?? Globe;
}

/**
 * Heading, body, the email button with a copy action, the contact links (LinkedIn, GitHub,
 * "Book a call", the phone number), the "Request my resume" button, and the location, in that
 * order (ARCHITECTURE.md 5). No form, and no resume file: the request button opens an email
 * (ARCHITECTURE.md 4).
 *
 * The Contact board's layout: from 1024 px the email panel holds the resume request too, and the
 * links and the location sit in the right column. The reading order stays the order above, row by
 * row; below 1024 px the parts stack in that order.
 */
export default function ContactPage() {
  const { site } = siteData();
  const { contact, personal } = site;
  const email = personal.email.trim();
  const links = socialLinksFor(site, 'contact');
  const resume = contact.resumeRequest;
  const resumeHref =
    resume?.enabled && hasText(email) && hasText(resume.label)
      ? `mailto:${email}?subject=${encodeURIComponent(resume.subject)}&body=${encodeURIComponent(resume.body)}`
      : null;
  const hasMain = hasText(contact.body) || hasText(email);

  return (
    <div className="hm-wrap st-page">
      <header className="st-head">
        <h1 className="st-title">{hasText(contact.heading) ? contact.heading : navLabel(site, '/contact', 'Contact')}</h1>
      </header>

      <div className={cn('st-contact__grid', hasMain && resumeHref && 'st-contact__grid--joined')}>
        {hasMain ? (
          <div className="st-contact__main">
            {hasText(contact.body) ? <p className="hm-copy">{contact.body}</p> : null}
            {hasText(email) ? (
              <>
                <p className="st-contact__addr">{email}</p>
                <div className="st-contact__actions">
                  <Button variant="primary" href={`mailto:${email}`} icon={Mail}>
                    {UI.contact.emailMe}
                  </Button>
                  <CopyAddress
                    address={email}
                    labels={{ copy: UI.contact.copyEmail, copied: UI.contact.copiedShort, failed: UI.contact.copyFailed }}
                  />
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {links.length > 0 ? (
          <Glass as="ul" pad={false} className="st-links" aria-label={UI.contact.otherWays}>
            {links.map((link) => (
              <li key={link.id}>
                <a href={link.url} rel={isExternalUrl(link.url) ? 'noopener noreferrer' : undefined}>
                  <Icon icon={contactIcon(link)} size={20} />
                  <span className="st-links__label">{link.label}</span>
                  <span className="st-links__go" aria-hidden="true">
                    <Icon icon={ArrowUpRight} size={18} />
                  </span>
                </a>
              </li>
            ))}
          </Glass>
        ) : null}

        {resumeHref && resume ? (
          <div className="st-contact__resume">
            <Button variant="secondary" href={resumeHref}>
              {resume.label}
            </Button>
          </div>
        ) : null}

        {hasText(personal.location) ? (
          <dl className="st-loc">
            <dt>{UI.contact.location}</dt> <dd>{personal.location}</dd>
          </dl>
        ) : null}
      </div>
    </div>
  );
}
