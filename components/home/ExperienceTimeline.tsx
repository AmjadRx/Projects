import type { Site } from '@/lib/types';
import Reveal from '@/components/Reveal';

export default function ExperienceTimeline({ experience }: { experience: Site['experience'] }) {
  return (
    <section id="experience" className="wrap py-20 md:py-32">
      <Reveal>
        <p className="kicker">06 / Experience</p>
        <h2 className="display-2 mt-5">Where I have worked</h2>
      </Reveal>
      <ol className="relative mt-12 flex flex-col gap-8 border-l pl-6 md:gap-10 md:pl-10" style={{ borderColor: 'var(--line)' }}>
        {experience.map((role, i) => (
          <li key={`${role.company}-${i}`} className="relative">
            <span
              className="absolute -left-[31px] top-2 h-2.5 w-2.5 rounded-full bg-accent md:-left-[47px]"
              style={{ boxShadow: '0 0 0 4px rgb(var(--accent) / 0.15)' }}
              aria-hidden
            />
            <Reveal>
              <article className="card p-5 md:p-7">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold text-ink md:text-xl">{role.role}</h3>
                  <span className="kicker">{role.dates}</span>
                </div>
                <p className="mt-1 text-sm text-ink-dim">
                  {role.company} · {role.location}
                </p>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {role.bullets.map((bullet, j) => (
                    <li key={j} className="flex gap-3 text-[15px] leading-relaxed text-ink-dim">
                      <span className="mt-[11px] h-px w-4 shrink-0 bg-accent/60" aria-hidden />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}
