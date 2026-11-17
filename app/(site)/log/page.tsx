import type { Metadata } from 'next';
import RevisionTable, { type RevisionRow } from '@/components/log/RevisionTable';
import { mergedLog } from '@/lib/log';
import { resolveMedia } from '@/lib/media-server';
import { pageMetadata } from '@/lib/meta';
import { navLabel, siteData } from '@/lib/site';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { title: navLabel(site, '/log', 'Build log'), description: site.seo.description, path: '/log' });
}

/** Every log entry from every visible project, merged, newest first, as one revision table (ARCHITECTURE.md 5). */
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
  return (
    <div className="wrap py-12 md:py-16">
      <h1 className="display-2">{navLabel(site, '/log', 'Build log')}</h1>
      <div className="mt-10">
        <RevisionTable rows={rows} resolveLink={resolveLink} anchorPrefix="rev-" showProject />
      </div>
    </div>
  );
}
