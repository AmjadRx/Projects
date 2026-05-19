import type { Stat } from '@/lib/types';
import AnimatedNumber from '@/components/AnimatedNumber';

export default function Stats({ stats }: { stats: Stat[] }) {
  return (
    <section className="wrap section-tight">
      <div className="mb-10 flex items-baseline justify-between md:mb-14">
        <span className="eyebrow">
          <span className="eyebrow-num">002</span>
          <span className="eyebrow-rule" />
          <span>By the numbers</span>
        </span>
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-fg-soft md:inline">
          As of May 2026
        </span>
      </div>

      <div className="hairline" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="flex flex-col gap-2 px-1 py-8 md:px-2 md:py-12"
            style={{
              borderRight:
                (i + 1) % 2 !== 0 && i < stats.length - 1
                  ? '1px solid rgb(var(--line) / 0.08)'
                  : undefined,
              borderBottom:
                i < stats.length - 2 ? '1px solid rgb(var(--line) / 0.08)' : undefined,
            }}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
              {s.label}
            </span>
            <div className="display-md tracking-tight text-fg">
              <AnimatedNumber value={s.value} />
            </div>
          </div>
        ))}
      </div>

      <div className="hairline" />
    </section>
  );
}
