import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addFreeChips,
  changePlayerPassword,
  formatNakamaError,
  getPlayerProfile,
  fetchPlayerAdmin,
  signOutPlayer,
  type PlayerProfile,
} from '../lib/nakamaClient';

export default function ProfilePage() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    getPlayerProfile()
      .then(setProfile)
      .catch((err) => setError(formatNakamaError(err)));
  }, []);
  useEffect(() => {
    let disposed = false;
    void fetchPlayerAdmin('/api/admin/me')
      .then((response) => {
        if (!disposed) setIsAdmin(response.ok);
      })
      .catch(() => {
        if (!disposed) setIsAdmin(false);
      });
    return () => {
      disposed = true;
    };
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
            {isAdmin && (
              <section className="mt-6 rounded-xl border border-teal-300/30 bg-teal-400/5 p-5">
                <h2 className="text-lg font-semibold">Administration</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Your player account also has administrator access.
                </p>
                <div className="mt-4 flex flex-wrap gap-4">
                  <Link href="/admin/analytics" className="text-teal-300 underline">
                    Admin analytics
                  </Link>
                  <Link href="/players" className="text-teal-300 underline">
                    Player activity and chip totals
                  </Link>
                </div>
              </section>
            )}
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
            <form
              className="mt-8 max-w-md space-y-3 rounded-xl border border-white/10 p-5"
              onSubmit={async (event) => {
                event.preventDefault();
                if (passwordBusy) return;
                setPasswordBusy(true);
                setPasswordMessage('');
                try {
                  await changePlayerPassword(currentPassword, newPassword);
                  setCurrentPassword('');
                  setNewPassword('');
                  setPasswordMessage('Your password has been changed.');
                } catch (err) {
                  setPasswordMessage(formatNakamaError(err));
                } finally {
                  setPasswordBusy(false);
                }
              }}
            >
              <h2 className="text-lg font-semibold">Change password</h2>
              <label className="block text-sm">
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="mt-1 w-full rounded bg-zinc-800 p-3"
                />
              </label>
              <label className="block text-sm">
                New password (at least 12 characters)
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 w-full rounded bg-zinc-800 p-3"
                />
              </label>
              <button
                disabled={passwordBusy}
                className="rounded bg-zinc-700 px-4 py-2 disabled:opacity-50"
              >
                {passwordBusy ? 'Updating…' : 'Update password'}
              </button>
              {passwordMessage && (
                <p role="status" className="text-sm text-teal-200">
                  {passwordMessage}
                </p>
              )}
            </form>
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
