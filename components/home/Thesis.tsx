import type { Site } from '@/lib/types';
import Reveal from '@/components/Reveal';

export default function Thesis({ thesis }: { thesis: Site['thesis'] }) {
  return (
    <section className="wrap py-20 md:py-32">
      <Reveal>
        <p className="kicker">02 / {thesis.kicker}</p>
        <h2 className="display-2 mt-5 max-w-3xl">{thesis.headline}</h2>
        <p className="body-lg mt-6 max-w-2xl">{thesis.body}</p>
      </Reveal>
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {thesis.pillars.map((pillar, i) => (
          <Reveal key={pillar.k} delay={i * 0.08}>
            <div className="card h-full p-5">
              <span className="font-mono text-[11px] text-accent">{pillar.k}</span>
              <h3 className="mt-2 text-base font-semibold text-ink">{pillar.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">{pillar.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
