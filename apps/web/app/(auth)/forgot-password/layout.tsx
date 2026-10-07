import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Reset password',
  description:
    'Request a one-time code to reset the password on your FRIGAT account.',
  robots: { index: false, follow: true },
  alternates: { canonical: '/forgot-password' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
