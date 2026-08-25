'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';
import { IS_DEMO } from '@/lib/demo';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6"
      >
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Pulse</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Analitika za tvarenasport.com</p>
        </div>

        {IS_DEMO && (
          <div className="mb-5 rounded-md border border-[var(--series-4)]/50 bg-[var(--series-4)]/10 px-3 py-2.5">
            <p className="text-xs font-semibold text-[var(--text-primary)]">Demo prikaz</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              Nema backenda ni prijave — svi brojevi su izmišljeni i generišu se u pregledaču.
              Uđite bilo kojim podacima.
            </p>
          </div>
        )}

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)]"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Lozinka</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)]"
          />
        </label>

        {error && (
          <p className="mb-3 rounded-md border border-[var(--status-critical)]/40 bg-[var(--status-critical)]/10 px-3 py-2 text-xs text-[var(--status-critical)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-[var(--series-1)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Prijavljivanje…' : 'Prijavi se'}
        </button>
      </form>
    </div>
  );
}
