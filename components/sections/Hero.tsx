import Link from 'next/link';
import type { Personal } from '@/lib/types';

export default function Hero({ personal }: { personal: Personal }) {
  const [first] = personal.tagline.split(' move themselves.');
  const hasSplit = personal.tagline.includes('move themselves.');

  return (
    <section className="relative isolate overflow-hidden">
      <Atmosphere imageUrl={personal.heroImageUrl} />

      <div className="wrap relative pt-32 pb-12 md:pt-44 md:pb-20">
        <div className="grid grid-cols-1 items-end gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-7 animate-rise">
            <div className="eyebrow">
              <span className="eyebrow-num">001 — INDEX</span>
              <span className="eyebrow-rule" />
              <span>Senior · EE + ME · Santa Clara</span>
            </div>

            <h1 className="display-3xl text-balance mt-7 text-fg">
              {hasSplit ? (
                <>
                  <span className="block">{first}</span>
                  <span className="block">
                    <span className="editorial italic text-fg-dim">move themselves.</span>
                  </span>
                </>
              ) : (
                <span className="block">{personal.tagline}</span>
              )}
            </h1>

            <p className="lead-xl text-pretty mt-8 max-w-[58ch]">
              {personal.subTagline}
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link href="/projects/raven" className="btn-primary">
                Meet Raven
                <span aria-hidden>→</span>
              </Link>
              <Link href="/#projects" className="btn-secondary">
                All projects
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5 animate-rise" style={{ animationDelay: '180ms' }}>
            <HeroCard imageUrl={personal.heroImageUrl} />
          </div>
        </div>

        <BottomStrip personal={personal} />
      </div>
    </section>
  );
}

function HeroCard({ imageUrl }: { imageUrl?: string }) {
  return (
    <figure className="relative overflow-hidden rounded-[28px] border border-line/10 bg-bg-2 aspect-[5/6] md:aspect-[4/5]">
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="Raven eVTOL — autonomous tilt-rotor prototype"
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ filter: 'saturate(1.05) contrast(1.04)' }}
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgb(var(--bg) / 0) 30%, rgb(var(--bg) / 0.4) 75%, rgb(var(--bg) / 0.92) 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 30% 0%, rgb(var(--accent) / 0.16), transparent 60%)',
        }}
      />

      {/* corner brackets */}
      <CornerBracket pos="tl" />
      <CornerBracket pos="tr" />
      <CornerBracket pos="bl" />
      <CornerBracket pos="br" />

      <div className="pointer-events-none absolute inset-0 flex items-start justify-between p-5">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
          RAVEN · v0.1
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-fg-dim">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'rgb(var(--accent))' }} />
          LIVE TELEM
        </span>
      </div>

      <figcaption className="absolute inset-x-0 bottom-0 p-5 md:p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
          Tilt-rotor · 3 motors · Stage 01 / 08
        </div>
        <div className="mt-2 text-base font-medium text-fg md:text-lg">
          Fixed-wing in cruise. Three-motor VTOL in hover.
        </div>
      </figcaption>
    </figure>
  );
}

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const map: Record<typeof pos, string> = {
    tl: 'top-3 left-3 border-l-2 border-t-2 rounded-tl-[12px]',
    tr: 'top-3 right-3 border-r-2 border-t-2 rounded-tr-[12px]',
    bl: 'bottom-3 left-3 border-l-2 border-b-2 rounded-bl-[12px]',
    br: 'bottom-3 right-3 border-r-2 border-b-2 rounded-br-[12px]',
  };
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute h-3.5 w-3.5 ${map[pos]}`}
      style={{ borderColor: 'rgb(var(--accent) / 0.55)' }}
    />
  );
}

function BottomStrip({ personal }: { personal: Personal }) {
  const cells = [
    { label: 'GPA', value: personal.gpa },
    { label: 'Class of', value: personal.graduation },
    { label: 'Location', value: personal.location },
    { label: 'Status', value: 'Available · Summer 2026' },
  ];
  return (
    <div className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-2xl md:mt-24 md:grid-cols-4" style={{ background: 'rgb(var(--line) / 0.1)' }}>
      {cells.map((c) => (
        <div key={c.label} className="bg-bg px-5 py-5 md:px-7 md:py-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
            {c.label}
          </span>
          <div className="mt-2.5 text-fg font-medium md:text-[17px]">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function Atmosphere({ imageUrl }: { imageUrl?: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      {/* Image plate, very faded, masked to fade out */}
      {imageUrl && (
        <div className="absolute inset-x-0 top-0 h-[80vh] mask-fade-b opacity-[0.35]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
          />
        </div>
      )}
      {/* Soft tint over the image */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgb(var(--bg) / 0.4) 0%, rgb(var(--bg) / 0.75) 50%, rgb(var(--bg)) 100%)',
        }}
      />
      {/* Engineering grid */}
      <div
        className="absolute inset-0 grid-bg opacity-50"
        style={{
          maskImage:
            'radial-gradient(ellipse 90% 70% at 50% 0%, black 0%, transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 90% 70% at 50% 0%, black 0%, transparent 70%)',
        }}
      />
      {/* Cyan radial glow */}
      <div
        className="absolute -top-24 left-1/2 h-[420px] w-[80%] -translate-x-1/2 rounded-full blur-3xl opacity-50"
        style={{ background: 'rgb(var(--accent) / 0.22)' }}
      />
    </div>
  );
}
