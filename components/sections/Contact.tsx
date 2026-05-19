import type { Contact, Personal } from '@/lib/types';

export default function ContactSection({
  contact,
  personal,
}: {
  contact: Contact;
  personal: Personal;
}) {
  return (
    <section id="contact" className="relative section">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 50%, rgb(var(--accent) / 0.1), transparent 70%)',
        }}
      />
      <div className="wrap">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-14">
            <div className="md:col-span-7">
              <span className="eyebrow">
                <span className="eyebrow-num">009</span>
                <span className="eyebrow-rule" />
                <span>Contact</span>
              </span>
              <h2 className="display-2xl text-balance mt-6 text-fg">
                {contact.heading.split(' ').slice(0, -1).join(' ')}{' '}
                <span className="editorial italic text-fg-dim">
                  {contact.heading.split(' ').slice(-1)}
                </span>
              </h2>
              <p className="lead mt-7 max-w-[44ch]">
                Hiring, collaborating, or curious about Raven? Get in touch.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <a href={`mailto:${personal.email}`} className="btn-primary">
                  {personal.email}
                  <span aria-hidden>→</span>
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

            <div className="md:col-span-5">
              <div className="surface overflow-hidden">
                <DetailRow label="Email" value={personal.email} href={`mailto:${personal.email}`} />
                {personal.phone && (
                  <DetailRow label="Phone" value={personal.phone} href={`tel:${personal.phone.replace(/[^\d+]/g, '')}`} />
                )}
                <DetailRow
                  label="LinkedIn"
                  value="amjadrehawi"
                  href={personal.linkedin}
                  external
                />
                <DetailRow label="Location" value={personal.location} />
                <DetailRow label="GPA" value={`${personal.gpa} / 4.00`} />
                <DetailRow label="Graduating" value={personal.graduation} last />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DetailRow({
  label,
  value,
  href,
  external,
  last,
}: {
  label: string;
  value: string;
  href?: string;
  external?: boolean;
  last?: boolean;
}) {
  const inner = (
    <>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">{label}</span>
      <span className="break-all text-right text-fg">{value}</span>
      {href && (
        <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.22em] text-fg-soft transition-colors group-hover:text-accent">
          →
        </span>
      )}
    </>
  );
  const className = `group flex items-baseline justify-between gap-4 px-6 py-4 ${
    !last ? 'border-b border-line/10' : ''
  } transition-colors hover:bg-bg-2/30`;
  if (href) {
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className={className}
      >
        {inner}
      </a>
    );
  }
  return <div className={className}>{inner}</div>;
}
