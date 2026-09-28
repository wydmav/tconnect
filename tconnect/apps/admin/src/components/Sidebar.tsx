'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function Sidebar({ nav, showPeers }: { nav: { href: string; label: string }[]; showPeers: boolean }) {
  const path = usePathname();
  const [peers, setPeers] = useState<{ up: number; total: number } | null>(null);
  useEffect(() => {
    if (!showPeers) return;
    let alive = true;
    const run = async () => { try { const d = await api('/api/routers');
      if (alive) setPeers({ up: d.routers.filter((r: any) => r.online).length, total: d.routers.length }); } catch {} };
    run();
    const t = setInterval(run, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [showPeers]);
  return (
    <aside className="w-64 bg-surface-low border-r border-surface-high flex flex-col justify-between shrink-0 p-5 select-none">
      <div className="space-y-6">
        <div className="flex items-center space-x-3 p-2 rounded-xl bg-surface-base/70 border border-surface-border">
          <div className="w-10 h-10 rounded-xl bg-surface-lowest flex items-center justify-center border border-surface-border">
            <svg viewBox="0 0 100 100" className="w-8 h-8" fill="none">
              <circle cx="50" cy="50" r="32" stroke="#F05E17" strokeWidth="6" strokeDasharray="8 6" opacity="0.4"/>
              <circle cx="50" cy="50" r="22" stroke="#F05E17" strokeWidth="5" strokeLinecap="round"/>
              <path d="M50 34C58.8 34 66 41.2 66 50" stroke="#F05E17" strokeWidth="5" strokeLinecap="round"/>
              <circle cx="50" cy="50" r="8" fill="#10B981"/><circle cx="50" cy="50" r="4" fill="#FFF"/>
            </svg>
          </div>
          <div>
            <span className="text-sm font-extrabold tracking-tight text-white block leading-tight">T-CONNECT</span>
            <span className="text-[9px] tracking-widest uppercase font-bold text-brand-orange">Fleet Orchestrator</span>
          </div>
        </div>
        <nav className="space-y-1 text-sm font-medium">
          {nav.map((n) => (
            <Link key={n.href} href={n.href}
              className={`flex items-center px-3.5 py-2.5 rounded-xl font-bold transition ${path === n.href ? 'bg-brand-orange text-white shadow-lg shadow-brand-orange/20' : 'text-slate-400 hover:bg-surface-base hover:text-white'}`}>
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="bg-surface-base border border-surface-high rounded-xl p-3 text-xs font-mono">
        <div className="flex justify-between items-center text-[10px] text-slate-400 mb-1">
          <span>WIREGUARD SWARM</span>
          <span className={peers && peers.total > 0 && peers.up === peers.total ? 'text-emerald-400 font-bold' : 'text-slate-400 font-bold'}>
            {peers ? `${peers.up}/${peers.total} UP` : '—'}
          </span>
        </div>
        <p className="text-white text-[11px] truncate">central RADIUS · Lesotho</p>
      </div>
    </aside>
  );
}