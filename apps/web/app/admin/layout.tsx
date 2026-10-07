import type { ReactNode } from 'react';
import { cookies } from 'next/headers';

import { AdminGate, type GateUser } from '@/app/admin/AdminGate';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';

import { SESSION_COOKIE, verifySession } from '@/lib/adminAuth';

import '@/app/admin/admin.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'FRIGAT — Admin',
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);

  const serverUser: GateUser | null =
    session.status === 'valid' || session.status === 'forbidden'
      ? { id: session.claims.userId, role: session.claims.role }
      : null;

  return (
    <AdminGate serverUser={serverUser}>
      <div className="admin">
        <AdminSidebar adminId={serverUser?.id} />
        <div className="admin__body">
          <AdminHeader adminId={serverUser?.id} />
          <main className="admin__main">{children}</main>
        </div>
      </div>
    </AdminGate>
  );
}
