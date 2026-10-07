import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Slots',
  description:
    'Five reels, five paylines and one lever. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/slots' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
