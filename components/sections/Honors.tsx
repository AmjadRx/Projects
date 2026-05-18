import type { Honor } from '@/lib/types';
import SectionHeader from '@/components/SectionHeader';

export default function HonorsSection({ honors }: { honors: Honor[] }) {
  return (
    <section id="honors" className="wrap py-20 md:py-28">
      <SectionHeader num="008" eyebrow="Recognition" title="Honors, fellowships, certifications." />
      <div
        className="grid gap-px"
        style={{ background: 'rgb(255 255 255 / 0.08)' }}
      >
        {honors.map((h, i) => (
          <div
            key={i}
            className="grid grid-cols-12 items-baseline gap-4 bg-navy px-1 py-6 md:gap-8 md:px-2"
          >
            <div className="col-span-2 font-mono text-[11px] uppercase tracking-[0.22em] text-cyan md:col-span-2">
              {String(i + 1).padStart(2, '0')}
            </div>
            <div className="col-span-10 md:col-span-7">
              <h3 className="text-lg font-medium text-ink md:text-xl">{h.title}</h3>
              <p className="mt-1 text-ink-dim">{h.note}</p>
            </div>
            <div className="col-span-12 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute md:col-span-3 md:text-right">
              {h.year}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
