import Link from 'next/link';
import type { Project } from '@/lib/types';
import SectionHeader from '@/components/SectionHeader';

function FeaturedCard({ project }: { project: Project }) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group relative overflow-hidden rounded-2xl md:col-span-12"
      style={{
        border: '1px solid rgb(255 255 255 / 0.08)',
        background:
          'linear-gradient(135deg, rgb(12 16 25) 0%, rgb(15 24 38) 50%, rgb(8 12 20) 100%)',
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(800px circle at 50% 0%, rgb(61 224 255 / 0.10), transparent 60%)',
        }}
      />
      <div className="relative grid grid-cols-1 gap-6 p-8 md:grid-cols-12 md:gap-12 md:p-12">
        <div className="md:col-span-7">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan">
              {project.type}
            </span>
            <span
              className="inline-block h-px w-6"
              style={{ background: 'rgb(255 255 255 / 0.2)' }}
            />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-mute">
              Featured
            </span>
          </div>
          <h3 className="display-lg mt-6 text-ink">{project.name}</h3>
          <p className="lead mt-6 max-w-xl">{project.subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-1.5">
            {project.tags.slice(0, 6).map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </div>
          <div className="mt-10 flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.2em] text-cyan">
            View deep dive
            <span
              aria-hidden
              className="inline-block transition-transform duration-300 group-hover:translate-x-1"
            >
              →
            </span>
          </div>
        </div>
        <div className="md:col-span-5">
          <div className="grid h-full gap-px" style={{ background: 'rgb(255 255 255 / 0.08)' }}>
            <Spec label="Status" value={project.status} />
            <Spec label="Dates" value={project.dates} />
            <Spec label="Domain" value="eVTOL · Power · Autonomy" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-navy-2 px-5 py-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute">{label}</div>
      <div className="mt-1.5 text-ink">{value}</div>
    </div>
  );
}

function SupportingCard({ project, index }: { project: Project; index: number }) {
  const accent = project.color === 'purple' ? 'text-purple' : 'text-cyan';
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group relative flex flex-col gap-6 p-8 transition-colors duration-300 md:col-span-6 md:p-10"
      style={{
        border: '1px solid rgb(255 255 255 / 0.08)',
        background: 'rgb(12 16 25 / 0.5)',
        borderRadius: '16px',
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: 'rgb(255 255 255 / 0.02)', borderRadius: '16px' }}
      />
      <div className="relative flex items-center justify-between">
        <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${accent}`}>
          {String(index + 1).padStart(2, '0')} / {project.type}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute">
          {project.status}
        </span>
      </div>
      <div className="relative flex-1">
        <h3 className="display-md text-ink">{project.name}</h3>
        <p className="mt-4 text-base text-ink-dim md:text-lg">{project.subtitle}</p>
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {project.tags.slice(0, 4).map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
        <span className={`font-mono text-[11px] uppercase tracking-[0.22em] ${accent} transition-transform group-hover:translate-x-1`}>
          →
        </span>
      </div>
    </Link>
  );
}

export default function ProjectsGrid({ projects }: { projects: Project[] }) {
  if (!projects.length) return null;
  const [featured, ...rest] = projects;
  return (
    <section id="projects" className="wrap py-20 md:py-28">
      <SectionHeader
        num="005"
        eyebrow="Projects"
        title="The pivot in flight."
        lead="A flagship eVTOL program, a 540 V motorsport pack, motor-drive IC validation, and an award-winning wearable."
        align="between"
        right={
          <Link
            href="/projects"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-mute hover:text-cyan"
          >
            All projects →
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
        <FeaturedCard project={featured} />
        {rest.map((p, i) => (
          <SupportingCard key={p.slug} project={p} index={i + 1} />
        ))}
      </div>
    </section>
  );
}
