'use client';
import { api, fmtTime } from '@/lib/api';
import { Badge, usePoll } from '@/components/ui';

export default function AuditPage() {
  const data = usePoll(() => api('/api/stats/audit'), 10000);
  const color = (a: string) => a.includes('delete') || a.includes('remove') || a.includes('retire') || a.includes('revoke')
    ? '#ef4444' : a.includes('create') || a.includes('adopt') || a.includes('accept') ? '#10b981' : '#f05e17';
  return (
    <div className="space-y-6">
      <div><h1 className="text-xl font-extrabold text-white">Audit log</h1>
        <p className="text-xs text-slate-400 font-mono">every privileged action, who did it, from where</p></div>
      <div className="bg-surface-low border border-surface-high rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead><tr className="text-slate-500 uppercase text-[10px] border-b border-surface-high">
            <th className="p-3">WHEN</th><th>ACTION</th><th>ACTOR</th><th>ENTITY</th><th>IP</th><th>DATA</th></tr></thead>
          <tbody className="divide-y divide-surface-high text-slate-300">
            {(data?.entries ?? []).map((e: any, i: number) => (
              <tr key={i}>
                <td className="p-3 whitespace-nowrap">{fmtTime(e.created_at)}</td>
                <td><Badge color={color(e.action)}>{e.action}</Badge></td>
                <td className="text-white">{e.actor ?? 'system/router'}</td>
                <td>{e.entity_type ? `${e.entity_type} ${e.entity_id ?? ''}` : '—'}</td>
                <td>{e.ip ?? '—'}</td>
                <td className="max-w-xs truncate text-slate-500">{JSON.stringify(e.data)}</td>
              </tr>
            ))}
            {!data?.entries?.length && <tr><td colSpan={6} className="p-8 text-center text-slate-500">no entries yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}