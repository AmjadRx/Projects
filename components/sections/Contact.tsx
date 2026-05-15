import type { Contact, Personal } from '@/lib/types';

export default function ContactSection({
  contact,
  personal,
}: {
  contact: Contact;
  personal: Personal;
}) {
  return (
    <section id="contact" className="wrap py-16 md:py-24">
      <div className="relative overflow-hidden rounded-2xl border border-cyan/20 bg-gradient-to-br from-navy-2 to-navy-3 p-10 text-center md:p-16">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan/5 via-transparent to-purple/8" />
        <div className="relative mx-auto max-w-2xl">
          <span className="kicker">Contact</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-5xl">{contact.heading}</h2>
          <p className="mt-4 text-ink-dim">
            Hiring, collaborating, or curious about Raven? Get in touch.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <a href={`mailto:${personal.email}`} className="btn-primary">
              {contact.primaryCTA || personal.email}
            </a>
            {personal.linkedin && (
              <a
                href={personal.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                {contact.secondaryCTA || 'LinkedIn'}
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
