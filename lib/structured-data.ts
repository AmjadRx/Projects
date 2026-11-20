/**
 * The JSON-LD of the pages (ARCHITECTURE.md 5, "Also new"; docs/V3_PLAN.md D-41): `Person` on the
 * home page and `CreativeWork` on each visible project page, built only from fields that page
 * shows. An empty field is left out; there is never a telephone, and the owner is a contributor
 * to a project in the role the content gives, never its sole author (team work stays the team's).
 * lib/jsonld.ts serializes the result for the script element.
 */
import 'server-only';
import { hasText } from './format';
import { resolveMedia } from './media-server';
import { absoluteUrl } from './meta';
import { siteUrl, socialLinksFor } from './site';
import type { MediaRef, Project, Site } from './types';

/** The still a page paints for a media field: the photo itself, or the poster of a video or model. */
function stillOf(media: MediaRef | undefined): string | undefined {
  const resolved = resolveMedia(media);
  if (!resolved) return undefined;
  const src = resolved.kind === 'image' ? resolved.file.src : resolved.poster?.src;
  return hasText(src) ? src : undefined;
}

const PROFILE = /^https:\/\/(www\.)?(linkedin\.com|github\.com)\//i;

/**
 * The home page's `Person`: the name (in the nav), the sub-tagline (the hero), the email (the
 * footer), the school (the degree line, as an affiliation, not `alumniOf`, since the degree is in
 * progress), the photo (the about teaser), and the LinkedIn and GitHub profiles among the footer
 * links (`sameAs`; the scheduling link and the phone are not profiles).
 */
export function personJsonLd(site: Site) {
  const { personal } = site;
  const profiles = socialLinksFor(site, 'footer')
    .map((link) => link.url.trim())
    .filter((url) => PROFILE.test(url));
  const photo = stillOf(personal.photo);
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    ...(hasText(personal.name) ? { name: personal.name.trim() } : {}),
    url: siteUrl(),
    ...(hasText(personal.subTagline) ? { description: personal.subTagline.trim() } : {}),
    ...(hasText(personal.email) ? { email: `mailto:${personal.email.trim()}` } : {}),
    ...(hasText(personal.school) ? { affiliation: { '@type': 'CollegeOrUniversity', name: personal.school.trim() } } : {}),
    ...(photo ? { image: absoluteUrl(photo) } : {}),
    ...(profiles.length > 0 ? { sameAs: profiles } : {}),
  };
}

/**
 * A project page's `CreativeWork`: the title, the subtitle, the pitch, the page's address, the
 * owner as a contributor in the role the title block shows, the cover's still when there is one,
 * and REV (the title block's revision date) as the date it was last changed.
 */
export function creativeWorkJsonLd(site: Site, project: Project, rev?: string) {
  const name = site.personal.name.trim();
  const owner = { '@type': 'Person', ...(hasText(name) ? { name } : {}), url: siteUrl() };
  const cover = stillOf(project.cover);
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: project.title.trim(),
    ...(hasText(project.subtitle) ? { alternativeHeadline: project.subtitle.trim() } : {}),
    ...(hasText(project.pitch) ? { description: project.pitch.trim() } : {}),
    url: absoluteUrl(`/projects/${project.slug}`),
    contributor: hasText(project.role) ? { '@type': 'Role', roleName: project.role.trim(), contributor: owner } : owner,
    ...(cover ? { image: absoluteUrl(cover) } : {}),
    ...(hasText(rev) ? { dateModified: rev.trim() } : {}),
  };
}
