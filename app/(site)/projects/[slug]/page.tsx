import { Suspense, type CSSProperties } from 'react';
import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import BlockRenderer from '@/components/blocks/BlockRenderer';
import { CalloutRow, shownCallouts } from '@/components/sheet/callouts';
import CoverStage from '@/components/sheet/CoverStage';
import DimensionCallouts from '@/components/sheet/DimensionCallouts';
import Glass from '@/components/sheet/Glass';
import Icon from '@/components/sheet/Icon';
import ProgressStrip from '@/components/sheet/ProgressStrip';
import TitleBlock from '@/components/sheet/TitleBlock';
import { hasText } from '@/lib/format';
import { projectRevDate } from '@/lib/history';
import type { ResolvedMedia } from '@/lib/media';
import { resolveMedia } from '@/lib/media-server';
import { JsonLd, pageMetadata } from '@/lib/meta';
import { projectMetaImage } from '@/lib/og/meta';
import { siteData, siteUrl } from '@/lib/site';
import { creativeWorkJsonLd } from '@/lib/structured-data';
import { UI } from '@/lib/strings';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

type Params = { slug: string };

// Video and model covers load their viewer code only on the pages that have one.
const VideoPlayer = dynamic(() => import('@/components/viewers/video/VideoPlayer'));
const ModelViewer = dynamic(() => import('@/components/viewers/model/ModelViewer'));

/** Only visible projects get a page; any other slug is a 404 (ARCHITECTURE.md 4). */
export const dynamicParams = false;

/** Over this many characters a title steps down on phones (the canvas's pj-title--long), so it never runs past four lines. */
const LONG_TITLE = 56;

/** From this many characters a word cannot sit whole at 40 px in a 320 px phone's column: the title steps down on phones. */
const LONG_WORD = 12;

/** The longest run of a title that cannot wrap (titles wrap at spaces and after hyphens), in characters. */
function longestWord(title: string): number {
  return Math.max(0, ...title.split(/\s+|(?<=-)/).map((word) => word.length));
}

/**
 * The cover's width as drawn, so a phone or a laptop asks for no bigger a file than it shows: the
 * column inside the 20 px gutters below 1024 px; from 1024 px eight of twelve columns (32 px gaps)
 * inside the frame's 16 px inset and the 32 px gutters, which reach their 800 px at a 1344 px window
 * (the 1280 px content width). Measured in Chrome from 360 to 2560 px.
 */
const COVER_SIZES = '(min-width: 1344px) 800px, (min-width: 1024px) calc(66.67vw - 75px), calc(100vw - 40px)';

/**
 * The page's address as the printed sheet's frame band shows it ("amjadrehawi.com/projects/raven";
 * the Print board): the site's own host and the path, with no scheme.
 */
function printAddress(slug: string): string {
  return `${new URL(siteUrl()).host}/projects/${slug}`;
}

export function generateStaticParams(): Params[] {
  return siteData().projects.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const { site, projects } = siteData();
  const project = projects.find((p) => p.slug === slug);
  if (!project) return {};
  // The share image is the project's generated sheet (lib/og/), not its cover photo.
  return pageMetadata(site, {
    title: project.title,
    description: project.pitch,
    path: `/projects/${project.slug}`,
    image: projectMetaImage(project.slug),
  });
}

/**
 * The cover with its dimension callouts (ARCHITECTURE.md 5): a photo, or the placeholder, in the
 * 16:10 well with the callouts drawn over it (a row under it on phones, and at every width when
 * there is no photo), opening in the lightbox; a video or model cover in its viewer, with the
 * callouts as the row under it.
 */
function Cover({ project, cover }: { project: Project; cover: ResolvedMedia | null }) {
  const callouts = shownCallouts(project.callouts);
  if (cover && (cover.kind === 'video' || cover.kind === 'embed' || cover.kind === 'model')) {
    return (
      <>
        {cover.kind === 'model' ? (
          <ModelViewer media={cover} views={['realistic', 'blueprint', 'thermal']} explode callouts={callouts} />
        ) : (
          <VideoPlayer media={cover} />
        )}
        <CalloutRow callouts={callouts} label={UI.projects.callouts} />
      </>
    );
  }
  return <DimensionCallouts media={cover} callouts={callouts} layout="auto" drawn zoom sizes={COVER_SIZES} priority />;
}

/** One side of the pager: the direction, the sheet number, and the project's title. */
function PagerLink({ project, sheet, sheets, dir }: { project: Project; sheet: number; sheets: number; dir: 'prev' | 'next' }) {
  return (
    <Link href={`/projects/${project.slug}`} className={cn('pj-pager__link ar-glass', `pj-pager__link--${dir}`)}>
      <span className="pj-pager__dir">
        {dir === 'prev' ? <Icon icon={ArrowLeft} size={18} /> : null}
        {dir === 'prev' ? UI.projects.previous : UI.projects.next}
        {dir === 'next' ? <Icon icon={ArrowRight} size={18} /> : null}
      </span>
      <span className="pj-pager__sheet">{UI.projects.sheetOf(sheet, sheets)}</span>
      <span className="pj-pager__title">{project.title}</span>
    </Link>
  );
}

/**
 * A project page (ARCHITECTURE.md 5; the canvas's Project board): the back link, the title and
 * subtitle; the cover with its dimension callouts; the title block (under the cover on phones and
 * tablets, the sticky rail from 1024 px); the pitch and highlights; the progress strip when there
 * is one; the blocks in order; and the previous and next project.
 *
 * Printed, the article is one drawing sheet (app/print.css, the Print board): its data-print-*
 * attributes carry the words the sheet adds, the page address, the owner's name over the title, and
 * the label over the highlights. Nothing else changes in the markup.
 *
 * Everything after the cover sits in Suspense boundaries (the title block, the summary, the
 * progress, the blocks, the pager): the server sends the page as before (a boundary adds two HTML
 * comments), and in the browser React hydrates the head and the cover first, then each part on its
 * own, in short slices between frames, so no one long task holds the page (ARCHITECTURE.md 9: TBT).
 */
export default async function ProjectPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const { site, projects, resolveLink } = siteData();
  const index = projects.findIndex((p) => p.slug === slug);
  if (index < 0) notFound();
  const project = projects[index];
  const previous = index > 0 ? projects[index - 1] : undefined;
  const next = index < projects.length - 1 ? projects[index + 1] : undefined;
  const cover = resolveMedia(project.cover);
  const highlights = project.highlights.filter(hasText);
  const steps = project.progress?.steps.filter((s) => hasText(s.label)) ?? [];
  const word = longestWord(project.title);

  return (
    <>
      <article className="pj-sheet" data-print-address={printAddress(project.slug)}>
        <JsonLd data={creativeWorkJsonLd(site, project, projectRevDate(project.slug))} />
        <div className="hm-wrap pj-top">
          <Link href="/projects" className="pj-back">
            <Icon icon={ArrowLeft} size={18} />
            <span className="pj-back__text">{UI.projects.backToProjects}</span>
          </Link>
          <header className="pj-head" data-print-owner={hasText(site.personal.name) ? site.personal.name.trim() : undefined}>
            <h1
              className={cn('pj-title', project.title.length > LONG_TITLE && 'pj-title--long', word >= LONG_WORD && 'pj-title--word')}
              style={word >= LONG_WORD ? ({ '--pj-word': word } as CSSProperties) : undefined}
            >
              {project.title}
            </h1>
            {hasText(project.subtitle) ? <p className="pj-sub">{project.subtitle}</p> : null}
          </header>
        </div>

        <div className="hm-wrap pj-grid">
          <CoverStage slug={project.slug}>
            <Cover project={project} cover={cover} />
          </CoverStage>

          <Suspense>
            <aside className="pj-rail" aria-label={UI.titleBlock.caption}>
              <TitleBlock
                project={project}
                sheet={index + 1}
                sheets={projects.length}
                rev={projectRevDate(project.slug)}
                resolveLink={resolveLink}
                rail
              />
            </aside>
          </Suspense>

          <Suspense>
            {hasText(project.pitch) || highlights.length > 0 ? (
              <section className="pj-intro" aria-label={UI.projects.summary}>
                {hasText(project.pitch) ? <p className="pj-pitch">{project.pitch}</p> : null}
                {highlights.length > 0 ? (
                  <ul className="pj-hl ar-glass" data-print-label={UI.print.notes}>
                    {highlights.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </Suspense>

          <Suspense>
            {steps.length > 0 ? (
              <section className="pj-progress" aria-labelledby="progress-title">
                <h2 id="progress-title" className="hm-label">
                  {UI.projects.progress}
                </h2>
                <Glass>
                  <ProgressStrip steps={steps} label={UI.projects.progressOf(project.title)} />
                </Glass>
              </section>
            ) : null}
          </Suspense>

          <Suspense>
            <BlockRenderer blocks={project.blocks} ctx={{ resolveLink, level: 2, idPrefix: '', label: project.title }} />
          </Suspense>
        </div>
      </article>

      <Suspense>
        {previous || next ? (
          <nav className="hm-wrap pj-pager" aria-label={UI.projects.pager}>
            {previous ? <PagerLink project={previous} sheet={index} sheets={projects.length} dir="prev" /> : null}
            {next ? <PagerLink project={next} sheet={index + 2} sheets={projects.length} dir="next" /> : null}
          </nav>
        ) : null}
      </Suspense>
    </>
  );
}
