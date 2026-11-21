/**
 * The command palette's index (ARCHITECTURE.md 5, "Also new"; the bundle's CommandPalette and the
 * Palette boards): every page, every visible project, and every section of a project page, built
 * on the server from the seed through the site's own loaders (lib/site.ts `siteData`): the visible
 * projects in order, the nav's items and labels, and the link resolver. A hidden project, a nav item
 * that leads nowhere, and an empty heading never enter it, so none can reach the browser
 * (docs/V3_PLAN.md D-06).
 *
 * A section is what the Palette boards list under "Sections": a project page's heading block, named
 * "Project: Heading" and reached by its anchor, which is the block's id (components/blocks/
 * HeadingBlock.tsx). The bundle's three groups come in its order: Pages, Projects, Sections.
 *
 * The index reaches the browser as one static file, /palette.json (app/palette.json/route.ts),
 * fetched the first time the palette is wanted, not as props: props would print it into the
 * HTML of every page, a first load that grows with every heading the owner adds, for a tool most
 * visits never open. As a file it is built once per deployment, cached by the browser, kept out of
 * the page source, and fetched on demand beside the palette's own code (components/palette/load.ts).
 */
import 'server-only';
import { blockHasContent } from './blocks';
import { hasText } from './format';
import { isKnownBlock } from './schema';
import { navItemsFor, siteData, siteRepository, type SiteData } from './site';
import { UI } from './strings';
import type { Block } from './types';

/** One result: what it says, the line beside it, and where it goes. */
export interface PaletteItem {
  /** A page's nav label, a project's title, or "Project: Heading". */
  label: string;
  /** "Page", "Sheet 2 of 12", or "Section". */
  meta: string;
  /** A site path, as the link resolver gives it; a section adds its anchor. */
  href: string;
}

export interface PaletteGroup {
  /** "Pages", "Projects", or "Sections". */
  label: string;
  items: PaletteItem[];
}

export interface PaletteIndex {
  /** The groups in the bundle's order; a group with nothing in it is left out. */
  groups: PaletteGroup[];
  /** The nav's page names, which the empty state offers ("Try a project name or a page: ..."). */
  pages: string[];
}

/** The home page, which the nav reaches through the name rather than an item. */
const HOME = '/';

/**
 * A project's sections: its heading blocks with text, in the order the project page draws them,
 * the two columns of a twoCol block included (left, then right), skipping what the page skips
 * (an unknown block type, a block with nothing to show; components/blocks/BlockRenderer.tsx).
 */
export function headingsOf(blocks: readonly Block[], repository?: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const walk = (list: readonly Block[]) => {
    for (const block of list) {
      if (!isKnownBlock(block) || !blockHasContent(block, repository)) continue;
      if (block.type === 'heading') out.push({ id: block.id, text: block.text.trim() });
      else if (block.type === 'twoCol') {
        walk(block.left);
        walk(block.right);
      }
    }
  };
  walk(blocks);
  return out;
}

/**
 * The index from the site's data. Pages: home, then the nav's items that stay on the site, each
 * through the resolver (navItemsFor drops an item that leads to no page). Projects: the visible ones
 * in order, each with its sheet number as the title block counts it. Sections: each visible
 * project's headings, in project order.
 */
export function buildPaletteIndex(data: Pick<SiteData, 'site' | 'projects' | 'resolveLink'>, repository?: string): PaletteIndex {
  const { site, projects, resolveLink } = data;
  const nav = navItemsFor(site, resolveLink).filter((item) => !item.external);

  const pages: PaletteItem[] = [];
  const seen = new Set<string>();
  const addPage = (label: string, href: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    pages.push({ label, meta: UI.palette.page, href });
  };
  const home = resolveLink(HOME);
  if (home && !nav.some((item) => item.href === home.href)) addPage(UI.site.home, home.href);
  for (const item of nav) addPage(item.label, item.href);

  const projectItems: PaletteItem[] = [];
  const sectionItems: PaletteItem[] = [];
  projects.forEach((project, index) => {
    const target = resolveLink(`/projects/${project.slug}`);
    if (!target || !hasText(project.title)) return;
    const title = project.title.trim();
    projectItems.push({ label: title, meta: UI.projects.sheetOf(index + 1, projects.length), href: target.href });
    for (const heading of headingsOf(project.blocks, repository)) {
      sectionItems.push({
        label: UI.palette.sectionOf(title, heading.text),
        meta: UI.palette.section,
        href: `${target.href}#${encodeURIComponent(heading.id)}`,
      });
    }
  });

  const groups: PaletteGroup[] = [
    { label: UI.palette.groups.pages, items: pages },
    { label: UI.palette.groups.projects, items: projectItems },
    { label: UI.palette.groups.sections, items: sectionItems },
  ].filter((group) => group.items.length > 0);

  return { groups, pages: nav.map((item) => item.label) };
}

/** The index of the site as built: what /palette.json serves. */
export function paletteIndex(): PaletteIndex {
  return buildPaletteIndex(siteData(), siteRepository());
}
