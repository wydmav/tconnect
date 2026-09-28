export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const csrf = typeof document !== 'undefined' ? (document.cookie.match(/tc_csrf=([^;]+)/)?.[1] ?? '') : '';
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(opts.method && opts.method !== 'GET' ? { 'x-csrf-token': csrf } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && typeof window !== 'undefined') { window.location.href = '/login'; throw new Error('unauthenticated'); }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) return res as unknown as T;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'request failed');
  return data as T;
}
export const fmtM = (minor: number) => `M ${(minor / 100).toFixed(2)}`;
export const fmtBytes = (b: number) => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${(b / 1e3).toFixed(0)} KB`;
export const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-LS', { timeZone: 'Africa/Maseru', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : '—';
export const ago = (iso?: string | null) => { if (!iso) return 'never'; const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };