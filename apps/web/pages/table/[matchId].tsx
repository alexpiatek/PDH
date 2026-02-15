import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { Loader2, Users } from 'lucide-react';
import { ensureNakamaSocket, formatNakamaError } from '../../lib/nakamaClient';

const TablePlaceholderPage: NextPage = () => {
  const router = useRouter();

  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>(
    'connecting'
  );
  const [joinStatus, setJoinStatus] = useState<'idle' | 'joining' | 'joined' | 'error'>('idle');
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const matchId = useMemo(() => {
    const raw = router.query.matchId;
    if (typeof raw === 'string') {
      return raw;
    }
    if (Array.isArray(raw)) {
      return raw[0] ?? '';
    }
    return '';
  }, [router.query.matchId]);

  useEffect(() => {
    if (!router.isReady || !matchId) {
      return;
    }

    let cancelled = false;
    let cleanupPresenceHandler: (() => void) | null = null;

    (async () => {
      setConnectionStatus('connecting');
      setJoinStatus('idle');
      setErrorMessage('');
      let connected = false;

      try {
        const socket = await ensureNakamaSocket();
        if (cancelled) {
          return;
        }

        connected = true;
        setConnectionStatus('connected');

        const previousPresenceHandler = socket.onmatchpresence;
        socket.onmatchpresence = (event) => {
          if (typeof previousPresenceHandler === 'function') {
            previousPresenceHandler(event);
          }
          if (event.match_id !== matchId) {
            return;
          }
          setPlayerCount((current) => {
            if (typeof current !== 'number') {
              return Math.max(1, event.joins.length + 1 - event.leaves.length);
            }
            return Math.max(0, current + event.joins.length - event.leaves.length);
          });
        };

        cleanupPresenceHandler = () => {
          socket.onmatchpresence = previousPresenceHandler;
        };

        setJoinStatus('joining');
        const joinedMatch = await socket.joinMatch(matchId);
        if (cancelled) {
          return;
        }

        setJoinStatus('joined');
        setPlayerCount((joinedMatch.presences?.length ?? 0) + 1);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const rendered = formatNakamaError(error);
        if (!connected) {
          setConnectionStatus('error');
        }
        setJoinStatus('error');
        setErrorMessage(rendered);
      }
    })();

    return () => {
      cancelled = true;
      cleanupPresenceHandler?.();
    };
  }, [matchId, router.isReady]);

  return (
    <>
      <Head>
        <title>Bondi Poker Table</title>
        <meta name="description" content="Bondi Poker table room placeholder." />
      </Head>

      <main className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(20,184,166,0.18),transparent_35%),radial-gradient(circle_at_85%_82%,rgba(251,191,36,0.16),transparent_40%)]" />

        <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 py-12">
          <div className="w-full rounded-3xl border border-zinc-400/25 bg-zinc-900/70 p-7 backdrop-blur-xl sm:p-9">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-300/70">Table Placeholder</p>
            <h1 className="mt-2 font-[var(--font-display)] text-3xl font-semibold text-white">
              Match Room
            </h1>

            <div className="mt-6 space-y-3 text-sm">
              <p className="rounded-xl border border-zinc-400/25 bg-zinc-900/55 px-3.5 py-2.5 font-mono text-zinc-100">
                matchId: {matchId || '...' }
              </p>

              <div className="flex flex-wrap gap-2" aria-live="polite">
                <span
                  className={[
                    'rounded-full border px-3 py-1 text-xs font-semibold',
                    connectionStatus === 'connected'
                      ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                      : connectionStatus === 'error'
                        ? 'border-rose-400/45 bg-rose-500/12 text-rose-100'
                        : 'border-zinc-400/35 bg-zinc-500/12 text-zinc-100',
                  ].join(' ')}
                >
                  {connectionStatus === 'connected' && 'Connected'}
                  {connectionStatus === 'connecting' && 'Connecting...'}
                  {connectionStatus === 'error' && 'Connection Error'}
                </span>

                <span
                  className={[
                    'rounded-full border px-3 py-1 text-xs font-semibold',
                    joinStatus === 'joined'
                      ? 'border-teal-400/50 bg-teal-500/15 text-teal-100'
                      : joinStatus === 'error'
                        ? 'border-rose-400/45 bg-rose-500/12 text-rose-100'
                        : 'border-zinc-400/35 bg-zinc-500/12 text-zinc-100',
                  ].join(' ')}
                >
                  {joinStatus === 'joined' && 'Joined'}
                  {joinStatus === 'joining' && 'Joining...'}
                  {joinStatus === 'idle' && 'Waiting'}
                  {joinStatus === 'error' && 'Join Failed'}
                </span>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-zinc-400/25 bg-zinc-900/55 p-4">
              <p className="inline-flex items-center gap-2 text-sm text-zinc-200">
                <Users className="h-4 w-4" />
                Player Count: {typeof playerCount === 'number' ? playerCount : 'Unavailable'}
              </p>
              <p className="mt-2 text-xs text-zinc-300/80">
                Gameplay is intentionally disabled here. This route only verifies authentication,
                socket connect, and table join.
              </p>
            </div>

            {joinStatus === 'joining' ? (
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-zinc-200">
                <Loader2 className="h-4 w-4 animate-spin" />
                Joining authoritative match...
              </p>
            ) : null}

            {errorMessage ? (
              <p role="alert" className="mt-4 text-sm text-rose-300">
                {errorMessage}
              </p>
            ) : null}

            <div className="mt-7">
              <Link
                href="/play"
                className="inline-flex items-center rounded-xl border border-amber-300/60 bg-amber-400/20 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/30"
              >
                Back to Lobby
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
};

export default TablePlaceholderPage;
