import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Chicken Road',
  description:
    'Cross the lanes one step at a time and bank before the traffic catches you. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/chicken' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
