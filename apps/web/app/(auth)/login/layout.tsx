import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Sign in',
  description:
    'Sign in to your FRIGAT account.',
  alternates: { canonical: '/login' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
