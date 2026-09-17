import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { useRouter } from 'next/router';
import { formatNakamaError, getPlayerProfile, signInWithEmail } from '../lib/nakamaClient';
import { storePlayerName } from '../lib/playerIdentity';

export function PlayerAccountGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const required =
    process.env.NEXT_PUBLIC_PLAYER_PROFILES !== 'false' &&
    ['/game', '/table/[matchId]', '/profile', '/players'].includes(router.pathname);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [create, setCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!required) return;
    let disposed = false;
    setChecking(true);
    getPlayerProfile()
      .then((profile) => {
        if (!disposed) {
          storePlayerName(profile.displayName);
          setReady(true);
        }
      })
      .catch(() => {
        if (!disposed) setReady(false);
      })
      .finally(() => {
        if (!disposed) setChecking(false);
      });
    return () => {
      disposed = true;
    };
  }, [required]);
  if (!required || ready) return <>{children}</>;
  if (checking)
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-white">Loading your player profile…</main>
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await signInWithEmail(email, password, create);
      const profile = await getPlayerProfile(create ? name : undefined);
      storePlayerName(profile.displayName);
      setPassword('');
      setReady(true);
    } catch (err) {
      setError(formatNakamaError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
      <section className="w-full max-w-md rounded-2xl border border-white/15 bg-white/5 p-7">
        <p className="text-sm font-semibold uppercase tracking-widest text-teal-300">Bondi Poker</p>
        <h1 className="mt-3 text-3xl font-semibold">
          {create ? 'Create your player profile' : 'Welcome back'}
        </h1>
        <p className="mt-3 text-sm text-zinc-400">
          Keep your chips and game history across devices. All chips are free play chips, with no
          cash value.
        </p>
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          {create && (
            <label className="block">
              Player name
              <input
                className="mt-1 w-full rounded bg-zinc-800 p-3"
                required
                maxLength={24}
                autoComplete="nickname"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label className="block">
            Email
            <input
              className="mt-1 w-full rounded bg-zinc-800 p-3"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block">
            Password
            <input
              className="mt-1 w-full rounded bg-zinc-800 p-3"
              type="password"
              autoComplete={create ? 'new-password' : 'current-password'}
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-amber-200">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded bg-teal-400 p-3 font-semibold text-zinc-950 disabled:opacity-50"
          >
            {busy ? 'Please wait…' : create ? 'Create profile & play' : 'Sign in & play'}
          </button>
        </form>
        <button
          className="mt-5 text-sm text-teal-300"
          onClick={() => {
            setCreate(!create);
            setError('');
          }}
        >
          {create ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
        <p className="mt-5 text-sm text-zinc-400">
          Forgotten your password?{' '}
          <a
            className="text-teal-300 underline"
            href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'alex.piatek17@gmail.com'}?subject=Bondi%20Poker%20account%20help`}
          >
            Contact pilot support
          </a>
          . Include your account email, but never your password.
        </p>
      </section>
    </main>
  );
}
