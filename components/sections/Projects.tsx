import Link from 'next/link';
import type { Project } from '@/lib/types';
import Chapter from '@/components/Chapter';

const accentClass: Record<Project['color'], string> = {
  cyan: 'text-accent',
  purple: 'text-accent-2',
  amber: 'text-accent-warm',
};

function ProjectMedia({
  project,
  className,
}: {
  project: Project;
  className?: string;
}) {
  if (project.imageUrl) {
    return (
      <div className={`relative overflow-hidden ${className ?? ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={project.imageUrl}
          alt={`${project.name} — ${project.type}`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.05]"
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgb(var(--bg) / 0) 30%, rgb(var(--bg) / 0.65) 90%, rgb(var(--bg) / 0.95) 100%)',
          }}
        />
      </div>
    );
  }
  // Typographic fallback
  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{
        background:
          'linear-gradient(135deg, rgb(var(--card-grad-1)) 0%, rgb(var(--card-grad-2)) 50%, rgb(var(--bg)) 100%)',
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 grid-bg opacity-50"
        style={{
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black, transparent 80%)',
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center p-8">
        <span className={`font-display text-5xl font-medium tracking-tight md:text-7xl ${accentClass[project.color]} opacity-20`}>
          {project.name.split(' ')[0]}
        </span>
      </div>
    </div>
  );
}

function FeaturedCard({ project }: { project: Project }) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group relative block overflow-hidden rounded-[28px] border border-line/8 bg-bg-2 md:col-span-12"
    >
      <ProjectMedia project={project} className="aspect-[16/10] md:aspect-[21/9]" />

      <div className="relative grid grid-cols-1 gap-6 p-8 md:grid-cols-12 md:gap-12 md:p-12">
        <div className="md:col-span-8">
          <div className="flex items-center gap-3">
            <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${accentClass[project.color]}`}>
              {project.type}
            </span>
            <span className="eyebrow-rule" />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-fg-mute">
              Flagship
            </span>
          </div>
          <h3 className="display-lg mt-5 text-fg">{project.name}</h3>
          <p className="lead mt-5 max-w-[60ch]">{project.subtitle}</p>
          <div className="mt-7 flex flex-wrap gap-1.5">
            {project.tags.slice(0, 7).map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
          </div>
          <div className="mt-9 inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.2em] text-accent">
            View deep dive
            <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
          </div>
        </div>
        <div className="md:col-span-4">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line/8 md:grid-cols-1" style={{ background: 'rgb(var(--line) / 0.08)' }}>
            <Spec label="Status" value={project.status} />
            <Spec label="Dates" value={project.dates} />
            <Spec label="Domain" value="eVTOL · Autonomy · Power" wide />
          </div>
        </div>
      </div>
    </Link>
  );
}

function Spec({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`bg-bg-2 px-5 py-4 ${wide ? 'col-span-2 md:col-span-1' : ''}`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">{label}</div>
      <div className="mt-1.5 text-fg">{value}</div>
    </div>
  );
}

function SupportingCard({ project, index }: { project: Project; index: number }) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-[24px] border border-line/8 bg-bg-2 transition-colors duration-300 hover:border-line/20 md:col-span-6"
    >
      <ProjectMedia project={project} className="aspect-[16/10]" />
      <div className="relative flex flex-1 flex-col gap-5 p-8 md:p-10">
        <div className="flex items-center justify-between">
          <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${accentClass[project.color]}`}>
            {String(index).padStart(2, '0')} · {project.type}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
            {project.status}
          </span>
        </div>
        <h3 className="display-md text-fg">{project.name}</h3>
        <p className="text-pretty text-fg-dim md:text-lg">{project.subtitle}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {project.tags.slice(0, 4).map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
          </div>
          <span
            className={`font-mono text-[11px] uppercase tracking-[0.22em] ${accentClass[project.color]} transition-transform group-hover:translate-x-1`}
          >
            →
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function ProjectsGrid({ projects }: { projects: Project[] }) {
  if (!projects.length) return null;
  const [featured, ...rest] = projects;
  return (
    <section id="projects" className="wrap section">
      <Chapter
        num="005"
        eyebrow="Projects"
        title={<>The pivot, <span className="editorial italic text-fg-dim">in flight.</span></>}
        lead="A flagship tilt-rotor eVTOL program, a 540 V motorsport pack, motor-inverter validation at ST, an award-winning wearable, and applied-entrepreneurship products."
        right={
          <Link
            href="/projects"
            className="btn-ghost"
          >
            All projects →
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-12 md:gap-6">
        <FeaturedCard project={featured} />
        {rest.map((p, i) => (
          <SupportingCard key={p.slug} project={p} index={i + 1} />
        ))}
      </div>
    </section>
  );
}
