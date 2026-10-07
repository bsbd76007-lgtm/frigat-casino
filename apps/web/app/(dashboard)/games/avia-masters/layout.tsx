import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Avia Masters',
  description:
    'Fly the deck run, collect multipliers and land before you ditch. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/avia-masters' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
