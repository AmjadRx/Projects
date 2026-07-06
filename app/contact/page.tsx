import type { Metadata } from 'next';
import { loadContent, lastUpdated } from '@/lib/content';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import Reveal from '@/components/Reveal';
import AvailabilityBadge from '@/components/AvailabilityBadge';
import LinkIcon from '@/components/LinkIcon';
import { detectIcon } from '@/lib/utils';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch about battery, power electronics, embedded, or autonomy roles.',
};

export default function ContactPage() {
  const { site } = loadContent();
  const links = site.socialLinks.filter((s) => s.showInContact);

  return (
    <>
      <Nav name={site.personal.name} items={site.nav} socials={site.socialLinks} />
      <main className="pb-12 pt-28 md:pt-40">
        <section className="wrap">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal>
              {site.settings.showAvailabilityBadge && (
                <div className="mb-6 flex justify-center">
                  <AvailabilityBadge text={site.personal.availability} />
                </div>
              )}
              <p className="kicker">Contact</p>
              <h1 className="display-1 mt-5">{site.contact.heading}</h1>
              <p className="body-lg mt-6">{site.contact.body}</p>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="mt-10 flex justify-center">
                <a href={`mailto:${site.personal.email}`} className="btn-primary">
                  {site.personal.email}
                </a>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.15}>
            <div
              className="mx-auto mt-14 grid max-w-2xl grid-cols-1 gap-px overflow-hidden rounded-md sm:grid-cols-2"
              style={{ border: '1px solid var(--line)', background: 'var(--line)' }}
            >
              {links.map((link) => {
                const external = link.url.startsWith('http');
                return (
                  <a
                    key={link.id}
                    href={link.url}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noopener noreferrer' : undefined}
                    className="group flex items-center gap-3 bg-surface px-5 py-5 transition-colors hover:bg-surface-2"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent" style={{ border: '1px solid var(--line)' }}>
                      <LinkIcon icon={link.icon || detectIcon(link.url)} size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{link.label}</span>
                      <span className="block truncate font-mono text-[11px] text-ink-mute">
                        {link.url.replace(/^(mailto:|tel:|https?:\/\/)/, '')}
                      </span>
                    </span>
                    <span aria-hidden className="ml-auto text-ink-mute transition-transform group-hover:translate-x-0.5 group-hover:text-accent">
                      →
                    </span>
                  </a>
                );
              })}
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <p className="kicker mt-10 text-center">{site.personal.location}</p>
          </Reveal>
        </section>
      </main>
      <Footer site={site} lastUpdated={lastUpdated()} />
    </>
  );
}
