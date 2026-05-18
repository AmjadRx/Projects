import type { About } from '@/lib/types';
import SectionHeader from '@/components/SectionHeader';

export default function AboutSection({ about }: { about: About }) {
  return (
    <section id="about" className="wrap py-20 md:py-28">
      <SectionHeader
        num="004"
        eyebrow={about.heading}
        title="Hardware engineer translating an EV power-electronics stack into autonomous aerospace."
      />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-10 lg:gap-12">
        {about.paragraphs.map((p, i) => (
          <div key={i} className="relative">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan">
              {String(i + 1).padStart(2, '0')}
            </span>
            <p className="mt-4 text-lg leading-relaxed text-ink-dim md:text-xl">{p}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
