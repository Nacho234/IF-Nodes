import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/shell/sidebar';
import { serverApiGet } from '@/lib/server-api';
import type { Me } from '@/lib/types';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await serverApiGet<Me>('/auth/me');
  if (!me) {
    redirect('/login');
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar me={me} />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
