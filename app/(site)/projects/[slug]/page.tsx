import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import BlockRenderer from '@/components/blocks/BlockRenderer';
import ProgressStrip from '@/components/projects/ProgressStrip';
import TitleBlock from '@/components/projects/TitleBlock';
import { fitFor, PhotoPlaceholder } from '@/components/ui/MediaImage';
import ImageZoom from '@/components/viewers/image/ImageZoom';
import { hasText } from '@/lib/format';
import { projectRevDate } from '@/lib/history';
import type { ResolvedMedia } from '@/lib/media';
import { resolveMedia } from '@/lib/media-server';
import { absoluteUrl, JsonLd, pageMetadata } from '@/lib/meta';
import { siteData } from '@/lib/site';
import { UI } from '@/lib/strings';
import type { Project } from '@/lib/types';

type Params = { slug: string };

// Video and model covers load their viewer code only on the pages that have one.
const VideoPlayer = dynamic(() => import('@/components/viewers/video/VideoPlayer'));
const ModelViewer = dynamic(() => import('@/components/viewers/model/ModelViewer'));

/** Only visible projects get a page; any other slug is a 404 (ARCHITECTURE.md 4). */
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return siteData().projects.map((project) => ({ slug: project.slug }));
}

/** The still image that stands for the cover in metadata: the photo, or a video or model poster. */
function coverStill(cover: ResolvedMedia | null): string | undefined {
  if (!cover) return undefined;
  if (cover.kind === 'image') return cover.file.src;
  return cover.poster?.src;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const { site, projects } = siteData();
  const project = projects.find((p) => p.slug === slug);
  if (!project) return {};
  return pageMetadata(site, {
    title: project.title,
    description: project.pitch,
    path: `/projects/${project.slug}`,
    image: coverStill(resolveMedia(project.cover)),
  });
}

function Cover({ project, cover }: { project: Project; cover: ResolvedMedia | null }) {
  const sizes = '(min-width: 1280px) 760px, (min-width: 1024px) 60vw, 100vw';
  if (!cover) {
    return (
      <div className="relative w-full overflow-hidden rounded-sm" style={{ aspectRatio: '16 / 10' }}>
        <PhotoPlaceholder />
      </div>
    );
  }
  if (cover.kind === 'video' || cover.kind === 'embed') return <VideoPlayer media={cover} />;
  if (cover.kind === 'model') {
    return (
      <ModelViewer
        media={cover}
        views={['realistic', 'blueprint', 'thermal']}
        explode
        callouts={(project.callouts ?? []).filter((c) => hasText(c.label) && hasText(c.value))}
      />
    );
  }
  return <ImageZoom media={cover} fit={fitFor(cover, 16 / 10)} aspect={16 / 10} sizes={sizes} priority />;
}

export default async function ProjectPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const { site, projects, resolveLink } = siteData();
  const index = projects.findIndex((p) => p.slug === slug);
  if (index < 0) notFound();
  const project = projects[index];
  const previous = index > 0 ? projects[index - 1] : undefined;
  const next = index < projects.length - 1 ? projects[index + 1] : undefined;
  const cover = resolveMedia(project.cover);
  const callouts = (project.callouts ?? []).filter((c) => hasText(c.label) && hasText(c.value));
  const highlights = project.highlights.filter(hasText);
  const steps = project.progress?.steps.filter((s) => hasText(s.label)) ?? [];
  const still = coverStill(cover);

  const creativeWork = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: project.title,
    ...(hasText(project.subtitle) ? { alternativeHeadline: project.subtitle } : {}),
    ...(hasText(project.pitch) ? { description: project.pitch } : {}),
    url: absoluteUrl(`/projects/${project.slug}`),
    contributor: hasText(project.role)
      ? { '@type': 'Role', roleName: project.role, contributor: { '@type': 'Person', name: site.personal.name } }
      : { '@type': 'Person', name: site.personal.name },
    ...(still ? { image: absoluteUrl(still) } : {}),
  };

  return (
    <article className="wrap py-10 md:py-14">
      <JsonLd data={creativeWork} />
      <Link href="/projects" className="text-link inline-flex min-h-[44px] items-center gap-2 text-sm">
        <ArrowLeft size={16} aria-hidden />
        {UI.projects.backToProjects}
      </Link>

      <header className="mt-4">
        <h1 className="display-2">{project.title}</h1>
        {hasText(project.subtitle) && <p className="body-lg mt-2">{project.subtitle}</p>}
      </header>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <Cover project={project} cover={cover} />
          {callouts.length > 0 && (
            <dl aria-label={UI.projects.callouts} className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-line bg-[var(--line)] sm:grid-cols-3">
              {callouts.map((callout, i) => (
                <div key={`${callout.label}-${i}`} className="flex flex-col gap-1 bg-surface p-4">
                  <dt className="text-sm text-ink-mute">{callout.label}</dt>{' '}
                  <dd className="data text-xl text-ink">{callout.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="lg:sticky lg:top-24">
          <TitleBlock
            project={project}
            sheet={index + 1}
            sheets={projects.length}
            rev={projectRevDate(project.slug)}
            resolveLink={resolveLink}
          />
        </div>
      </div>

      {(hasText(project.pitch) || highlights.length > 0) && (
        <section className="mt-12 max-w-3xl" aria-labelledby={highlights.length > 0 ? 'highlights-title' : undefined}>
          {hasText(project.pitch) && <p className="text-lg text-ink md:text-xl">{project.pitch}</p>}
          {highlights.length > 0 && (
            <>
              <h2 id="highlights-title" className="mt-8 text-xl font-semibold">
                {UI.projects.highlights}
              </h2>
              <ul className="prose-md mt-3 list-disc space-y-2 pl-5 text-base md:text-lg">
                {highlights.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {steps.length > 0 && (
        <section className="mt-12" aria-labelledby="progress-title">
          <h2 id="progress-title" className="text-xl font-semibold">
            {UI.projects.progress}
          </h2>
          <div className="mt-4">
            <ProgressStrip steps={steps} labelledBy="progress-title" />
          </div>
        </section>
      )}

      <div className="mt-12">
        <BlockRenderer blocks={project.blocks} ctx={{ resolveLink, level: 2, idPrefix: '' }} />
      </div>

      {(previous || next) && (
        <nav aria-label={UI.projects.moreProjects} className="mt-16 grid gap-4 border-t border-line pt-8 sm:grid-cols-2">
          {previous ? (
            <Link href={`/projects/${previous.slug}`} className="group flex min-h-[44px] flex-col gap-1 rounded-sm border border-line p-4 hover:border-accent">
              <span className="inline-flex items-center gap-2 text-sm text-ink-mute">
                <ArrowLeft size={15} aria-hidden />
                {UI.projects.previous}
              </span>
              <span className="font-semibold text-ink">{previous.title}</span>
            </Link>
          ) : null}
          {next && (
            <Link
              href={`/projects/${next.slug}`}
              className={`group flex min-h-[44px] flex-col items-end gap-1 rounded-sm border border-line p-4 text-right hover:border-accent${previous ? '' : ' sm:col-start-2'}`}
            >
              <span className="inline-flex items-center gap-2 text-sm text-ink-mute">
                {UI.projects.next}
                <ArrowRight size={15} aria-hidden />
              </span>
              <span className="font-semibold text-ink">{next.title}</span>
            </Link>
          )}
        </nav>
      )}
    </article>
  );
}
