import type { About } from '@/lib/types';
import Chapter from '@/components/Chapter';

export default function AboutSection({ about }: { about: About }) {
  return (
    <section id="about" className="wrap section">
      <Chapter
        num="004"
        eyebrow={about.heading}
        title={<>Hardware engineer translating an EV stack <span className="editorial italic text-fg-dim">into autonomous aerospace.</span></>}
      />

      <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-16">
        <aside className="md:col-span-4">
          <div className="sticky top-28 space-y-6">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">Discipline</div>
              <div className="mt-2 text-fg">EE + ME · Honors</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">Focus</div>
              <div className="mt-2 text-fg">Power · firmware · controls</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">Looking for</div>
              <div className="mt-2 text-fg">Drones · aerospace · autonomy</div>
            </div>
            <div className="hairline mt-4" />
            <p className="editorial mt-4 text-[17px] leading-snug text-fg-dim md:text-lg">
              &ldquo;Motor-inverter debug is ESC debug. The math doesn&rsquo;t care which side of gravity it&rsquo;s on.&rdquo;
            </p>
          </div>
        </aside>

        <div className="md:col-span-8 space-y-10 md:space-y-14">
          {about.paragraphs.map((p, i) => (
            <div key={i} className="relative">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
                {String(i + 1).padStart(2, '0')}
              </div>
              <p className="text-pretty mt-3 text-lg leading-[1.55] text-fg-dim md:text-[1.4rem] md:leading-[1.45]">
                {p}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
