export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function findProjectBySlug<T extends { slug: string }>(
  projects: T[],
  slug: string,
): T | undefined {
  return projects.find((p) => p.slug === slug);
}
