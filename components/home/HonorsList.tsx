import type { Site } from '@/lib/types';
import Reveal from '@/components/Reveal';

export default function HonorsList({ honors, education }: { honors: Site['honors']; education: Site['education'] }) {
  return (
    <section id="honors" className="wrap py-20 md:py-32">
      <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
        <div>
          <Reveal>
            <p className="kicker">07 / Honors</p>
            <h2 className="display-3 mt-5">Recognition</h2>
          </Reveal>
          <ul className="mt-8 flex flex-col">
            {honors.map((honor, i) => (
              <Reveal key={i} delay={i * 0.05}>
                <li className="flex items-baseline justify-between gap-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <h3 className="text-[15px] font-medium text-ink">{honor.title}</h3>
                    <p className="mt-1 text-sm text-ink-dim">{honor.note}</p>
                  </div>
                  <span className="kicker shrink-0">{honor.year}</span>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
        <div>
          <Reveal>
            <p className="kicker">08 / Education</p>
            <h2 className="display-3 mt-5">Where I studied</h2>
          </Reveal>
          <ul className="mt-8 flex flex-col gap-4">
            {education.map((school, i) => (
              <Reveal key={i} delay={i * 0.08}>
                <li className="card p-5 md:p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold text-ink">{school.school}</h3>
                    <span className="kicker">{school.dates}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink-dim">{school.degree}</p>
                  <p className="mt-1 text-sm text-ink-mute">{school.details}</p>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
