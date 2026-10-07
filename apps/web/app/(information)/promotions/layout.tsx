import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Promotions',
  description:
    'Current bonuses, raffles and promotional offers, with the terms that apply to each.',
  alternates: { canonical: '/promotions' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
