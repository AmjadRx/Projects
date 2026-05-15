import Link from 'next/link';
import { notFound } from 'next/navigation';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import Roadmap from '@/components/Roadmap';
import { loadContent } from '@/lib/content';
import { findProjectBySlug } from '@/lib/utils';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const content = await loadContent();
  const project = findProjectBySlug(content.projects, params.slug);
  if (!project) return { title: 'Project not found' };
  return {
    title: project.name,
    description: project.subtitle,
  };
}

export default async function ProjectDetail({ params }: { params: { slug: string } }) {
  const content = await loadContent();
  const project = findProjectBySlug(content.projects, params.slug);
  if (!project) notFound();

  const accent = project.color === 'purple' ? 'text-purple' : 'text-cyan';

  return (
    <>
      <Nav />
      <main className="pt-28">
        <article className="wrap">
          <Link
            href="/projects"
            className="font-mono text-xs uppercase tracking-widest text-ink-mute hover:text-cyan"
          >
            ← back to projects
          </Link>

          <header className="mt-6">
            <span className={`font-mono text-[10px] uppercase tracking-widest ${accent}`}>
              {project.type}
            </span>
            <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-6xl">{project.name}</h1>
            <p className="mt-4 max-w-3xl text-lg text-ink-dim">{project.subtitle}</p>
            <div className="mt-6 flex flex-wrap gap-1.5">
              <span className="chip chip-cyan">{project.status}</span>
              <span className="chip">{project.dates}</span>
              {project.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          </header>

          {project.hero && (
            <section className="mt-12">
              <div className="card p-6 md:p-8">
                <p className="text-xl font-medium leading-snug tracking-tight text-ink md:text-2xl">
                  {project.hero.pitch}
                </p>
                {project.hero.highlights?.length > 0 && (
                  <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {project.hero.highlights.map((h, i) => (
                      <li key={i} className="flex gap-3 text-ink-dim">
                        <span className={`mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${project.color === 'purple' ? 'bg-purple' : 'bg-cyan'}`} />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          <section className="mt-12 max-w-3xl">
            <span className="kicker">Summary</span>
            <p className="mt-4 text-lg leading-relaxed text-ink-dim">{project.summary}</p>
          </section>

          {project.sections && project.sections.length > 0 && (
            <section className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
              {project.sections.map((s, i) => (
                <div key={i} className="card p-6 md:p-8">
                  <h3 className="text-xl font-semibold text-ink">{s.heading}</h3>
                  {s.body && <p className="mt-3 text-ink-dim leading-relaxed">{s.body}</p>}
                  {s.items && s.items.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      {s.items.map((it, j) => (
                        <li key={j} className="flex gap-3 text-ink-dim">
                          <span className="mt-2 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-cyan" />
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          )}

          {project.roadmap && project.roadmap.length > 0 && (
            <section className="mt-16">
              <span className="kicker">Roadmap</span>
              <h2 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
                8 stages, one airframe at a time.
              </h2>
              <p className="section-sub">Where Raven is today and what's next.</p>
              <div className="mt-8">
                <Roadmap stages={project.roadmap} />
              </div>
            </section>
          )}

          <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-white/8 pt-8" style={{ borderTopColor: 'rgb(255 255 255 / 0.08)' }}>
            <Link href="/projects" className="btn-secondary">
              ← All projects
            </Link>
            <a href={`mailto:${content.personal.email}`} className="btn-primary">
              Talk to me about this →
            </a>
          </div>
        </article>
      </main>
      <Footer content={content} />
    </>
  );
}
