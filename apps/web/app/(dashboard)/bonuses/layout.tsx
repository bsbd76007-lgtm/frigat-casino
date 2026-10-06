import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Metadata shell for /bonuses — page.tsx is a client component. */
export const metadata: Metadata = {
  title: 'Bonuses',
  description: 'Deposit bonuses: a percentage on top of your first three deposits.',
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
