import type { ExperienceItem } from '@/lib/types';
import Chapter from '@/components/Chapter';

export default function ExperienceSection({ experience }: { experience: ExperienceItem[] }) {
  return (
    <section id="experience" className="wrap section">
      <Chapter
        num="007"
        eyebrow="Experience"
        title={<>Where I&rsquo;ve <span className="editorial italic text-fg-dim">shipped.</span></>}
      />
      <div className="relative">
        {/* Vertical rule */}
        <div
          className="absolute left-2 top-0 bottom-0 hidden w-px md:left-[33.333%] md:block"
          style={{ background: 'rgb(var(--line) / 0.1)' }}
        />
        {experience.map((e, i) => (
          <article
            key={`${e.company}-${i}`}
            className="relative grid grid-cols-1 gap-6 border-t border-line/10 py-10 md:grid-cols-12 md:gap-10 md:py-14 first:border-t-0"
          >
            <div className="md:col-span-4 md:pr-8">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
                {String(i + 1).padStart(2, '0')} · Role
              </div>
              <div className="mt-4 font-mono text-[12px] uppercase tracking-[0.18em] text-fg-dim">
                {e.dates}
              </div>
              <div className="mt-1.5 text-sm text-fg-mute">
                {e.location}
              </div>
            </div>
            <div className="md:col-span-8 md:pl-10 md:border-l md:border-line/10">
              <h3 className="display-md text-fg">{e.role}</h3>
              <div className="mt-2 font-mono text-[12px] uppercase tracking-[0.18em] text-fg-dim">
                {e.company}
              </div>
              <ul className="mt-7 space-y-3.5 text-fg-dim md:text-[17px]">
                {e.bullets.map((b, j) => (
                  <li key={j} className="flex gap-4">
                    <span
                      aria-hidden
                      className="mt-[0.7em] inline-block h-px w-5 flex-shrink-0"
                      style={{ background: 'rgb(var(--accent) / 0.7)' }}
                    />
                    <span className="text-pretty">{b}</span>
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
