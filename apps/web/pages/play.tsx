import { useEffect, useState, type FormEvent } from 'react';
import Head from 'next/head';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { isValidTableCodeFormat, normalizeTableCode } from '@pdh/protocol';
import { logClientEvent } from '../lib/clientTelemetry';
import {
  ensureNakamaReady,
  formatNakamaError,
  quickPlayLobby,
  resolveLobbyCode,
} from '../lib/nakamaClient';
import { normalizePlayerName, readStoredPlayerName, storePlayerName } from '../lib/playerIdentity';
import {
  buildQuickPlayRequest,
  recordQuickPlayResolved,
  recordTableJoin,
} from '../lib/quickPlayProfile';
import { getRecentTables, type RecentLobbyTable, upsertRecentTable } from '../lib/recentTables';

const resolveNetworkBackend = () => {
  const explicit = (process.env.NEXT_PUBLIC_NETWORK_BACKEND || '').trim().toLowerCase();
  if (explicit === 'nakama' || explicit === 'legacy') {
    return explicit;
  }
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return 'legacy';
  }
  return 'nakama';
};

const NETWORK_BACKEND = resolveNetworkBackend();
const USE_NAKAMA_BACKEND = NETWORK_BACKEND === 'nakama';
const LEGACY_FALLBACK_MATCH_ID = 'main';

type LoadingMode = 'quick_play' | 'join_code' | `recent:${string}` | null;

const PlayLobbyPage: NextPage = () => {
  const router = useRouter();
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loadingMode, setLoadingMode] = useState<LoadingMode>(null);
  const [error, setError] = useState('');
  const [recentTables, setRecentTables] = useState<RecentLobbyTable[]>([]);

  useEffect(() => {
    setName(readStoredPlayerName());
    setRecentTables(getRecentTables());
  }, []);

  const loading = loadingMode !== null;

  const preparePlayerName = () => {
    const normalized = normalizePlayerName(name);
    if (!normalized) {
      setError('Please enter your name.');
      return null;
    }
    setName(normalized);
    setError('');
    storePlayerName(normalized);
    return normalized;
  };

  const enterMatch = async (matchId: string) => {
    await router.push(`/table/${encodeURIComponent(matchId)}`);
  };

  const handleQuickPlay = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) {
      return;
    }
    const normalizedName = preparePlayerName();
    if (!normalizedName) {
      return;
    }

    setLoadingMode('quick_play');
    logClientEvent('quick_play_click', {
      backend: USE_NAKAMA_BACKEND ? 'nakama' : 'legacy',
    });

    try {
      if (!USE_NAKAMA_BACKEND) {
        await enterMatch(LEGACY_FALLBACK_MATCH_ID);
        return;
      }

      await ensureNakamaReady();
      const quickPlayRequest = buildQuickPlayRequest();
      const resolved = await quickPlayLobby(quickPlayRequest);

      recordQuickPlayResolved(resolved);
      recordTableJoin(resolved.quickPlayBuyIn);
      setRecentTables(
        upsertRecentTable({
          code: resolved.code,
          name: resolved.name,
          matchId: resolved.matchId,
          maxPlayers: resolved.maxPlayers,
          isPrivate: resolved.isPrivate,
        })
      );

      await enterMatch(resolved.matchId);
    } catch (submitError) {
      setError(formatNakamaError(submitError));
    } finally {
      setLoadingMode(null);
    }
  };

  const resolveTableCode = async (rawCode: string) => {
    const code = normalizeTableCode(rawCode);
    if (!isValidTableCodeFormat(code)) {
      throw new Error('Enter a valid 6-character table code.');
    }

    if (!USE_NAKAMA_BACKEND) {
      return {
        code,
        matchId: LEGACY_FALLBACK_MATCH_ID,
      };
    }

    await ensureNakamaReady();
    const resolved = await resolveLobbyCode({ code });
    return {
      code,
      matchId: resolved.matchId,
    };
  };

  const handleJoinByCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) {
      return;
    }

    const normalizedName = preparePlayerName();
    if (!normalizedName) {
      return;
    }

    setLoadingMode('join_code');
    setError('');
    logClientEvent('join_by_code_click', {
      backend: USE_NAKAMA_BACKEND ? 'nakama' : 'legacy',
    });

    try {
      const resolved = await resolveTableCode(joinCode);
      recordTableJoin();
      setRecentTables(
        upsertRecentTable({
          code: resolved.code,
          name: `Table ${resolved.code}`,
          matchId: resolved.matchId,
        })
      );
      setJoinCode(resolved.code);
      await enterMatch(resolved.matchId);
    } catch (submitError) {
      setError(formatNakamaError(submitError));
    } finally {
      setLoadingMode(null);
    }
  };

  const handleJoinRecent = async (table: RecentLobbyTable) => {
    if (loading) {
      return;
    }

    const normalizedName = preparePlayerName();
    if (!normalizedName) {
      return;
    }

    setLoadingMode(`recent:${table.code}`);
    setError('');
    logClientEvent('recent_table_click', {
      backend: USE_NAKAMA_BACKEND ? 'nakama' : 'legacy',
      code: table.code,
    });

    try {
      const resolved = await resolveTableCode(table.code);
      recordTableJoin();
      setRecentTables(
        upsertRecentTable({
          code: resolved.code,
          name: table.name || `Table ${resolved.code}`,
          matchId: resolved.matchId,
          maxPlayers: table.maxPlayers,
          isPrivate: table.isPrivate,
        })
      );
      await enterMatch(resolved.matchId);
    } catch (submitError) {
      setError(formatNakamaError(submitError));
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <>
      <Head>
        <title>Play Lobby | BondiPoker</title>
        <meta
          name="description"
          content="Quick Play to join an active table, or enter a table code to join friends."
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
              Play Lobby
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Enter Fast, Or Join By Code
            </h1>
            <p className="mt-3 text-sm text-zinc-300 sm:text-base">
              Quick Play seats you at the best available table. Joining a friend by table code is
              still available.
            </p>

            <form onSubmit={(event) => void handleQuickPlay(event)} className="mt-8 space-y-4">
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
                {loadingMode === 'quick_play' ? 'Finding Table...' : 'Quick Play'}
              </button>
            </form>

            <form
              onSubmit={(event) => void handleJoinByCode(event)}
              className="mt-6 rounded-2xl border border-zinc-200/15 bg-zinc-900/45 p-4 sm:p-5"
            >
              <label htmlFor="join-code" className="block text-sm font-medium text-zinc-100">
                Join By Code
              </label>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <input
                  id="join-code"
                  value={joinCode}
                  onChange={(event) => {
                    setJoinCode(normalizeTableCode(event.target.value));
                    if (error) {
                      setError('');
                    }
                  }}
                  maxLength={6}
                  placeholder="ABC234"
                  className="w-full rounded-xl border border-zinc-300/30 bg-zinc-950/70 px-4 py-3 text-base uppercase tracking-[0.1em] text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-200/60 focus:ring-2 focus:ring-zinc-300/35"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-300/45 bg-zinc-800/55 px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {loadingMode === 'join_code' ? 'Joining...' : 'Join Code'}
                </button>
              </div>
            </form>

            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-300">
                Recent Tables
              </h2>
              {recentTables.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {recentTables.slice(0, 4).map((table) => {
                    const buttonLoading = loadingMode === `recent:${table.code}`;
                    return (
                      <button
                        key={`${table.code}-${table.updatedAt}`}
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          void handleJoinRecent(table);
                        }}
                        className="inline-flex items-center justify-between rounded-xl border border-zinc-300/25 bg-zinc-900/45 px-4 py-3 text-left text-sm text-zinc-100 transition hover:bg-zinc-800/60 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="truncate pr-3">{table.name || `Table ${table.code}`}</span>
                        <span className="font-semibold tracking-[0.08em] text-zinc-200">
                          {buttonLoading ? 'Joining...' : table.code}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-400">No recent tables yet.</p>
              )}
            </div>

            {error ? (
              <p className="mt-5 rounded-xl border border-rose-400/45 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                {error}
              </p>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
};

export default PlayLobbyPage;
