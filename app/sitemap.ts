import type { MetadataRoute } from 'next';
import { lastContentUpdate, projectRevDate } from '@/lib/history';
import { siteData, siteUrl } from '@/lib/site';

/** Visible pages only: the static routes, /log, and every visible project (docs/V3_PLAN.md D-65). */
export default function sitemap(): MetadataRoute.Sitemap {
  const { projects } = siteData();
  const base = siteUrl();
  const updated = lastContentUpdate(projects.map((p) => p.slug));
  const staticRoutes = ['/', '/projects', '/about', '/experience', '/log', '/contact'];
  return [
    ...staticRoutes.map((route) => ({
      url: `${base}${route === '/' ? '' : route}`,
      ...(updated ? { lastModified: updated } : {}),
    })),
    ...projects.map((project) => {
      const rev = projectRevDate(project.slug);
      return { url: `${base}/projects/${project.slug}`, ...(rev ? { lastModified: rev } : {}) };
    }),
  ];
}
