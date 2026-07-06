import type { Site } from '@/lib/types';
import AvailabilityBadge from '@/components/AvailabilityBadge';
import LinkIcon from '@/components/LinkIcon';
import Reveal from '@/components/Reveal';

export default function ContactSection({ site }: { site: Site }) {
  const socials = site.socialLinks.filter((s) => s.showInContact);
  return (
    <section id="contact" className="wrap py-24 md:py-36">
      <Reveal>
        <div className="mx-auto max-w-2xl text-center">
          {site.settings.showAvailabilityBadge && (
            <div className="mb-6 flex justify-center">
              <AvailabilityBadge text={site.personal.availability} />
            </div>
          )}
          <p className="kicker">09 / Contact</p>
          <h2 className="display-2 mt-5">{site.contact.heading}</h2>
          <p className="body-lg mt-5">{site.contact.body}</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a href={`mailto:${site.personal.email}`} className="btn-primary">
              {site.personal.email}
            </a>
            {socials
              .filter((s) => !s.url.startsWith('mailto:'))
              .map((s) => (
                <a
                  key={s.id}
                  href={s.url}
                  target={s.url.startsWith('http') ? '_blank' : undefined}
                  rel={s.url.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="btn-ghost"
                >
                  <LinkIcon icon={s.icon} size={15} />
                  {s.label}
                </a>
              ))}
          </div>
          <p className="kicker mt-9">{site.personal.location}</p>
        </div>
      </Reveal>
    </section>
  );
}
