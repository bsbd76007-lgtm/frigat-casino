import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Mines',
  description:
    'Pick tiles, dodge the mines and bank your multiplier before one goes off. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/mines' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
