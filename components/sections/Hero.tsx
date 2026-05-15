'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { Personal } from '@/lib/types';

const DroneScene = dynamic(() => import('@/components/DroneScene'), { ssr: false });

export default function Hero({ personal }: { personal: Personal }) {
  const [first, ...rest] = personal.tagline.split(' move themselves.');
  const hasSplit = personal.tagline.includes('move themselves.');

  return (
    <section className="relative overflow-hidden pt-24 md:pt-28">
      <div className="wrap relative grid grid-cols-1 items-center gap-10 pb-12 md:grid-cols-12 md:gap-8 md:pb-20">
        <div className="md:col-span-6 fadein">
          <span className="kicker">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan" />
            Senior · EE + ME · {personal.school}
          </span>
          <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            {hasSplit ? (
              <>
                <span className="block text-ink">{first}</span>
                <span className="block text-cyan">move themselves.</span>
              </>
            ) : (
              <span className="block text-ink">{personal.tagline}</span>
            )}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-dim md:text-lg">
            {personal.subTagline}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/projects/raven" className="btn-primary">
              Meet Raven <span aria-hidden>→</span>
            </Link>
            <Link href="/#projects" className="btn-secondary">
              See all projects
            </Link>
            <a href={`mailto:${personal.email}`} className="btn-secondary">
              Contact
            </a>
          </div>
          <div className="mt-8 flex items-center gap-4 font-mono text-[11px] uppercase tracking-widest text-ink-mute">
            <span>GPA {personal.gpa}</span>
            <span className="h-1 w-1 rounded-full bg-ink-mute" />
            <span>Class of {personal.graduation}</span>
            <span className="h-1 w-1 rounded-full bg-ink-mute" />
            <span>{personal.location}</span>
          </div>
        </div>

        <div className="md:col-span-6">
          <div className="card relative aspect-[4/3] overflow-hidden rounded-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan/5 via-transparent to-purple/5" />
            <DroneScene />
          </div>
        </div>
      </div>
      <div className="hairline" />
      {rest.length > 0 ? null : null}
    </section>
  );
}
