'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { Personal } from '@/lib/types';

const DroneScene = dynamic(() => import('@/components/DroneScene'), { ssr: false });

export default function Hero({ personal }: { personal: Personal }) {
  const [first] = personal.tagline.split(' move themselves.');
  const hasSplit = personal.tagline.includes('move themselves.');

  return (
    <section className="relative overflow-hidden">
      <BackgroundField />
      <div className="wrap relative pt-32 md:pt-40">
        <div className="grid grid-cols-1 items-end gap-12 md:grid-cols-12 md:gap-10">
          <div className="md:col-span-7 fadein">
            <div className="eyebrow">
              <span className="text-cyan">001 / INDEX</span>
              <span
                className="inline-block h-px w-8"
                style={{ background: 'rgb(255 255 255 / 0.2)' }}
              />
              <span>Senior · EE + ME · Santa Clara</span>
            </div>
            <h1 className="display-xl mt-8 text-ink">
              {hasSplit ? (
                <>
                  <span className="block text-ink">{first}</span>
                  <span className="block text-cyan">move themselves.</span>
                </>
              ) : (
                <span className="block text-ink">{personal.tagline}</span>
              )}
            </h1>
            <p className="lead mt-8 max-w-xl text-ink-dim">{personal.subTagline}</p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link href="/projects/raven" className="btn-primary group">
                Meet Raven
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
              <Link href="/#projects" className="btn-secondary">
                All projects
              </Link>
            </div>
          </div>

          <div className="md:col-span-5">
            <div
              className="relative aspect-square overflow-hidden rounded-2xl bg-navy-2"
              style={{ border: '1px solid rgb(255 255 255 / 0.08)' }}
            >
              <DroneScene />
            </div>
          </div>
        </div>

        <BottomStrip personal={personal} />
      </div>
    </section>
  );
}

function BottomStrip({ personal }: { personal: Personal }) {
  return (
    <div
      className="mt-16 grid grid-cols-2 gap-px md:mt-24 md:grid-cols-4"
      style={{ background: 'rgb(255 255 255 / 0.08)' }}
    >
      <Cell label="GPA" value={personal.gpa} />
      <Cell label="Class of" value={personal.graduation} />
      <Cell label="Location" value={personal.location} />
      <Cell label="Status" value="Available · Summer 2026" />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5 bg-navy px-5 py-6">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

function BackgroundField() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10">
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(255 255 255 / 0.06) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgb(255 255 255 / 0.06) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%, black 0%, transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 70% at 50% 0%, black 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute -top-20 left-1/2 h-80 w-[60%] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: 'rgb(61 224 255 / 0.18)' }}
      />
    </div>
  );
}
