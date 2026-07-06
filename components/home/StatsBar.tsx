import type { Stat } from '@/lib/types';
import CountUp from '@/components/CountUp';
import Reveal from '@/components/Reveal';

export default function StatsBar({ stats }: { stats: Stat[] }) {
  return (
    <section className="wrap py-16 md:py-24">
      <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat, i) => (
          <Reveal key={stat.label} delay={i * 0.06}>
            <div>
              <div className="text-4xl font-semibold tracking-tight text-ink md:text-5xl">
                <CountUp value={stat.value} />
                {stat.suffix && <span className="text-accent">{stat.suffix}</span>}
              </div>
              <div className="kicker mt-2.5 max-w-[16ch] normal-case tracking-normal text-ink-mute" style={{ fontSize: '12px' }}>
                {stat.label}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
