import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

/**
 * robots.txt: every crawler may read the site, and the file points to the sitemap, which lists the
 * visible pages only (app/sitemap.ts). It names no private path: /admin and the development pages
 * carry noindex in their own metadata, which a crawler can only see on a page it may read (a page
 * blocked here can still be listed from a link elsewhere), /api serves no page, and naming them in
 * a public file would only point to them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
