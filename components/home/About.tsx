import type { Site } from '@/lib/types';
import MediaView from '@/components/MediaView';
import Reveal from '@/components/Reveal';

export default function About({ about }: { about: Site['about'] }) {
  const showHeadshot = about.headshot && about.headshot.exists !== false;
  return (
    <section id="about" className="wrap py-20 md:py-32">
      <Reveal>
        <p className="kicker">04 / About</p>
        <h2 className="display-2 mt-5 max-w-3xl">{about.heading}</h2>
      </Reveal>
      <div className="mt-12 grid grid-cols-1 gap-12 md:grid-cols-12">
        <div className="flex flex-col gap-6 md:col-span-7">
          {about.paragraphs.map((paragraph, i) => (
            <Reveal key={i} delay={i * 0.08}>
              <p className="body-lg">{paragraph}</p>
            </Reveal>
          ))}
        </div>
        <div className="md:col-span-4 md:col-start-9">
          {showHeadshot && (
            <Reveal>
              <div
                className="relative mb-8 aspect-square w-full max-w-[280px] overflow-hidden rounded-lg"
                style={{ border: '1px solid var(--line)' }}
              >
                <MediaView media={about.headshot!} sizes="280px" />
              </div>
            </Reveal>
          )}
          <Reveal delay={0.1}>
            <dl className="flex flex-col">
              {about.facts.map((fact) => (
                <div
                  key={fact.label}
                  className="flex items-baseline justify-between gap-4 py-3"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <dt className="kicker">{fact.label}</dt>
                  <dd className="text-right text-sm font-medium text-ink">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
