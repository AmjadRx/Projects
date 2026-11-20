/**
 * The cards of this site's images, from the visible content only (lib/site.ts siteData): the home
 * card, and one card per visible project, numbered among the visible projects. A hidden or unknown
 * slug has no card.
 */
import 'server-only';
import { projectRevDate } from '../history';
import { siteData } from '../site';
import { homeCard, projectCard, type HomeCard, type ProjectCard } from './cards';

export function siteHomeCard(): HomeCard {
  return homeCard(siteData().site);
}

export function siteProjectCard(slug: string): ProjectCard | null {
  const { projects } = siteData();
  const index = projects.findIndex((p) => p.slug === slug);
  if (index < 0) return null;
  return projectCard(projects[index], index + 1, projects.length, projectRevDate(slug));
}

/** The slugs that get an image: the visible projects, as the pages' own generateStaticParams lists them. */
export function imageSlugs(): { slug: string }[] {
  return siteData().projects.map((p) => ({ slug: p.slug }));
}
