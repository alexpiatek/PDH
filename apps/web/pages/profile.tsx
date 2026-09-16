import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addFreeChips,
  formatNakamaError,
  getPlayerProfile,
  signOutPlayer,
  type PlayerProfile,
} from '../lib/nakamaClient';

export default function ProfilePage() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    getPlayerProfile()
      .then(setProfile)
      .catch((err) => setError(formatNakamaError(err)));
  }, []);
  const topUp = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    // Keep this receipt through network failures so Retry cannot grant twice.
    try {
      requestId.current ??=
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `topup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setProfile(await addFreeChips(requestId.current));
      requestId.current = null;
    } catch (err) {
      setError(formatNakamaError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-3xl">
        <Link href="/play" className="text-teal-300">
          ← Back to the lobby
        </Link>
        <h1 className="mt-8 text-3xl font-semibold">{profile?.displayName ?? 'Your profile'}</h1>
        <p className="mt-2 text-zinc-400">
          Free play chips only. No purchases, cash value, or withdrawals.
        </p>
        {error && (
          <p role="alert" className="my-4 text-amber-200">
            {error}
          </p>
        )}
        {profile && (
          <>
            <dl className="my-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                ['Available chips', profile.availableChips],
                ['Chips at table', profile.allocation?.chips ?? 0],
                ['Net chips won / lost', profile.netWinnings],
                ['Table sessions', profile.tableSessions],
                ['Hands played', profile.handsStarted],
                ['Hands completed', profile.handsCompleted],
                ['Hands won', profile.handsWon],
                ['Table rebuys', profile.tableRebuys],
                ['Free top-ups', profile.freeTopUps],
                ['Free chips granted', profile.freeChipsGranted],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <dt className="text-sm text-zinc-400">{label}</dt>
                  <dd className="mt-2 text-2xl font-semibold">{Number(value).toLocaleString()}</dd>
                </div>
              ))}
            </dl>
            {profile.allocation && (
              <p className="mb-5 text-sm text-zinc-400">
                Chips are reserved at table {profile.allocation.tableId}. Leave the table and wait
                for the hand/reconnect window to finish before joining another. Table chips update
                when a hand settles.
              </p>
            )}
            <button
              disabled={busy}
              onClick={() => void topUp()}
              className="rounded-lg bg-teal-400 px-6 py-3 font-semibold text-zinc-950 disabled:opacity-50"
            >
              {busy
                ? 'Adding chips…'
                : requestId.current
                  ? 'Retry free top-up'
                  : 'Add 10,000 free chips'}
            </button>
            <p className="mt-3 text-sm text-zinc-400">
              Unlimited free top-ups. Each successful top-up is counted separately from table
              rebuys.
            </p>
            <button
              className="mt-8 block text-sm text-zinc-400"
              onClick={() =>
                void signOutPlayer()
                  .then(() => window.location.assign('/play'))
                  .catch((err) => setError(formatNakamaError(err)))
              }
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </main>
  );
}
