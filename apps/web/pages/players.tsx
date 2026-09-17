import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatNakamaError, getPlayerReport, type PlayerProfile } from '../lib/nakamaClient';
export default function PlayersPage() {
  const [players, setPlayers] = useState<Array<{ playerId: string; profile: PlayerProfile }>>([]);
  const [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async (next?: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await getPlayerReport(next);
      setPlayers((rows) => (next ? [...rows, ...result.players] : result.players));
      setCursor(result.cursor);
    } catch (err) {
      setError(formatNakamaError(err));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="flex gap-5">
        <Link href="/profile" className="text-teal-300">
          ← My profile
        </Link>
        <Link href="/admin/analytics" className="text-teal-300">
          Admin analytics
        </Link>
      </div>
      <h1 className="my-6 text-3xl">Player activity</h1>
      <p className="mb-5 text-zinc-400">Administrator view · free play only</p>
      {error && <p role="alert">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              {[
                'Player',
                'Sessions',
                'Hands completed',
                'Chips available',
                'At table',
                'Net won/lost',
                'Rebuys',
                'Free top-ups',
              ].map((label) => (
                <th className="p-3" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map(({ playerId, profile: p }) => (
              <tr key={playerId} className="border-t border-white/10">
                {[
                  p.displayName,
                  p.tableSessions,
                  p.handsCompleted,
                  p.availableChips,
                  p.allocation?.chips ?? 0,
                  p.netWinnings,
                  p.tableRebuys,
                  p.freeTopUps,
                ].map((v, i) => (
                  <td className="p-3" key={i}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button disabled={busy} className="mt-5 text-teal-300" onClick={() => void load(cursor)}>
          Load more players
        </button>
      )}
    </main>
  );
}
