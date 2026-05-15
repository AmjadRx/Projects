import type { BrandThesis } from '@/lib/types';

export default function BrandThesisSection({ thesis }: { thesis: BrandThesis }) {
  return (
    <section className="wrap py-12 md:py-16">
      <div className="relative overflow-hidden rounded-2xl border border-cyan/20 bg-gradient-to-br from-navy-2 via-navy-3 to-navy-2 p-8 md:p-12">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-cyan/8 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-purple/10 blur-3xl" />
        <div className="relative">
          <span className="kicker">Brand thesis</span>
          <h2 className="mt-5 text-2xl font-semibold leading-tight tracking-tight text-ink md:text-3xl">
            {thesis.headline}
          </h2>
          <p className="mt-5 max-w-3xl text-base leading-relaxed text-ink-dim md:text-lg">
            {thesis.body}
          </p>
        </div>
      </div>
    </section>
  );
}
