import { useEffect, useState, type FormEvent } from 'react';
import Head from 'next/head';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { isValidTableCodeFormat, normalizeTableCode } from '@pdh/protocol';
import { ArrowRight, Check, Clock3, Copy, KeyRound, Spade, Users } from 'lucide-react';
import { logClientEvent } from '../lib/clientTelemetry';
import { LOCAL_BROWSER_HOSTS, type LocalAccessInfo } from '../lib/localAccess';
import {
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
  const [localAccess, setLocalAccess] = useState<LocalAccessInfo | null>(null);
  const [copiedLanUrl, setCopiedLanUrl] = useState(false);

  useEffect(() => {
    setName(readStoredPlayerName());
    setRecentTables(getRecentTables());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = window.location.hostname.toLowerCase();
    if (!LOCAL_BROWSER_HOSTS.has(host)) {
      setLocalAccess(null);
      return;
    }

    let cancelled = false;
    void fetch('/api/local-access')
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { available: boolean } & Partial<LocalAccessInfo>;
      })
      .then((payload) => {
        if (
          cancelled ||
          !payload?.available ||
          !payload.playUrl ||
          !payload.origin ||
          !payload.lanHost
        ) {
          return;
        }
        setLocalAccess({
          lanHost: payload.lanHost,
          origin: payload.origin,
          playUrl: payload.playUrl,
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const loading = loadingMode !== null;
  const errorDisplay = error ? friendlyLobbyError(error) : null;
  const copyLanUrl = async () => {
    if (!localAccess || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(localAccess.playUrl);
    setCopiedLanUrl(true);
    window.setTimeout(() => setCopiedLanUrl(false), 1500);
  };

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

        <div
          data-testid="lobby-shell"
          className="relative z-10 mx-auto grid min-h-[calc(100vh-73px)] w-full max-w-7xl gap-6 px-5 py-5 sm:px-8 sm:py-8 lg:min-h-[calc(100vh-89px)] lg:grid-cols-[0.78fr_1.22fr] lg:items-center lg:gap-10 lg:py-12"
        >
          <section
            data-testid="lobby-hero"
            className="hidden max-w-xl lg:order-1 lg:block"
          >
            <p className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.34em] text-amber-200">
              Play Lobby
            </p>
            <h1 className="mt-4 font-[var(--font-serif)] text-4xl font-semibold leading-[0.98] text-white xl:text-5xl">
              Quick Play or join by code.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-zinc-300">
              Jump into a table or join a friend by code. Quick Play finds the best available
              table.
            </p>

            <div className="mt-7 grid gap-3 xl:grid-cols-3">
              {[
                { label: 'Quick seat', value: 'Best table', icon: Users },
                { label: 'Private code', value: '6 chars', icon: KeyRound },
                { label: 'Recent', value: `${recentTables.length} saved`, icon: Clock3 },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-md border border-white/10 bg-white/[0.025] px-4 py-3.5"
                  >
                    <Icon aria-hidden="true" className="h-5 w-5 text-teal-300" strokeWidth={1.7} />
                    <div className="mt-3 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      {item.label}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-zinc-100">{item.value}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section data-testid="lobby-actions" className="w-full lg:order-2">
            <div className="mb-4 lg:hidden">
              <p className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">
                Play Lobby
              </p>
              <h1 className="mt-2 font-[var(--font-serif)] text-3xl font-semibold leading-tight text-white">
                Quick Play or join by code.
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                Jump into a table or join a friend by code.
              </p>
            </div>

            {localAccess ? (
              <div className="mb-4 rounded-lg border border-teal-300/35 bg-teal-400/[0.08] p-4 sm:mb-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-teal-100">Test on phone too</div>
                    <p className="mt-1 text-sm leading-6 text-zinc-300">
                      Open the same LAN address on both devices. Do not use <code>localhost</code>{' '}
                      on your phone.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyLanUrl()}
                    className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-teal-200/45 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-teal-100 transition hover:border-teal-200/75 hover:bg-white/[0.08]"
                  >
                    {copiedLanUrl ? (
                      <>
                        <Check aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
                        Copy URL
                      </>
                    )}
                  </button>
                </div>
                <div className="mt-3 rounded-md border border-white/10 bg-black/[0.28] px-3 py-2.5">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Open on both desktop and mobile
                  </div>
                  <div className="mt-1 break-all font-mono text-sm text-white">
                    {localAccess.playUrl}
                  </div>
                </div>
              </div>
            ) : null}

            <form
              data-testid="quick-play-card"
              onSubmit={(event) => void handleQuickPlay(event)}
              className="rounded-lg border border-amber-300/45 bg-amber-300/[0.07] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)] sm:p-5"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <label htmlFor="player-name" className="block text-sm font-semibold text-zinc-100">
                  Player name
                </label>
                <p className="text-xs leading-5 text-amber-100/75">Quick Play finds a table.</p>
              </div>
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
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-teal-200/70 bg-teal-400/[0.46] px-5 py-3 text-sm font-semibold text-white shadow-[0_0_26px_rgba(20,184,166,0.22)] transition hover:bg-teal-300/[0.56] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {loadingMode === 'quick_play' ? 'Finding Table...' : 'Quick Play'}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
            </form>

            <form
              data-testid="join-code-card"
              onSubmit={(event) => void handleJoinByCode(event)}
              className="mt-3 rounded-lg border border-white/15 bg-white/[0.035] p-4 sm:mt-4 sm:p-5"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <label htmlFor="join-code" className="block text-sm font-semibold text-zinc-100">
                  Join by code
                </label>
                <p className="text-xs leading-5 text-zinc-400">For friend and private tables.</p>
              </div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <input
                  id="join-code"
                  data-testid="join-code-input"
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
                  data-testid="join-code-button"
                  disabled={loading}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-amber-300/60 bg-transparent px-5 py-3 text-sm font-semibold text-amber-100 transition hover:border-teal-200 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  <KeyRound aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                  {loadingMode === 'join_code' ? 'Joining...' : 'Join Code'}
                </button>
              </div>
            </form>

            <div
              data-testid="recent-tables-card"
              className="mt-4 rounded-lg border border-white/10 bg-black/[0.16] p-4 sm:mt-5 sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-[var(--font-display)] text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-200/85">
                  Recent Tables
                </h2>
                <Spade aria-hidden="true" className="h-4 w-4 text-teal-300/85" strokeWidth={1.7} />
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
                        className="inline-flex min-h-11 items-center justify-between rounded-md border border-white/10 bg-white/[0.025] px-4 py-2.5 text-left text-sm text-zinc-100 transition hover:border-teal-300/45 hover:bg-teal-400/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
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
