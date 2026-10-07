import type { Metadata } from 'next';

import { ArchitectureContent } from '@/app/(information)/architecture/ArchitectureContent';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'How a FRIGAT round is decided: committed seeds, server-side outcomes, and an exact-decimal ledger you can audit.',
  alternates: { canonical: '/architecture' },
};

export default function ArchitecturePage() {
  return <ArchitectureContent />;
}
