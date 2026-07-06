import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { loadContent, loadProject, loadProjects, lastUpdated } from '@/lib/content';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import MediaView from '@/components/MediaView';
import LinkButton from '@/components/LinkButton';
import ProgressStrip from '@/components/ProgressStrip';
import BlockRenderer from '@/components/blocks/BlockRenderer';
import Reveal from '@/components/Reveal';
import { cn } from '@/lib/utils';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return loadProjects().map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const project = loadProject(params.slug);
  if (!project) return { title: 'Project not found' };
  return {
    title: project.title,
    description: project.pitch,
    openGraph: {
      title: project.title,
      description: project.pitch,
      images: project.cover.exists !== false ? [project.cover.src] : undefined,
    },
  };
}

const STATUS_LABEL = {
  'in-progress': 'In progress',
  active: 'Active',
  completed: 'Completed',
  shipped: 'Shipped',
} as const;

export default function ProjectPage({ params }: { params: { slug: string } }) {
  const { site, projects } = loadContent();
  const project = projects.find((p) => p.slug === params.slug);
  if (!project) notFound();

  const idx = projects.findIndex((p) => p.slug === project.slug);
  const prev = projects[idx - 1];
  const next = projects[idx + 1];
  const live = project.status === 'in-progress' || project.status === 'active';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: project.title,
    description: project.pitch,
    author: { '@type': 'Person', name: site.personal.name },
    keywords: project.tags.join(', '),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Nav name={site.personal.name} items={site.nav} socials={site.socialLinks} />
      <main className="pb-24 pt-28 md:pt-36">
        <article className="wrap">
          <div className="mx-auto max-w-article">
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 text-sm text-ink-mute transition-colors hover:text-accent"
            >
              <ArrowLeft size={15} /> All projects
            </Link>

            <header className="mt-8">
              <p className="kicker">{project.domain}</p>
              <h1 className="display-1 mt-4">{project.title}</h1>
              <p className="body-lg mt-4">{project.subtitle}</p>

              <div
                className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 py-4"
                style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
              >
                <span className="text-sm font-medium text-ink">{project.role}</span>
                <span className="kicker">{project.timeframe}</span>
                <span className={cn('pill', live && 'pill-accent')}>
                  {live && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
                  {project.statusLabel || STATUS_LABEL[project.status]}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {project.tags.map((tag) => (
                  <span key={tag} className="chip">{tag}</span>
                ))}
              </div>

              {project.links.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-2.5">
                  {project.links.map((link) => (
                    <LinkButton key={link.url} {...link} />
                  ))}
                </div>
              )}
            </header>

            <Reveal className="mt-10">
              <div
                className="relative aspect-[16/9] w-full overflow-hidden rounded-lg"
                style={{ border: '1px solid var(--line)' }}
              >
                <MediaView media={project.cover} placeholderLabel={project.title} sizes="760px" priority />
              </div>
            </Reveal>

            <Reveal className="mt-12">
              <p className="display-3 !font-medium leading-snug text-ink">{project.pitch}</p>
            </Reveal>

            {project.highlights.length > 0 && (
              <Reveal className="mt-10">
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {project.highlights.map((highlight, i) => (
                    <li key={i} className="card flex gap-3 p-4">
                      <span className="font-mono text-[11px] text-accent">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-sm leading-relaxed text-ink-dim">{highlight}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}

            {project.progress && (
              <Reveal className="mt-10">
                <div className="card px-5 py-4">
                  <ProgressStrip progress={project.progress} />
                </div>
              </Reveal>
            )}

            <div className="mt-14">
              <BlockRenderer blocks={project.blocks} slug={project.slug} />
            </div>

            <nav
              className="mt-20 grid grid-cols-1 gap-4 pt-8 sm:grid-cols-2"
              style={{ borderTop: '1px solid var(--line)' }}
              aria-label="Project navigation"
            >
              {prev ? (
                <Link href={`/projects/${prev.slug}`} className="card group p-5 transition-colors hover:border-accent/50">
                  <span className="kicker">← Previous</span>
                  <span className="mt-1.5 block font-semibold text-ink group-hover:text-accent">
                    {prev.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  href={`/projects/${next.slug}`}
                  className="card group p-5 text-right transition-colors hover:border-accent/50"
                >
                  <span className="kicker">Next →</span>
                  <span className="mt-1.5 block font-semibold text-ink group-hover:text-accent">
                    {next.title}
                  </span>
                </Link>
              )}
            </nav>
          </div>
        </article>
      </main>
      <Footer site={site} lastUpdated={lastUpdated()} />
    </>
  );
}
