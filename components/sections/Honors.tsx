import type { Honor } from '@/lib/types';
import Chapter from '@/components/Chapter';

export default function HonorsSection({ honors }: { honors: Honor[] }) {
  return (
    <section id="honors" className="wrap section">
      <Chapter
        num="008"
        eyebrow="Recognition"
        title={<>Honors, fellowships, <span className="editorial italic text-fg-dim">certifications.</span></>}
      />
      <ul className="border-t border-line/10">
        {honors.map((h, i) => (
          <li
            key={i}
            className="grid grid-cols-12 items-baseline gap-4 border-b border-line/10 py-6 transition-colors hover:bg-bg-2/40 md:gap-8 md:py-7"
          >
            <div className="col-span-2 font-mono text-[11px] uppercase tracking-[0.22em] text-accent md:col-span-1">
              {String(i + 1).padStart(2, '0')}
            </div>
            <div className="col-span-10 md:col-span-8">
              <h3 className="text-pretty text-lg font-medium text-fg md:text-xl">{h.title}</h3>
              <p className="mt-1.5 text-[15px] text-fg-mute md:text-base">{h.note}</p>
            </div>
            <div className="col-span-12 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-mute md:col-span-3 md:text-right">
              {h.year}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
