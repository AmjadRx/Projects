import type { Metadata } from 'next';
import DomainFilter, { type DomainOption } from '@/components/projects/DomainFilter';
import ProjectCard from '@/components/projects/ProjectCard';
import { domainKey, projectDomains } from '@/lib/format';
import { pageMetadata } from '@/lib/meta';
import { navLabel, siteData } from '@/lib/site';
import { UI } from '@/lib/strings';
import type { Project } from '@/lib/types';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { title: navLabel(site, '/projects', 'Projects'), description: site.seo.description, path: '/projects' });
}

/** Domains grouped without regard to case, labelled with their first spelling (docs/V3_PLAN.md Q-11). */
function domainOptions(projects: Project[]): DomainOption[] {
  const map = new Map<string, DomainOption>();
  for (const project of projects) {
    const seen = new Set<string>();
    for (const domain of projectDomains(project)) {
      const key = domainKey(domain);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { key, label: domain, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

export default function ProjectsPage() {
  const { site, projects } = siteData();
  const heading = navLabel(site, '/projects', 'Projects');
  const gridId = 'project-grid';
  return (
    <div className="wrap py-12 md:py-16">
      <h1 className="display-2">{heading}</h1>
      <p className="body-lg mt-3 max-w-2xl">{UI.projects.intro}</p>
      <div className="mt-8">
        <DomainFilter gridId={gridId} options={domainOptions(projects)} total={projects.length} />
      </div>
      <div id={gridId} className="mt-8 grid gap-6 md:grid-cols-2">
        {projects.map((project, i) => (
          <ProjectCard key={project.slug} project={project} headingLevel={2} priority={i < 2} />
        ))}
      </div>
    </div>
  );
}
