import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Coinflip',
  description:
    'One toss, even odds and an instant result. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/coinflip' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
