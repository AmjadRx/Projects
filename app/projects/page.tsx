import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import { loadContent } from '@/lib/content';
import type { Project } from '@/lib/types';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Projects',
};

const accentClass: Record<Project['color'], string> = {
  cyan: 'text-accent',
  purple: 'text-accent-2',
  amber: 'text-accent-warm',
};

export default async function ProjectsIndex() {
  const content = await loadContent();
  return (
    <>
      <Nav />
      <main>
        <section className="wrap pt-32 pb-16 md:pt-44 md:pb-24">
          <Link
            href="/"
            className="btn-ghost -ml-2"
          >
            ← Home
          </Link>

          <div className="mt-10 max-w-[760px]">
            <div className="eyebrow">
              <span className="eyebrow-num">All projects</span>
              <span className="eyebrow-rule" />
              <span>{content.projects.length} active</span>
            </div>
            <h1 className="display-3xl text-balance mt-7 text-fg">
              Hardware that <span className="editorial italic text-fg-dim">moves.</span>
            </h1>
            <p className="lead-xl mt-7 max-w-[58ch]">
              Flagship eVTOL R&amp;D, FSAE traction packs, motor-drive IC validation, wearables, and applied-entrepreneurship products.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-5 md:mt-20 md:grid-cols-2 md:gap-6">
            {content.projects.map((p, i) => (
              <Link
                key={p.slug}
                href={`/projects/${p.slug}`}
                className="group relative flex flex-col overflow-hidden rounded-[24px] border border-line/8 bg-bg-2 transition-colors duration-300 hover:border-line/20"
              >
                {p.imageUrl ? (
                  <div className="relative aspect-[16/10] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.05]"
                    />
                    <div
                      aria-hidden
                      className="absolute inset-0"
                      style={{
                        background:
                          'linear-gradient(180deg, rgb(var(--bg) / 0) 30%, rgb(var(--bg) / 0.6) 95%, rgb(var(--bg) / 0.95) 100%)',
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className="relative aspect-[16/10] overflow-hidden"
                    style={{
                      background:
                        'linear-gradient(135deg, rgb(var(--card-grad-1)) 0%, rgb(var(--card-grad-2)) 50%, rgb(var(--bg)) 100%)',
                    }}
                  >
                    <div
                      aria-hidden
                      className="absolute inset-0 grid-bg opacity-50"
                      style={{
                        maskImage:
                          'radial-gradient(ellipse 70% 60% at 50% 50%, black, transparent 80%)',
                        WebkitMaskImage:
                          'radial-gradient(ellipse 70% 60% at 50% 50%, black, transparent 80%)',
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center p-8">
                      <span className={`font-display text-5xl font-medium tracking-tight md:text-7xl ${accentClass[p.color]} opacity-20`}>
                        {p.name.split(' ')[0]}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex flex-1 flex-col gap-5 p-8 md:p-10">
                  <div className="flex items-center justify-between">
                    <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${accentClass[p.color]}`}>
                      {String(i + 1).padStart(2, '0')} · {p.type}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
                      {p.status}
                    </span>
                  </div>
                  <h2 className="display-md text-fg">{p.name}</h2>
                  <p className="text-pretty text-fg-dim md:text-lg">{p.subtitle}</p>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      {p.tags.slice(0, 4).map((t) => (
                        <span key={t} className="chip">{t}</span>
                      ))}
                    </div>
                    <span
                      className={`font-mono text-[11px] uppercase tracking-[0.22em] ${accentClass[p.color]} transition-transform group-hover:translate-x-1`}
                    >
                      →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <Footer content={content} />
    </>
  );
}
