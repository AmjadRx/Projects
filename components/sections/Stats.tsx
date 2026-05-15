import type { Stat } from '@/lib/types';

export default function Stats({ stats }: { stats: Stat[] }) {
  return (
    <section className="wrap py-10">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className="card px-4 py-5 transition-colors hover:border-cyan/30"
          >
            <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">
              {s.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
