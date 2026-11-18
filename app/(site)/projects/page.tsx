import type { Metadata } from 'next';
import DomainFilter from '@/components/sheet/DomainFilter';
import ProjectCard, { CARD_SIZES } from '@/components/sheet/ProjectCard';
import { pageMetadata } from '@/lib/meta';
import { navLabel, siteData } from '@/lib/site';
import { UI } from '@/lib/strings';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { title: navLabel(site, '/projects', 'Projects'), description: site.seo.description, path: '/projects' });
}

/**
 * Every visible project in sheet order (ARCHITECTURE.md 5; the canvas's Projects board): the
 * heading and one line, the domain filter, and the cards, one column on phones, two from 768 px,
 * three from 1024 px. The cards sit straight in the grid, so a filtered-out card leaves no cell.
 */
export default function ProjectsPage() {
  const { site, projects } = siteData();
  const heading = navLabel(site, '/projects', 'Projects');
  const gridId = 'project-grid';
  return (
    <section className="hm-wrap pj-index" aria-labelledby="projects-title">
      <header className="pj-index__head">
        <h1 className="pj-title" id="projects-title">
          {heading}
        </h1>
        <p className="pj-sub">{UI.projects.intro}</p>
      </header>
      <DomainFilter projects={projects} gridId={gridId} />
      <div id={gridId} className="pj-cards">
        {projects.map((project, i) => (
          <ProjectCard key={project.slug} project={project} headingLevel={2} priority={i < 3} sizes={CARD_SIZES.third} />
        ))}
      </div>
    </section>
  );
}
