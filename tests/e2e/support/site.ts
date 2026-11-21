/**
 * What the suite visits, read from the content the site is built from (lib/content.ts, which
 * follows SITE_CONTENT_DIR as the build does): every public route of ARCHITECTURE.md 5, each
 * visible project page in the site's order, and an address that is no page at all. A hidden
 * project has no page, so it is not visited; the build tests (tests/build/hiding.test.ts) prove it
 * leaves no trace.
 */
import { loadPublicProjects, loadSite } from '../../../lib/content';
import { THEME_COOKIE, THEMES, themeFromSetting, type Theme } from '../../../lib/theme';

export { THEME_COOKIE, THEMES, type Theme };

export interface Route {
  /** The route's name in test titles. */
  name: string;
  path: string;
  /** The status the server answers with. */
  status: number;
}

/** An address that is no page: the not-found page answers it. */
export const NOT_FOUND_PATH = '/e2e-no-such-sheet';

/** A project address that is no project (only visible projects get a page). */
export const NOT_FOUND_PROJECT_PATH = '/projects/e2e-no-such-project';

export const site = loadSite();
export const projects = loadPublicProjects();

export const ROUTES: Route[] = [
  { name: 'home', path: '/', status: 200 },
  { name: 'projects', path: '/projects', status: 200 },
  ...projects.map((project) => ({ name: `project ${project.slug}`, path: `/projects/${project.slug}`, status: 200 })),
  { name: 'about', path: '/about', status: 200 },
  { name: 'experience', path: '/experience', status: 200 },
  { name: 'log', path: '/log', status: 200 },
  { name: 'contact', path: '/contact', status: 200 },
  { name: 'not found', path: NOT_FOUND_PATH, status: 404 },
];

/** A route as test titles name it: "home (/)". */
export function routeTitle(route: Route): string {
  return `${route.name} (${route.path})`;
}

/** How many items with a file a block holds when it is a gallery; 0 for any other block. */
function galleryItems(block: unknown): number {
  if (!block || typeof block !== 'object') return 0;
  const { type, items } = block as { type?: unknown; items?: unknown };
  if (type !== 'gallery' || !Array.isArray(items)) return 0;
  return items.filter((item) => typeof item?.src === 'string' && item.src.trim() !== '').length;
}

/** The visible project pages that show a gallery. */
export const GALLERY_PAGES: Route[] = projects
  .filter((project) => project.blocks.some((block) => galleryItems(block) > 0))
  .map((project) => ({ name: `project ${project.slug}`, path: `/projects/${project.slug}`, status: 200 }));

/** The four widths of ARCHITECTURE.md 15, item 4. */
export const WIDTHS = [390, 768, 1024, 1440] as const;
export type Width = (typeof WIDTHS)[number];

/** The phone and the desktop: the two widths of the checks that do not need all four. */
export const PHONE: Width = 390;
export const DESKTOP: Width = 1440;

const HEIGHTS: Record<Width, number> = { 390: 844, 768: 1024, 1024: 768, 1440: 900 };

/**
 * The window at a width, as scripts/screenshots.mjs opens it: a phone at 390 px (touch and the
 * mobile viewport), a tablet at 768 and 1024 px (touch), and a desktop at 1440 px. One device
 * pixel per CSS pixel, which is enough for every check here and keeps the runs light.
 */
export function device(width: Width) {
  return {
    viewport: { width, height: HEIGHTS[width] },
    deviceScaleFactor: 1,
    isMobile: width < 768,
    hasTouch: width < 1024,
  };
}

/** The theme the server renders before the visitor's cookie is read: the content's default. */
export const DEFAULT_THEME: Theme = themeFromSetting(site.settings.themeDefault);
