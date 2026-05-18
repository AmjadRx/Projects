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

  return (
    <>
      <Nav />
      <main className="pt-32 md:pt-40">
        <article className="wrap">
          <Link
            href="/projects"
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-mute hover:text-cyan"
          >
            ← All projects
          </Link>

          <header className="mt-12 md:mt-16">
            <div className="section-eyebrow">
              <span className="text-cyan">{project.type}</span>
              <span
                className="inline-block h-px w-8"
                style={{ background: 'rgb(255 255 255 / 0.2)' }}
              />
              <span>{project.dates}</span>
            </div>
            <h1 className="display-xl mt-6 text-ink">{project.name}</h1>
            <p className="lead mt-6 max-w-3xl">{project.subtitle}</p>
            <div className="mt-8 flex flex-wrap items-center gap-1.5">
              <span className="chip chip-cyan">{project.status}</span>
              {project.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          </header>

          {project.hero && (
            <section className="mt-16 md:mt-20">
              <div
                className="grid grid-cols-1 gap-px md:grid-cols-12"
                style={{ background: 'rgb(255 255 255 / 0.08)' }}
              >
                <div className="bg-navy p-8 md:col-span-5 md:p-12">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan">
                    Pitch
                  </div>
                  <p className="display-md mt-5 text-ink">{project.hero.pitch}</p>
                </div>
                <div className="bg-navy p-8 md:col-span-7 md:p-12">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan">
                    Highlights
                  </div>
                  {project.hero.highlights?.length > 0 && (
                    <ul className="mt-5 space-y-3">
                      {project.hero.highlights.map((h, i) => (
                        <li key={i} className="flex gap-4 text-ink-dim md:text-lg">
                          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className="mt-16 grid grid-cols-1 gap-10 md:mt-24 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-4">
              <div className="section-eyebrow">
                <span className="text-cyan">Summary</span>
              </div>
            </div>
            <div className="md:col-span-8">
              <p className="text-xl leading-relaxed text-ink-dim md:text-2xl">
                {project.summary}
              </p>
            </div>
          </section>

          {project.sections && project.sections.length > 0 && (
            <section className="mt-16 md:mt-24">
              <div
                className="grid grid-cols-1 gap-px md:grid-cols-2"
                style={{ background: 'rgb(255 255 255 / 0.08)' }}
              >
                {project.sections.map((s, i) => (
                  <div key={i} className="bg-navy p-8 md:p-10">
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan">
                      {String(i + 1).padStart(2, '0')}
                    </div>
                    <h3 className="mt-4 text-2xl font-medium text-ink md:text-3xl">{s.heading}</h3>
                    {s.body && <p className="mt-5 text-ink-dim leading-relaxed">{s.body}</p>}
                    {s.items && s.items.length > 0 && (
                      <ul className="mt-5 space-y-3">
                        {s.items.map((it, j) => (
                          <li key={j} className="flex gap-3 text-ink-dim">
                            <span
                              className="mt-3 inline-block h-px w-4 flex-shrink-0"
                              style={{ background: 'rgb(61 224 255 / 0.6)' }}
                            />
                            <span>{it}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {project.roadmap && project.roadmap.length > 0 && (
            <section className="mt-16 md:mt-24">
              <div className="mb-10 max-w-2xl">
                <div className="section-eyebrow">
                  <span className="text-cyan">Roadmap</span>
                </div>
                <h2 className="display-lg mt-4 text-ink">8 stages, one airframe at a time.</h2>
                <p className="lead mt-5">Where Raven is today and what's next.</p>
              </div>
              <Roadmap stages={project.roadmap} />
            </section>
          )}

          <div
            className="mt-20 flex flex-wrap items-center justify-between gap-4 pt-10 md:mt-32"
            style={{ borderTop: '1px solid rgb(255 255 255 / 0.08)' }}
          >
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
