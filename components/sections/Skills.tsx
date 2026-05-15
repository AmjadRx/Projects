import type { Skills } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function SkillsSection({ skills }: { skills: Skills }) {
  return (
    <section id="skills" className="wrap py-12 md:py-16">
      <div className="mb-8">
        <span className="kicker">Skills</span>
        <h2 className="section-heading mt-3">The stack, end to end.</h2>
        <p className="section-sub">Power, hardware, firmware, controls — built and shipped.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {skills.groups.map((g) => (
          <div key={g.title} className="card p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold tracking-tight text-ink">{g.title}</h3>
              <span
                className={cn(
                  'font-mono text-[10px] uppercase tracking-widest',
                  g.tier === 'deep' ? 'text-cyan' : 'text-purple',
                )}
              >
                {g.tier === 'deep' ? '● deep' : '◆ strong'}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {g.items.map((it) => (
                <span
                  key={it}
                  className={cn('chip', g.tier === 'deep' ? 'chip-cyan' : 'chip-purple')}
                >
                  {it}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
