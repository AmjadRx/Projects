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
          <div
            key={g.title}
            className={cn(
              'card group relative overflow-hidden p-6 transition-all duration-300 hover:-translate-y-0.5',
              g.tier === 'deep' ? 'hover:border-cyan/40 hover:shadow-glow' : 'hover:border-purple/40 hover:shadow-glow-purple',
            )}
          >
            <div
              className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              style={{
                background:
                  g.tier === 'deep'
                    ? 'radial-gradient(400px circle at 50% 0%, rgb(61 224 255 / 0.10), transparent 50%)'
                    : 'radial-gradient(400px circle at 50% 0%, rgb(124 92 255 / 0.10), transparent 50%)',
              }}
            />
            <div className="relative flex items-center justify-between">
              <h3 className="text-lg font-semibold tracking-tight text-ink">{g.title}</h3>
              <span
                className={cn(
                  'flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest',
                  g.tier === 'deep' ? 'text-cyan' : 'text-purple',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    g.tier === 'deep' ? 'bg-cyan animate-pulse' : 'bg-purple',
                  )}
                />
                {g.tier === 'deep' ? 'deep' : 'strong'}
              </span>
            </div>
            <div className="relative mt-4 flex flex-wrap gap-1.5">
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
