import type { Stat } from '@/lib/types';
import AnimatedNumber from '@/components/AnimatedNumber';

export default function Stats({ stats }: { stats: Stat[] }) {
  return (
    <section className="wrap py-10">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="card group relative overflow-hidden px-4 py-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan/30 hover:shadow-glow"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className="pointer-events-none absolute -top-px left-3 right-3 h-px bg-gradient-to-r from-transparent via-cyan/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">
              {s.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              <AnimatedNumber value={s.value} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
