import type { MetadataRoute } from 'next';

import { OPERATOR } from '@/lib/legal';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/',
          '/favorites',
          '/referrals',
          '/bonuses',
          '/vip',
          '/api/',
          '/forgot-password',
        ],
      },
    ],
    sitemap: `${OPERATOR.siteUrl}/sitemap.xml`,
    host: OPERATOR.siteUrl,
  };
}
