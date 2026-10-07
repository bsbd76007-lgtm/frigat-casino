import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Partner program',
  description:
    'The FRIGAT affiliate programme: revenue share rates, attribution rules and payout terms.',
  alternates: { canonical: '/partner-program' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
