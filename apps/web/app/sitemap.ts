import type { MetadataRoute } from 'next';

import { OPERATOR } from '@/lib/legal';
import { CATALOGUE } from '@/lib/gameCatalogue';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = OPERATOR.siteUrl;
  const now = new Date();

  const staticPages: { path: string; priority: number; frequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
    { path: '/', priority: 1, frequency: 'daily' },
    { path: '/architecture', priority: 0.7, frequency: 'monthly' },
    { path: '/promotions', priority: 0.7, frequency: 'weekly' },
    { path: '/partner-program', priority: 0.6, frequency: 'monthly' },
    { path: '/register', priority: 0.6, frequency: 'monthly' },
    { path: '/login', priority: 0.5, frequency: 'monthly' },
    { path: '/rules', priority: 0.5, frequency: 'monthly' },
    { path: '/terms', priority: 0.4, frequency: 'yearly' },
    { path: '/privacy', priority: 0.4, frequency: 'yearly' },
    { path: '/refunds', priority: 0.4, frequency: 'yearly' },
  ];

  return [
    ...staticPages.map(({ path, priority, frequency }) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: frequency,
      priority,
    })),
    ...CATALOGUE.map((game) => ({
      url: `${base}/games/${game.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
