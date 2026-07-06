import Link from 'next/link';
import type { Project } from '@/lib/types';
import ProjectCard from '@/components/ProjectCard';
import Reveal from '@/components/Reveal';

export default function FeaturedProjects({ projects }: { projects: Project[] }) {
  const featured = projects.filter((p) => p.featured);
  const rest = projects.filter((p) => !p.featured).slice(0, 4);
  const [first, ...otherFeatured] = featured;

  return (
    <section id="projects" className="wrap py-20 md:py-32">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker">Projects</p>
            <h2 className="display-2 mt-5">Selected work</h2>
          </div>
          <Link href="/projects" className="link-underline text-sm font-medium text-accent">
            All projects →
          </Link>
        </div>
      </Reveal>

      <div className="mt-12 flex flex-col gap-5">
        {first && (
          <Reveal>
            <ProjectCard project={first} wide />
          </Reveal>
        )}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {otherFeatured.map((project, i) => (
            <Reveal key={project.slug} delay={i * 0.08}>
              <ProjectCard project={project} />
            </Reveal>
          ))}
          {rest.map((project, i) => (
            <Reveal key={project.slug} delay={(otherFeatured.length + i) * 0.06}>
              <ProjectCard project={project} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
