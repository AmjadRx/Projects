import type { About } from '@/lib/types';

export default function AboutSection({ about }: { about: About }) {
  return (
    <section id="about" className="wrap py-12 md:py-16">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
        <div className="md:col-span-4">
          <span className="kicker">About</span>
          <h2 className="section-heading mt-4">{about.heading}</h2>
          <p className="section-sub">
            Hardware engineer translating an EV power-electronics stack into autonomous aerospace.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 md:col-span-8 md:grid-cols-2">
          {about.paragraphs.map((p, i) => (
            <p key={i} className="text-ink-dim leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
