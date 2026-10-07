import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Keno',
  description:
    'Pick your numbers and watch the draw come in. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/keno' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
