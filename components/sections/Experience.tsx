import type { ExperienceItem } from '@/lib/types';
import SectionHeader from '@/components/SectionHeader';

export default function ExperienceSection({ experience }: { experience: ExperienceItem[] }) {
  return (
    <section id="experience" className="wrap py-20 md:py-28">
      <SectionHeader num="007" eyebrow="Experience" title="Where I've shipped." />
      <div
        className="grid gap-px"
        style={{ background: 'rgb(255 255 255 / 0.08)' }}
      >
        {experience.map((e, i) => (
          <article
            key={`${e.company}-${i}`}
            className="grid grid-cols-1 gap-6 bg-navy px-1 py-10 md:grid-cols-12 md:gap-8 md:px-2 md:py-12"
          >
            <div className="md:col-span-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan">
                {String(i + 1).padStart(2, '0')} / Role
              </div>
              <div className="mt-3 font-mono text-[12px] uppercase tracking-[0.18em] text-ink-dim">
                {e.dates}
              </div>
              <div className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute">
                {e.location}
              </div>
            </div>
            <div className="md:col-span-9">
              <h3 className="display-md text-ink">{e.role}</h3>
              <div className="mt-2 font-mono text-[12px] uppercase tracking-[0.18em] text-ink-dim">
                {e.company}
              </div>
              <ul className="mt-6 space-y-3 text-ink-dim">
                {e.bullets.map((b, j) => (
                  <li key={j} className="flex gap-4 md:text-lg">
                    <span
                      className="mt-3 inline-block h-px w-5 flex-shrink-0"
                      style={{ background: 'rgb(61 224 255 / 0.7)' }}
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
