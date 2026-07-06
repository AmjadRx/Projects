import Link from 'next/link';
import type { Site } from '@/lib/types';
import AvailabilityBadge from '@/components/AvailabilityBadge';
import HeroVisual from './HeroVisual';

export default function Hero({ site }: { site: Site }) {
  const { personal, settings } = site;
  const [head] = personal.tagline.split(' move themselves.');
  const accented = personal.tagline.includes('move themselves.');

  return (
    <section className="wrap grid grid-cols-1 items-center gap-12 pb-16 pt-28 md:grid-cols-12 md:gap-10 md:pb-24 md:pt-40">
      <div className="md:col-span-7">
        {settings.showAvailabilityBadge && (
          <div className="mb-6">
            <AvailabilityBadge text={personal.availability} />
          </div>
        )}
        <h1 className="display-1">
          {accented ? (
            <>
              {head} <span className="text-accent">move themselves.</span>
            </>
          ) : (
            personal.tagline
          )}
        </h1>
        <p className="body-lg mt-6 max-w-xl">{personal.subTagline}</p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link href="/projects" className="btn-primary">
            See the work <span aria-hidden>→</span>
          </Link>
          <Link href="/projects/raven" className="btn-ghost">
            Meet Raven
          </Link>
        </div>
        <p className="kicker mt-9">
          {personal.degree} · {personal.school} · GPA {personal.gpa} · Class of {personal.graduation}
        </p>
      </div>
      <div className="md:col-span-5">
        <HeroVisual mode={settings.heroMode} media={settings.heroMedia} />
      </div>
    </section>
  );
}
