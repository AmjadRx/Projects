import type { BrandThesis } from '@/lib/types';

export default function BrandThesisSection({ thesis }: { thesis: BrandThesis }) {
  return (
    <section className="wrap py-20 md:py-32">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
        <div className="md:col-span-4">
          <div className="section-eyebrow">
            <span className="text-cyan">003</span>
            <span
              className="inline-block h-px w-8"
              style={{ background: 'rgb(255 255 255 / 0.2)' }}
            />
            <span>Thesis</span>
          </div>
          <div className="mt-4 font-mono text-[12px] uppercase tracking-[0.18em] text-cyan">
            EV → Drone
          </div>
        </div>
        <div className="md:col-span-8">
          <h2 className="display-lg text-ink">
            {thesis.headline}
          </h2>
          <p className="lead mt-8">{thesis.body}</p>
        </div>
      </div>
    </section>
  );
}
