import type { Skills } from '@/lib/types';
import SectionHeader from '@/components/SectionHeader';
import { cn } from '@/lib/utils';

export default function SkillsSection({ skills }: { skills: Skills }) {
  return (
    <section id="skills" className="wrap py-20 md:py-28">
      <SectionHeader
        num="006"
        eyebrow="Capabilities"
        title="Power, hardware, firmware, controls — end to end."
        lead="Tier 1 are deep, demonstrated, and rare for a junior. Tier 2 are strong and in active growth."
      />
      <div
        className="grid grid-cols-1 gap-px md:grid-cols-2 lg:grid-cols-4"
        style={{ background: 'rgb(255 255 255 / 0.08)' }}
      >
        {skills.groups.map((g, i) => (
          <div key={g.title} className="flex flex-col gap-5 bg-navy p-6 md:p-8">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-mute">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={cn(
                  'font-mono text-[10px] uppercase tracking-[0.22em]',
                  g.tier === 'deep' ? 'text-cyan' : 'text-ink-dim',
                )}
              >
                {g.tier === 'deep' ? 'Tier 1' : 'Tier 2'}
              </span>
            </div>
            <h3 className="text-xl font-medium tracking-tight text-ink">{g.title}</h3>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((it) => (
                <span
                  key={it}
                  className={cn('chip', g.tier === 'deep' && 'chip-cyan')}
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
