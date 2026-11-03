import { useEffect, useRef, useState } from 'react';
import { PlayerProfileView } from '../components/PlayerProfileView';
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
    <PlayerProfileView
      profile={profile}
      isAdmin={isAdmin}
      error={error}
      busy={busy}
      retryTopUp={Boolean(requestId.current)}
      onTopUp={topUp}
      onPasswordChange={changePlayerPassword}
      onSignOut={() =>
        void signOutPlayer()
          .then(() => window.location.assign('/play'))
          .catch((err) => setError(formatNakamaError(err)))
      }
    />
  );
}
