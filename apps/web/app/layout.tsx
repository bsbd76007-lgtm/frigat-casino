import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { Providers } from '@/app/providers';
import { THEME_SCRIPT } from '@/components/providers/ThemeProvider';
import { Footer } from '@/components/nav/Footer';
import { CloudflareGuard } from '@/components/common/CloudflareGuard';
import { CookieConsent } from '@/components/common/CookieConsent';
import { Analytics } from '@/components/common/Analytics';
import { OPERATOR } from '@/lib/legal';

export const metadata: Metadata = {
  metadataBase: new URL(OPERATOR.siteUrl),

  title: {
    default: 'FRIGAT — Provably fair casino games',
    template: '%s — FRIGAT',
  },
  description:
    'Provably fair casino games with verifiable outcomes. Every roll, drop and card is committed to a published seed hash before it is dealt, so any round can be checked after the fact.',
  applicationName: 'FRIGAT',
  keywords: [
    'provably fair casino',
    'provably fair games',
    'crypto casino',
    'online casino',
    'crash game',
    'plinko',
    'mines',
    'dice',
    'limbo',
    'keno',
    'roulette',
    'coin flip',
    'slots',
    'chicken road',
    'avia masters',
    'verifiable outcomes',
    'FRIGAT',
  ],
  authors: [{ name: 'FRIGAT', url: OPERATOR.siteUrl }],
  creator: 'FRIGAT',
  publisher: 'FRIGAT',
  category: 'games',
  alternates: { canonical: '/' },
  formatDetection: { email: false, address: false, telephone: false },

  openGraph: {
    type: 'website',
    siteName: 'FRIGAT',
    title: 'FRIGAT — Provably fair casino games',
    description:
      'Every outcome is committed to a published seed hash before the round is dealt, so it can be verified afterwards.',
    url: '/',
    locale: 'en_US',
    alternateLocale: ['ru_RU'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FRIGAT — Provably fair casino games',
    description:
      'Every outcome is committed to a published seed hash before the round is dealt, so it can be verified afterwards.',
  },

  icons: {
    icon: [{ url: '/frigat-monogram.png', type: 'image/png' }],
    shortcut: [{ url: '/frigat-monogram.png', type: 'image/png' }],
    apple: [{ url: '/frigat-monogram.png' }],
  },

  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
  },

  other: { rating: 'adult' },

  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-theme="dark" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <CloudflareGuard>
            {children}
            <Footer />
            <CookieConsent />
            <Analytics />
          </CloudflareGuard>
        </Providers>
      </body>
    </html>
  );
}
