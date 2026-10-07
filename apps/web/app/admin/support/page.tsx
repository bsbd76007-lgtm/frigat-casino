import { SupportConsole } from '@/app/admin/support/SupportConsole';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AdminSupportPage() {
  return (
    <>
      <header className="admin__head">
        <h1 className="admin__title">Live Support</h1>
        <p className="admin__sub">
          Open conversations, newest activity first. Replies reach the player
          immediately if they have the site open, and wait in their widget if
          they do not.
        </p>
      </header>

      <SupportConsole />
    </>
  );
}
