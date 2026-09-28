'use client';
import { useState } from 'react';
import { api, ago } from '@/lib/api';
import { Badge, Copy, Field, Modal, inputCls, usePoll } from '@/components/ui';

export default function TeamPage() {
  const members = usePoll(() => api('/api/team/members'), 20000);
  const invites = usePoll(() => api('/api/team/invites'), 20000);
  const rolesResp = usePoll(() => api('/api/roles'), 60000);
  const sites = usePoll(() => api('/api/sites'), 60000);
  const [invOpen, setInvOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [inv, setInv] = useState({ email: '', roleKey: 'viewer', scopeType: 'global', siteId: '' });
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [scope, setScope] = useState<Record<string, string>>({});
  const [siteSel, setSiteSel] = useState<Record<string, string>>({});

  const systemRoles = rolesResp?.roles ?? [];
  const siteList = sites?.sites ?? [];

  const openEdit = (m: any) => {
    const s: Record<string, boolean> = {}, sc: Record<string, string> = {}, st: Record<string, string> = {};
    for (const r of m.roles ?? []) { s[r.role] = true; sc[r.role] = r.scope; st[r.role] = r.siteId ? String(r.siteId) : ''; }
    setSel(s); setScope(sc); setSiteSel(st); setEditUser(m);
  };
  const saveRoles = async () => {
    setErr('');
    const roles = systemRoles.filter((r: any) => sel[r.key]).map((r: any) => ({
      roleKey: r.key,
      scopeType: scope[r.key] === 'site' ? 'site' : 'global',
      siteId: scope[r.key] === 'site' ? Number(siteSel[r.key]) || undefined : undefined,
    }));
    if (!roles.length) return setErr('select at least one role');
    try { await api(`/api/team/members/${editUser.id}/roles`, { method: 'PATCH', body: { roles } }); setEditUser(null); }
    catch (e: any) { setErr(e.message); }
  };
  const createInvite = async () => {
    setErr(''); setLink(null);
    try {
      const r = await api('/api/team/invites', { method: 'POST', body: {
        email: inv.email, roleKey: inv.roleKey, scopeType: inv.scopeType,
        siteId: inv.scopeType === 'site' ? Number(inv.siteId) : undefined } });
      setLink(r.link); setInvOpen(false);
    } catch (e: any) { setErr(e.message); }
  };
  const statusColor = (s: string) => s === 'pending' ? '#f05e17' : s === 'accepted' ? '#10b981' : s === 'expired' ? '#a855f7' : '#64748b';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-extrabold text-white">Team</h1>
          <p className="text-xs text-slate-400 font-mono">members gain access only by accepting a single-use invite link</p></div>
        <button onClick={() => { setLink(null); setInvOpen(true); }} className="px-4 py-2 bg-brand-orange hover:bg-brand-orangeDark text-white rounded-xl text-xs font-bold">+ Invite member</button>
      </div>

      <div className="bg-surface-low border border-surface-high rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead><tr className="text-slate-500 uppercase text-[10px] border-b border-surface-high">
            <th className="p-3">MEMBER</th><th>ROLES</th><th>LAST LOGIN</th><th>ACTIONS</th></tr></thead>
          <tbody className="divide-y divide-surface-high text-slate-300">
            {(members?.members ?? []).map((m: any) => (
              <tr key={m.id}>
                <td className="p-3 text-white font-bold">{m.name || m.email}<div className="text-[10px] text-slate-500">{m.email}</div></td>
                <td className="space-x-1">{(m.roles ?? []).map((r: any, i: number) =>
                  <Badge key={i} color={r.scope === 'site' ? '#06b6d4' : '#f05e17'}>{r.roleName}{r.scope === 'site' ? ' · site' : ''}</Badge>)}</td>
                <td>{ago(m.last_login_at)}</td>
                <td className="space-x-2">
                  <button className="text-cyan-400 hover:underline" onClick={() => openEdit(m)}>roles</button>
                  <button className="text-red-400 hover:underline" onClick={async () => {
                    if (confirm(`Remove ${m.email} from this operator?`)) await api(`/api/team/members/${m.id}`, { method: 'DELETE' }); }}>remove</button>
                </td>
              </tr>
            ))}
            {!members?.members?.length && <tr><td colSpan={4} className="p-8 text-center text-slate-500">no members yet</td></tr>}
          </tbody>
        </table>
      </div>

      <Card2 title="Invites">
        <table className="w-full text-left text-xs font-mono">
          <thead><tr className="text-slate-500 uppercase text-[10px] border-b border-surface-high">
            <th className="p-3">EMAIL</th><th>ROLE</th><th>STATUS</th><th>EXPIRES</th><th>ACTIONS</th></tr></thead>
          <tbody className="divide-y divide-surface-high text-slate-300">
            {(invites?.invites ?? []).map((i: any) => (
              <tr key={i.id}>
                <td className="p-3 text-white">{i.email}</td>
                <td>{i.role_name}</td>
                <td><Badge color={statusColor(i.status)}>{i.status}</Badge></td>
                <td>{i.status === 'pending' ? ago(i.expires_at).replace(' ago', '') : '—'}</td>
                <td className="space-x-2">
                  {i.status !== 'accepted' && i.status !== 'revoked' && <>
                    <button className="text-cyan-400 hover:underline" onClick={async () =>
                      setLink((await api(`/api/team/invites/${i.id}/resend`, { method: 'POST' })).link)}>resend</button>
                    <button className="text-red-400 hover:underline" onClick={() => api(`/api/team/invites/${i.id}/revoke`, { method: 'POST' })}>revoke</button>
                  </>}
                </td>
              </tr>
            ))}
            {!invites?.invites?.length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">no invites yet</td></tr>}
          </tbody>
        </table>
      </Card2>

      <Modal open={invOpen} onClose={() => setInvOpen(false)} title="Invite a team member">
        <div className="space-y-3">
          <Field label="Email"><input className={inputCls} value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
          <Field label="Role"><select className={inputCls} value={inv.roleKey} onChange={(e) => setInv({ ...inv, roleKey: e.target.value })}>
            {systemRoles.map((r: any) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></Field>
          <Field label="Scope"><select className={inputCls} value={inv.scopeType} onChange={(e) => setInv({ ...inv, scopeType: e.target.value })}>
            <option value="global">whole operator</option><option value="site">specific site</option></select></Field>
          {inv.scopeType === 'site' && (
            <Field label="Site"><select className={inputCls} value={inv.siteId} onChange={(e) => setInv({ ...inv, siteId: e.target.value })}>
              <option value="">— choose —</option>
              {siteList.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>)}
          <p className="text-[10px] text-slate-500 font-mono">privileged roles (owner/admin/technical) must enroll MFA on accept</p>
          {err && <p className="text-xs text-red-400 font-mono">{err}</p>}
          <button onClick={createInvite} className="w-full py-2.5 bg-brand-orange text-white rounded-xl text-sm font-bold">Create invite link</button>
        </div>
      </Modal>

      <Modal open={!!link} onClose={() => setLink(null)} title="Invite link (single-use, expires in 7 days)">
        <div className="space-y-3">
          <p className="text-xs text-slate-400 font-mono">send this to the person — they set their own password on accept. locally, open it in a private window.</p>
          <pre className="bg-surface-lowest border border-surface-border rounded-xl p-3 text-[10px] font-mono text-slate-300 whitespace-pre-wrap break-all">{link}</pre>
          <Copy text={link ?? ''} label="Copy invite link" />
        </div>
      </Modal>

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={`Roles — ${editUser?.email ?? ''}`}>
        <div className="space-y-2">
          {systemRoles.map((r: any) => (
            <div key={r.key} className="flex items-center gap-3 p-2 bg-surface-base border border-surface-border rounded-xl">
              <input type="checkbox" className="accent-brand-orange" checked={!!sel[r.key]}
                onChange={(e) => setSel({ ...sel, [r.key]: e.target.checked })} />
              <span className="text-xs font-bold text-white w-28">{r.name}</span>
              {sel[r.key] && <>
                <select className="bg-surface-low border border-surface-border rounded-lg text-[10px] font-mono text-slate-300 px-2 py-1"
                  value={scope[r.key] ?? 'global'} onChange={(e) => setScope({ ...scope, [r.key]: e.target.value })}>
                  <option value="global">whole operator</option><option value="site">site only</option>
                </select>
                {scope[r.key] === 'site' && (
                  <select className="bg-surface-low border border-surface-border rounded-lg text-[10px] font-mono text-slate-300 px-2 py-1"
                    value={siteSel[r.key] ?? ''} onChange={(e) => setSiteSel({ ...siteSel, [r.key]: e.target.value })}>
                    <option value="">— site —</option>
                    {siteList.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>)}
              </>}
            </div>
          ))}
          {err && <p className="text-xs text-red-400 font-mono">{err}</p>}
          <button onClick={saveRoles} className="w-full py-2.5 bg-brand-orange text-white rounded-xl text-sm font-bold">Save (effective immediately)</button>
        </div>
      </Modal>
    </div>
  );
}

function Card2({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-surface-low border border-surface-high rounded-2xl p-6">
    <h3 className="text-sm font-extrabold text-white mb-4">{title}</h3>
    <div className="overflow-x-auto">{children}</div></div>;
}