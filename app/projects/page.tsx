import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import { loadContent } from '@/lib/content';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Projects',
};

export default async function ProjectsIndex() {
  const content = await loadContent();
  return (
    <>
      <Nav />
      <main className="pt-32 md:pt-40">
        <section className="wrap">
          <Link
            href="/"
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-mute hover:text-cyan"
          >
            ← Home
          </Link>
          <div className="mt-10 max-w-3xl">
            <div className="section-eyebrow">
              <span className="text-cyan">All projects</span>
              <span
                className="inline-block h-px w-8"
                style={{ background: 'rgb(255 255 255 / 0.2)' }}
              />
              <span>{content.projects.length} active</span>
            </div>
            <h1 className="display-xl mt-6 text-ink">Hardware that moves.</h1>
            <p className="lead mt-6">
              Flagship eVTOL R&D, FSAE traction packs, motor-drive IC validation, wearables, and applied-entrepreneurship products.
            </p>
          </div>

          <div
            className="mt-16 grid grid-cols-1 gap-px md:mt-20 md:grid-cols-2"
            style={{ background: 'rgb(255 255 255 / 0.08)' }}
          >
            {content.projects.map((p, i) => {
              const accent = p.color === 'purple' ? 'text-purple' : 'text-cyan';
              return (
                <Link
                  key={p.slug}
                  href={`/projects/${p.slug}`}
                  className="group flex flex-col gap-6 bg-navy p-8 transition-colors hover:bg-navy-2 md:p-10"
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${accent}`}>
                      {String(i + 1).padStart(2, '0')} / {p.type}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute">
                      {p.status}
                    </span>
                  </div>
                  <h2 className="display-md text-ink">{p.name}</h2>
                  <p className="text-ink-dim md:text-lg">{p.subtitle}</p>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      {p.tags.slice(0, 4).map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </div>
                    <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${accent} transition-transform group-hover:translate-x-1`}>
                      →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </main>
      <Footer content={content} />
    </>
  );
}
