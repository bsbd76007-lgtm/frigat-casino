import type { Metadata } from 'next';

import { RulesContent } from '@/app/(information)/rules/RulesContent';

export const metadata: Metadata = {
  title: 'Rules',
  description:
    'Terms of service, provably fair policy, age restriction, anti-money-laundering summary and game rules.',
  alternates: { canonical: '/rules' },
};

export default function RulesPage() {
  return <RulesContent />;
}
