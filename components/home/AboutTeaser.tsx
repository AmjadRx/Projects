import Link from 'next/link';
import type { Site } from '@/lib/types';
import MediaView, { MediaPlaceholder } from '@/components/MediaView';
import Reveal from '@/components/Reveal';

/** Compact who-I-am block for the home page: photo + first paragraph + facts. */
export default function AboutTeaser({ site }: { site: Site }) {
  const photo = site.personal.photo ?? site.about.headshot;
  return (
    <section id="about" className="wrap py-20 md:py-28">
      <div className="grid grid-cols-1 items-start gap-10 md:grid-cols-12">
        <Reveal className="md:col-span-4">
          <div
            className="relative aspect-[4/5] w-full max-w-[320px] overflow-hidden rounded-lg"
            style={{ border: '1px solid var(--line)' }}
          >
            {photo ? (
              <MediaView media={photo} placeholderLabel={site.personal.name} sizes="320px" />
            ) : (
              <MediaPlaceholder label={site.personal.name} />
            )}
          </div>
        </Reveal>
        <div className="md:col-span-7 md:col-start-6">
          <Reveal>
            <p className="kicker">About</p>
            <h2 className="display-2 mt-4">{site.about.heading}</h2>
            <p className="body-lg mt-6">{site.about.paragraphs[0]}</p>
          </Reveal>
          <Reveal delay={0.1}>
            <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4">
              {site.about.facts.slice(0, 4).map((fact) => (
                <div key={fact.label}>
                  <dt className="kicker">{fact.label}</dt>
                  <dd className="mt-1 text-sm font-medium text-ink">{fact.value}</dd>
                </div>
              ))}
            </dl>
            <Link href="/about" className="btn-ghost mt-8">
              Full story <span aria-hidden>→</span>
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
