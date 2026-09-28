'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { api } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Dashboard', perm: 'analytics.read' },
  { href: '/routers', label: 'Routers', perm: 'routers.read' },
  { href: '/sites', label: 'Sites', perm: 'sites.read' },
  { href: '/vouchers', label: 'Vouchers', perm: 'vouchers.read' },
  { href: '/plans', label: 'Plans', perm: 'plans.read' },
  { href: '/team', label: 'Team', perm: 'team.read' },
  { href: '/audit', label: 'Audit', perm: 'audit.read' },
];

export default function DashLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  useEffect(() => {
    (async () => {
      try {
        const status = await api('/api/auth/status');
        if (status.setupNeeded) return router.replace('/setup');
        setMe(await api('/api/auth/me'));
      } catch {}
    })();
  }, [router]);
  if (!me) return <div className="min-h-screen flex items-center justify-center text-slate-500 font-mono text-xs">loading…</div>;
  const can = (p: string) =>
    me.user.isPlatformOwner ||
    (me.permissions?.global ?? []).includes(p) ||
    Object.values(me.permissions?.sites ?? {}).some((a: any) => (a as string[]).includes(p));
  const nav = NAV.filter((n) => can(n.perm));
  const opName = me.operators?.find((o: any) => o.id === me.operatorId)?.name ?? 'T-Connect';
  return (
    <div className="flex min-h-screen">
      <Sidebar nav={nav} showPeers={can('routers.read')} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-surface-low border-b border-surface-high px-8 flex items-center justify-between shrink-0">
          <div className="text-xs font-mono text-slate-400">
            {opName} · Lesotho <span className="text-slate-600">· Africa/Maseru</span>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-[10px] font-mono text-slate-400 uppercase">{me.user.isPlatformOwner ? 'Platform Owner' : 'Operator Staff'}</span>
            <div className="w-9 h-9 rounded-full bg-surface-base border border-surface-border flex items-center justify-center text-xs font-bold text-brand-orange">
              {me.user.email.slice(0, 2).toUpperCase()}
            </div>
            <button onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }}
              className="text-xs font-mono text-slate-400 hover:text-white">Sign out</button>
          </div>
        </header>
        <main className="flex-1 p-8 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}