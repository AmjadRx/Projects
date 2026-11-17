import Link from 'next/link';
import MediaImage from '@/components/ui/MediaImage';
import { domainKey, hasText, projectDomains, statusText } from '@/lib/format';
import { resolveMedia } from '@/lib/media-server';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';
import MaturityScale from './MaturityScale';

/**
 * A project card (DESIGN_DIRECTION.md 5.8): the cover in a 16:10 well, the title, the pitch, the
 * maturity scale, and the status. No tags. The title is the one link; it covers the whole card.
 * Featured cards span the full width with the cover left and the text right on wide screens.
 */
export default function ProjectCard({
  project,
  headingLevel,
  featured = false,
  priority = false,
}: {
  project: Project;
  headingLevel: 2 | 3;
  featured?: boolean;
  priority?: boolean;
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  const cover = resolveMedia(project.cover);
  const href = `/projects/${project.slug}`;
  const domains = projectDomains(project).map(domainKey).filter(Boolean);
  return (
    <article
      data-card
      data-domains={domains.join(' ')}
      className={cn(
        'group relative flex flex-col gap-4 rounded-sm border border-line bg-surface p-3 hover:border-accent md:p-4',
        featured && 'md:col-span-2 lg:grid lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-8',
      )}
    >
      <div className="relative w-full overflow-hidden rounded-sm bg-well" style={{ aspectRatio: '16 / 10' }}>
        <MediaImage
          media={cover}
          wellAspect={16 / 10}
          priority={priority}
          sizes={featured ? '(min-width: 1024px) 680px, (min-width: 768px) 90vw, 100vw' : '(min-width: 1024px) 560px, (min-width: 768px) 45vw, 100vw'}
        />
      </div>
      <div className="flex flex-col gap-3 px-1 pb-1">
        <Heading className={cn('font-semibold text-ink', featured ? 'text-2xl md:text-3xl' : 'text-xl')}>
          <Link
            href={href}
            className="after:absolute after:inset-0 after:rounded-sm after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[rgb(var(--accent))]"
          >
            {project.title}
          </Link>
        </Heading>
        {hasText(project.pitch) && <p className="text-ink-dim">{project.pitch}</p>}
        <MaturityScale maturity={project.maturity} />
        <p className="data text-sm text-ink">{statusText(project)}</p>
      </div>
    </article>
  );
}
