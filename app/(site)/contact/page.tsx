import type { Metadata } from 'next';
import { FileText, Mail, MapPin } from 'lucide-react';
import LinkIcon from '@/components/LinkIcon';
import CopyAddress from '@/components/contact/CopyAddress';
import { hasText } from '@/lib/format';
import { pageMetadata } from '@/lib/meta';
import { navLabel, siteData, socialLinksFor } from '@/lib/site';
import { UI } from '@/lib/strings';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { title: navLabel(site, '/contact', 'Contact'), description: site.seo.description, path: '/contact' });
}

/**
 * Heading, body, the email button with a copy action, the contact links (LinkedIn, GitHub,
 * "Book a call", the phone number), the "Request my resume" button, and the location. No form,
 * and no resume file: the request button opens an email (ARCHITECTURE.md 4, 5).
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

  return (
    <div className="wrap py-12 md:py-16">
      <h1 className="display-2 max-w-3xl">{hasText(contact.heading) ? contact.heading : navLabel(site, '/contact', 'Contact')}</h1>
      {hasText(contact.body) && <p className="body-lg mt-5 max-w-2xl">{contact.body}</p>}

      {hasText(email) && (
        <div className="mt-10 flex flex-col gap-4">
          <p className="data break-all text-lg text-ink md:text-xl">{email}</p>
          <div className="flex flex-wrap items-center gap-3">
            <a href={`mailto:${email}`} className="btn-primary">
              <Mail size={16} aria-hidden />
              {UI.contact.emailMe}
            </a>
            <CopyAddress address={email} />
          </div>
        </div>
      )}

      {links.length > 0 && (
        <section className="mt-12" aria-labelledby="elsewhere-title">
          <h2 id="elsewhere-title" className="text-xl font-semibold">
            {UI.contact.elsewhere}
          </h2>
          <ul className="mt-4 flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.id}>
                <a
                  href={link.url}
                  rel={link.url.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="text-link inline-flex min-h-[44px] items-center gap-3 text-lg"
                >
                  <LinkIcon icon={link.icon} size={18} />
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {resumeHref && resume && (
        <div className="mt-10">
          <a href={resumeHref} className="btn-ghost">
            <FileText size={16} aria-hidden />
            {resume.label}
          </a>
        </div>
      )}

      {hasText(personal.location) && (
        <p className="mt-10 inline-flex items-center gap-2 text-ink-dim">
          <MapPin size={16} aria-hidden />
          <span className="sr-only">{UI.contact.location}: </span>
          {personal.location}
        </p>
      )}
    </div>
  );
}
