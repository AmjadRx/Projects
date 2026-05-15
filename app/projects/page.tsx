import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import { loadContent } from '@/lib/content';
import { cn } from '@/lib/utils';

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
      <main className="pt-28">
        <section className="wrap">
          <div className="mb-10">
            <Link href="/" className="font-mono text-xs uppercase tracking-widest text-ink-mute hover:text-cyan">
              ← back home
            </Link>
            <span className="kicker mt-5">All projects</span>
            <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
              Hardware that moves.
            </h1>
            <p className="section-sub max-w-2xl">
              Flagship eVTOL R&D, FSAE traction packs, motor-drive IC validation, and wearables that won.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {content.projects.map((p) => {
              const colorRing =
                p.color === 'purple'
                  ? 'hover:border-purple/40 hover:shadow-glow-purple'
                  : 'hover:border-cyan/40 hover:shadow-glow';
              const accent = p.color === 'purple' ? 'text-purple' : 'text-cyan';
              return (
                <Link
                  key={p.slug}
                  href={`/projects/${p.slug}`}
                  className={cn('card group block p-6 transition-all duration-300', colorRing)}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('font-mono text-[10px] uppercase tracking-widest', accent)}>
                      {p.type}
                    </span>
                    <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-ink-mute">
                      {p.status}
                    </span>
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">{p.name}</h2>
                  <p className="mt-2 text-ink-dim">{p.subtitle}</p>
                  <div className="mt-5 flex flex-wrap gap-1.5">
                    {p.tags.map((t) => (
                      <span key={t} className="chip">{t}</span>
                    ))}
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
