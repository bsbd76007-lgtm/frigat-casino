import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Plinko',
  description:
    'Drop the ball through the pegs and ride it into a multiplier slot. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/plinko' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
