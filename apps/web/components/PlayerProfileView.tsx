import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import type { PlayerProfile } from '../lib/nakamaClient';
import { formatNakamaError } from '../lib/nakamaClient';
import { CoastalFooter, CoastalShell } from './CoastalShell';

export function PlayerProfileView({
  profile,
  isAdmin = false,
  error,
  busy,
  retryTopUp,
  onTopUp,
  onPasswordChange,
  onSignOut,
}: {
  profile: PlayerProfile | null;
  isAdmin?: boolean;
  error: string;
  busy: boolean;
  retryTopUp: boolean;
  onTopUp: () => Promise<void>;
  onPasswordChange: (currentPassword: string, newPassword: string) => Promise<unknown>;
  onSignOut: () => void;
}) {
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  return (
    <CoastalShell signedIn>
      <Head>
        <title>Your profile | Bondi Poker</title>
      </Head>
      <main id="main-content" className="coastal-profile">
        <header className="profile-heading">
          <div>
            <p className="coastal-eyebrow">YOUR SEAT AT BONDI</p>
            <h1>{profile?.displayName ?? 'Your profile'}</h1>
            <p>Your chips, your hands, your next poker night.</p>
          </div>
          <Link href="/play" className="coastal-button primary">
            Back to the lobby <span aria-hidden="true">→</span>
          </Link>
        </header>
        {error && (
          <p role="alert" className="coastal-error">
            {error}
          </p>
        )}
        {!profile && !error && <p role="status">Loading your profile…</p>}
        {profile && (
          <>
            <section
              className="profile-bankroll coastal-panel"
              aria-labelledby="profile-chips-title"
            >
              <div>
                <p className="coastal-eyebrow" id="profile-chips-title">
                  READY TO PLAY
                </p>
                <p className="profile-chip-total">
                  {profile.availableChips.toLocaleString()} <span>chips available</span>
                </p>
                <p className="coastal-fineprint">
                  Free play chips only. No purchases, cash value or withdrawals.
                </p>
              </div>
              <div className="profile-top-up">
                <button
                  className="coastal-button primary"
                  disabled={busy}
                  onClick={() => void onTopUp()}
                >
                  {busy
                    ? 'Adding chips…'
                    : retryTopUp
                      ? 'Retry free top-up'
                      : 'Add 10,000 free chips'}
                </button>
                <p className="coastal-fineprint">Unlimited free top-ups. Always free to play.</p>
              </div>
            </section>
            {profile.allocation && (
              <p className="profile-allocation" role="status">
                {profile.allocation.chips.toLocaleString()} chips are reserved at table{' '}
                {profile.allocation.tableId}. Leave the table and wait for the hand/reconnect window
                to finish before joining another. Table chips update when a hand settles.
              </p>
            )}
            <section className="profile-history" aria-labelledby="profile-history-title">
              <h2 id="profile-history-title">Your time at the table</h2>
              <dl className="profile-stats">
                {[
                  ['Hands played', profile.handsStarted],
                  ['Hands completed', profile.handsCompleted],
                  ['Hands won', profile.handsWon],
                  ['Net chips won / lost', profile.netWinnings],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{Number(value).toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
              <details className="profile-details">
                <summary>Chip and session details</summary>
                <dl className="profile-stats secondary">
                  {[
                    ['Chips at table', profile.allocation?.chips ?? 0],
                    ['Table sessions', profile.tableSessions],
                    ['Table rebuys', profile.tableRebuys],
                    ['Free top-ups', profile.freeTopUps],
                    ['Free chips granted', profile.freeChipsGranted],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{Number(value).toLocaleString()}</dd>
                    </div>
                  ))}
                </dl>
                <p className="coastal-fineprint">
                  Each successful free top-up is counted separately from table rebuys.
                </p>
              </details>
            </section>
            <section
              className="profile-settings coastal-panel"
              aria-labelledby="profile-settings-title"
            >
              <div>
                <h2 id="profile-settings-title">Account settings</h2>
                <p className="coastal-fineprint">Keep your seat secure across devices.</p>
              </div>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (passwordBusy) return;
                  setPasswordBusy(true);
                  setPasswordMessage('');
                  try {
                    await onPasswordChange(currentPassword, newPassword);
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
                <h3>Change password</h3>
                <label>
                  Current password
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </label>
                <label>
                  New password (at least 12 characters)
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </label>
                <button disabled={passwordBusy} className="coastal-button secondary">
                  {passwordBusy ? 'Updating…' : 'Update password'}
                </button>
                {passwordMessage && (
                  <p role="status" className="coastal-fineprint">
                    {passwordMessage}
                  </p>
                )}
              </form>
            </section>
            {isAdmin && (
              <section className="profile-admin coastal-panel">
                <h2>Administration</h2>
                <p className="coastal-fineprint">
                  Your player account also has administrator access.
                </p>
                <div>
                  <Link href="/admin/analytics" className="coastal-inline-link">
                    Admin analytics
                  </Link>
                  <Link href="/players" className="coastal-inline-link">
                    Player activity and chip totals
                  </Link>
                </div>
              </section>
            )}
            <button className="profile-signout coastal-inline-link" onClick={onSignOut}>
              Sign out
            </button>
          </>
        )}
      </main>
      <CoastalFooter />
    </CoastalShell>
  );
}
