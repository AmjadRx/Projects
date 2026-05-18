import type { Contact, Personal } from '@/lib/types';

export default function ContactSection({
  contact,
  personal,
}: {
  contact: Contact;
  personal: Personal;
}) {
  return (
    <section id="contact" className="wrap py-24 md:py-36">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-12">
        <div className="md:col-span-5">
          <div className="section-eyebrow">
            <span className="text-cyan">009</span>
            <span
              className="inline-block h-px w-8"
              style={{ background: 'rgb(255 255 255 / 0.2)' }}
            />
            <span>Contact</span>
          </div>
          <h2 className="display-lg mt-5 text-ink">{contact.heading}</h2>
          <p className="lead mt-6 max-w-md">
            Hiring, collaborating, or curious about Raven? Get in touch.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a href={`mailto:${personal.email}`} className="btn-primary">
              {personal.email}
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

        <div className="md:col-span-7">
          <div
            className="grid grid-cols-1 gap-px md:grid-cols-2"
            style={{ background: 'rgb(255 255 255 / 0.08)' }}
          >
            <DetailCell label="Email" value={personal.email} href={`mailto:${personal.email}`} />
            {personal.phone && (
              <DetailCell label="Phone" value={personal.phone} href={`tel:${personal.phone.replace(/[^\d+]/g, '')}`} />
            )}
            <DetailCell
              label="LinkedIn"
              value="amjadrehawi"
              href={personal.linkedin}
              external
            />
            <DetailCell label="Location" value={personal.location} />
            <DetailCell label="GPA" value={`${personal.gpa} / 4.00`} />
            <DetailCell label="Graduating" value={personal.graduation} />
          </div>
        </div>
      </div>
    </section>
  );
}

function DetailCell({
  label,
  value,
  href,
  external,
}: {
  label: string;
  value: string;
  href?: string;
  external?: boolean;
}) {
  const inner = (
    <>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute">{label}</div>
      <div className="mt-2 break-all text-ink">{value}</div>
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className="group relative bg-navy px-5 py-6 transition-colors hover:bg-navy-2"
      >
        {inner}
        <span className="absolute right-5 top-6 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute transition-colors group-hover:text-cyan">
          →
        </span>
      </a>
    );
  }
  return <div className="bg-navy px-5 py-6">{inner}</div>;
}
