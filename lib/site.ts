/**
 * What every public page needs, built on the server from content/: the site file, the visible
 * projects in order, and the link resolver. Client components receive small objects built from
 * these, never whole records (docs/V3_PLAN.md D-06).
 */
import 'server-only';
import { loadPublicProjects, loadSite } from './content';
import { hasText } from './format';
import { makeLinkResolver, type LinkResolver } from './links';
import { DEFAULT_SITE_URL, pointsIntoRepository, siteHostsOf } from './lint';
import type { Project, Site, SocialLink } from './types';

export interface SiteData {
  site: Site;
  /** Visible projects, ordered by `order`. Hidden projects never appear here. */
  projects: Project[];
  visibleSlugs: ReadonlySet<string>;
  resolveLink: LinkResolver;
}

export function siteData(): SiteData {
  const site = loadSite();
  const projects = loadPublicProjects();
  const visibleSlugs = new Set(projects.map((p) => p.slug));
  const resolveLink = makeLinkResolver(visibleSlugs, {
    siteHosts: siteHostsOf(siteUrl()),
    phoneShown: hasText(site.personal.phone),
    siteRepository: siteRepository(),
  });
  return { site, projects, visibleSlugs, resolveLink };
}

/** The production address, for metadata, JSON-LD, and the sitemap. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (configured && /^https?:\/\//.test(configured) ? configured : DEFAULT_SITE_URL).replace(/\/+$/, '');
}

/** This site's own repository ("Owner/Name"), which no public link may point into (D-22). */
export function siteRepository(): string | undefined {
  const value = (process.env.GITHUB_REPO ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
  return value || undefined;
}

export interface NavItem {
  label: string;
  href: string;
  external: boolean;
}

/**
 * The nav items, each through the link resolver: an item that leads to no page (a hidden project,
 * a mistyped path) or to an unsafe address is left out, so it never reaches the HTML or the props
 * of the menu (docs/V3_PLAN.md D-06).
 */
export function navItemsFor(site: Site, resolveLink: LinkResolver): NavItem[] {
  return site.nav.flatMap((item) => {
    if (!hasText(item.label)) return [];
    const target = resolveLink(item.href);
    return target ? [{ label: item.label.trim(), href: target.href, external: target.external }] : [];
  });
}

/**
 * The social links for one place on the site. Email comes only from `personal.email`, so
 * `mailto:` entries are skipped; a phone link hides when `personal.phone` is empty
 * (docs/V3_PLAN.md D-14, D-64).
 */
export function socialLinksFor(site: Site, place: 'nav' | 'footer' | 'contact'): SocialLink[] {
  const flag = place === 'nav' ? 'showInNav' : place === 'footer' ? 'showInFooter' : 'showInContact';
  return site.socialLinks.filter((link) => {
    if (!link[flag] || !hasText(link.label) || !hasText(link.url)) return false;
    const url = link.url.trim().toLowerCase();
    if (url.startsWith('mailto:')) return false;
    if (url.startsWith('tel:') && !hasText(site.personal.phone)) return false;
    if (pointsIntoRepository(link.url, siteRepository())) return false;
    return url.startsWith('https://') || url.startsWith('http://') || url.startsWith('tel:');
  });
}

/** The visible project a path points at, or undefined. */
export function projectBySlug(projects: Project[], slug: string): Project | undefined {
  return projects.find((p) => p.slug === slug);
}

/** The nav label for a path, used as that page's heading and title ("Build log" for /log). */
export function navLabel(site: Site, href: string, fallback: string): string {
  const item = site.nav.find((n) => n.href.replace(/\/+$/, '') === href);
  return item && hasText(item.label) ? item.label : fallback;
}
