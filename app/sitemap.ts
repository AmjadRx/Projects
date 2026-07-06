import type { MetadataRoute } from 'next';
import { loadProjects } from '@/lib/content';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://amjadrehawi.com';
  return [
    { url: base, changeFrequency: 'monthly', priority: 1 },
    { url: `${base}/projects`, changeFrequency: 'monthly', priority: 0.9 },
    ...loadProjects().map((p) => ({
      url: `${base}/projects/${p.slug}`,
      changeFrequency: 'monthly' as const,
      priority: p.featured ? 0.8 : 0.6,
    })),
  ];
}
