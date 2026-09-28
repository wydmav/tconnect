'use client';
import { ReactNode, useEffect, useState } from 'react';

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <div className={`bg-surface-low border border-surface-high rounded-2xl ${className}`}>{children}</div>;
export const Badge = ({ children, color = '#f05e17' }: { children: ReactNode; color?: string }) =>
  <span className="px-2 py-0.5 rounded border text-[10px] font-mono font-bold"
    style={{ color, borderColor: `${color}55`, backgroundColor: `${color}14` }}>{children}</span>;
export const Stat = ({ label, children, sub }: { label: string; children: ReactNode; sub?: string }) =>
  <Card className="p-5">
    <span className="text-[10px] uppercase text-slate-400 font-mono font-bold tracking-wider">{label}</span>
    <div className="mt-2 text-3xl font-extrabold text-white font-mono">{children}</div>
    {sub && <p className="text-[11px] text-slate-500 font-mono mt-2">{sub}</p>}
  </Card>;
export const Dot = ({ on }: { on: boolean }) =>
  <span className={`inline-block w-2 h-2 rounded-full ${on ? 'bg-emerald-400' : 'bg-slate-600'}`} />;
export function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
    className="px-3 py-1.5 bg-brand-orange hover:bg-brand-orangeDark text-white rounded-xl text-xs font-bold transition">{done ? 'Copied ✓' : label}</button>;
}
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-surface-low border border-surface-border rounded-2xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="flex justify-between items-center mb-4"><h3 className="font-extrabold text-white">{title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button></div>
      {children}
    </div></div>;
}
export const Field = ({ label, children }: { label: string; children: ReactNode }) =>
  <label className="block text-xs font-mono text-slate-400 mb-1">{label}<div className="mt-1">{children}</div></label>;
export const inputCls = 'w-full px-3 py-2 bg-surface-base border border-surface-border rounded-xl text-sm text-white focus:outline-none focus:border-brand-orange font-mono';
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => { let alive = true; const run = async () => { try { const d = await fn(); if (alive) setData(d); } catch {} };
    run(); const t = setInterval(run, ms); return () => { alive = false; clearInterval(t); }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return data;
}