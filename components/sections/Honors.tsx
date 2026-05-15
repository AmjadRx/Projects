import type { Honor } from '@/lib/types';

export default function HonorsSection({ honors }: { honors: Honor[] }) {
  return (
    <section id="honors" className="wrap py-12 md:py-16">
      <div className="mb-8">
        <span className="kicker-purple">Honors</span>
        <h2 className="section-heading mt-3">Recognition.</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {honors.map((h, i) => (
          <div key={i} className="card flex items-start gap-4 p-5">
            <div className="font-mono text-xs uppercase tracking-widest text-purple">{h.year}</div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-ink">{h.title}</h3>
              <p className="text-sm text-ink-dim">{h.note}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
