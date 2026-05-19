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
      <main>
        {/* HERO */}
        <section className="relative isolate overflow-hidden">
          {project.imageUrl && (
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={project.imageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-40 mask-fade-b"
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgb(var(--bg) / 0.4) 0%, rgb(var(--bg) / 0.85) 70%, rgb(var(--bg)) 100%)',
                }}
              />
            </div>
          )}
          <div className="wrap pt-32 pb-16 md:pt-44 md:pb-24">
            <Link
              href="/projects"
              className="btn-ghost -ml-2"
            >
              ← All projects
            </Link>

            <header className="mt-10 md:mt-14">
              <div className="eyebrow">
                <span className="eyebrow-num">{project.type}</span>
                <span className="eyebrow-rule" />
                <span>{project.dates}</span>
              </div>
              <h1 className="display-3xl text-balance mt-7 text-fg max-w-[18ch]">
                {project.name}
              </h1>
              <p className="lead-xl text-pretty mt-8 max-w-[60ch]">{project.subtitle}</p>
              <div className="mt-9 flex flex-wrap items-center gap-1.5">
                <span className="chip chip-accent">{project.status}</span>
                {project.tags.map((t) => (
                  <span key={t} className="chip">{t}</span>
                ))}
              </div>
            </header>

            {project.imageUrl && (
              <figure className="mt-14 overflow-hidden rounded-[28px] border border-line/10 bg-bg-2 md:mt-20">
                <div className="aspect-[16/9] relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={project.imageUrl}
                    alt={`${project.name}`}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
              </figure>
            )}
          </div>
        </section>

        {/* PITCH + HIGHLIGHTS */}
        {project.hero && (
          <section className="wrap py-16 md:py-24">
            <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-14">
              <div className="md:col-span-5">
                <span className="eyebrow">
                  <span className="eyebrow-num">Pitch</span>
                </span>
                <p className="display-lg text-balance mt-6 text-fg">
                  {project.hero.pitch}
                </p>
              </div>
              <div className="md:col-span-7">
                <span className="eyebrow">
                  <span className="eyebrow-num">Highlights</span>
                  <span className="eyebrow-rule" />
                  <span>{project.hero.highlights?.length ?? 0} items</span>
                </span>
                {project.hero.highlights?.length > 0 && (
                  <ul className="mt-7 space-y-4 md:space-y-5">
                    {project.hero.highlights.map((h, i) => (
                      <li key={i} className="flex gap-5 text-fg-dim md:text-lg">
                        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent shrink-0 mt-[0.4em]">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="text-pretty">{h}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}

        {/* SUMMARY — editorial big text */}
        <section className="wrap py-16 md:py-24 border-t border-line/8">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-14">
            <div className="md:col-span-3">
              <span className="eyebrow">
                <span className="eyebrow-num">Summary</span>
              </span>
            </div>
            <div className="md:col-span-9">
              <p className="text-pretty text-xl leading-[1.5] text-fg-dim md:text-[1.55rem] md:leading-[1.4]">
                {project.summary}
              </p>
            </div>
          </div>
        </section>

        {/* CHAPTERS */}
        {project.sections && project.sections.length > 0 && (
          <section className="wrap py-16 md:py-24 border-t border-line/8">
            <div className="mb-12 md:mb-20">
              <span className="eyebrow">
                <span className="eyebrow-num">Chapters</span>
                <span className="eyebrow-rule" />
                <span>{project.sections.length}</span>
              </span>
            </div>
            <div className="space-y-16 md:space-y-24">
              {project.sections.map((s, i) => (
                <article
                  key={i}
                  className="grid grid-cols-1 gap-8 md:grid-cols-12 md:gap-14"
                >
                  <div className="md:col-span-4">
                    <div className="sticky top-28">
                      <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">
                        Chapter {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="display-md text-balance mt-4 text-fg">
                        {s.heading}
                      </h3>
                    </div>
                  </div>
                  <div className="md:col-span-8">
                    {s.body && (
                      <p className="text-pretty text-lg leading-[1.55] text-fg-dim md:text-xl md:leading-[1.5]">
                        {s.body}
                      </p>
                    )}
                    {s.items && s.items.length > 0 && (
                      <ul className={`${s.body ? 'mt-7' : ''} space-y-3.5 md:space-y-4`}>
                        {s.items.map((it, j) => (
                          <li key={j} className="flex gap-4 text-fg-dim md:text-lg">
                            <span
                              aria-hidden
                              className="mt-[0.7em] inline-block h-px w-4 flex-shrink-0"
                              style={{ background: 'rgb(var(--accent) / 0.7)' }}
                            />
                            <span className="text-pretty">{it}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ROADMAP */}
        {project.roadmap && project.roadmap.length > 0 && (
          <section className="wrap py-16 md:py-24 border-t border-line/8">
            <div className="max-w-[760px] mb-12 md:mb-16">
              <span className="eyebrow">
                <span className="eyebrow-num">Roadmap</span>
                <span className="eyebrow-rule" />
                <span>{project.roadmap.length} stages</span>
              </span>
              <h2 className="display-xl text-balance mt-6 text-fg">
                8 stages, one airframe <span className="editorial italic text-fg-dim">at a time.</span>
              </h2>
              <p className="lead mt-6">
                Where Raven is today, and what&rsquo;s next.
              </p>
            </div>
            <Roadmap stages={project.roadmap} />
          </section>
        )}

        {/* CTA */}
        <section className="wrap py-16 md:py-24 border-t border-line/8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/projects" className="btn-secondary">
              ← All projects
            </Link>
            <a href={`mailto:${content.personal.email}`} className="btn-primary">
              Talk to me about this <span aria-hidden>→</span>
            </a>
          </div>
        </section>
      </main>
      <Footer content={content} />
    </>
  );
}
