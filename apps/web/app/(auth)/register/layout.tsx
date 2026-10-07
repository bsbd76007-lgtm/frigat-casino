import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Create account',
  description:
    'Open a FRIGAT account. You must be 18 or over to play.',
  alternates: { canonical: '/register' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
