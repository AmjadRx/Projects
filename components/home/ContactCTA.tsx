import Link from 'next/link';
import type { Site } from '@/lib/types';
import AvailabilityBadge from '@/components/AvailabilityBadge';
import Reveal from '@/components/Reveal';

/** Compact closing strip on the home page pointing at the full contact page. */
export default function ContactCTA({ site }: { site: Site }) {
  return (
    <section className="wrap py-20 md:py-28">
      <Reveal>
        <div className="card flex flex-col items-center gap-6 px-6 py-12 text-center md:py-16">
          {site.settings.showAvailabilityBadge && (
            <AvailabilityBadge text={site.personal.availability} />
          )}
          <h2 className="display-2 max-w-xl">{site.contact.heading}</h2>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a href={`mailto:${site.personal.email}`} className="btn-primary">
              {site.personal.email}
            </a>
            <Link href="/contact" className="btn-ghost">
              All ways to reach me <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
