import type { ExperienceItem } from '@/lib/types';

export default function ExperienceSection({ experience }: { experience: ExperienceItem[] }) {
  return (
    <section id="experience" className="wrap py-12 md:py-16">
      <div className="mb-8">
        <span className="kicker">Experience</span>
        <h2 className="section-heading mt-3">Where I've shipped.</h2>
      </div>
      <ol className="relative ml-2 border-l border-white/8" style={{ borderLeftColor: 'rgb(255 255 255 / 0.08)' }}>
        {experience.map((e, i) => (
          <li key={`${e.company}-${i}`} className="relative pb-8 pl-6 last:pb-0">
            <span className="absolute -left-[7px] top-2 h-3.5 w-3.5 rounded-full border border-cyan/60 bg-navy">
              <span className="absolute inset-0.5 animate-pulse rounded-full bg-cyan/80" />
              <span className="absolute inset-[-6px] rounded-full border border-cyan/20" />
            </span>
            <div className="card group p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan/30 hover:shadow-glow">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold text-ink">{e.role}</h3>
                <span className="font-mono text-[11px] uppercase tracking-widest text-cyan">{e.dates}</span>
              </div>
              <div className="font-mono text-xs uppercase tracking-widest text-ink-mute">
                {e.company} · {e.location}
              </div>
              <ul className="mt-4 space-y-2">
                {e.bullets.map((b, j) => (
                  <li key={j} className="flex gap-3 text-ink-dim">
                    <span className="mt-2 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-cyan transition-all group-hover:w-2 group-hover:bg-cyan" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
