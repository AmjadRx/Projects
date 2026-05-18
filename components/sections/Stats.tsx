import type { Stat } from '@/lib/types';
import AnimatedNumber from '@/components/AnimatedNumber';

export default function Stats({ stats }: { stats: Stat[] }) {
  return (
    <section className="wrap py-20 md:py-28">
      <div className="mb-10 flex items-center gap-3">
        <span className="section-num">002 / METRICS</span>
        <span className="hairline-x flex-1" />
      </div>
      <div
        className="grid grid-cols-2 gap-px md:grid-cols-3 lg:grid-cols-6"
        style={{ background: 'rgb(255 255 255 / 0.08)' }}
      >
        {stats.map((s) => (
          <div key={s.label} className="bg-navy px-5 py-8 md:px-6 md:py-10">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute">
              {s.label}
            </div>
            <div className="mt-4 text-4xl font-medium tracking-tight text-ink md:text-5xl">
              <AnimatedNumber value={s.value} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
