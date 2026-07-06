import Link from 'next/link';
import type { Project } from '@/lib/types';
import MediaView from './MediaView';
import LinkIcon from './LinkIcon';
import { cn, detectIcon } from '@/lib/utils';

const STATUS_LABEL: Record<Project['status'], string> = {
  'in-progress': 'In progress',
  active: 'Active',
  completed: 'Completed',
  shipped: 'Shipped',
};

/** Media-led project card. `wide` = featured treatment (media left, copy right on desktop). */
export default function ProjectCard({ project, wide = false }: { project: Project; wide?: boolean }) {
  const statusText = project.statusLabel || STATUS_LABEL[project.status];
  const live = project.status === 'in-progress' || project.status === 'active';

  return (
    <Link
      href={`/projects/${project.slug}`}
      className={cn(
        'card group block overflow-hidden transition-all duration-200 ease-out hover:-translate-y-1',
        'hover:border-accent/50 hover:shadow-glow',
      )}
    >
      <article className={cn(wide && 'md:grid md:grid-cols-2')}>
        <div className={cn('relative overflow-hidden', wide ? 'aspect-[16/10] md:aspect-auto md:min-h-[340px]' : 'aspect-[16/10]')}>
          <div className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.03]">
            <MediaView
              media={project.cover}
              placeholderLabel={project.title}
              sizes={wide ? '(max-width: 768px) 100vw, 50vw' : '(max-width: 768px) 100vw, 33vw'}
            />
          </div>
        </div>
        <div className={cn('flex flex-col gap-3 p-5 md:p-6', wide && 'md:justify-center md:p-10')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('pill', live && 'pill-accent')}>
              {live && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
              {statusText}
            </span>
            <span className="kicker">{project.domain}</span>
          </div>
          <h3 className={cn('font-semibold tracking-tight text-ink', wide ? 'display-3' : 'text-xl')}>
            {project.title}
          </h3>
          <p className={cn('text-ink-dim', wide ? 'body-lg' : 'text-sm leading-relaxed')}>
            {project.pitch}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {project.tags.slice(0, wide ? 7 : 4).map((tag) => (
              <span key={tag} className="chip">{tag}</span>
            ))}
          </div>
          {project.links.length > 0 && (
            <div className="mt-1 flex items-center gap-3 text-ink-mute">
              {project.links.slice(0, 4).map((link) => (
                <span key={link.url} title={link.label}>
                  <LinkIcon icon={link.icon || detectIcon(link.url)} size={14} />
                </span>
              ))}
            </div>
          )}
          <span className="mt-2 text-sm font-medium text-accent">
            View project{' '}
            <span aria-hidden className="inline-block transition-transform duration-200 group-hover:translate-x-1">
              →
            </span>
          </span>
        </div>
      </article>
    </Link>
  );
}
