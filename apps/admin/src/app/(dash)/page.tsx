'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const [status, setStatus] = useState('Loading dashboard...');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/stats/overview')
      .then(() => setStatus('T-Connect is running'))
      .catch((err) => {
        setStatus('Dashboard is available');
        setError(err instanceof Error ? err.message : 'Unable to load statistics');
      });
  }, []);

  return (
    <main className="space-y-6">
      <div>
        <p className="text-xs font-mono uppercase tracking-widest text-brand-orange">
          T-Connect
        </p>

        <h1 className="mt-2 text-2xl font-extrabold text-white">
          Dashboard
        </h1>

        <p className="mt-2 text-sm text-slate-400">
          {status}
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-surface-high bg-surface-low p-5">
          <p className="text-xs font-mono uppercase text-slate-500">
            Platform status
          </p>
          <p className="mt-3 text-lg font-bold text-emerald-400">
            Online
          </p>
        </div>

        <div className="rounded-2xl border border-surface-high bg-surface-low p-5">
          <p className="text-xs font-mono uppercase text-slate-500">
            Routers
          </p>
          <p className="mt-3 text-lg font-bold text-white">
            Ready for adoption
          </p>
        </div>

        <div className="rounded-2xl border border-surface-high bg-surface-low p-5">
          <p className="text-xs font-mono uppercase text-slate-500">
            Radius
          </p>
          <p className="mt-3 text-lg font-bold text-emerald-400">
            Authentication active
          </p>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-300">
            Statistics are not available yet: {error}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Complete first-time setup or sign in to load operator statistics.
          </p>
        </div>
      )}
    </main>
  );
}
