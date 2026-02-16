import { useEffect, useState, type FormEvent } from 'react';
import Head from 'next/head';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { logClientEvent } from '../lib/clientTelemetry';
import { formatNakamaError, ensureNakamaReady, ensurePdhMatch } from '../lib/nakamaClient';
import { normalizePlayerName, readStoredPlayerName, storePlayerName } from '../lib/playerIdentity';

const NETWORK_BACKEND = (
  process.env.NEXT_PUBLIC_NETWORK_BACKEND ||
  (process.env.NEXT_PUBLIC_NAKAMA_HOST ? 'nakama' : 'legacy')
).toLowerCase();
const USE_NAKAMA_BACKEND = NETWORK_BACKEND === 'nakama';
const NAKAMA_TABLE_ID = process.env.NEXT_PUBLIC_NAKAMA_TABLE_ID || 'main';
const LEGACY_FALLBACK_MATCH_ID = 'main';

const PlayLobbyPage: NextPage = () => {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(readStoredPlayerName());
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) {
      return;
    }

    const normalized = normalizePlayerName(name);
    if (!normalized) {
      setError('Please enter your name.');
      return;
    }

    setLoading(true);
    setError('');
    storePlayerName(normalized);

    logClientEvent('single_table_enter_click', {
      backend: USE_NAKAMA_BACKEND ? 'nakama' : 'legacy',
      tableId: NAKAMA_TABLE_ID,
    });

    try {
      let matchId = LEGACY_FALLBACK_MATCH_ID;
      if (USE_NAKAMA_BACKEND) {
        await ensureNakamaReady();
        const ensured = await ensurePdhMatch({ tableId: NAKAMA_TABLE_ID });
        matchId = ensured.matchId;
      }
      await router.push(`/table/${encodeURIComponent(matchId)}`);
    } catch (submitError) {
      setError(formatNakamaError(submitError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Join Game | BondiPoker</title>
        <meta
          name="description"
          content="Enter your name and join the main BondiPoker table."
        />
      </Head>

      <main className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-30"
            style={{ backgroundImage: "url('/Casino floor background.png')" }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_8%,rgba(251,191,36,0.18),transparent_38%),radial-gradient(circle_at_80%_92%,rgba(20,184,166,0.16),transparent_45%),linear-gradient(180deg,rgba(6,10,20,0.8),rgba(3,6,14,0.94))]" />
        </div>

        <div className="relative mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
          <section className="w-full rounded-3xl border border-amber-200/20 bg-zinc-950/70 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
            <p className="inline-flex rounded-full border border-amber-300/35 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
              Single Table Mode
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Identify Yourself, Then Enter The Game
            </h1>
            <p className="mt-3 text-sm text-zinc-300 sm:text-base">
              One table. No lobby setup. Enter your name and jump straight into the main game.
            </p>

            <form onSubmit={(event) => void handleSubmit(event)} className="mt-8 space-y-4">
              <label htmlFor="player-name" className="block text-sm font-medium text-zinc-100">
                Player Name
              </label>
              <input
                id="player-name"
                data-testid="join-name-input"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) {
                    setError('');
                  }
                }}
                autoComplete="nickname"
                maxLength={24}
                placeholder="e.g. Alex"
                className="w-full rounded-xl border border-amber-200/35 bg-zinc-900/75 px-4 py-3 text-base text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-amber-200 focus:ring-2 focus:ring-amber-300/35"
              />

              <button
                type="submit"
                data-testid="join-button"
                disabled={loading}
                className="inline-flex w-full items-center justify-center rounded-xl border border-amber-200/65 bg-amber-400/20 px-5 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Entering Game...' : 'Enter Game'}
              </button>

              {error ? (
                <p className="rounded-xl border border-rose-400/45 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                  {error}
                </p>
              ) : null}
            </form>
          </section>
        </div>
      </main>
    </>
  );
};

export default PlayLobbyPage;
