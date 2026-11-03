import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Head from 'next/head';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { isValidTableCodeFormat, normalizeTableCode } from '@pdh/protocol';
import { ArrowRight, Users } from 'lucide-react';
import { logClientEvent } from '../lib/clientTelemetry';
import {
  createLobbyTable,
  formatNakamaError,
  hasSignedInPlayerSession,
  quickPlayLobby,
  resolveLobbyCode,
} from '../lib/nakamaClient';
import { normalizePlayerName, readStoredPlayerName, storePlayerName } from '../lib/playerIdentity';
import {
  buildQuickPlayRequest,
  recordQuickPlayResolved,
  recordTableJoin,
} from '../lib/quickPlayProfile';
import {
  getOrCreateTestingProfile,
  recordTestingEvent,
  startTestingSession,
  updateTestingProfileDisplayName,
} from '../lib/playerTestingAnalytics';
import { getRecentTables, type RecentLobbyTable, upsertRecentTable } from '../lib/recentTables';
import { HandProgress } from '../components/HandProgress';
import { CoastalShell, CoastalFooter } from '../components/CoastalShell';
import { readPlayIntent, playIntentUrl, type PlayIntent } from '../lib/playIntent';

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

type LoadingMode = 'create' | 'quick_play' | 'join_code' | `recent:${string}` | null;

const friendlyLobbyError = (message: string) => {
  const lower = message.toLowerCase();
  if (/http\s*500|internal server error/.test(lower)) {
    return {
      title: 'Table service had a problem',
      detail: 'The table service could not be reached. Try again in a moment.',
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
  const [signedIn, setSignedIn] = useState(false);
  const intentRun = useRef(false);
  useEffect(() => {
    setName(readStoredPlayerName());
    setRecentTables(getRecentTables());
    setSignedIn(hasSignedInPlayerSession());
  }, []);
  const loading = loadingMode !== null;
  const errorDisplay = error ? friendlyLobbyError(error) : null;
  const requireAccount = (intent: PlayIntent) => {
    if (
      USE_NAKAMA_BACKEND &&
      process.env.NEXT_PUBLIC_PLAYER_PROFILES !== 'false' &&
      !hasSignedInPlayerSession()
    ) {
      void router.push(playIntentUrl(intent));
      return true;
    }
    return false;
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
    updateTestingProfileDisplayName(normalized);
    return normalized;
  };

  const enterMatch = async (matchId: string, entryPoint: string, tableCode?: string | null) => {
    startTestingSession({
      entryPoint,
      backend: USE_NAKAMA_BACKEND ? 'nakama' : 'legacy',
      matchId,
      tableId: tableCode ?? null,
      displayName: name,
    });
    await router.push(`/table/${encodeURIComponent(matchId)}`);
  };

  const handleCreateTable = async () => {
    if (loading) return;
    if (requireAccount({ action: 'create' })) return;
    const playerName = preparePlayerName();
    if (!playerName) return;
    setLoadingMode('create');
    try {
      const table = await createLobbyTable({
        name: playerName + "'s table",
        maxPlayers: 9,
        isPrivate: true,
      });
      setRecentTables(
        upsertRecentTable({
          ...table,
          name: playerName + "'s table",
          maxPlayers: 9,
          isPrivate: true,
        })
      );
      await enterMatch(table.matchId, 'create_private', table.code);
    } catch (err) {
      setError(formatNakamaError(err));
    } finally {
      setLoadingMode(null);
    }
  };

  const handleQuickPlay = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (requireAccount({ action: 'quick' })) return;
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
    recordTestingEvent('quick_play_click', {
      backend: USE_NAKAMA_BACKEND ? 'nakama' : 'legacy',
    });

    try {
      if (!USE_NAKAMA_BACKEND) {
        await enterMatch(LEGACY_FALLBACK_MATCH_ID, 'quick_play');
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

      recordTestingEvent('quick_play_resolved', {
        buyIn: resolved.quickPlayBuyIn,
        maxPlayers: resolved.maxPlayers,
        isPrivate: resolved.isPrivate,
      });
      await enterMatch(resolved.matchId, 'quick_play', resolved.code);
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

  const handleJoinByCode = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!isValidTableCodeFormat(normalizeTableCode(joinCode))) {
      setError('Enter a valid 6-character table code.');
      return;
    }
    if (requireAccount({ action: 'join', code: joinCode })) return;
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
    recordTestingEvent('join_by_code_click', {
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
      await enterMatch(resolved.matchId, 'join_code', resolved.code);
    } catch (submitError) {
      setError(formatNakamaError(submitError));
    } finally {
      setLoadingMode(null);
    }
  };

  const handleJoinRecent = async (table: RecentLobbyTable) => {
    if (requireAccount({ action: 'join', code: table.code })) return;
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
    recordTestingEvent('recent_table_click', {
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
      await enterMatch(resolved.matchId, 'recent_table', resolved.code);
    } catch (submitError) {
      setError(formatNakamaError(submitError));
    } finally {
      setLoadingMode(null);
    }
  };

  useEffect(() => {
    if (!router.isReady) return;
    const intent = readPlayIntent(router.query);
    if (intent?.action === 'join') setJoinCode(intent.code);
  }, [router.isReady, router.query]);

  useEffect(() => {
    const intent = readPlayIntent(router.query);
    if (!router.isReady || !intent || !name || intentRun.current) return;
    if (
      USE_NAKAMA_BACKEND &&
      process.env.NEXT_PUBLIC_PLAYER_PROFILES !== 'false' &&
      !hasSignedInPlayerSession()
    )
      return;
    if (intent.action === 'join' && joinCode !== intent.code) return;
    intentRun.current = true;
    if (intent.action === 'create') void handleCreateTable();
    else if (intent.action === 'join') void handleJoinByCode();
    else void handleQuickPlay();
    // Run an explicit URL intent once; retries stay in the visible form.
  }, [router.isReady, router.query, name, joinCode]);

  return (
    <CoastalShell signedIn={signedIn}>
      <Head>
        <title>Play with friends | Bondi Poker</title>
      </Head>
      <main id="main-content" className="coastal-lobby" data-testid="lobby-shell">
        <section data-testid="lobby-hero" className="lobby-intro">
          <p className="coastal-eyebrow">Pull up a seat</p>
          <h1>Your table. Your people.</h1>
          <p>Create a table, invite your friends and deal the first hand.</p>
          <Link href="/practice" className="coastal-inline-link">
            New to the game? Try a practice hand <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <div className="lobby-game-guide">
            <p>A new kind of Hold’em. Start with five. Finish with two.</p>
            <HandProgress />
          </div>
          <p className="coastal-fineprint">
            Free profile for multiplayer. Play chips only. No cash value.
          </p>
        </section>
        <section className="lobby-panel" data-testid="lobby-actions">
          <h2>Play with your people.</h2>
          {errorDisplay && (
            <div role="alert" className="coastal-error">
              <b>{errorDisplay.title}</b>
              <p>{errorDisplay.detail}</p>
            </div>
          )}
          <label htmlFor="player-name">Player name</label>
          <input
            id="player-name"
            data-testid="join-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="nickname"
            placeholder="Your name at the table"
          />
          <button
            type="button"
            className="coastal-button primary"
            disabled={loading}
            onClick={() => void handleCreateTable()}
          >
            {loadingMode === 'create' ? 'Creating your table…' : 'Create a table for friends'}
            <Users size={18} aria-hidden="true" />
          </button>
          <p className="coastal-fineprint">
            {signedIn
              ? 'Your friends join using your invite link or table code.'
              : 'Create a free account or sign in, then go straight to your table.'}
          </p>
          <form
            id="join-table"
            data-testid="join-code-card"
            onSubmit={(e) => void handleJoinByCode(e)}
          >
            <h3>Already invited?</h3>
            <label htmlFor="join-code">Six-character table code</label>
            <div className="lobby-join-row">
              <input
                id="join-code"
                data-testid="join-code-input"
                value={joinCode}
                onChange={(e) => setJoinCode(normalizeTableCode(e.target.value))}
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="ABC123"
              />
              <button
                data-testid="join-code-button"
                className="coastal-button secondary"
                disabled={loading}
              >
                {loadingMode === 'join_code' ? 'Joining…' : 'Join table'}
              </button>
            </div>
          </form>
          <details className="lobby-public">
            <summary>Looking for a public game?</summary>
            <p>Public tables can be quiet. Bring a friend or try Quick Play.</p>
            <form data-testid="quick-play-card" onSubmit={(e) => void handleQuickPlay(e)}>
              <button
                data-testid="join-button"
                className="coastal-button secondary"
                disabled={loading}
              >
                {loadingMode === 'quick_play' ? 'Finding Table...' : 'Quick Play'}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </form>
          </details>
          {recentTables.length > 0 && (
            <div className="lobby-recent" data-testid="recent-tables-card">
              <h3>Your recent tables</h3>
              {recentTables.slice(0, 4).map((table) => (
                <button
                  key={table.code}
                  disabled={loading}
                  onClick={() => void handleJoinRecent(table)}
                >
                  {table.name || `Table ${table.code}`}
                  <span>{table.code}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
      <CoastalFooter />
    </CoastalShell>
  );
};

export default PlayLobbyPage;
