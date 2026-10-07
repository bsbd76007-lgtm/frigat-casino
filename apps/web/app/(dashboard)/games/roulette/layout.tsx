import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Roulette',
  description:
    'Inside bets, outside bets and everything between, on a single-zero wheel. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/roulette' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
