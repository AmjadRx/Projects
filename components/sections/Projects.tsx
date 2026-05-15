import Link from 'next/link';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

function ProjectCard({ project, featured }: { project: Project; featured?: boolean }) {
  const colorRing =
    project.color === 'purple'
      ? 'hover:border-purple/40 hover:shadow-glow-purple'
      : 'hover:border-cyan/40 hover:shadow-glow';
  const accent = project.color === 'purple' ? 'text-purple' : 'text-cyan';
  return (
    <Link
      href={`/projects/${project.slug}`}
      className={cn(
        'card group block p-6 transition-all duration-300 md:p-8',
        colorRing,
        featured ? 'md:col-span-8' : 'md:col-span-4',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('font-mono text-[10px] uppercase tracking-widest', accent)}>
          {project.type}
        </span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-ink-mute">
          {project.status}
        </span>
      </div>
      <h3 className={cn('mt-3 font-semibold tracking-tight', featured ? 'text-3xl md:text-4xl' : 'text-xl md:text-2xl')}>
        {project.name}
      </h3>
      <p className="mt-2 max-w-xl text-ink-dim">{project.subtitle}</p>
      <div className="mt-5 flex flex-wrap gap-1.5">
        {project.tags.slice(0, featured ? 6 : 4).map((t) => (
          <span key={t} className="chip">{t}</span>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-ink-mute transition-colors group-hover:text-cyan">
        Open project <span aria-hidden>→</span>
      </div>
    </Link>
  );
}

export default function ProjectsGrid({ projects }: { projects: Project[] }) {
  if (!projects.length) return null;
  const [featured, ...rest] = projects;
  return (
    <section id="projects" className="wrap py-12 md:py-16">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <span className="kicker">Projects</span>
          <h2 className="section-heading mt-3">Hardware that moves itself.</h2>
        </div>
        <Link href="/projects" className="hidden font-mono text-xs uppercase tracking-widest text-ink-dim hover:text-cyan md:inline-flex">
          All projects →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:gap-5">
        <ProjectCard project={featured} featured />
        {rest.map((p) => (
          <ProjectCard key={p.slug} project={p} />
        ))}
      </div>
    </section>
  );
}
