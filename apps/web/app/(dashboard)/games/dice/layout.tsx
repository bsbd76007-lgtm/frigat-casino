import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Dice',
  description:
    'Set your target number and call the roll over or under it. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/dice' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
