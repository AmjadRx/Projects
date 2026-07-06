import type { Site } from '@/lib/types';
import Reveal from '@/components/Reveal';
import { cn } from '@/lib/utils';

const TIER_LABEL = { deep: 'Deep', strong: 'Strong', familiar: 'Familiar' } as const;

export default function SkillsSection({ skills }: { skills: Site['skills'] }) {
  return (
    <section id="skills" className="wrap py-20 md:py-32">
      <Reveal>
        <p className="kicker">05 / Skills</p>
        <h2 className="display-2 mt-5">What I work with</h2>
      </Reveal>
      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {skills.groups.map((group, i) => (
          <Reveal key={group.title} delay={i * 0.06}>
            <div
              className={cn('card h-full p-5 md:p-6', group.tier === 'deep' && 'border-l-2')}
              style={group.tier === 'deep' ? { borderLeftColor: 'rgb(var(--accent))' } : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold leading-snug text-ink">{group.title}</h3>
                <span
                  className={cn(
                    'shrink-0 font-mono text-[10px] uppercase tracking-[0.16em]',
                    group.tier === 'deep' ? 'text-accent' : 'text-ink-mute',
                  )}
                >
                  {TIER_LABEL[group.tier]}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {group.items.map((item) => (
                  <span key={item} className="chip">{item}</span>
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
