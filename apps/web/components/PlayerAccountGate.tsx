import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { useRouter } from 'next/router';
import { formatNakamaError, getPlayerProfile, signInWithEmail } from '../lib/nakamaClient';
import { storePlayerName } from '../lib/playerIdentity';
import { readPlayIntent } from '../lib/playIntent';
import { CoastalShell } from './CoastalShell';
import Link from 'next/link';
import Head from 'next/head';

export function PlayerAccountGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const intent = router.pathname === '/play' ? readPlayIntent(router.query) : null;
  const required =
    router.pathname.startsWith('/admin/') ||
    (process.env.NEXT_PUBLIC_PLAYER_PROFILES !== 'false' &&
      (Boolean(intent) ||
        ['/game', '/table/[matchId]', '/profile', '/players'].includes(router.pathname)));
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [create, setCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (intent) setCreate(true);
  }, [Boolean(intent)]);
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
      <CoastalShell>
        <main id="main-content" className="coastal-auth-loading" role="status">
          Getting your seat ready…
        </main>
      </CoastalShell>
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
    <CoastalShell>
      <Head>
        <title>
          {intent?.action === 'join' ? `Join table ${intent.code}` : 'Your player profile'} | Bondi
          Poker
        </title>
      </Head>
      <main id="main-content" className="coastal-auth">
        <section className="coastal-auth-story">
          <p className="coastal-eyebrow">Your seat is waiting</p>
          <h2>
            {intent?.action === 'join'
              ? 'Your friends. Your table.'
              : 'Good hands. Better company.'}
          </h2>
          <p>
            {intent?.action === 'join'
              ? `Sign in to join table ${intent.code}. We’ll take you straight there.`
              : 'One free profile keeps your play chips and game history together.'}
          </p>
          <Link href="/practice" className="coastal-inline-link">
            Try the game first. No signup needed.
          </Link>
        </section>
        <section className="coastal-auth-panel">
          <div className="coastal-auth-heading-row">
            <p className="coastal-eyebrow">
              {intent?.action === 'create'
                ? 'Create your private table'
                : intent?.action === 'join'
                  ? `Join table ${intent.code}`
                  : 'Bondi Poker'}
            </p>
            <button
              type="button"
              className="coastal-auth-switch"
              disabled={busy}
              aria-label={
                create ? 'Already have an account? Sign in' : 'New here? Create an account'
              }
              onClick={() => {
                setCreate(!create);
                setError('');
              }}
            >
              {create ? 'Sign in' : 'Create account'}
            </button>
          </div>
          <h1 className="mt-3 text-3xl font-semibold" tabIndex={-1} autoFocus>
            {create ? 'Create your player profile' : 'Welcome back'}
          </h1>
          <p className="mt-3 text-sm text-zinc-400">
            {intent
              ? 'Your table choice is saved. Create a profile or sign in to continue.'
              : 'Keep your chips and game history across devices.'}{' '}
            Free play chips. No cash value.
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
              {busy
                ? 'Please wait…'
                : intent
                  ? create
                    ? 'Create profile & continue'
                    : 'Sign in & continue'
                  : create
                    ? 'Create profile'
                    : 'Sign in'}
            </button>
          </form>
          <p className="mt-5 text-sm text-zinc-400">
            Forgotten your password?{' '}
            <a
              className="text-teal-300 underline"
              href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'admin@bondipoker.com'}?subject=Bondi%20Poker%20account%20help`}
            >
              Contact pilot support
            </a>
            . Include your account email, but never your password.
          </p>
        </section>
      </main>
    </CoastalShell>
  );
}
