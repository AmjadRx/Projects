import { Suspense } from 'react';
import type { Metadata } from 'next';
import Glass from '@/components/sheet/Glass';
import RevisionTable, { type RevisionRow } from '@/components/sheet/RevisionTable';
import TextLink from '@/components/sheet/TextLink';
import { mergedLog } from '@/lib/log';
import { resolveMedia } from '@/lib/media-server';
import { pageMetadata } from '@/lib/meta';
import { homeMetaImage } from '@/lib/og/meta';
import { navLabel, siteData } from '@/lib/site';
import { UI } from '@/lib/strings';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { title: navLabel(site, '/log', 'Build log'), description: site.seo.description, path: '/log', image: homeMetaImage(site) });
}

/**
 * Every log entry from every visible project, merged, newest first, as one revision table with
 * links to the projects (ARCHITECTURE.md 5), on glass under the title and its line (the Log board).
 * With no entry at all the page says so and points to the projects (the States board).
 */
export default function LogPage() {
  const { site, projects, resolveLink } = siteData();
  const rows: RevisionRow[] = mergedLog(projects).map((entry) => ({
    key: `${entry.project.slug}-${entry.blockId}-${entry.index}`,
    date: entry.date,
    title: entry.title,
    md: entry.md,
    media: entry.media.map(resolveMedia).filter((m) => m !== null),
    project: { title: entry.project.title, href: `/projects/${entry.project.slug}` },
  }));
  const allProjects = resolveLink('/projects');
  return (
    <div className="hm-wrap st-page">
      <header className="st-head">
        <h1 className="st-title">{navLabel(site, '/log', 'Build log')}</h1>
        <p className="st-sub">{UI.log.intro}</p>
      </header>
      {rows.length > 0 ? (
        // In a Suspense boundary: hydrated after the head, in short slices (ARCHITECTURE.md 9: TBT).
        <Suspense>
          <Glass className="st-log">
            <RevisionTable rows={rows} resolveLink={resolveLink} anchorPrefix="rev-" showProject />
          </Glass>
        </Suspense>
      ) : (
        <Glass className="st-log-empty">
          <p>{UI.log.empty}</p>
          {allProjects ? (
            <TextLink href={allProjects.href} variant="standalone">
              {UI.log.seeProjects}
            </TextLink>
          ) : null}
        </Glass>
      )}
    </div>
  );
}
