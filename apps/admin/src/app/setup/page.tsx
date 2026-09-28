'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

type CreateResponse = {
  enrollToken: string;
  qr?: string;
  otpauth?: string;
  secret?: string;
};

export default function SetupPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<'account' | 'mfa'>('account');

  const [operatorName, setOperatorName] = useState('T-Connect');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [enrollToken, setEnrollToken] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ needed: boolean }>('/api/setup/status')
      .then((result) => {
        if (!result.needed) {
          router.replace('/login');
          return;
        }

        setChecking(false);
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to check setup status',
        );
        setChecking(false);
      });
  }, [router]);

  async function createOwner(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const result = await api<CreateResponse>('/api/setup', {
        method: 'POST',
        body: {
          operatorName,
          name,
          email,
          password,
        },
      });

      setEnrollToken(result.enrollToken);
      setQr(result.qr ?? '');
      setSecret(result.secret ?? '');
      setStep('mfa');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to create the owner account',
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      await api('/api/setup/verify', {
        method: 'POST',
        body: {
          enrollToken,
          code,
        },
      });

      router.replace('/team');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'MFA verification failed',
      );
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-surface-lowest text-slate-400">
        <p className="font-mono text-sm">Checking platform status...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-surface-lowest px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-surface-high bg-surface-low p-6 shadow-2xl">
        <div className="mb-6">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-brand-orange">
            T-Connect
          </p>

          <h1 className="mt-2 text-2xl font-extrabold text-white">
            {step === 'account'
              ? 'Initial platform setup'
              : 'Secure your account'}
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            {step === 'account'
              ? 'Create the first operator and platform owner.'
              : 'Scan the QR code and enter the six-digit authenticator code.'}
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {step === 'account' ? (
          <form onSubmit={createOwner} className="space-y-4">
            <label className="block text-xs text-slate-400">
              Operator name
              <input
                required
                minLength={2}
                value={operatorName}
                onChange={(event) => setOperatorName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-surface-high bg-surface-base px-3 py-2 text-white outline-none focus:border-brand-orange"
              />
            </label>

            <label className="block text-xs text-slate-400">
              Your name
              <input
                required
                minLength={2}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-surface-high bg-surface-base px-3 py-2 text-white outline-none focus:border-brand-orange"
              />
            </label>

            <label className="block text-xs text-slate-400">
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-xl border border-surface-high bg-surface-base px-3 py-2 text-white outline-none focus:border-brand-orange"
              />
            </label>

            <label className="block text-xs text-slate-400">
              Password
              <input
                required
                type="password"
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-xl border border-surface-high bg-surface-base px-3 py-2 text-white outline-none focus:border-brand-orange"
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Use at least 10 characters.
              </span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-brand-orange px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Creating account...' : 'Create owner account'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyMfa} className="space-y-5">
            {qr && (
              <div className="flex justify-center rounded-xl bg-white p-4">
                {qr}
              </div>
            )}

            {secret && (
              <div className="rounded-xl border border-surface-high bg-surface-base p-3">
                <p className="text-xs text-slate-500">
                  Manual setup key
                </p>
                <p className="mt-1 break-all font-mono text-xs text-white">
                  {secret}
                </p>
              </div>
            )}

            <label className="block text-xs text-slate-400">
              Six-digit authenticator code
              <input
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ''))
                }
                className="mt-1 w-full rounded-xl border border-surface-high bg-surface-base px-3 py-3 text-center font-mono text-xl tracking-[0.35em] text-white outline-none focus:border-brand-orange"
              />
            </label>

            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full rounded-xl bg-brand-orange px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Verifying...' : 'Verify and finish setup'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
