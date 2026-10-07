import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Limbo',
  description:
    'Pick a target multiplier and win if the round clears the bar. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/limbo' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
