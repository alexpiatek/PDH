import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { NextPage } from 'next';
import { Check, Copy, Loader2, Lock, Unlock } from 'lucide-react';
import { TABLE_CODE_LENGTH, isValidTableCodeFormat, normalizeTableCode } from '@pdh/protocol';
import {
  createLobbyTable,
  ensureNakamaReady,
  ensurePdhMatch,
  formatNakamaError,
  listLobbyTables,
  type ListTablesRpcTable,
  quickPlayLobby,
  resolveLobbyCode,
} from '../lib/nakamaClient';
import { logClientEvent } from '../lib/clientTelemetry';
import { useFeatureFlags } from '../lib/featureFlags';
import { buildQuickPlayRequest, recordQuickPlayResolved, recordTableJoin } from '../lib/quickPlayProfile';
import {
  getTrackedFriends,
  removeTrackedFriend,
  type TrackedLobbyFriend,
  upsertTrackedFriend,
} from '../lib/friendsLobby';
import { getRecentTables, type RecentLobbyTable, upsertRecentTable } from '../lib/recentTables';

type BootStatus = 'connecting' | 'ready' | 'error';

interface CreateResult {
  code: string;
  matchId: string;
}

interface FriendLobbyPresence {
  friend: TrackedLobbyFriend;
  table: ListTablesRpcTable | null;
}

const MAX_PLAYERS_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9];
const BUY_IN_FORMATTER = new Intl.NumberFormat('en-US');

function formatSkillTierLabel(skillTier: string | undefined): string {
  if (skillTier === 'newcomer') {
    return 'Newcomer';
  }
  if (skillTier === 'regular') {
    return 'Regular';
  }
  if (skillTier === 'pro') {
    return 'Pro';
  }
  return 'Casual';
}

const PlayLobbyPage: NextPage = () => {
  const router = useRouter();
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { uiQuickPlay, socialFriendsLobby } = useFeatureFlags();

  const [bootStatus, setBootStatus] = useState<BootStatus>('connecting');
  const [bootError, setBootError] = useState('');

  const [tableName, setTableName] = useState('Bondi Late Night');
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [isPrivate, setIsPrivate] = useState(true);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [quickPlayLoading, setQuickPlayLoading] = useState(false);
  const [quickPlayError, setQuickPlayError] = useState('');

  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState('');

  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const [copyToast, setCopyToast] = useState('');

  const [recentTables, setRecentTables] = useState<RecentLobbyTable[]>([]);
  const [activeTables, setActiveTables] = useState<ListTablesRpcTable[]>([]);
  const [activeTablesLoading, setActiveTablesLoading] = useState(false);
  const [activeTablesError, setActiveTablesError] = useState('');
  const [trackedFriends, setTrackedFriends] = useState<TrackedLobbyFriend[]>([]);
  const [friendAliasInput, setFriendAliasInput] = useState('');
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [friendFormError, setFriendFormError] = useState('');

  useEffect(() => {
    setRecentTables(getRecentTables());
    setTrackedFriends(getTrackedFriends());

    let isCancelled = false;
    setBootStatus('connecting');
    ensureNakamaReady()
      .then(() => {
        if (isCancelled) {
          return;
        }
        setBootStatus('ready');
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        setBootStatus('error');
        setBootError(formatNakamaError(error));
      });

    return () => {
      isCancelled = true;
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    const rawCode = router.query.code;
    if (typeof rawCode === 'string') {
      const normalized = normalizeTableCode(rawCode);
      if (normalized) {
        setJoinCodeInput(normalized);
      }
    }
  }, [router.isReady, router.query.code]);

  const canSubmitCreate = useMemo(() => {
    return tableName.trim().length > 0 && !createLoading && bootStatus !== 'connecting';
  }, [bootStatus, createLoading, tableName]);

  const canSubmitJoin = useMemo(() => {
    return normalizeTableCode(joinCodeInput).length > 0 && !joinLoading && bootStatus !== 'connecting';
  }, [bootStatus, joinCodeInput, joinLoading]);
  const canQuickPlay = useMemo(() => {
    return bootStatus === 'ready' && !quickPlayLoading && !createLoading && !joinLoading;
  }, [bootStatus, quickPlayLoading, createLoading, joinLoading]);
  const activeTablesByCode = useMemo(() => {
    const map = new Map<string, ListTablesRpcTable>();
    for (const table of activeTables) {
      map.set(table.code, table);
    }
    return map;
  }, [activeTables]);
  const friendPresence = useMemo<FriendLobbyPresence[]>(() => {
    return trackedFriends.map((friend) => {
      return {
        friend,
        table: activeTablesByCode.get(friend.tableCode) ?? null,
      };
    });
  }, [trackedFriends, activeTablesByCode]);
  const onlineFriendsCount = useMemo(() => {
    return friendPresence.filter((entry) => entry.table !== null).length;
  }, [friendPresence]);

  const saveRecentEntry = (entry: Omit<RecentLobbyTable, 'updatedAt'>) => {
    const next = upsertRecentTable(entry);
    setRecentTables(next);
  };
  const handleTrackFriendSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedAlias = friendAliasInput.trim();
    const normalizedCode = normalizeTableCode(friendCodeInput);
    if (!normalizedAlias) {
      setFriendFormError('Friend alias is required.');
      return;
    }
    if (!isValidTableCodeFormat(normalizedCode)) {
      setFriendFormError(`Enter a valid ${TABLE_CODE_LENGTH}-character table code.`);
      return;
    }

    const next = upsertTrackedFriend({
      alias: normalizedAlias,
      tableCode: normalizedCode,
    });
    setTrackedFriends(next);
    setFriendAliasInput('');
    setFriendCodeInput('');
    setFriendFormError('');
  };
  const handleRemoveTrackedFriend = (alias: string) => {
    const next = removeTrackedFriend(alias);
    setTrackedFriends(next);
  };

  const handleCreateTable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedName = tableName.trim().replace(/\s+/g, ' ');
    if (!normalizedName) {
      setCreateError('Table name is required.');
      return;
    }

    setCreateLoading(true);
    setCreateError('');

    try {
      const result = await createLobbyTable({
        name: normalizedName,
        maxPlayers,
        isPrivate,
      });

      setCreateResult(result);
      setJoinCodeInput(result.code);

      saveRecentEntry({
        code: result.code,
        matchId: result.matchId,
        name: normalizedName,
        maxPlayers,
        isPrivate,
      });
    } catch (error) {
      setCreateError(formatNakamaError(error));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleQuickPlay = async () => {
    if (!canQuickPlay) {
      return;
    }

    logClientEvent('quick_play_click', {
      surface: 'play_lobby',
    });
    setQuickPlayLoading(true);
    setQuickPlayError('');

    try {
      const maxPlayersForQuickPlay = 6;
      const request = buildQuickPlayRequest(maxPlayersForQuickPlay);
      const result = await quickPlayLobby(request);
      recordQuickPlayResolved(result);
      logClientEvent('quick_play_resolved', {
        created: result.created,
        code: result.code,
        matchId: result.matchId,
        targetBuyIn: request.targetBuyIn,
        skillTier: request.skillTier,
        resolvedBuyIn: result.quickPlayBuyIn,
        resolvedSkillTier: result.quickPlaySkillTier,
      });

      saveRecentEntry({
        code: result.code,
        matchId: result.matchId,
        name: result.name,
        maxPlayers: result.maxPlayers,
        isPrivate: result.isPrivate,
      });

      await router.push(`/table/${encodeURIComponent(result.matchId)}`);
    } catch (error) {
      const message = formatNakamaError(error);
      if (message.toLowerCase().includes('404')) {
        try {
          const fallback = await ensurePdhMatch({ tableId: 'main' });
          logClientEvent('quick_play_fallback', {
            reason: 'rpc_404',
            matchId: fallback.matchId,
            tableId: fallback.tableId,
          });
          await router.push(`/table/${encodeURIComponent(fallback.matchId)}`);
          return;
        } catch (fallbackError) {
          setQuickPlayError(formatNakamaError(fallbackError));
          return;
        }
      }
      setQuickPlayError(message);
    } finally {
      setQuickPlayLoading(false);
    }
  };

  const refreshActiveTables = async (silent = false) => {
    if (bootStatus !== 'ready') {
      return;
    }

    if (!silent) {
      setActiveTablesLoading(true);
    }

    try {
      const result = await listLobbyTables({
        includePrivate: false,
        limit: 20,
      });
      setActiveTables(result.tables);
      if (!silent) {
        setActiveTablesError('');
      }
    } catch (error) {
      if (!silent || activeTables.length === 0) {
        setActiveTablesError(formatNakamaError(error));
      }
    } finally {
      if (!silent) {
        setActiveTablesLoading(false);
      }
    }
  };

  useEffect(() => {
    if (bootStatus !== 'ready') {
      setActiveTables([]);
      setActiveTablesLoading(false);
      setActiveTablesError('');
      return;
    }

    let active = true;

    const runInitialLoad = async () => {
      if (!active) return;
      await refreshActiveTables(false);
    };
    void runInitialLoad();

    const intervalId = window.setInterval(() => {
      if (!active) {
        return;
      }
      void refreshActiveTables(true);
    }, 8000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [bootStatus]);

  const joinActiveTable = async (table: ListTablesRpcTable) => {
    if (joinLoading || createLoading || quickPlayLoading) {
      return;
    }
    if (table.seatsOpen <= 0) {
      return;
    }

    logClientEvent('active_table_join_click', {
      code: table.code,
      matchId: table.matchId,
      seatsOpen: table.seatsOpen,
      presenceCount: table.presenceCount,
      maxPlayers: table.maxPlayers,
    });

    setJoinLoading(true);
    setJoinError('');
    try {
      saveRecentEntry({
        code: table.code,
        matchId: table.matchId,
        name: table.name,
        maxPlayers: table.maxPlayers,
        isPrivate: table.isPrivate,
      });
      recordTableJoin(table.quickPlayBuyIn);
      await router.push(`/table/${encodeURIComponent(table.matchId)}`);
    } catch (error) {
      setJoinError(formatNakamaError(error));
    } finally {
      setJoinLoading(false);
    }
  };
  const joinFriendTable = async (entry: FriendLobbyPresence) => {
    if (!entry.table) {
      return;
    }
    logClientEvent('friend_join_click', {
      alias: entry.friend.alias,
      code: entry.friend.tableCode,
      matchId: entry.table.matchId,
    });
    await joinActiveTable(entry.table);
  };

  const resolveAndJoinTable = async (rawCode: string) => {
    const normalizedCode = normalizeTableCode(rawCode);

    if (!isValidTableCodeFormat(normalizedCode)) {
      setJoinError(`Enter a valid ${TABLE_CODE_LENGTH}-character table code.`);
      return;
    }

    setJoinLoading(true);
    setJoinError('');

    try {
      const result = await resolveLobbyCode({ code: normalizedCode });
      const existing = recentTables.find((table) => table.code === normalizedCode);

      saveRecentEntry({
        code: normalizedCode,
        matchId: result.matchId,
        name: existing?.name ?? `Table ${normalizedCode}`,
        maxPlayers: existing?.maxPlayers,
        isPrivate: existing?.isPrivate,
      });
      const activeTable = activeTablesByCode.get(normalizedCode);
      recordTableJoin(activeTable?.quickPlayBuyIn);

      await router.push(`/table/${encodeURIComponent(result.matchId)}`);
    } catch (error) {
      setJoinError(formatNakamaError(error));
    } finally {
      setJoinLoading(false);
    }
  };

  const handleJoinSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await resolveAndJoinTable(joinCodeInput);
  };

  const handleCopyInviteLink = async () => {
    if (!createResult || typeof window === 'undefined') {
      return;
    }

    const inviteLink = `${window.location.origin}/play?code=${createResult.code}`;

    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyState('success');
      setCopyToast('Invite link copied.');
    } catch {
      setCopyState('error');
      setCopyToast('Could not copy. Copy from the address bar instead.');
    }

    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current);
    }

    copyResetTimeoutRef.current = setTimeout(() => {
      setCopyState('idle');
      setCopyToast('');
    }, 2200);
  };

  return (
    <>
      <Head>
        <title>Bondi Poker Lobby</title>
        <meta
          name="description"
          content="Create a private Bondi Poker table or join instantly with a code."
        />
      </Head>

      <main className="relative min-h-screen overflow-hidden text-zinc-100">
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-35"
          style={{ backgroundImage: "url('/Casino floor background.png')" }}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(251,191,36,0.22),transparent_36%),radial-gradient(circle_at_82%_85%,rgba(20,184,166,0.16),transparent_42%),linear-gradient(180deg,rgba(6,10,20,0.72),rgba(3,6,14,0.92))]" />

        <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-12">
          <header className="mb-9 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-[var(--font-display)] text-xs uppercase tracking-[0.24em] text-amber-300/85">
                Bondi Poker
              </p>
              <h1 className="mt-2 font-[var(--font-display)] text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Private Lobby
              </h1>
            </div>

            <div
              className={[
                'rounded-full border px-4 py-2 text-xs font-semibold tracking-wide transition',
                bootStatus === 'ready'
                  ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                  : bootStatus === 'error'
                    ? 'border-rose-400/50 bg-rose-500/10 text-rose-100'
                    : 'border-zinc-400/30 bg-zinc-500/10 text-zinc-100',
              ].join(' ')}
              aria-live="polite"
            >
              {bootStatus === 'ready' && 'Nakama Connected'}
              {bootStatus === 'connecting' && 'Connecting to Nakama...'}
              {bootStatus === 'error' && 'Connection Error'}
            </div>
          </header>

          {bootStatus === 'error' && bootError ? (
            <p className="mb-6 rounded-2xl border border-rose-400/45 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {bootError}
            </p>
          ) : null}

          {uiQuickPlay ? (
            <section className="mb-6 rounded-3xl border border-emerald-200/20 bg-zinc-950/65 p-6 backdrop-blur-xl sm:p-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/85">Primary Path</p>
                  <h2 className="mt-2 font-[var(--font-display)] text-2xl font-semibold text-white sm:text-3xl">
                    Play Now
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-zinc-300/85">
                    Auto-seat into the best public table for your stack and skill profile.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void handleQuickPlay();
                  }}
                  disabled={!canQuickPlay}
                  className="inline-flex min-w-[200px] items-center justify-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/20 px-5 py-3 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-500/28 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {quickPlayLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {quickPlayLoading ? 'Finding a Seat...' : 'Play Now'}
                </button>
              </div>
              {quickPlayError ? (
                <p role="alert" className="mt-4 text-sm text-rose-300">
                  {quickPlayError}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="grid flex-1 gap-6 lg:grid-cols-2">
            <article className="rounded-3xl border border-amber-200/20 bg-zinc-950/65 p-6 backdrop-blur-xl sm:p-7">
              <div className="mb-6">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-300/70">Action A</p>
                <h2 className="mt-2 font-[var(--font-display)] text-2xl font-semibold text-white">
                  Create Table
                </h2>
                <p className="mt-2 text-sm text-zinc-300/85">
                  Launch a new table, share your invite code, then move into the table room.
                </p>
              </div>

              <form className="space-y-4" onSubmit={handleCreateTable}>
                <div className="space-y-2">
                  <label htmlFor="table-name" className="text-sm font-medium text-zinc-100">
                    Table Name
                  </label>
                  <input
                    id="table-name"
                    aria-label="Table name"
                    value={tableName}
                    onChange={(event) => setTableName(event.target.value)}
                    required
                    maxLength={48}
                    className="w-full rounded-xl border border-zinc-500/40 bg-zinc-900/70 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-400/80 focus-visible:border-amber-300/75"
                    placeholder="e.g. Bondi Night Game"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="space-y-2">
                    <label htmlFor="max-players" className="text-sm font-medium text-zinc-100">
                      Max Players
                    </label>
                    <select
                      id="max-players"
                      aria-label="Maximum players"
                      value={maxPlayers}
                      onChange={(event) => setMaxPlayers(Number(event.target.value))}
                      className="w-full rounded-xl border border-zinc-500/40 bg-zinc-900/70 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition focus-visible:border-amber-300/75"
                    >
                      {MAX_PLAYERS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option} players
                        </option>
                      ))}
                    </select>
                  </div>

                  <label
                    htmlFor="private-table"
                    className="inline-flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-500/40 bg-zinc-900/60 px-3.5 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-zinc-300/40"
                  >
                    <input
                      id="private-table"
                      aria-label="Private table"
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(event) => setIsPrivate(event.target.checked)}
                      className="h-4 w-4 accent-amber-400"
                    />
                    <span className="inline-flex items-center gap-1.5">
                      {isPrivate ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                      {isPrivate ? 'Private' : 'Public'}
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  aria-label="Create table"
                  disabled={!canSubmitCreate}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300/60 bg-amber-400/20 px-4 py-2.5 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/28 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {createLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {createLoading ? 'Creating Table...' : 'Create Table'}
                </button>

                {createError ? (
                  <p role="alert" className="text-sm text-rose-300">
                    {createError}
                  </p>
                ) : null}
              </form>

              {createResult ? (
                <div className="mt-6 rounded-2xl border border-emerald-300/35 bg-emerald-500/10 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/80">Table Ready</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-emerald-100/90">Invite Code</p>
                      <p className="font-mono text-2xl font-semibold tracking-[0.25em] text-white">
                        {createResult.code}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleCopyInviteLink}
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/45 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/25"
                      >
                        {copyState === 'success' ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        Copy Invite Link
                      </button>

                      <Link
                        href={`/table/${encodeURIComponent(createResult.matchId)}`}
                        className="inline-flex items-center rounded-lg border border-amber-300/65 bg-amber-400/25 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:bg-amber-400/35"
                      >
                        Enter Table
                      </Link>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>

	            <article className="rounded-3xl border border-teal-200/20 bg-zinc-950/65 p-6 backdrop-blur-xl sm:p-7">
              <div className="mb-6">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-300/70">Action B</p>
                <h2 className="mt-2 font-[var(--font-display)] text-2xl font-semibold text-white">
                  Join With Code
                </h2>
                <p className="mt-2 text-sm text-zinc-300/85">
                  Paste the invite code, and we will route you to the live table.
                </p>
              </div>

	              <form className="space-y-4" onSubmit={handleJoinSubmit}>
                <div className="space-y-2">
                  <label htmlFor="join-code" className="text-sm font-medium text-zinc-100">
                    Table Code
                  </label>
                  <input
                    id="join-code"
                    aria-label="Join table with code"
                    value={joinCodeInput}
                    onChange={(event) => setJoinCodeInput(normalizeTableCode(event.target.value))}
                    autoComplete="off"
                    inputMode="text"
                    maxLength={TABLE_CODE_LENGTH}
                    className="w-full rounded-xl border border-zinc-500/40 bg-zinc-900/70 px-3.5 py-2.5 font-mono text-lg uppercase tracking-[0.22em] text-zinc-100 outline-none transition placeholder:text-zinc-400/80 focus-visible:border-teal-300/70"
                    placeholder="ABC234"
                  />
                </div>

                <button
                  type="submit"
                  aria-label="Join table"
                  disabled={!canSubmitJoin}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-teal-300/55 bg-teal-500/15 px-4 py-2.5 text-sm font-semibold text-teal-50 transition hover:bg-teal-500/24 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {joinLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {joinLoading ? 'Joining...' : 'Join Table'}
                </button>

                {joinError ? (
                  <p role="alert" className="text-sm text-rose-300">
                    {joinError}
                  </p>
                ) : null}
	              </form>

	              {socialFriendsLobby ? (
	                <div className="mt-7 rounded-2xl border border-teal-300/25 bg-teal-500/5 p-4">
	                  <div className="flex items-center justify-between gap-3">
	                    <h3 className="font-[var(--font-display)] text-lg text-white">Friends Online</h3>
	                    <span className="rounded-full border border-teal-300/35 bg-teal-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-teal-100">
	                      {onlineFriendsCount} online
	                    </span>
	                  </div>

	                  <form className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]" onSubmit={handleTrackFriendSubmit}>
	                    <input
	                      aria-label="Friend alias"
	                      value={friendAliasInput}
	                      onChange={(event) => {
	                        setFriendAliasInput(event.target.value);
	                        if (friendFormError) {
	                          setFriendFormError('');
	                        }
	                      }}
	                      className="rounded-lg border border-zinc-500/40 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-400/80 focus-visible:border-teal-300/70"
	                      placeholder="Friend alias"
	                      maxLength={28}
	                    />
	                    <input
	                      aria-label="Friend table code"
	                      value={friendCodeInput}
	                      onChange={(event) => {
	                        setFriendCodeInput(normalizeTableCode(event.target.value));
	                        if (friendFormError) {
	                          setFriendFormError('');
	                        }
	                      }}
	                      className="rounded-lg border border-zinc-500/40 bg-zinc-900/70 px-3 py-2 font-mono text-sm uppercase tracking-[0.16em] text-zinc-100 outline-none transition placeholder:text-zinc-400/80 focus-visible:border-teal-300/70"
	                      placeholder="ABC234"
	                      maxLength={TABLE_CODE_LENGTH}
	                    />
	                    <button
	                      type="submit"
	                      className="rounded-lg border border-teal-300/45 bg-teal-500/15 px-3 py-2 text-xs font-semibold text-teal-100 transition hover:bg-teal-500/25"
	                    >
	                      Track
	                    </button>
	                  </form>

	                  {friendFormError ? (
	                    <p className="mt-2 text-xs text-rose-300">{friendFormError}</p>
	                  ) : null}

	                  {friendPresence.length === 0 ? (
	                    <p className="mt-3 rounded-lg border border-zinc-500/30 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300/85">
	                      Add a friend alias + table code to unlock one-tap friend joining.
	                    </p>
	                  ) : (
	                    <ul className="mt-3 space-y-2.5">
	                      {friendPresence.map((entry) => (
	                        <li
	                          key={`${entry.friend.alias}-${entry.friend.tableCode}`}
	                          className="flex items-center justify-between gap-3 rounded-xl border border-zinc-500/30 bg-zinc-900/60 px-3.5 py-2.5"
	                        >
	                          <div>
	                            <p className="text-sm font-medium text-zinc-100">{entry.friend.alias}</p>
	                            <p className="text-xs text-zinc-300/80">
	                              <span className="font-mono tracking-[0.15em]">{entry.friend.tableCode}</span>
	                              {entry.table
	                                ? ` · ${entry.table.name} · ${entry.table.presenceCount}/${entry.table.maxPlayers} seated`
	                                : ' · Offline'}
	                            </p>
	                          </div>

	                          <div className="flex items-center gap-2">
	                            <button
	                              type="button"
	                              onClick={() => {
	                                void joinFriendTable(entry);
	                              }}
	                              disabled={!entry.table || entry.table.seatsOpen <= 0 || joinLoading || bootStatus !== 'ready'}
	                              className="rounded-lg border border-teal-300/45 bg-teal-500/15 px-3 py-1.5 text-xs font-semibold text-teal-100 transition hover:bg-teal-500/25 disabled:cursor-not-allowed disabled:opacity-50"
	                            >
	                              {entry.table
	                                ? entry.table.seatsOpen > 0
	                                  ? 'Join Friend'
	                                  : 'Full'
	                                : 'Offline'}
	                            </button>
	                            <button
	                              type="button"
	                              onClick={() => {
	                                handleRemoveTrackedFriend(entry.friend.alias);
	                              }}
	                              className="rounded-lg border border-zinc-400/40 bg-zinc-800/60 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-zinc-200/50 hover:bg-zinc-700/60"
	                            >
	                              Remove
	                            </button>
	                          </div>
	                        </li>
	                      ))}
	                    </ul>
	                  )}
	                </div>
	              ) : null}

	              <div className="mt-7">
	                <div className="flex items-center justify-between gap-3">
	                  <h3 className="font-[var(--font-display)] text-lg text-white">Active Public Tables</h3>
	                  <button
	                    type="button"
	                    onClick={() => {
	                      void refreshActiveTables(false);
	                    }}
	                    disabled={activeTablesLoading || bootStatus !== 'ready'}
	                    className="rounded-lg border border-teal-300/45 bg-teal-500/10 px-3 py-1.5 text-xs font-semibold text-teal-100 transition hover:bg-teal-500/20 disabled:cursor-not-allowed disabled:opacity-50"
	                  >
	                    {activeTablesLoading ? 'Refreshing...' : 'Refresh'}
	                  </button>
	                </div>

	                {activeTablesError ? (
	                  <p className="mt-3 text-sm text-rose-300">{activeTablesError}</p>
	                ) : null}

	                {!activeTablesError && activeTables.length === 0 ? (
	                  <p className="mt-3 rounded-xl border border-zinc-500/30 bg-zinc-900/60 px-3.5 py-2.5 text-xs text-zinc-300/85">
	                    No public tables live right now. Try Quick Play to start one.
	                  </p>
	                ) : null}

	                {activeTables.length > 0 ? (
	                  <ul className="mt-3 space-y-2.5">
	                    {activeTables.slice(0, 8).map((table) => (
	                      <li
	                        key={`${table.matchId}-${table.code}`}
	                        className="flex items-center justify-between gap-3 rounded-xl border border-zinc-500/30 bg-zinc-900/60 px-3.5 py-2.5"
	                      >
	                        <div>
	                          <p className="text-sm font-medium text-zinc-100">{table.name}</p>
                          <p className="text-xs text-zinc-300/80">
                            <span className="font-mono tracking-[0.15em]">{table.code}</span>
                            {` · ${table.presenceCount}/${table.maxPlayers} seated`}
                            {table.seatsOpen > 0 ? ` · ${table.seatsOpen} open` : ' · Full'}
                            {typeof table.quickPlayBuyIn === 'number'
                              ? ` · Buy-in ${BUY_IN_FORMATTER.format(table.quickPlayBuyIn)}`
                              : ''}
                            {table.quickPlaySkillTier ? ` · ${formatSkillTierLabel(table.quickPlaySkillTier)}` : ''}
                          </p>
                        </div>

	                        <button
	                          type="button"
	                          onClick={() => {
	                            void joinActiveTable(table);
	                          }}
	                          disabled={joinLoading || table.seatsOpen <= 0 || bootStatus !== 'ready'}
	                          className="rounded-lg border border-teal-300/45 bg-teal-500/15 px-3 py-1.5 text-xs font-semibold text-teal-100 transition hover:bg-teal-500/25 disabled:cursor-not-allowed disabled:opacity-50"
	                        >
	                          {table.seatsOpen > 0 ? 'Join' : 'Full'}
	                        </button>
	                      </li>
	                    ))}
	                  </ul>
	                ) : null}
	              </div>

	              {recentTables.length > 0 ? (
	                <div className="mt-7">
                  <h3 className="font-[var(--font-display)] text-lg text-white">Recent Tables</h3>
                  <ul className="mt-3 space-y-2.5">
                    {recentTables.slice(0, 10).map((table) => (
                      <li
                        key={`${table.code}-${table.updatedAt}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-zinc-500/30 bg-zinc-900/60 px-3.5 py-2.5"
                      >
                        <div>
                          <p className="text-sm font-medium text-zinc-100">{table.name}</p>
                          <p className="text-xs text-zinc-300/80">
                            <span className="font-mono tracking-[0.15em]">{table.code}</span>
                            {typeof table.maxPlayers === 'number'
                              ? ` · ${table.maxPlayers} seats`
                              : ' · Seats unknown'}
                            {typeof table.isPrivate === 'boolean'
                              ? table.isPrivate
                                ? ' · Private'
                                : ' · Public'
                              : ''}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => resolveAndJoinTable(table.code)}
                          disabled={joinLoading}
                          className="rounded-lg border border-teal-300/45 bg-teal-500/15 px-3 py-1.5 text-xs font-semibold text-teal-100 transition hover:bg-teal-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Join
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          </section>

          <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-50">
            {copyToast ? (
              <p className="rounded-lg border border-emerald-300/45 bg-zinc-900/95 px-3 py-2 text-xs font-medium text-emerald-100 shadow-xl backdrop-blur">
                {copyToast}
              </p>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
};

export default PlayLobbyPage;
