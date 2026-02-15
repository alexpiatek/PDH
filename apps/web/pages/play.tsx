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
  formatNakamaError,
  resolveLobbyCode,
} from '../lib/nakamaClient';
import { getRecentTables, type RecentLobbyTable, upsertRecentTable } from '../lib/recentTables';

type BootStatus = 'connecting' | 'ready' | 'error';

interface CreateResult {
  code: string;
  matchId: string;
}

const MAX_PLAYERS_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9];

const PlayLobbyPage: NextPage = () => {
  const router = useRouter();
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [bootStatus, setBootStatus] = useState<BootStatus>('connecting');
  const [bootError, setBootError] = useState('');

  const [tableName, setTableName] = useState('Bondi Late Night');
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [isPrivate, setIsPrivate] = useState(true);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);

  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState('');

  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const [copyToast, setCopyToast] = useState('');

  const [recentTables, setRecentTables] = useState<RecentLobbyTable[]>([]);

  useEffect(() => {
    setRecentTables(getRecentTables());

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

  const saveRecentEntry = (entry: Omit<RecentLobbyTable, 'updatedAt'>) => {
    const next = upsertRecentTable(entry);
    setRecentTables(next);
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
