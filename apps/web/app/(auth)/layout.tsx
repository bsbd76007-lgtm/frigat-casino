import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/Toaster';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      {children}
      <Toaster />
    </div>
  );
}
