import type { Skills } from '@/lib/types';
import Chapter from '@/components/Chapter';
import { cn } from '@/lib/utils';

export default function SkillsSection({ skills }: { skills: Skills }) {
  const deep = skills.groups.filter((g) => g.tier === 'deep');
  const strong = skills.groups.filter((g) => g.tier === 'strong');

  return (
    <section id="skills" className="wrap section">
      <Chapter
        num="006"
        eyebrow="Capabilities"
        title={<>Power, hardware, firmware, controls — <span className="editorial italic text-fg-dim">end to end.</span></>}
        lead="Tier 1 are deep, demonstrated, rare for a junior. Tier 2 are strong and in active growth."
      />

      {[
        { title: 'Tier 1 — Deep', groups: deep, deep: true },
        { title: 'Tier 2 — Strong', groups: strong, deep: false },
      ].map((band) => (
        <div key={band.title} className="mt-14 first:mt-0 md:mt-20">
          <div className="mb-8 flex items-baseline justify-between border-b border-line/10 pb-4">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-fg-mute">
              {band.title}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-soft">
              {band.groups.length} groups
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {band.groups.map((g, i) => (
              <div
                key={g.title}
                className={cn(
                  'surface-flat flex flex-col gap-4 p-5 md:p-6',
                  band.deep && 'relative overflow-hidden',
                )}
              >
                {band.deep && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-px"
                    style={{ background: 'linear-gradient(90deg, transparent, rgb(var(--accent) / 0.5), transparent)' }}
                  />
                )}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-fg-mute">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className={cn(
                    'font-mono text-[10px] uppercase tracking-[0.22em]',
                    band.deep ? 'text-accent' : 'text-fg-mute',
                  )}>
                    {band.deep ? 'Tier 1' : 'Tier 2'}
                  </span>
                </div>
                <h3 className="text-lg font-medium tracking-tight text-fg md:text-xl">{g.title}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((it) => (
                    <span
                      key={it}
                      className={cn('chip', band.deep && 'chip-accent')}
                    >
                      {it}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
