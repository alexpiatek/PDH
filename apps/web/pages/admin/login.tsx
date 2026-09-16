import { useState, type FormEvent } from 'react';
import Head from 'next/head';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { LockKeyhole, LogIn } from 'lucide-react';
import { BondiPokerLogo } from '../../components/BondiPokerLogo';

const AdminLoginPage: NextPage = () => {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error || 'Login failed.');
        return;
      }
      await router.push('/admin/analytics');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Admin Login | BondiPoker</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <main className="grid min-h-screen place-items-center bg-[#03080b] px-5 text-zinc-100">
        <div className="w-full max-w-md rounded-lg border border-amber-300/35 bg-zinc-950/[0.72] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.42)]">
          <BondiPokerLogo href="/play" variant="lockup" className="mx-auto w-24" />
          <div className="mt-6 flex items-center justify-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-200">
            <LockKeyhole aria-hidden="true" className="h-4 w-4" />
            Admin Access
          </div>
          <h1 className="mt-2 text-center font-[var(--font-serif)] text-3xl font-semibold text-white">
            Analytics Login
          </h1>

          <form onSubmit={(event) => void submitLogin(event)} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-zinc-200">Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="mt-2 min-h-12 w-full rounded-md border border-white/15 bg-black/30 px-4 py-3 text-base text-white outline-none transition placeholder:text-zinc-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-zinc-200">Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                className="mt-2 min-h-12 w-full rounded-md border border-white/15 bg-black/30 px-4 py-3 text-base text-white outline-none transition placeholder:text-zinc-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20"
              />
            </label>

            {error ? (
              <div className="rounded-md border border-rose-300/45 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-teal-200/60 bg-teal-400/[0.24] px-5 py-3 text-sm font-semibold text-teal-50 transition hover:bg-teal-300/[0.34] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogIn aria-hidden="true" className="h-4 w-4" />
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    </>
  );
};

export default AdminLoginPage;
