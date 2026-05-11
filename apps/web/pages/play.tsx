import { useEffect, useState, type FormEvent } from 'react';
import Head from 'next/head';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { isValidTableCodeFormat, normalizeTableCode } from '@pdh/protocol';
import { ArrowRight, Clock3, KeyRound, Spade, Users } from 'lucide-react';
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
import { BondiPokerLogo } from '../components/BondiPokerLogo';

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

const friendlyLobbyError = (message: string) => {
  const lower = message.toLowerCase();
  if (/http\s*500|internal server error/.test(lower)) {
    return {
      title: 'Table service had a problem',
      detail: 'Quick Play could not reach the table service. Try again in a moment.',
    };
  }
  if (lower.includes('already full')) {
    return {
      title: 'Table is full',
      detail: 'Choose Quick Play or enter another table code.',
    };
  }
  if (lower.includes('could not find') || lower.includes('no longer active')) {
    return {
      title: 'Table not found',
      detail: message,
    };
  }
  if (lower.includes('valid 6-character')) {
    return {
      title: 'Check the table code',
      detail: message,
    };
  }
  return {
    title: lower.includes('http') || lower.includes('error') ? 'Lobby problem' : 'Lobby notice',
    detail: message,
  };
};

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
  const errorDisplay = error ? friendlyLobbyError(error) : null;

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

      <main className="relative min-h-screen overflow-hidden bg-[#03080b] text-zinc-100">
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-[0.08]"
            style={{ backgroundImage: "url('/Casino floor background.png')" }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_22%,rgba(20,184,166,0.16),transparent_30%),radial-gradient(circle_at_17%_16%,rgba(251,191,36,0.09),transparent_27%),linear-gradient(180deg,rgba(3,8,11,0.94),rgba(2,7,9,0.985))]" />
        </div>

        <header className="relative z-10 border-b border-amber-300/40 bg-[#03080b]/70 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 sm:px-8 sm:py-5">
            <BondiPokerLogo href="/" variant="nav" className="max-w-[68vw]" />
            <a
              href="/#how-it-works"
              className="hidden rounded-md border border-white/15 px-4 py-2 font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200 transition hover:border-teal-300/70 hover:text-teal-100 sm:inline-flex"
            >
              Rules
            </a>
          </div>
        </header>

        <div className="relative z-10 mx-auto grid min-h-[calc(100vh-89px)] w-full max-w-7xl items-center gap-8 px-6 py-10 sm:px-8 lg:grid-cols-[0.88fr_1.12fr] lg:py-14">
          <section className="max-w-xl">
            <p className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.34em] text-amber-200">
              Play Lobby
            </p>
            <h1 className="mt-4 font-[var(--font-serif)] text-5xl font-semibold leading-[0.94] text-white sm:text-6xl">
              Enter fast, or join by code.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-zinc-300 sm:text-lg">
              Quick Play seats you at the best available table. Table codes keep friend games one
              step away.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Quick seat', value: 'Best table', icon: Users },
                { label: 'Private code', value: '6 chars', icon: KeyRound },
                { label: 'Recent', value: `${recentTables.length} saved`, icon: Clock3 },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-lg border border-white/15 bg-white/[0.035] px-4 py-4"
                  >
                    <Icon aria-hidden="true" className="h-5 w-5 text-teal-300" strokeWidth={1.7} />
                    <div className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
                      {item.label}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-zinc-100">{item.value}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="w-full">
            <form
              onSubmit={(event) => void handleQuickPlay(event)}
              className="rounded-lg border border-amber-300/35 bg-amber-300/[0.055] p-4 sm:p-5"
            >
              <label htmlFor="player-name" className="block text-sm font-semibold text-zinc-100">
                Player name
              </label>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
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
                  className="min-h-12 w-full rounded-md border border-white/15 bg-black/[0.34] px-4 py-3 text-base text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/25"
                />

                <button
                  type="submit"
                  data-testid="join-button"
                  disabled={loading}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-teal-200/70 bg-teal-400/[0.42] px-5 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(20,184,166,0.18)] transition hover:bg-teal-300/[0.52] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMode === 'quick_play' ? 'Finding Table...' : 'Quick Play'}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
            </form>

            <form
              onSubmit={(event) => void handleJoinByCode(event)}
              className="mt-4 rounded-lg border border-white/15 bg-white/[0.035] p-4 sm:p-5"
            >
              <label htmlFor="join-code" className="block text-sm font-semibold text-zinc-100">
                Join by code
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
                  className="min-h-12 w-full rounded-md border border-white/15 bg-black/[0.34] px-4 py-3 text-base uppercase tracking-[0.1em] text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/25"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-amber-300/60 bg-transparent px-5 py-3 text-sm font-semibold text-amber-100 transition hover:border-teal-200 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  <KeyRound aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                  {loadingMode === 'join_code' ? 'Joining...' : 'Join Code'}
                </button>
              </div>
            </form>

            <div className="mt-5 rounded-lg border border-white/10 bg-black/[0.2] p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">
                  Recent Tables
                </h2>
                <Spade aria-hidden="true" className="h-4 w-4 text-teal-300" strokeWidth={1.7} />
              </div>
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
                        className="inline-flex min-h-12 items-center justify-between rounded-md border border-white/15 bg-white/[0.035] px-4 py-3 text-left text-sm text-zinc-100 transition hover:border-teal-300/45 hover:bg-teal-400/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="truncate pr-3">{table.name || `Table ${table.code}`}</span>
                        <span className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.14em] text-zinc-200">
                          {buttonLoading ? 'Joining...' : table.code}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-zinc-400">No recent tables yet.</p>
              )}
            </div>

            {errorDisplay ? (
              <div className="mt-5 rounded-md border border-rose-300/45 bg-rose-500/10 px-3 py-3 text-rose-100">
                <div className="text-sm font-semibold">{errorDisplay.title}</div>
                <p className="mt-1 text-sm leading-5 text-rose-100/85">{errorDisplay.detail}</p>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
};

export default PlayLobbyPage;
