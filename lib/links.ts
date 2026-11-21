/**
 * Link resolution for content links. A link to a page the site does not render (a hidden
 * project, a mistyped path) becomes plain text, so a hidden project leaves no trace in the HTML
 * (docs/V3_PLAN.md D-06). The content check reports the same links before they are saved.
 */
import { pointsIntoRepository, resolvesToPage, sitePathOf } from './lint';

export interface LinkTarget {
  href: string;
  /** True when the link leaves the site. */
  external: boolean;
}

export type LinkResolver = (href: string | undefined) => LinkTarget | null;

export interface LinkRules {
  /**
   * Host names that mean this site. An absolute link to one of them is resolved like a site
   * path, so `https://amjadrehawi.com/projects/<hidden>` is hidden like `/projects/<hidden>`.
   */
  siteHosts?: readonly string[];
  /** False when `personal.phone` is empty: every `tel:` link then prints as plain text (D-14). */
  phoneShown?: boolean;
  /** This site's own repository ("Owner/Name"), which is never linked (D-22). */
  siteRepository?: string;
}

const FILE_PREFIXES = ['/media/', '/dev/'];

export function makeLinkResolver(visibleSlugs: ReadonlySet<string>, rules: LinkRules = {}): LinkResolver {
  return (raw) => {
    let href = raw?.trim();
    if (!href) return null;
    if (href.startsWith('#')) return { href, external: false };
    if (/^mailto:/i.test(href)) return { href, external: false };
    if (/^tel:/i.test(href)) return rules.phoneShown === false ? null : { href, external: false };
    if (/^https?:\/\//i.test(href)) {
      const ownPath = sitePathOf(href, rules.siteHosts ?? []);
      if (ownPath === null) {
        if (pointsIntoRepository(href, rules.siteRepository)) return null;
        return { href, external: true };
      }
      href = ownPath;
    }
    const path = href;
    if (path.startsWith('/') && !path.startsWith('//')) {
      if (resolvesToPage(path, visibleSlugs)) return { href: path, external: false };
      if (FILE_PREFIXES.some((prefix) => path.startsWith(prefix))) return { href: path, external: false };
    }
    return null;
  };
}

/** The slug of a project path ("/projects/raven#log" gives "raven"), or null. */
export function projectSlugOf(href: string): string | null {
  const match = /^\/projects\/([a-z0-9-]+)(?:[/?#]|$)/.exec(href.trim());
  return match ? match[1] : null;
}
