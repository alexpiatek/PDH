import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Client as NakamaClient } from '@heroiclabs/nakama-js';
import type { Match, Session, Socket as NakamaSocket } from '@heroiclabs/nakama-js';
import { Card, HandState, PlayerInHand } from '@pdh/engine';
import { TABLE_CHAT_MAX_LENGTH, TABLE_REACTIONS } from '@pdh/protocol';
import { ClientMessage, ServerMessage } from '../server-types';
import { BondiPokerLogo } from './BondiPokerLogo';
import { logClientEvent } from '../lib/clientTelemetry';
import { normalizePlayerName, readStoredPlayerName, storePlayerName } from '../lib/playerIdentity';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';

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
const NAKAMA_HOST = process.env.NEXT_PUBLIC_NAKAMA_HOST || '127.0.0.1';
const NAKAMA_PORT = process.env.NEXT_PUBLIC_NAKAMA_PORT || '7350';
const NAKAMA_CLIENT_KEY =
  process.env.NEXT_PUBLIC_NAKAMA_CLIENT_KEY ||
  process.env.NEXT_PUBLIC_NAKAMA_SERVER_KEY ||
  'defaultkey';
const NAKAMA_MATCH_MODULE = process.env.NEXT_PUBLIC_NAKAMA_MATCH_MODULE || 'pdh';
const NAKAMA_TABLE_ID = process.env.NEXT_PUBLIC_NAKAMA_TABLE_ID || 'main';
const NAKAMA_MATCH_ID = process.env.NEXT_PUBLIC_NAKAMA_MATCH_ID;

const STORAGE_KEYS = {
  playerId: 'playerId',
  matchId: 'nakamaMatchId',
  deviceId: 'nakamaDeviceId',
  nextMutatingSeq: 'nakamaNextMutatingSeq',
} as const;

const UI_STORAGE_KEYS = {
  soundEnabled: 'pdh.table.sound_enabled',
  showActivityFeed: 'pdh.table.show_activity_feed',
  showTableChat: 'pdh.table.show_chat',
  mutedChatPlayerIds: 'pdh.table.muted_chat_player_ids',
} as const;

const REACTION_COOLDOWN_MS = 2500;
const REACTION_VISIBLE_MS = 2200;
const CHAT_HISTORY_LIMIT = 50;

const textDecoder = new TextDecoder();

const enum MatchOpCode {
  ClientMessage = 1,
  ServerMessage = 2,
}

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const NAKAMA_USE_SSL = parseBoolean(process.env.NEXT_PUBLIC_NAKAMA_USE_SSL, false);
const USE_NAKAMA_BACKEND = NETWORK_BACKEND === 'nakama';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const TABLE_THEME = {
  fontSans:
    'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
  fontDisplay:
    'var(--font-display, "Sora", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
  pageBackground:
    'radial-gradient(circle at 72% 18%, rgba(20,184,166,0.17), transparent 31%), ' +
    'radial-gradient(circle at 16% 16%, rgba(251,191,36,0.1), transparent 29%), ' +
    'linear-gradient(180deg, rgba(3,8,11,0.94), rgba(2,7,9,0.985)), ' +
    'url("/Casino floor background.png")',
  panel: 'rgba(3,8,11,0.76)',
  panelStrong: 'rgba(2,7,9,0.92)',
  panelSoft: 'rgba(255,255,255,0.035)',
  border: 'rgba(255,255,255,0.14)',
  borderStrong: 'rgba(251,191,36,0.42)',
  amber: '#fde68a',
  amberStrong: '#fbbf24',
  teal: '#5eead4',
  tealSoft: 'rgba(20,184,166,0.24)',
  tealBorder: 'rgba(94,234,212,0.54)',
  text: '#f8fafc',
  muted: 'rgba(212,212,216,0.78)',
  dim: 'rgba(161,161,170,0.78)',
};

const createDeviceId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pdh-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
};

const getOrCreateDeviceId = () => {
  if (typeof window === 'undefined') {
    return createDeviceId();
  }
  const existing = window.localStorage.getItem(STORAGE_KEYS.deviceId);
  if (existing) {
    return existing;
  }
  const created = createDeviceId();
  window.localStorage.setItem(STORAGE_KEYS.deviceId, created);
  return created;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const authenticateDeviceWithRetries = async (client: NakamaClient, deviceId: string) => {
  try {
    return await client.authenticateDevice(deviceId, true);
  } catch (createError) {
    let lastError: unknown = createError;
    for (const delayMs of [50, 150, 350, 700]) {
      await sleep(delayMs);
      try {
        return await client.authenticateDevice(deviceId, false);
      } catch (loginError) {
        lastError = loginError;
      }
    }
    throw lastError;
  }
};

const errorMessage = (error: unknown) => {
  if (typeof Response !== 'undefined' && error instanceof Response) {
    const statusText = error.statusText ? ` ${error.statusText}` : '';
    return `HTTP ${error.status}${statusText}`;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybeStatus = (error as { status?: unknown }).status;
    const maybeStatusText = (error as { statusText?: unknown }).statusText;
    if (typeof maybeStatus === 'number') {
      const statusText =
        typeof maybeStatusText === 'string' && maybeStatusText ? ` ${maybeStatusText}` : '';
      return `HTTP ${maybeStatus}${statusText}`;
    }
    const maybeCode = (error as { code?: unknown }).code;
    if (typeof maybeCode === 'string' || typeof maybeCode === 'number') {
      return `code ${String(maybeCode)}`;
    }
    const maybeError = (error as { error?: unknown }).error;
    if (typeof maybeError === 'string') {
      return maybeError;
    }
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const friendlyStatus = (message: string | null | undefined) => {
  const raw = (message ?? '').trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return null;
  }
  if (/http\s*500|internal server error/.test(lower)) {
    return {
      title: 'Table service had a problem',
      detail: 'The table server returned an error. Try again, or go back to the lobby.',
    };
  }
  if (lower.includes('player not pending discard') || lower.includes('not in discard phase')) {
    return {
      title: 'Discard not received',
      detail: 'Choose a card again. The table state has refreshed.',
    };
  }
  if (lower.includes('connection failed') || lower.includes('socket error')) {
    return {
      title: 'Connection problem',
      detail: raw,
    };
  }
  if (lower.includes('join timed out')) {
    return {
      title: 'Could not take a seat',
      detail: raw,
    };
  }
  if (lower.includes('duplicate or stale action sequence')) {
    return {
      title: 'Action already handled',
      detail: 'The table ignored a repeated action. The latest table state is loading.',
    };
  }

  return {
    title: lower.includes('error') || lower.includes('failed') ? 'Table problem' : 'Table notice',
    detail: raw,
  };
};

const startupSanityError = () => {
  if (!USE_NAKAMA_BACKEND) return null;
  if (typeof window === 'undefined') return null;

  if (!NAKAMA_HOST.trim()) {
    return 'Missing NEXT_PUBLIC_NAKAMA_HOST';
  }
  if (!NAKAMA_PORT.trim()) {
    return 'Missing NEXT_PUBLIC_NAKAMA_PORT';
  }
  if (!NAKAMA_CLIENT_KEY.trim()) {
    return 'Missing NEXT_PUBLIC_NAKAMA_CLIENT_KEY';
  }

  if (window.location.protocol === 'https:' && !NAKAMA_USE_SSL) {
    return 'NEXT_PUBLIC_NAKAMA_USE_SSL=false on an HTTPS site';
  }

  const uiHost = window.location.hostname.toLowerCase();
  const apiHost = NAKAMA_HOST.trim().toLowerCase();
  if (!LOCAL_HOSTS.has(uiHost) && LOCAL_HOSTS.has(apiHost)) {
    return `Nakama host ${NAKAMA_HOST} is local, but UI host is ${window.location.hostname}`;
  }

  return null;
};

const suitSymbol = (suit: Card['suit']) => {
  switch (suit) {
    case 'H':
      return '♥';
    case 'D':
      return '♦';
    case 'C':
      return '♣';
    case 'S':
      return '♠';
    default:
      return suit;
  }
};

const AVATAR_SUITS: Card['suit'][] = ['C', 'S', 'H', 'D'];
const avatarSuitForId = (id?: string) => {
  if (!id) return 'S';
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_SUITS[hash % AVATAR_SUITS.length];
};
const avatarSuitColor = (suit: Card['suit']) =>
  suit === 'H' || suit === 'D' ? '#dc2626' : '#111827';

const cardRankLabel = (rank: Card['rank']) => (rank === 'T' ? '10' : rank);
const cardText = (c: Card) => `${cardRankLabel(c.rank)}${suitSymbol(c.suit)}`;
type PlayerActionType = Extract<ClientMessage, { type: 'action' }>['action'];
type ServerStatePayload = Extract<ServerMessage, { type: 'state' }>['state'];
const seatBelongsToPlayer = (seat: unknown, playerId: string) =>
  Boolean(
    seat && typeof seat === 'object' && 'id' in seat && (seat as { id?: unknown }).id === playerId
  );
const playerIdFromState = (state: ServerStatePayload) =>
  state &&
  typeof state === 'object' &&
  'you' in state &&
  state.you &&
  typeof state.you === 'object' &&
  'playerId' in state.you &&
  typeof state.you.playerId === 'string'
    ? state.you.playerId
    : null;
const stateHasSeatedPlayer = (state: ServerStatePayload, playerId: string) =>
  Array.isArray(state.seats) && state.seats.some((seat) => seatBelongsToPlayer(seat, playerId));
const isHiddenCard = (card: Card) =>
  (card as unknown as { rank: string }).rank === 'X' ||
  (card as unknown as { suit: string }).suit === 'X';
const formatHandLabel = (label: string) => {
  const lower = label.trim().toLowerCase();
  if (!lower) return lower;
  if (lower.endsWith(' high')) return lower;
  if (lower.startsWith('two pair')) return lower;
  if (lower.startsWith('three of a kind')) return lower;
  if (lower.startsWith('four of a kind')) return lower;
  if (lower.startsWith('five of a kind')) return lower;
  if (lower.startsWith('pair of')) return `a ${lower}`;
  if (lower === 'pair') return 'a pair';
  if (['full house', 'straight', 'flush', 'straight flush', 'royal flush'].includes(lower)) {
    return `a ${lower}`;
  }
  return lower;
};

const formatStreetLabel = (street: HandState['street']) => {
  switch (street) {
    case 'preflop':
      return 'Preflop';
    case 'flop':
      return 'Flop';
    case 'turn':
      return 'Turn';
    case 'river':
      return 'River';
    case 'showdown':
      return 'Showdown';
    default:
      return street;
  }
};

const MINIMAL_DECK_PALETTE = {
  face: '#f6f7f2',
  border: '#e2e8f0',
  navy: '#0b1d3a',
  orange: '#f15a29',
  accent: '#cbd5e1',
};
const USE_CUSTOM_MINIMAL_DECK = true;

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
const BASE_TABLE_WIDTH = 780;
const BASE_TABLE_HEIGHT = 410;

interface PokerGamePageProps {
  forcedMatchId?: string | null;
  onExitLobby?: () => void;
  showExitButton?: boolean;
}

type Pip = { x: number; y: number; size?: number };

const pipLayoutByRank: Record<Card['rank'], Pip[]> = {
  A: [{ x: 50, y: 72, size: 28 }],
  K: [],
  Q: [],
  J: [],
  T: [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 52 },
    { x: 68, y: 52 },
    { x: 32, y: 70 },
    { x: 68, y: 70 },
    { x: 32, y: 88 },
    { x: 68, y: 88 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
  ],
  '9': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 52 },
    { x: 68, y: 52 },
    { x: 32, y: 88 },
    { x: 68, y: 88 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
    { x: 50, y: 70 },
  ],
  '8': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 52 },
    { x: 68, y: 52 },
    { x: 32, y: 88 },
    { x: 68, y: 88 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
  ],
  '7': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 70 },
    { x: 68, y: 70 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
    { x: 50, y: 52 },
  ],
  '6': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 70 },
    { x: 68, y: 70 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
  ],
  '5': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
    { x: 50, y: 70 },
  ],
  '4': [
    { x: 32, y: 34 },
    { x: 68, y: 34 },
    { x: 32, y: 106 },
    { x: 68, y: 106 },
  ],
  '3': [
    { x: 50, y: 34 },
    { x: 50, y: 70 },
    { x: 50, y: 106 },
  ],
  '2': [
    { x: 50, y: 34 },
    { x: 50, y: 106 },
  ],
};

const SuitPip = ({
  suit,
  x,
  y,
  size,
  color,
}: {
  suit: Card['suit'];
  x: number;
  y: number;
  size: number;
  color: string;
}) => {
  const scale = size / 100;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) translate(-50 -50)`} fill={color}>
      {suit === 'H' && (
        <path d="M50 90 L18 52 C6 36 14 16 34 16 C44 16 50 24 50 32 C50 24 56 16 66 16 C86 16 94 36 82 52 L50 90 Z" />
      )}
      {suit === 'S' && (
        <>
          <path d="M50 12 C70 32 90 50 50 88 C10 50 30 32 50 12 Z" />
          <path d="M45 88 L55 88 L62 100 L38 100 Z" />
        </>
      )}
      {suit === 'D' && <polygon points="50,8 88,50 50,92 12,50" />}
      {suit === 'C' && (
        <>
          <circle cx="35" cy="45" r="18" />
          <circle cx="65" cy="45" r="18" />
          <circle cx="50" cy="25" r="18" />
          <rect x="44" y="45" width="12" height="38" rx="4" />
        </>
      )}
    </g>
  );
};

type ActionTone = 'raise' | 'call' | 'allin' | 'fold' | 'check' | 'bet';
type ActionBadge = { name: string; label: string; tone: ActionTone; amount?: number };
type TableReaction = (typeof TABLE_REACTIONS)[number];
type LiveTableReaction = {
  id: string;
  playerId: string;
  emoji: TableReaction;
  ts: number;
};
type TableChatMessage = {
  id: string;
  playerId: string;
  message: string;
  ts: number;
};

const TABLE_REACTION_LABELS: Record<TableReaction, string> = {
  gg: 'GG',
  wow: 'WOW',
  nice: 'NICE',
  oops: 'OOPS',
  fire: 'FIRE',
};

const ACTION_TONE_STYLES: Record<
  ActionTone,
  { background: string; border: string; color: string }
> = {
  raise: { background: 'rgba(20,184,166,0.2)', border: '#5eead4', color: '#ccfbf1' },
  call: { background: 'rgba(20,83,45,0.42)', border: '#86efac', color: '#dcfce7' },
  allin: { background: 'rgba(127,29,29,0.62)', border: '#fbbf24', color: '#fef3c7' },
  fold: { background: 'rgba(63, 29, 29, 0.9)', border: '#ef4444', color: '#fee2e2' },
  check: { background: 'rgba(255,255,255,0.06)', border: '#a1a1aa', color: '#f4f4f5' },
  bet: { background: 'rgba(251,191,36,0.18)', border: '#fbbf24', color: '#fef3c7' },
};

const parseActionMessage = (message: string): ActionBadge | null => {
  const patterns: Array<{ re: RegExp; label: string; tone: ActionTone; amountIndex?: number }> = [
    { re: /^(.+?) folded$/, label: 'Fold', tone: 'fold' },
    { re: /^(.+?) checked$/, label: 'Check', tone: 'check' },
    { re: /^(.+?) called all-in for (\d+)$/, label: 'Call', tone: 'allin', amountIndex: 2 },
    { re: /^(.+?) is all-in for (\d+)$/, label: 'All-in', tone: 'allin', amountIndex: 2 },
    { re: /^(.+?) all-in to (\d+)$/, label: 'All-in', tone: 'allin', amountIndex: 2 },
    { re: /^(.+?) raised short to (\d+)$/, label: 'Raise', tone: 'raise', amountIndex: 2 },
    { re: /^(.+?) raised to (\d+)$/, label: 'Raise', tone: 'raise', amountIndex: 2 },
    { re: /^(.+?) called (\d+)$/, label: 'Call', tone: 'call', amountIndex: 2 },
    { re: /^(.+?) bet (\d+)$/, label: 'Bet', tone: 'bet', amountIndex: 2 },
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern.re);
    if (!match) continue;
    const amount = pattern.amountIndex ? Number(match[pattern.amountIndex]) : undefined;
    return { name: match[1], label: pattern.label, tone: pattern.tone, amount };
  }
  return null;
};

const CardBack = ({
  size = 'medium',
  tone = 'navy',
}: {
  size?: 'small' | 'medium';
  tone?: 'navy' | 'red' | 'gold';
}) => {
  const sizing =
    size === 'small'
      ? { width: 30, height: 44, radius: 6, inset: 3 }
      : { width: 36, height: 52, radius: 7, inset: 4 };
  const palette =
    tone === 'red'
      ? { base: '#b91c1c', dark: '#7f1d1d', border: '#f8fafc', pattern: 'rgba(254,226,226,0.35)' }
      : tone === 'gold'
        ? { base: '#9a6a24', dark: '#6b4517', border: '#fef3c7', pattern: 'rgba(252,211,77,0.28)' }
        : {
            base: '#0f172a',
            dark: '#1f2937',
            border: '#f8fafc',
            pattern: 'rgba(148,163,184,0.25)',
          };
  return (
    <div
      style={{
        width: sizing.width,
        height: sizing.height,
        borderRadius: sizing.radius,
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: sizing.inset,
          borderRadius: sizing.radius - 2,
          border: 'none',
          background:
            `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.16), rgba(0,0,0,0) 55%), ` +
            `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.12), rgba(0,0,0,0) 40%), ` +
            `radial-gradient(circle at 70% 70%, rgba(255,255,255,0.1), rgba(0,0,0,0) 42%), ` +
            `repeating-linear-gradient(45deg, ${palette.pattern} 0 1px, rgba(0,0,0,0.2) 1px 3px), ` +
            `repeating-linear-gradient(-45deg, ${palette.pattern} 0 1px, rgba(0,0,0,0.18) 1px 3px), ` +
            `linear-gradient(135deg, ${palette.base}, ${palette.dark})`,
        }}
      />
    </div>
  );
};

export const PokerGamePage = ({
  forcedMatchId = null,
  onExitLobby,
  showExitButton = true,
}: PokerGamePageProps) => {
  const connectionRef = useRef<{ send: (msg: ClientMessage) => void; close: () => void } | null>(
    null
  );
  const legacySocketRef = useRef<WebSocket | null>(null);
  const pendingMessagesRef = useRef<ClientMessage[]>([]);
  const nextMutatingSeqRef = useRef(1);
  const discardTimerRef = useRef<number | null>(null);
  const holeDealTimerRef = useRef<number | null>(null);
  const joinTimeoutRef = useRef<number | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [tableScale, setTableScale] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [viewportHeight, setViewportHeight] = useState(800);
  const buyIn = 10000;
  const [state, setState] = useState<any>(null);
  const [status, setStatus] = useState<string>('Disconnected');
  const [betAmount, setBetAmount] = useState<number>(200);
  const [discardFlashIndex, setDiscardFlashIndex] = useState<number | null>(null);
  const [discardSubmitted, setDiscardSubmitted] = useState(false);
  const [selectedDiscardIndex, setSelectedDiscardIndex] = useState<number | null>(null);
  const [liveReactions, setLiveReactions] = useState<LiveTableReaction[]>([]);
  const [reactionCooldownUntil, setReactionCooldownUntil] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showActivityFeed, setShowActivityFeed] = useState(true);
  const [showTableChat, setShowTableChat] = useState(true);
  const [showUtilitiesPanel, setShowUtilitiesPanel] = useState(false);
  const [showTopMenu, setShowTopMenu] = useState(false);
  const [showRaiseDrawer, setShowRaiseDrawer] = useState(false);
  const [confirmAllIn, setConfirmAllIn] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<TableChatMessage[]>([]);
  const [mutedChatPlayerIds, setMutedChatPlayerIds] = useState<string[]>([]);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const resolvedForcedMatchId = forcedMatchId?.trim() || '';
  const hasLoggedTableJoinedRef = useRef(false);
  const hasLoggedFirstActionRef = useRef(false);
  const autoJoinAttemptedRef = useRef(false);
  const [hasReceivedState, setHasReceivedState] = useState(false);

  const requestFreshState = () => {
    const msg: ClientMessage = { type: 'requestState' };
    if (!connectionRef.current) {
      pendingMessagesRef.current.push(msg);
      return;
    }
    if (legacySocketRef.current && legacySocketRef.current.readyState !== WebSocket.OPEN) {
      pendingMessagesRef.current.push(msg);
      return;
    }
    connectionRef.current.send(msg);
  };

  const recoverDiscardSubmission = (message = 'Discard not received. Choose a card again.') => {
    if (discardTimerRef.current) {
      window.clearTimeout(discardTimerRef.current);
      discardTimerRef.current = null;
    }
    setDiscardSubmitted(false);
    setDiscardFlashIndex(null);
    setSelectedDiscardIndex(null);
    setStatus(message);
    requestFreshState();
  };

  useEffect(() => {
    const storedName = readStoredPlayerName();
    if (storedName) {
      setName(storedName);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedSound = window.localStorage.getItem(UI_STORAGE_KEYS.soundEnabled);
    const storedFeed = window.localStorage.getItem(UI_STORAGE_KEYS.showActivityFeed);
    const storedChat = window.localStorage.getItem(UI_STORAGE_KEYS.showTableChat);
    const storedMuted = window.localStorage.getItem(UI_STORAGE_KEYS.mutedChatPlayerIds);
    if (storedSound !== null) {
      setSoundEnabled(storedSound !== '0');
    }
    if (storedFeed !== null) {
      setShowActivityFeed(storedFeed !== '0');
    }
    if (storedChat !== null) {
      setShowTableChat(storedChat !== '0');
    }
    if (storedMuted) {
      try {
        const parsed = JSON.parse(storedMuted) as unknown;
        if (Array.isArray(parsed)) {
          setMutedChatPlayerIds(
            parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)
          );
        }
      } catch {
        // Ignore malformed data and keep defaults.
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(UI_STORAGE_KEYS.soundEnabled, soundEnabled ? '1' : '0');
  }, [soundEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(UI_STORAGE_KEYS.showActivityFeed, showActivityFeed ? '1' : '0');
  }, [showActivityFeed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(UI_STORAGE_KEYS.showTableChat, showTableChat ? '1' : '0');
  }, [showTableChat]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(
      UI_STORAGE_KEYS.mutedChatPlayerIds,
      JSON.stringify(mutedChatPlayerIds)
    );
  }, [mutedChatPlayerIds]);

  const reserveMutatingSeq = () => {
    const seq = nextMutatingSeqRef.current;
    const nextSeq = seq + 1;
    nextMutatingSeqRef.current = nextSeq;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEYS.nextMutatingSeq, String(nextSeq));
    }
    return seq;
  };
  const withMutatingSeq = (msg: ClientMessage): ClientMessage => {
    if (
      msg.type !== 'action' &&
      msg.type !== 'discard' &&
      msg.type !== 'nextHand' &&
      msg.type !== 'rebuy' &&
      msg.type !== 'sitOut'
    ) {
      return msg;
    }
    if (typeof msg.seq === 'number' && Number.isInteger(msg.seq) && msg.seq > 0) {
      return msg;
    }
    return { ...msg, seq: reserveMutatingSeq() };
  };

  useEffect(() => {
    const existing =
      typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.playerId) : null;
    const storedNextMutatingSeq =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(STORAGE_KEYS.nextMutatingSeq)
        : null;
    const parsedNextMutatingSeq = Number.parseInt(storedNextMutatingSeq ?? '', 10);
    if (Number.isInteger(parsedNextMutatingSeq) && parsedNextMutatingSeq > 0) {
      nextMutatingSeqRef.current = parsedNextMutatingSeq;
    }
    if (existing) {
      setPlayerId(existing);
    }

    let disposed = false;
    const clearJoinTimeout = () => {
      if (joinTimeoutRef.current !== null) {
        window.clearTimeout(joinTimeoutRef.current);
        joinTimeoutRef.current = null;
      }
    };

    const onServerMessage = (msg: ServerMessage) => {
      if (msg.type === 'welcome') {
        setPlayerId(msg.playerId);
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEYS.playerId, msg.playerId);
        }
      }
      if (msg.type === 'state') {
        setHasReceivedState(true);
        const statePlayerId = playerIdFromState(msg.state);
        if (statePlayerId) {
          setPlayerId(statePlayerId);
          if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEYS.playerId, statePlayerId);
          }
          if (stateHasSeatedPlayer(msg.state, statePlayerId)) {
            clearJoinTimeout();
            setStatus((previous) =>
              previous === 'Joining table...' || previous === 'Connecting to table...'
                ? 'Connected'
                : previous
            );
          }
        }
        setState(msg.state);
      }
      if (msg.type === 'error') {
        clearJoinTimeout();
        if (
          msg.message.toLowerCase().includes('player not pending discard') ||
          msg.message.toLowerCase().includes('not in discard phase')
        ) {
          recoverDiscardSubmission('Discard not received. Choose a card again.');
        } else {
          setStatus(msg.message);
        }
      }
      if (msg.type === 'reaction') {
        const reactionId = `${msg.playerId}-${msg.ts}-${Math.floor(Math.random() * 1_000_000)}`;
        setLiveReactions((previous) => {
          const next = [
            ...previous,
            {
              id: reactionId,
              playerId: msg.playerId,
              emoji: msg.emoji,
              ts: msg.ts,
            },
          ];
          return next.slice(-24);
        });
      }
      if (msg.type === 'chat') {
        const chatId = `${msg.playerId}-${msg.ts}-${Math.floor(Math.random() * 1_000_000)}`;
        setChatMessages((previous) => {
          const next = [
            ...previous,
            {
              id: chatId,
              playerId: msg.playerId,
              message: msg.message,
              ts: msg.ts,
            },
          ];
          return next.slice(-CHAT_HISTORY_LIMIT);
        });
      }
    };

    const flushPendingMessages = () => {
      if (!connectionRef.current) return;
      const pending = pendingMessagesRef.current;
      if (!pending.length) return;
      pendingMessagesRef.current = [];
      for (const msg of pending) {
        connectionRef.current?.send(msg);
      }
    };

    const connectLegacyWebSocket = () => {
      const ws = new WebSocket(WS_URL);
      legacySocketRef.current = ws;
      connectionRef.current = {
        send: (msg) => {
          if (ws.readyState !== WebSocket.OPEN) {
            pendingMessagesRef.current.push(msg);
            return;
          }
          try {
            ws.send(JSON.stringify(msg));
          } catch (error) {
            if (msg.type === 'discard') {
              recoverDiscardSubmission('Discard not received. Choose a card again.');
            } else {
              setStatus(`Send failed: ${errorMessage(error)}`);
            }
          }
        },
        close: () => {
          ws.close();
        },
      };
      ws.onopen = () => {
        if (disposed) return;
        setStatus('Connected (legacy)');
        flushPendingMessages();
        if (existing) {
          ws.send(JSON.stringify({ type: 'reconnect', playerId: existing }));
        } else {
          ws.send(JSON.stringify({ type: 'requestState' }));
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        setStatus('Disconnected');
        legacySocketRef.current = null;
      };
      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const msg: ServerMessage = JSON.parse(ev.data.toString());
          onServerMessage(msg);
        } catch {
          setStatus('Invalid payload');
        }
      };
    };

    const joinOrCreateNakamaMatch = async (
      client: NakamaClient,
      session: Session,
      socket: NakamaSocket
    ): Promise<Match> => {
      const explicitMatchId = resolvedForcedMatchId || NAKAMA_MATCH_ID;
      if (explicitMatchId) {
        return socket.joinMatch(explicitMatchId);
      }

      const label = JSON.stringify({ tableId: NAKAMA_TABLE_ID });
      const findAuthoritativeMatchId = async () => {
        const list = await client.listMatches(session, 10, true, label, 0, 9);
        const existingMatch = (list.matches ?? []).find((match) => Boolean(match.match_id));
        return existingMatch?.match_id ?? null;
      };

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const matchId = await findAuthoritativeMatchId();
        if (matchId) {
          return socket.joinMatch(matchId);
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      throw new Error(
        `No authoritative match found for tableId=${NAKAMA_TABLE_ID}. ` +
          `Check server hook registration and module ${NAKAMA_MATCH_MODULE}.`
      );
    };

    const connectNakama = async () => {
      setStatus('Connecting to Nakama...');
      const sanity = startupSanityError();
      if (sanity) {
        throw new Error(`Startup sanity check failed: ${sanity}`);
      }

      const client = new NakamaClient(NAKAMA_CLIENT_KEY, NAKAMA_HOST, NAKAMA_PORT, NAKAMA_USE_SSL);
      const session = await authenticateDeviceWithRetries(client, getOrCreateDeviceId());
      if (disposed) return;
      const sessionUserId =
        session && typeof (session as Session & { user_id?: unknown }).user_id === 'string'
          ? ((session as Session & { user_id?: string }).user_id ?? null)
          : null;
      if (sessionUserId) {
        setPlayerId(sessionUserId);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEYS.playerId, sessionUserId);
        }
      }

      const socket = client.createSocket(NAKAMA_USE_SSL, false);
      socket.onmatchdata = (matchData) => {
        if (disposed) return;
        if (matchData.op_code !== MatchOpCode.ServerMessage) return;
        try {
          const payload = textDecoder.decode(matchData.data);
          const msg = JSON.parse(payload) as ServerMessage;
          onServerMessage(msg);
        } catch {
          setStatus('Invalid match payload');
        }
      };
      socket.ondisconnect = () => {
        if (disposed) return;
        setStatus('Disconnected');
      };
      socket.onerror = () => {
        if (disposed) return;
        setStatus('Nakama socket error');
      };

      await socket.connect(session, true);
      if (disposed) {
        socket.disconnect(false);
        return;
      }

      const match = await joinOrCreateNakamaMatch(client, session, socket);
      if (disposed) {
        socket.disconnect(false);
        return;
      }

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEYS.matchId, match.match_id);
      }

      connectionRef.current = {
        send: (msg) => {
          void socket
            .sendMatchState(match.match_id, MatchOpCode.ClientMessage, JSON.stringify(msg))
            .catch((error) => {
              if (!disposed) {
                if (msg.type === 'discard') {
                  recoverDiscardSubmission('Discard not received. Choose a card again.');
                } else {
                  setStatus(`Send failed: ${errorMessage(error)}`);
                }
              }
            });
        },
        close: () => {
          socket.disconnect(false);
        },
      };

      setStatus('Connected (nakama)');
      flushPendingMessages();
      if (existing) {
        connectionRef.current.send({ type: 'reconnect', playerId: existing });
      } else {
        connectionRef.current.send({ type: 'requestState' });
      }
    };

    if (USE_NAKAMA_BACKEND) {
      void connectNakama().catch((error) => {
        if (!disposed) {
          setStatus(`Connection failed: ${errorMessage(error)}`);
        }
      });
    } else {
      connectLegacyWebSocket();
    }

    return () => {
      disposed = true;
      if (joinTimeoutRef.current !== null) {
        window.clearTimeout(joinTimeoutRef.current);
        joinTimeoutRef.current = null;
      }
      connectionRef.current?.close();
      connectionRef.current = null;
      legacySocketRef.current = null;
    };
  }, [resolvedForcedMatchId]);

  const handleExitTable = () => {
    connectionRef.current?.close();
    connectionRef.current = null;
    legacySocketRef.current = null;
    pendingMessagesRef.current = [];

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEYS.matchId);
    }

    if (onExitLobby) {
      onExitLobby();
      return;
    }

    if (typeof window !== 'undefined') {
      window.location.assign('/play');
    }
  };

  const hand: HandState | null = state?.hand ?? null;
  const startGate = state?.startGate ?? null;
  const localSeat = useMemo(() => {
    if (!playerId || !Array.isArray(state?.seats)) return null;
    return (state.seats.find((s: any) => s && s.id === playerId) as any) ?? null;
  }, [state?.seats, playerId]);
  const seatedPlayers = useMemo(() => {
    return (state?.seats ?? []).filter(
      (seat: any) =>
        seat &&
        seat.stack > 0 &&
        !seat.sittingOut &&
        seat.status !== 'busted' &&
        seat.status !== 'sitting_out'
    );
  }, [state?.seats]);
  const you = useMemo(() => {
    if (!hand || !playerId) return null;
    return hand.players.find((p: PlayerInHand) => p.id === playerId);
  }, [hand, playerId]);
  const winnersById = useMemo(() => {
    const map = new Map<string, { bestFive?: Card[]; handLabel?: string }>();
    for (const w of hand?.showdownWinners ?? []) {
      map.set(w.playerId, { bestFive: w.bestFive, handLabel: w.handLabel });
    }
    return map;
  }, [hand?.showdownWinners]);
  const seated = useMemo(() => {
    if (!playerId) return false;
    return Boolean(state?.seats?.some((s: any) => s && s.id === playerId));
  }, [state, playerId]);
  const localSeatStack =
    typeof localSeat?.stack === 'number'
      ? localSeat.stack
      : you?.stack !== undefined
        ? you.stack
        : 0;
  const localSeatStatus =
    typeof localSeat?.status === 'string'
      ? localSeat.status
      : localSeat?.sittingOut
        ? 'sitting_out'
        : 'active';
  const localPlayerName = you?.name ?? localSeat?.name ?? name;
  const localNeedsRebuy = Boolean(
    seated &&
    localSeat &&
    localSeatStack <= 0 &&
    (localSeatStatus === 'busted' ||
      localSeatStatus === 'sitting_out' ||
      !hand ||
      hand.phase === 'showdown')
  );
  const localReadyBetweenHands = Boolean(
    seated && localSeat && !hand && !startGate && localSeatStack > 0 && localSeatStatus === 'active'
  );
  useEffect(() => {
    if (!seated) {
      setShowUtilitiesPanel(false);
      setShowTopMenu(false);
      setShowRaiseDrawer(false);
      setConfirmAllIn(false);
    }
  }, [seated]);
  useEffect(() => {
    if (!seated || !you || hasLoggedTableJoinedRef.current) {
      return;
    }
    hasLoggedTableJoinedRef.current = true;
    const storedMatchId =
      typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEYS.matchId) : null;
    logClientEvent('table_joined', {
      backend: USE_NAKAMA_BACKEND ? 'nakama' : 'legacy',
      matchId: resolvedForcedMatchId || storedMatchId || null,
      playerId: you.id,
      seat: you.seat,
      stack: you.stack,
    });
  }, [seated, you, resolvedForcedMatchId]);

  const logFirstAction = (
    kind: 'action' | 'discard',
    fields: { action?: PlayerActionType; amount?: number | null; discardIndex?: number }
  ) => {
    if (hasLoggedFirstActionRef.current) {
      return;
    }
    hasLoggedFirstActionRef.current = true;
    logClientEvent('first_action', {
      kind,
      handId: hand?.handId ?? null,
      street: hand?.street ?? null,
      phase: hand?.phase ?? null,
      ...fields,
    });
  };

  const isMyTurn = Boolean(
    hand && you && hand.phase === 'betting' && hand.actionOnSeat === you.seat
  );
  const youInfoDimmed = Boolean(
    you &&
    (you.status === 'folded' ||
      you.status === 'out' ||
      you.status === 'busted' ||
      you.status === 'sitting_out' ||
      (hand?.phase === 'betting' && !isMyTurn))
  );
  const youBusted = Boolean(you && (you.status === 'busted' || you.status === 'sitting_out'));
  const discardPending = Boolean(
    hand && you && hand.phase === 'discard' && hand.discardPending.includes(you.id)
  );
  const toCall = hand && you ? Math.max(0, hand.currentBet - you.betThisStreet) : 0;
  const isShowdown = hand?.phase === 'showdown';
  const currentStreetLabel = hand ? formatStreetLabel(hand.street) : '';
  const actionOnPlayer = useMemo(() => {
    if (!hand || hand.phase !== 'betting') {
      return null;
    }
    return hand.players.find((player) => player.seat === hand.actionOnSeat) ?? null;
  }, [hand]);
  const discardConfirmedPlayers = useMemo(() => {
    if (!hand || hand.phase !== 'discard') {
      return new Set<string>();
    }
    const confirmed = new Set<string>();
    for (const player of hand.players) {
      if (
        player.status === 'folded' ||
        player.status === 'out' ||
        player.status === 'busted' ||
        player.status === 'sitting_out'
      ) {
        continue;
      }
      if (!hand.discardPending.includes(player.id)) {
        confirmed.add(player.id);
      }
    }
    return confirmed;
  }, [hand]);
  const hasContestedShowdown = Boolean(
    hand &&
    hand.players.filter(
      (p) =>
        p.status !== 'folded' &&
        p.status !== 'out' &&
        p.status !== 'busted' &&
        p.status !== 'sitting_out'
    ).length > 1
  );
  const raiseCapReached = Boolean(hand && hand.raisesThisStreet >= 2);
  const actionSecondsLeft = useMemo(() => {
    if (!hand || hand.phase !== 'betting' || !hand.actionDeadline) {
      return null;
    }
    return Math.max(0, Math.ceil((hand.actionDeadline - clockNowMs) / 1000));
  }, [hand?.phase, hand?.actionDeadline, clockNowMs]);
  const discardSecondsLeft = useMemo(() => {
    if (!hand || hand.phase !== 'discard' || !hand.discardDeadline) {
      return null;
    }
    return Math.max(0, Math.ceil((hand.discardDeadline - clockNowMs) / 1000));
  }, [hand?.phase, hand?.discardDeadline, clockNowMs]);
  const startGateSecondsLeft = useMemo(() => {
    if (!startGate?.startsAt) {
      return null;
    }
    return Math.max(0, Math.ceil((startGate.startsAt - clockNowMs) / 1000));
  }, [startGate?.startsAt, clockNowMs]);
  const startGateReadyIds = useMemo(
    () => new Set<string>(startGate?.readyPlayerIds ?? []),
    [startGate?.readyPlayerIds]
  );
  const startGateAllReady = Boolean(
    startGate &&
      seatedPlayers.length >= startGate.minPlayers &&
      seatedPlayers.every((seat: any) => startGateReadyIds.has(seat.id))
  );
  const startGateCanEarlyStart = Boolean(
    startGateAllReady &&
      (seatedPlayers.length >= 3 ||
        (startGate?.earlyStartAt !== undefined && clockNowMs >= startGate.earlyStartAt))
  );
  const localReadyForStart = Boolean(playerId && startGateReadyIds.has(playerId));
  const isMobile = viewportWidth <= 900;
  const isPhone = viewportWidth <= 640;
  const isPortraitPhone = isPhone && viewportHeight > viewportWidth;
  const isLandscapePhone = isMobile && viewportHeight <= 520 && viewportWidth > viewportHeight;
  const pinActionTray = isMobile && !isLandscapePhone;
  const layoutTableWidth = isPortraitPhone ? 430 : isLandscapePhone ? 780 : isMobile ? BASE_TABLE_WIDTH : 920;
  const layoutTableHeight = isPortraitPhone ? 640 : isLandscapePhone ? 300 : isMobile ? BASE_TABLE_HEIGHT : 480;
  const tableTimerSeconds =
    hand?.phase === 'betting'
      ? actionSecondsLeft
      : hand?.phase === 'discard'
        ? discardSecondsLeft
        : null;
  const isBettingPhase = hand?.phase === 'betting';
  const isDiscardPhase = hand?.phase === 'discard';
  const isRevealPhase = hand?.phase === 'showdown';
  const tableLabel = useMemo(() => {
    const sourceId = typeof state?.id === 'string' && state.id.trim() ? state.id.trim() : '';
    if (!sourceId) return `Table ${NAKAMA_TABLE_ID}`;
    return `Table ${sourceId}`;
  }, [state?.id]);
  const latestActionLine = useMemo(() => {
    const lines: Array<{ message?: string }> = state?.log ?? [];
    for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
      const message = lines[idx]?.message;
      if (!message) continue;
      if (
        /(posts|folded|checked|called|raised|bet|all-in|discarded|wins|rebought|out of chips|sits out)/i.test(
          message
        )
      ) {
        return message;
      }
    }
    return null;
  }, [state?.log]);
  const dealAnimationKey = hand?.handId ?? 'no-hand';
  const [animateHoleDeal, setAnimateHoleDeal] = useState(false);
  const suggestedRaiseTo = useMemo(() => {
    if (!hand) return null;
    if (hand.currentBet === 0) return hand.minRaise;
    return hand.currentBet + hand.minRaise;
  }, [hand?.currentBet, hand?.minRaise]);
  const actionByPlayerId = useMemo(() => {
    if (!hand || hand.phase !== 'betting') return new Map<string, ActionBadge>();
    const logs = hand.log ?? [];
    let startIdx = 0;
    if (hand.street === 'preflop') {
      for (let i = logs.length - 1; i >= 0; i -= 1) {
        if (logs[i].message === 'Hand started') {
          startIdx = i + 1;
          break;
        }
      }
    } else {
      const marker = `Starting betting on ${hand.street}`;
      for (let i = logs.length - 1; i >= 0; i -= 1) {
        if (logs[i].message === marker) {
          startIdx = i + 1;
          break;
        }
      }
    }
    const playersByName = new Map(hand.players.map((p) => [p.name, p.id]));
    const map = new Map<string, ActionBadge>();
    for (let i = startIdx; i < logs.length; i += 1) {
      const parsed = parseActionMessage(logs[i].message);
      if (!parsed) continue;
      const playerId = playersByName.get(parsed.name);
      if (!playerId) continue;
      map.set(playerId, parsed);
    }
    return map;
  }, [hand?.log, hand?.phase, hand?.street, hand?.players]);
  const latestReactionByPlayerId = useMemo(() => {
    const map = new Map<string, LiveTableReaction>();
    for (const reaction of liveReactions) {
      const existing = map.get(reaction.playerId);
      if (!existing || existing.ts < reaction.ts) {
        map.set(reaction.playerId, reaction);
      }
    }
    return map;
  }, [liveReactions]);
  const playerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const seat of state?.seats ?? []) {
      if (seat?.id && seat?.name) {
        map.set(seat.id, seat.name);
      }
    }
    for (const player of hand?.players ?? []) {
      map.set(player.id, player.name);
    }
    return map;
  }, [state?.seats, hand?.players]);
  const mutedChatPlayerSet = useMemo(() => new Set(mutedChatPlayerIds), [mutedChatPlayerIds]);
  const visibleChatMessages = useMemo(() => {
    return chatMessages.filter((message) => !mutedChatPlayerSet.has(message.playerId));
  }, [chatMessages, mutedChatPlayerSet]);
  const hiddenChatCount = chatMessages.length - visibleChatMessages.length;

  useEffect(() => {
    if (!hand) {
      return;
    }
    if (hand.phase !== 'showdown') {
      return;
    }
    if (localNeedsRebuy) {
      return;
    }
    const timeoutId = window.setTimeout(() => send({ type: 'nextHand' }), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [hand?.phase, hand?.handId, localNeedsRebuy]);

  useEffect(() => {
    if (!discardPending) {
      setDiscardFlashIndex(null);
      setDiscardSubmitted(false);
      setSelectedDiscardIndex(null);
      if (discardTimerRef.current) {
        window.clearTimeout(discardTimerRef.current);
        discardTimerRef.current = null;
      }
    }
  }, [discardPending, hand?.handId]);

  useIsomorphicLayoutEffect(() => {
    if (!hand?.handId) return;
    setDiscardFlashIndex(null);
    setDiscardSubmitted(false);
    setSelectedDiscardIndex(null);
    setAnimateHoleDeal(true);
    if (holeDealTimerRef.current) {
      window.clearTimeout(holeDealTimerRef.current);
    }
    holeDealTimerRef.current = window.setTimeout(() => {
      setAnimateHoleDeal(false);
      holeDealTimerRef.current = null;
    }, 1400);
    return () => {
      if (holeDealTimerRef.current) {
        window.clearTimeout(holeDealTimerRef.current);
        holeDealTimerRef.current = null;
      }
    };
  }, [hand?.handId]);

  useEffect(() => {
    if (!startGate && (!hand || (hand.phase !== 'betting' && hand.phase !== 'discard'))) {
      return;
    }
    setClockNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [hand?.handId, hand?.phase, hand?.actionDeadline, hand?.discardDeadline, startGate?.startsAt]);

  useEffect(() => {
    if (!liveReactions.length) {
      return;
    }
    const intervalId = window.setInterval(() => {
      const cutoff = Date.now() - REACTION_VISIBLE_MS;
      setLiveReactions((previous) => previous.filter((reaction) => reaction.ts >= cutoff));
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [liveReactions.length]);

  useEffect(() => {
    if (reactionCooldownUntil <= Date.now()) {
      return;
    }
    const timeoutId = window.setTimeout(
      () => {
        setReactionCooldownUntil(0);
      },
      Math.max(0, reactionCooldownUntil - Date.now())
    );
    return () => window.clearTimeout(timeoutId);
  }, [reactionCooldownUntil]);

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const updateScale = () => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nextScale = Math.min(rect.width / layoutTableWidth, rect.height / layoutTableHeight);
      setTableScale((prev) => (Math.abs(prev - nextScale) < 0.001 ? prev : nextScale));
    };
    updateScale();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateScale);
      return () => window.removeEventListener('resize', updateScale);
    }
    const observer = new ResizeObserver(updateScale);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layoutTableWidth, layoutTableHeight]);

  useEffect(() => {
    return () => {
      if (discardTimerRef.current) {
        window.clearTimeout(discardTimerRef.current);
        discardTimerRef.current = null;
      }
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const updateViewportSize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    updateViewportSize();
    window.addEventListener('resize', updateViewportSize);
    window.addEventListener('orientationchange', updateViewportSize);
    return () => {
      window.removeEventListener('resize', updateViewportSize);
      window.removeEventListener('orientationchange', updateViewportSize);
    };
  }, []);

  useEffect(() => {
    if (!isMyTurn || suggestedRaiseTo === null) return;
    setBetAmount(suggestedRaiseTo);
  }, [isMyTurn, hand?.handId, hand?.currentBet, hand?.minRaise, suggestedRaiseTo]);

  useEffect(() => {
    if (!hand || hand.phase !== 'betting' || !isMyTurn) {
      setShowRaiseDrawer(false);
      setConfirmAllIn(false);
    }
  }, [hand?.handId, hand?.phase, isMyTurn]);

  const send = (msg: ClientMessage) => {
    const outgoing = withMutatingSeq(msg);
    if (!connectionRef.current) {
      pendingMessagesRef.current.push(outgoing);
      return;
    }
    if (legacySocketRef.current && legacySocketRef.current.readyState !== WebSocket.OPEN) {
      pendingMessagesRef.current.push(outgoing);
      return;
    }
    connectionRef.current.send(outgoing);
  };

  const join = () => {
    const trimmed = normalizePlayerName(name);
    if (!trimmed) {
      setNameError('Please enter a name.');
      return;
    }
    setName(trimmed);
    storePlayerName(trimmed);
    if (!connectionRef.current) {
      setStatus('Connecting to table...');
      return;
    }
    setStatus('Joining table...');
    if (joinTimeoutRef.current !== null) {
      window.clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
    joinTimeoutRef.current = window.setTimeout(() => {
      setStatus('Join timed out before seating. Please try again or refresh the table.');
      joinTimeoutRef.current = null;
    }, 7000);
    send({ type: 'join', name: trimmed, buyIn });
    window.setTimeout(() => {
      send({ type: 'requestState' });
    }, 160);
  };

  useEffect(() => {
    if (autoJoinAttemptedRef.current || !hasReceivedState || seated) {
      return;
    }
    if (!status.startsWith('Connected') || !connectionRef.current) {
      return;
    }

    const normalizedName = normalizePlayerName(name);
    if (!normalizedName) {
      return;
    }

    autoJoinAttemptedRef.current = true;
    storePlayerName(normalizedName);
    setName(normalizedName);
    setNameError(null);
    setStatus('Joining table...');
    if (joinTimeoutRef.current !== null) {
      window.clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
    joinTimeoutRef.current = window.setTimeout(() => {
      setStatus('Join timed out before seating. Please try again or refresh the table.');
      joinTimeoutRef.current = null;
    }, 7000);
    send({ type: 'join', name: normalizedName, buyIn });
    window.setTimeout(() => {
      send({ type: 'requestState' });
    }, 160);
  }, [buyIn, hasReceivedState, name, seated, status]);

  const act = (action: PlayerActionType, amount?: number) => {
    logFirstAction('action', {
      action,
      amount: amount ?? null,
    });
    send({ type: 'action', action, amount });
  };

  const rebuy = () => {
    logClientEvent('table_rebuy_click', {
      handId: hand?.handId ?? null,
      stack: localSeatStack,
      status: localSeatStatus,
    });
    send({ type: 'rebuy', amount: 10000 });
  };

  const sitOut = () => {
    logClientEvent('table_sit_out_click', {
      handId: hand?.handId ?? null,
      stack: localSeatStack,
      status: localSeatStatus,
    });
    send({ type: 'sitOut' });
  };

  const toggleReadyForHand = () => {
    logClientEvent('table_ready_for_hand_click', {
      tableId: state?.id ?? null,
      ready: !localReadyForStart,
      seatedPlayers: seatedPlayers.length,
      secondsLeft: startGateSecondsLeft,
    });
    send({ type: 'readyForHand', ready: !localReadyForStart });
  };

  const discard = (idx: number) => {
    send({ type: 'discard', index: idx });
  };

  const submitDiscard = (idx: number) => {
    if (!discardPending || discardSubmitted) return;
    logFirstAction('discard', { discardIndex: idx });
    setDiscardSubmitted(true);
    setDiscardFlashIndex(idx);
    setSelectedDiscardIndex(null);
    discard(idx);
    if (discardTimerRef.current) {
      window.clearTimeout(discardTimerRef.current);
    }
    discardTimerRef.current = window.setTimeout(() => {
      setDiscardFlashIndex(null);
      discardTimerRef.current = null;
    }, 450);
  };

  const handleDiscardClick = (idx: number) => {
    if (!discardPending || discardSubmitted) return;
    setSelectedDiscardIndex((previous) => (previous === idx ? null : idx));
  };

  const confirmDiscardSelection = () => {
    if (selectedDiscardIndex === null) {
      return;
    }
    submitDiscard(selectedDiscardIndex);
  };

  const sendReaction = (emoji: TableReaction) => {
    if (!you || !seated) {
      return;
    }
    if (Date.now() < reactionCooldownUntil) {
      return;
    }
    setReactionCooldownUntil(Date.now() + REACTION_COOLDOWN_MS);
    logClientEvent('table_reaction_send', {
      emoji,
      handId: hand?.handId ?? null,
      street: hand?.street ?? null,
      phase: hand?.phase ?? null,
    });
    send({ type: 'reaction', emoji });
  };

  const sendChatMessage = () => {
    if (!you || !seated) {
      return;
    }
    const normalized = chatInput.trim().replace(/\s+/g, ' ').slice(0, TABLE_CHAT_MAX_LENGTH);
    if (!normalized) {
      return;
    }
    logClientEvent('table_chat_send', {
      length: normalized.length,
      handId: hand?.handId ?? null,
      street: hand?.street ?? null,
      phase: hand?.phase ?? null,
    });
    send({ type: 'chat', message: normalized });
    setChatInput('');
  };

  const toggleMuteChatPlayer = (targetPlayerId: string) => {
    if (!targetPlayerId || targetPlayerId === playerId) {
      return;
    }
    setMutedChatPlayerIds((previous) => {
      if (previous.includes(targetPlayerId)) {
        return previous.filter((id) => id !== targetPlayerId);
      }
      return [...previous, targetPlayerId];
    });
  };

  const renderActionBadge = (action?: ActionBadge) => {
    if (!action || isPhone) return null;
    const tone = ACTION_TONE_STYLES[action.tone];
    return (
      <div
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translate(-50%, 6px)',
          padding: '4px 8px',
          borderRadius: 8,
          background: tone.background,
          border: `1px solid ${tone.border}`,
          color: tone.color,
          fontSize: 11,
          fontFamily: TABLE_THEME.fontSans,
          whiteSpace: 'nowrap',
          boxShadow: '0 8px 18px rgba(0,0,0,0.35)',
        }}
      >
        {action.label}
        {action.amount !== undefined ? ` ${action.amount}` : ''}
      </div>
    );
  };

  const renderReactionBadge = (playerId: string) => {
    const reaction = latestReactionByPlayerId.get(playerId);
    if (!reaction) {
      return null;
    }
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translate(-50%, -118%)',
          padding: '5px 8px',
          borderRadius: 999,
          border: '1px solid rgba(20,184,166,0.65)',
          background: 'rgba(2, 18, 26, 0.92)',
          color: '#ccfbf1',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0.5,
          fontFamily: TABLE_THEME.fontSans,
          boxShadow: '0 10px 20px rgba(0,0,0,0.38)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          textTransform: 'uppercase',
        }}
      >
        {TABLE_REACTION_LABELS[reaction.emoji]}
      </div>
    );
  };

  const renderTurnTimer = (isActive: boolean) => {
    if (!isActive || tableTimerSeconds === null) {
      return null;
    }
    const progress = Math.max(0, Math.min(1, tableTimerSeconds / 30));
    return (
      <div
        aria-label={`${tableTimerSeconds} seconds to act`}
        style={{
          position: 'absolute',
          top: -12,
          left: -12,
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: `conic-gradient(${timerTone} ${Math.round(progress * 360)}deg, rgba(148,163,184,0.22) 0deg)`,
          boxShadow: '0 0 18px rgba(20,184,166,0.32)',
          display: 'grid',
          placeItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            width: 23,
            height: 23,
            borderRadius: '50%',
            background: 'rgba(2,7,9,0.92)',
            color: timerTone,
            display: 'grid',
            placeItems: 'center',
            fontSize: 10,
            fontWeight: 800,
            lineHeight: 1,
          }}
        >
          {tableTimerSeconds}
        </span>
      </div>
    );
  };

  const renderBetPill = (amount: number | undefined, style?: React.CSSProperties) => {
    if (!amount || amount <= 0) {
      return null;
    }
    return (
      <div
        style={{
          position: 'absolute',
          zIndex: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 8px',
          borderRadius: 999,
          border: '1px solid rgba(251,191,36,0.62)',
          background: 'rgba(31,41,55,0.86)',
          color: '#fef3c7',
          fontSize: 11,
          fontWeight: 800,
          boxShadow: '0 9px 20px rgba(0,0,0,0.36)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          ...style,
        }}
      >
        <StackChipsIcon size={13} />
        {amount}
      </div>
    );
  };

  const communityCards = hand?.board ?? [];
  const cardKey = (card: Card) => `${card.rank}${card.suit}`;
  const potAmount = useMemo(() => {
    if (!hand) return 0;
    return hand.players.reduce((sum, p) => sum + p.totalCommitted, 0);
  }, [hand]);
  const winningCards = useMemo(() => {
    const keys = new Set<string>();
    for (const w of hand?.showdownWinners ?? []) {
      for (const c of w.bestFive ?? []) {
        keys.add(cardKey(c));
      }
    }
    return keys;
  }, [hand?.showdownWinners]);
  const showdownSummary = useMemo(() => {
    if (!hand?.showdownWinners?.length) return null;
    const topWinner = hand.showdownWinners[0];
    const winnerSeat = hand.players.find((p) => p.id === topWinner.playerId);
    const label = topWinner.handLabel ? ` with ${formatHandLabel(topWinner.handLabel)}` : '';
    return `${winnerSeat?.name ?? topWinner.playerId} wins ${topWinner.amount}${label}`;
  }, [hand?.showdownWinners, hand?.players]);

  const seatingPositions = isPortraitPhone
    ? [
        { left: '50%', top: '76%' },
        { left: '18%', top: '22%' },
        { left: '82%', top: '22%' },
        { left: '84%', top: '50%' },
        { left: '16%', top: '50%' },
        { left: '76%', top: '70%' },
        { left: '24%', top: '70%' },
      ]
    : [
        { left: '50%', top: '82%' },
        { left: '14%', top: '22%' },
        { left: '86%', top: '22%' },
        { left: '92%', top: '52%' },
        { left: '8%', top: '52%' },
        { left: '80%', top: '78%' },
        { left: '20%', top: '78%' },
      ];
  const seatBetOffsets: React.CSSProperties[] = isPortraitPhone
    ? [
        { left: '50%', top: -24, transform: 'translate(-50%, -100%)' },
        { left: '58%', top: 'calc(100% + 4px)', transform: 'translate(-50%, 0)' },
        { left: '42%', top: 'calc(100% + 4px)', transform: 'translate(-50%, 0)' },
        { left: -6, top: '50%', transform: 'translate(-100%, -50%)' },
        { left: 'calc(100% + 6px)', top: '50%', transform: 'translate(0, -50%)' },
        { left: '44%', top: -24, transform: 'translate(-50%, -100%)' },
        { left: '56%', top: -24, transform: 'translate(-50%, -100%)' },
      ]
    : [
        { left: '50%', top: -30, transform: 'translate(-50%, -100%)' },
        { left: '58%', top: 'calc(100% + 6px)', transform: 'translate(-50%, 0)' },
        { left: '42%', top: 'calc(100% + 6px)', transform: 'translate(-50%, 0)' },
        { left: -8, top: '50%', transform: 'translate(-100%, -50%)' },
        { left: 'calc(100% + 8px)', top: '50%', transform: 'translate(0, -50%)' },
        { left: '44%', top: -30, transform: 'translate(-50%, -100%)' },
        { left: '56%', top: -30, transform: 'translate(-50%, -100%)' },
      ];
  const orderedPlayers = hand
    ? [...(you ? [you] : []), ...hand.players.filter((p) => p.id !== playerId)]
    : [];
  const overflowPlayers = orderedPlayers.slice(seatingPositions.length);
  const tablePlayers = orderedPlayers.slice(0, seatingPositions.length);
  const roleChipsBySeat = useMemo(() => {
    if (!hand || !state?.seats?.length) {
      return new Map<number, { label: string; tone: 'dealer' | 'blind' }[]>();
    }
    const seats = state.seats;
    const max = seats.length;
    if (hand.buttonSeat < 0) {
      return new Map<number, { label: string; tone: 'dealer' | 'blind' }[]>();
    }
    const inHandSeats = new Set(hand.players.map((player) => player.seat));
    const nextOccupiedSeat = (start: number) => {
      for (let i = 1; i <= max; i += 1) {
        const idx = (start + i) % max;
        if (seats[idx] && inHandSeats.has(idx)) return idx;
      }
      return null;
    };
    const active = hand.players.filter(
      (p) =>
        p.status !== 'folded' &&
        p.status !== 'out' &&
        p.status !== 'busted' &&
        p.status !== 'sitting_out'
    );
    const isHeadsUp = active.length === 2;
    const dealerSeat = hand.buttonSeat;
    let sbSeat: number | null = null;
    let bbSeat: number | null = null;
    if (isHeadsUp) {
      sbSeat = dealerSeat;
      bbSeat = nextOccupiedSeat(dealerSeat);
    } else {
      sbSeat = nextOccupiedSeat(dealerSeat);
      bbSeat = sbSeat !== null ? nextOccupiedSeat(sbSeat) : null;
    }
    const map = new Map<number, { label: string; tone: 'dealer' | 'blind' }[]>();
    const addChip = (seat: number | null, chip: { label: string; tone: 'dealer' | 'blind' }) => {
      if (seat === null) return;
      const existing = map.get(seat) ?? [];
      existing.push(chip);
      map.set(seat, existing);
    };
    addChip(dealerSeat, { label: 'D', tone: 'dealer' });
    addChip(sbSeat, { label: 'sB', tone: 'blind' });
    addChip(bbSeat, { label: 'BB', tone: 'blind' });
    return map;
  }, [hand, state?.seats]);
  const infoAvatarSize = 36;
  const playerInfoOffsetY = -30 + 38;
  const heroAreaOffsetPx = 38 - 33;
  const youAvatarStyle = useMemo(() => {
    if (!you) return null;
    const youIsWinner = winnersById.has(you.id);
    return {
      width: infoAvatarSize,
      height: infoAvatarSize,
      borderRadius: '50%',
      background: '#f8fafc',
      border: youIsWinner ? '3px solid #22c55e' : `3px solid ${TABLE_THEME.borderStrong}`,
      boxShadow: '0 0 18px rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: TABLE_THEME.fontSans,
      fontWeight: 800,
      fontSize: 18,
    };
  }, [you, winnersById, infoAvatarSize]);
  const youAvatarSuit = useMemo(() => avatarSuitForId(you?.id), [you?.id]);
  const youAvatarColor = avatarSuitColor(youAvatarSuit);
  const ellipsisDotStyle = (delayMs: number): React.CSSProperties => ({
    display: 'inline-block',
    width: '0.35em',
    textAlign: 'center',
    animation: 'ellipsis-blink 1.2s infinite',
    animationDelay: `${delayMs}ms`,
  });
  const hasBottomActionTray = Boolean(
    localNeedsRebuy ||
    localReadyBetweenHands ||
    (you && (isBettingPhase || isDiscardPhase || isRevealPhase))
  );
  const centeredSectionMinHeight = isMobile ? 'calc(100dvh - 160px)' : 'calc(100vh - 220px)';
  const heroInfoBottomOffset = isPhone
    ? hasBottomActionTray
      ? 132
      : 112
    : isMobile
      ? hasBottomActionTray
        ? 126
        : 100
      : 128;
  const heroCardsBottomOffset = isPhone
    ? isLandscapePhone
      ? hasBottomActionTray
        ? 78
        : 46
      : hasBottomActionTray
        ? 30
        : 24
    : isMobile
      ? hasBottomActionTray
        ? 28
        : 22
      : 20;
  const actionBarReserve = !isMobile && you && isBettingPhase ? (showRaiseDrawer ? 220 : 150) : 0;
  const tableHorizontalPadding = isPhone ? 16 : isMobile ? 28 : 64;
  const tableVerticalReserve = isMobile
    ? hasBottomActionTray
      ? isPortraitPhone
        ? 178
        : isLandscapePhone
          ? 198
          : 122
      : 74
    : 152 + actionBarReserve;
  const tableAspectRatio = layoutTableWidth / layoutTableHeight;
  const tableAvailableWidth = Math.max(280, viewportWidth - tableHorizontalPadding);
  const tableRawWidth = Math.min(
    layoutTableWidth,
    tableAvailableWidth,
    (viewportHeight - tableVerticalReserve) * tableAspectRatio
  );
  const tableMinimumWidth = Math.min(
    tableAvailableWidth,
    isPortraitPhone ? 320 : isLandscapePhone ? 330 : 360
  );
  const tableOuterWidthPx = Math.floor(Math.max(tableMinimumWidth, tableRawWidth));
  const tableOuterWidth = `${tableOuterWidthPx}px`;
  const tableOuterBorder = isPhone ? 6 : isMobile ? 8 : 10;
  const actionButtonBaseStyle: React.CSSProperties = {
    padding: isPhone ? '10px 12px' : '10px 16px',
    fontWeight: 700,
    minHeight: isPhone ? 42 : 44,
    borderRadius: 12,
    border: `1px solid ${TABLE_THEME.border}`,
    background: TABLE_THEME.panelSoft,
    color: TABLE_THEME.text,
    fontFamily: TABLE_THEME.fontSans,
    fontSize: isPhone ? 13 : 14,
    letterSpacing: 0.2,
    transition: 'all 140ms ease',
    boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
    cursor: 'pointer',
  };
  const minRaiseTo = hand
    ? hand.currentBet === 0
      ? hand.minRaise
      : hand.currentBet + hand.minRaise
    : null;
  const maxRaiseTo = you ? you.stack + you.betThisStreet : null;
  const normalizedBetAmount = Number.isFinite(betAmount) ? Math.max(0, Math.floor(betAmount)) : 0;
  const clampedRaiseTo =
    minRaiseTo !== null && maxRaiseTo !== null
      ? Math.min(maxRaiseTo, Math.max(minRaiseTo, normalizedBetAmount))
      : normalizedBetAmount;
  const canFold = Boolean(isMyTurn);
  const canCheck = Boolean(isMyTurn && toCall === 0);
  const canCall = Boolean(isMyTurn && toCall > 0);
  const canRaise = Boolean(
    isMyTurn &&
    hand &&
    !raiseCapReached &&
    minRaiseTo !== null &&
    maxRaiseTo !== null &&
    clampedRaiseTo >= minRaiseTo &&
    clampedRaiseTo <= maxRaiseTo &&
    clampedRaiseTo > hand.currentBet
  );
  const canCheckOrCall = Boolean(isMyTurn);
  const canOpenRaiseDrawer = Boolean(
    isMyTurn && minRaiseTo !== null && maxRaiseTo !== null && !raiseCapReached
  );
  const raiseActionLabel = hand && hand.currentBet === 0 ? 'Bet' : 'Raise';
  const checkOrCallLabel = toCall === 0 ? 'Check' : `Call ${toCall}`;
  const raiseDisabledHint = (() => {
    if (!hand || hand.phase !== 'betting') return 'Betting controls unlock during betting rounds.';
    if (!isMyTurn) return 'Wait for your turn.';
    if (raiseCapReached) return 'Raise cap reached on this street.';
    if (minRaiseTo === null || maxRaiseTo === null) return 'Raise amount unavailable.';
    if (clampedRaiseTo < minRaiseTo) return `Enter at least ${minRaiseTo}.`;
    if (clampedRaiseTo > maxRaiseTo) return `Max raise is ${maxRaiseTo} (all-in).`;
    return 'Raise available.';
  })();
  const actionTrayTimerSuffix = tableTimerSeconds !== null ? ` \u00b7 ${tableTimerSeconds}s` : '';
  const trayTurnStatusLabel = isMyTurn
    ? `Your turn${actionTrayTimerSuffix}`
    : `Waiting for ${actionOnPlayer?.name ?? 'player'}${actionTrayTimerSuffix}`;
  const actionTrayStakeLine =
    hand && hand.phase === 'betting'
      ? toCall > 0
        ? `To call ${toCall} \u00b7 Pot ${potAmount}`
        : `Check available \u00b7 Pot ${potAmount}`
      : '';
  const discardLimit = 1;
  const selectedDiscardCount = selectedDiscardIndex === null ? 0 : 1;
  const canConfirmDiscard = discardPending && selectedDiscardIndex !== null && !discardSubmitted;
  const quickRaiseOptions = useMemo(() => {
    if (!hand || minRaiseTo === null || maxRaiseTo === null) {
      return [] as Array<{ label: string; value: number; requiresConfirm?: boolean }>;
    }
    const clamp = (value: number) => Math.min(maxRaiseTo, Math.max(minRaiseTo, Math.floor(value)));
    const seed = [
      { label: '1/2 pot', value: clamp(hand.currentBet + potAmount * 0.5) },
      { label: 'pot', value: clamp(hand.currentBet + potAmount) },
      { label: '2x', value: clamp(Math.max(hand.currentBet * 2, minRaiseTo)) },
      { label: 'all-in', value: maxRaiseTo, requiresConfirm: true },
    ];
    const seen = new Set<number>();
    const deduped: Array<{ label: string; value: number; requiresConfirm?: boolean }> = [];
    for (const option of seed) {
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      deduped.push(option);
    }
    return deduped;
  }, [hand?.currentBet, minRaiseTo, maxRaiseTo, potAmount]);
  const disabledActionStyle: React.CSSProperties = {
    opacity: 0.48,
    cursor: 'not-allowed',
    transform: 'none',
    boxShadow: 'none',
  };
  const turnActionStyle = (
    enabled: boolean,
    tone: { border: string; background: string; color: string; glow: string }
  ): React.CSSProperties => ({
    ...actionButtonBaseStyle,
    border: `1px solid ${enabled ? tone.border : TABLE_THEME.border}`,
    background: enabled ? tone.background : 'rgba(255,255,255,0.035)',
    color: enabled ? tone.color : TABLE_THEME.dim,
    boxShadow: enabled ? `0 0 0 1px ${tone.glow}, 0 12px 26px rgba(2,6,23,0.4)` : 'none',
    transform: enabled ? 'translateY(-1px)' : 'none',
    ...(enabled ? null : disabledActionStyle),
  });
  const reactionOnCooldown = reactionCooldownUntil > Date.now();
  const timerTone =
    tableTimerSeconds !== null
      ? tableTimerSeconds <= 5
        ? '#fda4af'
        : '#d1fae5'
      : 'rgba(226,232,240,0.72)';
  const utilityEnabledCount =
    Number(soundEnabled) + Number(showActivityFeed) + Number(showTableChat);
  const rebuyTray = localNeedsRebuy ? (
    <div
      style={{
        borderRadius: 8,
        border: '1px solid rgba(248,113,113,0.48)',
        background: TABLE_THEME.panelStrong,
        padding: isPhone ? '10px 12px' : '12px 14px',
        boxShadow: '0 14px 28px rgba(127,29,29,0.2)',
        display: 'flex',
        flexDirection: isPhone ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isPhone ? 'stretch' : 'center',
        gap: 10,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          data-testid="rebuy-status"
          style={{
            fontSize: isPhone ? 13 : 14,
            fontWeight: 800,
            color: '#fee2e2',
          }}
        >
          You are out of chips
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 12,
            color: TABLE_THEME.muted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {localPlayerName} can rebuy before the next hand.
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isPhone ? '1fr 1fr' : 'auto auto',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={rebuy}
          style={turnActionStyle(true, {
            border: 'rgba(94,234,212,0.78)',
            background: 'rgba(20,184,166,0.28)',
            color: '#ccfbf1',
            glow: 'rgba(20,184,166,0.3)',
          })}
        >
          Rebuy 10,000
        </button>
        <button
          type="button"
          onClick={sitOut}
          style={turnActionStyle(true, {
            border: 'rgba(148,163,184,0.65)',
            background: 'rgba(255,255,255,0.045)',
            color: '#e2e8f0',
            glow: 'rgba(148,163,184,0.18)',
          })}
        >
          Sit Out
        </button>
      </div>
    </div>
  ) : null;
  const nextHandTray = localReadyBetweenHands ? (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${TABLE_THEME.border}`,
        background: TABLE_THEME.panelStrong,
        padding: isPhone ? '10px 12px' : '12px 14px',
        display: 'flex',
        flexDirection: isPhone ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isPhone ? 'stretch' : 'center',
        gap: 10,
      }}
    >
      <div style={{ fontSize: isPhone ? 13 : 14, fontWeight: 800, color: TABLE_THEME.text }}>
        Ready for next hand
      </div>
      <button
        type="button"
        onClick={() => send({ type: 'nextHand' })}
        style={turnActionStyle(true, {
          border: 'rgba(94,234,212,0.78)',
          background: 'rgba(20,184,166,0.28)',
          color: '#ccfbf1',
          glow: 'rgba(20,184,166,0.3)',
        })}
      >
        Next Hand
      </button>
    </div>
  ) : null;
  const startGateTray = startGate && seated ? (
    <div
      data-testid="start-gate"
      style={{
        width: isMobile ? 'auto' : 'min(680px, 100%)',
        margin: isMobile ? 0 : '0 auto',
        borderRadius: 8,
        border: `1px solid ${TABLE_THEME.tealBorder}`,
        background: TABLE_THEME.panelStrong,
        padding: isPhone ? '12px' : '14px 16px',
        boxShadow: '0 16px 34px rgba(2,6,23,0.42)',
        display: 'grid',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: isPhone ? 14 : 15,
              fontWeight: 900,
              color: TABLE_THEME.text,
            }}
          >
            Waiting for players
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              color: TABLE_THEME.muted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tableLabel} - {seatedPlayers.length} seated
          </div>
        </div>
        <div
          data-testid="start-gate-countdown"
          style={{
            minWidth: 58,
            borderRadius: 999,
            border: `1px solid ${TABLE_THEME.border}`,
            background: 'rgba(255,255,255,0.045)',
            color: startGateSecondsLeft !== null && startGateSecondsLeft <= 3 ? '#fecaca' : '#ccfbf1',
            padding: '5px 9px',
            textAlign: 'center',
            fontSize: 12,
            fontWeight: 900,
          }}
        >
          {startGateSecondsLeft !== null ? `${startGateSecondsLeft}s` : '--'}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {seatedPlayers.map((seat: any) => {
          const ready = startGateReadyIds.has(seat.id);
          return (
            <div
              key={seat.id}
              data-testid="start-gate-player"
              style={{
                borderRadius: 999,
                border: `1px solid ${ready ? TABLE_THEME.tealBorder : TABLE_THEME.border}`,
                background: ready ? 'rgba(20,184,166,0.18)' : 'rgba(255,255,255,0.04)',
                color: ready ? '#ccfbf1' : TABLE_THEME.text,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 800,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {seat.name} {ready ? 'ready' : 'waiting'}
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isPhone ? '1fr' : '1fr auto',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <div style={{ fontSize: 12, color: TABLE_THEME.muted }}>
          {startGateCanEarlyStart
            ? 'Starting now.'
            : startGateAllReady
              ? 'Everyone is ready. Starting when the quick-entry window closes.'
              : 'The hand starts when the timer ends, or earlier when everyone is ready.'}
        </div>
        <button
          data-testid="ready-for-hand"
          type="button"
          onClick={toggleReadyForHand}
          style={turnActionStyle(true, {
            border: localReadyForStart ? 'rgba(148,163,184,0.65)' : 'rgba(94,234,212,0.78)',
            background: localReadyForStart ? 'rgba(255,255,255,0.045)' : 'rgba(20,184,166,0.28)',
            color: localReadyForStart ? '#e2e8f0' : '#ccfbf1',
            glow: localReadyForStart ? 'rgba(148,163,184,0.18)' : 'rgba(20,184,166,0.3)',
          })}
        >
          {localReadyForStart ? 'Ready' : 'Ready for Hand'}
        </button>
      </div>
    </div>
  ) : null;

  useEffect(() => {
    if (!seated || !hand || hand.phase !== 'betting') {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.metaKey || event.ctrlKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (
        target &&
        (tagName === 'input' ||
          tagName === 'textarea' ||
          tagName === 'select' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'f' && canFold) {
        event.preventDefault();
        act('fold');
        return;
      }
      if (key === 'c') {
        if (canCheck) {
          event.preventDefault();
          act('check');
          return;
        }
        if (canCall) {
          event.preventDefault();
          act('call');
          return;
        }
      }
      if (key === 'r' && canOpenRaiseDrawer) {
        event.preventDefault();
        setShowRaiseDrawer(true);
        setConfirmAllIn(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [act, canCall, canCheck, canFold, canOpenRaiseDrawer, seated]);

  useEffect(() => {
    if (maxRaiseTo === null || clampedRaiseTo < maxRaiseTo) {
      setConfirmAllIn(false);
    }
  }, [clampedRaiseTo, maxRaiseTo]);

  const toggleRaiseDrawer = () => {
    if (!canOpenRaiseDrawer) {
      return;
    }
    setShowRaiseDrawer((previous) => !previous);
    setConfirmAllIn(false);
  };

  const submitRaiseAction = () => {
    if (!hand || !canRaise) {
      return;
    }
    const isAllInRaise = maxRaiseTo !== null && clampedRaiseTo >= maxRaiseTo;
    if (isAllInRaise && !confirmAllIn) {
      setConfirmAllIn(true);
      return;
    }
    act(hand.currentBet === 0 ? 'bet' : 'raise', clampedRaiseTo);
    setConfirmAllIn(false);
    setShowRaiseDrawer(false);
  };

  const hiddenBettingActionButtons = (
    <>
      <button
        data-testid="action-fold"
        type="button"
        disabled
        aria-hidden="true"
        style={{ display: 'none' }}
      />
      <button
        data-testid="action-check"
        type="button"
        disabled
        aria-hidden="true"
        style={{ display: 'none' }}
      />
      <button
        data-testid="action-call"
        type="button"
        disabled
        aria-hidden="true"
        style={{ display: 'none' }}
      />
      <button
        data-testid="action-raise"
        type="button"
        disabled
        aria-hidden="true"
        style={{ display: 'none' }}
      />
      <button
        data-testid="action-allin"
        type="button"
        disabled
        aria-hidden="true"
        style={{ display: 'none' }}
      />
    </>
  );
  const statusDisplay = friendlyStatus(status);

  return (
    <div
      style={{
        fontFamily: TABLE_THEME.fontSans,
        color: TABLE_THEME.text,
        minHeight: '100dvh',
        height: seated ? '100dvh' : undefined,
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden',
        overflowY: seated && !showUtilitiesPanel ? 'hidden' : 'auto',
        background: TABLE_THEME.pageBackground,
        backgroundPosition: 'center, center, center, center',
        backgroundRepeat: 'no-repeat, no-repeat, no-repeat, no-repeat',
        backgroundSize: 'auto, auto, auto, cover',
        padding: isPhone
          ? '8px 8px calc(8px + env(safe-area-inset-bottom))'
          : `14px 16px calc(${18 + actionBarReserve}px + env(safe-area-inset-bottom))`,
      }}
    >
      <div
        style={{
          width: 'min(100%, 980px)',
          margin: '0 auto',
          marginBottom: isMobile ? 6 : 8,
          padding: isPhone ? '4px 2px 6px' : '4px 2px 8px',
          borderRadius: 0,
          border: 'none',
          background: 'transparent',
          boxShadow: 'none',
          backdropFilter: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <BondiPokerLogo
              variant="table"
              className={isPhone ? 'max-w-[150px]' : 'max-w-[210px]'}
            />
            <div
              style={{
                marginTop: isPhone ? 4 : 0,
                fontSize: isPhone ? 12 : 13,
                fontWeight: 600,
                color: TABLE_THEME.muted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {tableLabel}
              {hand ? ` \u00b7 ${currentStreetLabel}` : ''}
              {!isPhone && hand ? ` \u00b7 Pot ${potAmount}` : ''}
            </div>
            <span data-testid="street-indicator" style={{ display: 'none' }}>
              {hand ? `${hand.street} / ${hand.phase}` : 'waiting / idle'}
            </span>
          </div>
          <div
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, position: 'relative' }}
          >
            {seated || showExitButton ? (
              <button
                type="button"
                onClick={() => setShowTopMenu((previous) => !previous)}
                aria-label="Table menu"
                style={{
                  minHeight: isPhone ? 32 : 34,
                  minWidth: isPhone ? 32 : 34,
                  borderRadius: 8,
                  border: `1px solid ${TABLE_THEME.border}`,
                  background: TABLE_THEME.panelSoft,
                  color: TABLE_THEME.text,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MoreHorizontal aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
            ) : null}
            {showTopMenu ? (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 8px)',
                  zIndex: 40,
                  width: isPhone ? 170 : 190,
                  borderRadius: 8,
                  border: `1px solid ${TABLE_THEME.border}`,
                  background: TABLE_THEME.panelStrong,
                  boxShadow: '0 16px 34px rgba(0,0,0,0.44)',
                  padding: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {seated ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowUtilitiesPanel((previous) => !previous);
                      setShowTopMenu(false);
                    }}
                    style={{
                      borderRadius: 6,
                      border: `1px solid ${TABLE_THEME.border}`,
                      background: TABLE_THEME.panelSoft,
                      color: TABLE_THEME.text,
                      padding: '8px 10px',
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {showUtilitiesPanel ? 'Hide Extras' : 'Show Extras'} ({utilityEnabledCount})
                  </button>
                ) : null}
                {seated ? (
                  <button
                    type="button"
                    onClick={() => {
                      connectionRef.current?.close();
                      connectionRef.current = null;
                      legacySocketRef.current = null;
                      pendingMessagesRef.current = [];
                      setStatus('Disconnected');
                      setShowTopMenu(false);
                    }}
                    style={{
                      borderRadius: 6,
                      border: `1px solid ${TABLE_THEME.border}`,
                      background: TABLE_THEME.panelSoft,
                      color: TABLE_THEME.text,
                      padding: '8px 10px',
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Disconnect
                  </button>
                ) : null}
                {showExitButton ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowTopMenu(false);
                      handleExitTable();
                    }}
                    style={{
                      borderRadius: 6,
                      border: '1px solid rgba(248,113,113,0.72)',
                      background: 'rgba(127,29,29,0.46)',
                      color: '#fee2e2',
                      padding: '8px 10px',
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Exit Table
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {seated && showUtilitiesPanel ? (
        <div
          style={{
            width: 'min(100%, 980px)',
            margin: '0 auto',
            marginBottom: 12,
            padding: isPhone ? '10px' : '12px',
            borderRadius: 8,
            border: `1px solid ${TABLE_THEME.tealBorder}`,
            background: TABLE_THEME.panel,
            boxShadow: '0 12px 28px rgba(0,0,0,0.28)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                setSoundEnabled((previous) => !previous);
              }}
              style={{
                borderRadius: 6,
                border: `1px solid ${soundEnabled ? TABLE_THEME.tealBorder : TABLE_THEME.border}`,
                background: soundEnabled ? TABLE_THEME.tealSoft : TABLE_THEME.panelSoft,
                color: soundEnabled ? '#ccfbf1' : TABLE_THEME.text,
                padding: '7px 10px',
                fontFamily: TABLE_THEME.fontSans,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.25,
                cursor: 'pointer',
              }}
            >
              Sound {soundEnabled ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowActivityFeed((previous) => !previous);
              }}
              style={{
                borderRadius: 6,
                border: `1px solid ${
                  showActivityFeed ? TABLE_THEME.tealBorder : TABLE_THEME.border
                }`,
                background: showActivityFeed ? TABLE_THEME.tealSoft : TABLE_THEME.panelSoft,
                color: showActivityFeed ? '#ccfbf1' : TABLE_THEME.text,
                padding: '7px 10px',
                fontFamily: TABLE_THEME.fontSans,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.25,
                cursor: 'pointer',
              }}
            >
              Feed {showActivityFeed ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowTableChat((previous) => !previous);
              }}
              style={{
                borderRadius: 6,
                border: `1px solid ${showTableChat ? TABLE_THEME.tealBorder : TABLE_THEME.border}`,
                background: showTableChat ? TABLE_THEME.tealSoft : TABLE_THEME.panelSoft,
                color: showTableChat ? '#ccfbf1' : TABLE_THEME.text,
                padding: '7px 10px',
                fontFamily: TABLE_THEME.fontSans,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.25,
                cursor: 'pointer',
              }}
            >
              Chat {showTableChat ? 'On' : 'Off'}
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                color: TABLE_THEME.amber,
                fontFamily: TABLE_THEME.fontDisplay,
              }}
            >
              Reactions
            </span>
            {TABLE_REACTIONS.map((reaction) => (
              <button
                key={reaction}
                type="button"
                onClick={() => sendReaction(reaction)}
                disabled={reactionOnCooldown || !seated}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${TABLE_THEME.tealBorder}`,
                  background: TABLE_THEME.panelSoft,
                  color: '#ccfbf1',
                  padding: isPhone ? '6px 10px' : '6px 12px',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 0.4,
                  fontFamily: TABLE_THEME.fontSans,
                  cursor: reactionOnCooldown || !seated ? 'not-allowed' : 'pointer',
                  opacity: reactionOnCooldown || !seated ? 0.5 : 1,
                }}
              >
                {TABLE_REACTION_LABELS[reaction]}
              </button>
            ))}
            {reactionOnCooldown ? (
              <span style={{ fontSize: 11, color: TABLE_THEME.dim }}>Cooling down...</span>
            ) : null}
          </div>

          {showActivityFeed ? (
            <div
              style={{
                borderRadius: 8,
                border: `1px solid ${TABLE_THEME.border}`,
                background: TABLE_THEME.panelSoft,
                padding: '8px 10px',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  color: TABLE_THEME.amber,
                  marginBottom: 6,
                }}
              >
                Activity
              </div>
              <div style={{ maxHeight: isPhone ? 88 : 100, overflowY: 'auto' }}>
                {(state?.log ?? []).slice(-8).map((l: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      fontSize: 12,
                      opacity: 0.85,
                      marginBottom: 4,
                      fontFamily: TABLE_THEME.fontSans,
                    }}
                  >
                    {l.message}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {showTableChat ? (
            <div
              style={{
                borderRadius: 8,
                border: `1px solid ${TABLE_THEME.tealBorder}`,
                background: TABLE_THEME.panelSoft,
                padding: isPhone ? '10px 10px' : '11px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                    color: TABLE_THEME.amber,
                    fontFamily: TABLE_THEME.fontDisplay,
                  }}
                >
                  Table Chat
                </span>
                {hiddenChatCount > 0 ? (
                  <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.86)' }}>
                    {hiddenChatCount} muted
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  maxHeight: isPhone ? 110 : 132,
                  overflowY: 'auto',
                  paddingRight: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {visibleChatMessages.length === 0 ? (
                  <div style={{ fontSize: 12, color: TABLE_THEME.muted }}>No chat yet. Say hi.</div>
                ) : (
                  visibleChatMessages.slice(-18).map((entry) => {
                    const senderName =
                      playerNameById.get(entry.playerId) ??
                      (entry.playerId === playerId ? 'You' : 'Player');
                    const isSelf = entry.playerId === playerId;
                    const senderMuted = mutedChatPlayerSet.has(entry.playerId);
                    return (
                      <div
                        key={entry.id}
                        style={{
                          borderRadius: 6,
                          border: `1px solid ${TABLE_THEME.border}`,
                          background: 'rgba(0,0,0,0.24)',
                          padding: '6px 8px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 700, color: TABLE_THEME.teal }}>
                            {senderName}
                          </span>
                          {!isSelf ? (
                            <button
                              type="button"
                              onClick={() => toggleMuteChatPlayer(entry.playerId)}
                              style={{
                                borderRadius: 999,
                                border: `1px solid ${TABLE_THEME.border}`,
                                background: TABLE_THEME.panelSoft,
                                color: TABLE_THEME.text,
                                padding: '2px 7px',
                                fontSize: 10,
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {senderMuted ? 'Unmute' : 'Mute'}
                            </button>
                          ) : null}
                        </div>
                        <div style={{ marginTop: 3, fontSize: 12, color: 'rgba(244,244,245,0.9)' }}>
                          {entry.message}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  sendChatMessage();
                }}
                style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}
              >
                <input
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  maxLength={TABLE_CHAT_MAX_LENGTH}
                  placeholder="Type message..."
                  style={{
                    minHeight: 40,
                    borderRadius: 6,
                    border: `1px solid ${TABLE_THEME.border}`,
                    background: 'rgba(0,0,0,0.32)',
                    color: TABLE_THEME.text,
                    padding: '8px 10px',
                    fontSize: 13,
                    outline: 'none',
                    fontFamily: TABLE_THEME.fontSans,
                  }}
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || !seated}
                  style={{
                    minHeight: 40,
                    borderRadius: 6,
                    border: `1px solid ${TABLE_THEME.tealBorder}`,
                    background: TABLE_THEME.tealSoft,
                    color: '#ccfbf1',
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: !chatInput.trim() || !seated ? 'not-allowed' : 'pointer',
                    opacity: !chatInput.trim() || !seated ? 0.55 : 1,
                  }}
                >
                  Send
                </button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
      {seated && statusDisplay && !status.startsWith('Connected') ? (
        <div
          style={{
            position: 'fixed',
            left: isPhone ? 10 : '50%',
            right: isPhone ? 10 : undefined,
            top: isPhone ? 78 : 88,
            transform: isPhone ? 'none' : 'translateX(-50%)',
            zIndex: 60,
            maxWidth: isPhone ? undefined : 520,
            borderRadius: 8,
            border:
              status.toLowerCase().includes('error') ||
              status.toLowerCase().includes('failed') ||
              status.toLowerCase().includes('500')
                ? '1px solid rgba(248,113,113,0.45)'
                : `1px solid ${TABLE_THEME.border}`,
            background: 'rgba(2,7,9,0.92)',
            boxShadow: '0 18px 36px rgba(0,0,0,0.38)',
            color: TABLE_THEME.text,
            padding: '10px 12px',
            fontFamily: TABLE_THEME.fontSans,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 900 }}>{statusDisplay.title}</div>
          <div style={{ marginTop: 3, fontSize: 12, color: TABLE_THEME.muted }}>
            {statusDisplay.detail}
          </div>
        </div>
      ) : null}
      {!seated && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: centeredSectionMinHeight,
            paddingTop: 'clamp(0px, 2vh, 1cm)',
            paddingBottom: 'clamp(0px, 6vh, 2cm)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              transform: isMobile ? 'none' : 'translateY(-2.4cm)',
              width: isPhone ? '100%' : 'min(94vw, 560px)',
              padding: isPhone ? '18px 16px' : '22px',
              borderRadius: 8,
              border: `1px solid ${TABLE_THEME.borderStrong}`,
              background: TABLE_THEME.panel,
              boxShadow: '0 24px 70px rgba(0,0,0,0.34)',
              backdropFilter: 'blur(14px)',
            }}
          >
            <div style={{ width: '100%', textAlign: isPhone ? 'left' : 'center' }}>
              <div
                style={{
                  fontFamily: TABLE_THEME.fontDisplay,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.28em',
                  textTransform: 'uppercase',
                  color: TABLE_THEME.amber,
                }}
              >
                Table Entry
              </div>
              <div
                style={{ marginTop: 6, fontSize: 14, lineHeight: 1.5, color: TABLE_THEME.muted }}
              >
                Enter your table name to take a seat.
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 10,
                flexDirection: isPhone ? 'column' : 'row',
                width: isPhone ? 'min(92vw, 360px)' : 'auto',
              }}
            >
              <input
                value={name}
                onChange={(e) => {
                  const next = e.target.value;
                  setName(next);
                  if (nameError && next.trim()) setNameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (name.trim()) {
                      setNameError(null);
                      join();
                    } else {
                      setNameError('Please enter a name.');
                    }
                    e.currentTarget.blur();
                  }
                }}
                placeholder="Enter player name"
                aria-invalid={Boolean(nameError)}
                style={{
                  padding: '12px 14px',
                  width: isPhone ? '100%' : undefined,
                  minWidth: isPhone ? 0 : 300,
                  borderRadius: 6,
                  border: nameError ? '1px solid #fca5a5' : `1px solid ${TABLE_THEME.border}`,
                  background: 'rgba(0,0,0,0.34)',
                  color: TABLE_THEME.text,
                  caretColor: TABLE_THEME.text,
                  fontSize: 16,
                  fontFamily: TABLE_THEME.fontSans,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setNameError(null);
                  join();
                }}
                disabled={!name.trim()}
                style={{
                  padding: '12px 18px',
                  width: isPhone ? '100%' : undefined,
                  minHeight: 44,
                  borderRadius: 6,
                  border: `1px solid ${TABLE_THEME.tealBorder}`,
                  background: TABLE_THEME.tealSoft,
                  color: '#ccfbf1',
                  fontWeight: 700,
                  fontFamily: TABLE_THEME.fontSans,
                  letterSpacing: 0.5,
                  boxShadow: '0 0 24px rgba(20,184,166,0.18)',
                  cursor: name.trim() ? 'pointer' : 'not-allowed',
                  opacity: name.trim() ? 1 : 0.58,
                }}
              >
                Join
              </button>
            </div>
            {nameError && (
              <div
                style={{
                  fontSize: 12,
                  color: '#fca5a5',
                  fontFamily:
                    'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                }}
              >
                {nameError}
              </div>
            )}
            <div
              style={{
                fontSize: 12,
                color: TABLE_THEME.muted,
                fontFamily: TABLE_THEME.fontSans,
                alignSelf: 'center',
                textAlign: 'center',
                marginLeft: 0,
              }}
            >
              Waiting for hand...
            </div>
            {statusDisplay && status && !status.startsWith('Connected') && (
              <div
                style={{
                  fontFamily: TABLE_THEME.fontSans,
                  borderRadius: 8,
                  border:
                    status.toLowerCase().includes('error') ||
                    status.toLowerCase().includes('failed') ||
                    status.toLowerCase().includes('500')
                      ? '1px solid rgba(248,113,113,0.45)'
                      : `1px solid ${TABLE_THEME.border}`,
                  background: 'rgba(2,7,9,0.58)',
                  color: TABLE_THEME.text,
                  padding: '9px 10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 900 }}>{statusDisplay.title}</div>
                <div style={{ marginTop: 3, fontSize: 12, color: TABLE_THEME.muted }}>
                  {statusDisplay.detail}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {hand ? (
        <div
          style={{
            display: 'flex',
            flex: seated ? '1 1 auto' : undefined,
            minHeight: 0,
            flexDirection: 'column',
            justifyContent: isMobile ? 'flex-start' : 'center',
            gap: isMobile ? 8 : 12,
          }}
        >
          <div
            data-testid="table-felt"
            ref={tableRef}
            style={{
              position: 'relative',
              width: tableOuterWidth,
              maxWidth: layoutTableWidth,
              aspectRatio: `${layoutTableWidth} / ${layoutTableHeight}`,
              height: 'auto',
              minHeight: isPortraitPhone
                ? hasBottomActionTray
                  ? 500
                  : 540
                : isPhone
                  ? hasBottomActionTray
                    ? isLandscapePhone
                      ? 172
                      : 248
                    : isLandscapePhone
                      ? 164
                      : 236
                  : isMobile
                    ? isLandscapePhone
                      ? 172
                      : 286
                    : 360,
              margin: '0 auto',
              marginTop: isMobile ? 2 : 14,
              borderRadius: isPortraitPhone ? 180 : isPhone ? 110 : 999,
              background:
                'radial-gradient(circle at 50% 44%, rgba(20,184,166,0.24) 0%, rgba(13,74,57,0.95) 48%, rgba(6,43,32,0.98) 100%)',
              border: `${tableOuterBorder}px solid rgba(251,191,36,0.34)`,
              boxShadow:
                '0 34px 90px rgba(0,0,0,0.5), 0 0 0 1px rgba(251,191,36,0.18), inset 0 0 58px rgba(0,0,0,0.56)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: layoutTableWidth,
                height: layoutTableHeight,
                transform: `translate(-50%, -50%) scale(${tableScale})`,
                transformOrigin: 'center',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '40%',
                  left: '50%',
                  transform: 'translate(-50%, -50%) translateY(calc(-19px - 2.1cm))',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <div
                  data-testid="pot-amount"
                  style={{
                    minWidth: 92,
                    borderRadius: 999,
                    border: `1px solid ${TABLE_THEME.tealBorder}`,
                    background: 'rgba(3,8,11,0.74)',
                    color: '#ccfbf1',
                    padding: '6px 12px',
                    textAlign: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: 0.2,
                  }}
                >
                  Pot {potAmount}
                </div>
                <div
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${TABLE_THEME.border}`,
                    background: 'rgba(2,7,9,0.56)',
                    color: TABLE_THEME.muted,
                    padding: '3px 9px',
                    textAlign: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {currentStreetLabel}
                </div>
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: '40%',
                  left: '50%',
                  transform: 'translate(-50%, -50%) translateY(calc(-19px - 0.4cm))',
                  display: 'flex',
                  gap: '1mm',
                }}
              >
                {communityCards.map((c, idx) => (
                  <div
                    key={`${dealAnimationKey}-community-${idx}-${c.rank}${c.suit}`}
                    style={
                      {
                        animation: `deal-card 700ms ease-out ${idx * 120}ms both`,
                        '--deal-x': '0px',
                        '--deal-y': '-3.8cm',
                      } as React.CSSProperties
                    }
                  >
                    <CardView
                      key={idx}
                      card={c}
                      size={isPhone ? 'large' : 'xlarge'}
                      highlight={isShowdown && winningCards.has(cardKey(c))}
                    />
                  </div>
                ))}
              </div>
              {latestActionLine && !isRevealPhase ? (
                <div
                  style={{
                    position: 'absolute',
                    top: '40%',
                    left: '50%',
                    transform: 'translate(-50%, -50%) translateY(calc(-19px - 0.85cm))',
                    maxWidth: 300,
                    borderRadius: 999,
                    border: `1px solid ${TABLE_THEME.border}`,
                    background: 'rgba(2,7,9,0.78)',
                    color: '#e2e8f0',
                    padding: '5px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
                  }}
                >
                  {latestActionLine}
                </div>
              ) : null}
              {isShowdown && showdownSummary && (
                <div
                  style={{
                    position: 'absolute',
                    top: '40%',
                    left: '50%',
                    transform:
                      'translate(-50%, -50%) translateY(calc(-19px + 1.7cm)) translateX(4cm)',
                  }}
                >
                  <div
                    style={{
                      width: '3.22cm',
                      height: '0.92cm',
                      padding: '0 6px',
                      borderRadius: 999,
                      background: '#123b2f',
                      border: '1px solid #22c55e',
                      color: '#d1fae5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      fontSize: 11,
                      lineHeight: 1.1,
                      fontFamily: TABLE_THEME.fontSans,
                      overflow: 'hidden',
                      whiteSpace: 'normal',
                    }}
                  >
                    {showdownSummary}
                  </div>
                </div>
              )}
              {tablePlayers.map((p, idx) => {
                const pos = seatingPositions[idx];
                const winner = winnersById.has(p.id);
                const isYou = p.id === playerId;
                const roleChips = roleChipsBySeat.get(p.seat) ?? [];
                const avatarSize = infoAvatarSize;
                const avatarBorder = winner
                  ? '3px solid #22c55e'
                  : `3px solid ${TABLE_THEME.borderStrong}`;
                const avatarSuit = avatarSuitForId(p.id);
                const avatarColor = avatarSuitColor(avatarSuit);
                const isTurn = Boolean(
                  hand && hand.phase === 'betting' && hand.actionOnSeat === p.seat
                );
                const playerBusted = p.status === 'busted' || p.status === 'sitting_out';
                const playerInactive = p.status === 'folded' || p.status === 'out' || playerBusted;
                const infoDimmed =
                  playerInactive || Boolean(hand && hand.phase === 'betting' && !isTurn);
                const showDiscardState =
                  hand?.phase === 'discard' &&
                  p.status !== 'folded' &&
                  p.status !== 'out' &&
                  p.status !== 'busted' &&
                  p.status !== 'sitting_out';
                const hasDiscardedThisStreet =
                  showDiscardState && discardConfirmedPlayers.has(p.id);
                const avatarStyle = {
                  width: avatarSize,
                  height: avatarSize,
                  borderRadius: '50%',
                  background: '#f8fafc',
                  border: avatarBorder,
                  boxShadow: '0 0 18px rgba(0,0,0,0.45)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: TABLE_THEME.fontSans,
                  fontWeight: 800,
                  fontSize: 18,
                  color: avatarColor,
                };
                return (
                  <div
                    key={p.id}
                    style={{
                      position: 'absolute',
                      left: pos.left,
                      top: pos.top,
                      transform: `translate(-50%, -50%) translateY(${playerInfoOffsetY}px)`,
                      width: 170,
                      textAlign: 'center',
                    }}
                  >
                    {!isYou && (
                      <div style={{ display: 'inline-block' }}>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          {roleChips.length > 0 && (
                            <div
                              style={{
                                position: 'absolute',
                                top: -26,
                                right: 4,
                                zIndex: 12,
                                display: 'flex',
                                gap: 4,
                                transform: 'none',
                                pointerEvents: 'none',
                              }}
                            >
                              {roleChips.map((chip, chipIdx) => (
                                <RoleChip
                                  key={`${chip.label}-${chipIdx}`}
                                  label={chip.label}
                                  tone={chip.tone}
                                />
                              ))}
                            </div>
                          )}
                          <div
                            style={{
                              position: 'relative',
                              padding: '6px 10px 6px 60px',
                              borderRadius: 10,
                              background: infoDimmed ? 'rgba(3,8,11,0.58)' : 'rgba(3,8,11,0.82)',
                              border: isTurn
                                ? `2px solid ${TABLE_THEME.teal}`
                                : winner
                                  ? '2px solid #22c55e'
                                  : `1px solid ${TABLE_THEME.border}`,
                              boxShadow: isTurn
                                ? '0 0 0 3px rgba(20,184,166,0.22), 0 0 30px rgba(20,184,166,0.42)'
                                : winner
                                  ? '0 0 0 2px rgba(34, 197, 94, 0.2)'
                                  : undefined,
                              opacity: playerInactive ? 0.5 : infoDimmed ? 0.78 : 1,
                              textAlign: 'center',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                            }}
                          >
                            {renderTurnTimer(isTurn)}
                            <div
                              style={{
                                position: 'absolute',
                                top: 'calc(6px - 0.15cm)',
                                left: 'calc(8px - 0.2cm)',
                                overflow: 'hidden',
                                ...avatarStyle,
                              }}
                            >
                              {suitSymbol(avatarSuit)}
                            </div>
                            <div
                              style={{
                                fontWeight: 700,
                                fontFamily: TABLE_THEME.fontSans,
                                fontSize: 12,
                              }}
                            >
                              {p.name}
                            </div>
                            {p.id !== playerId && (
                              <div style={{ fontSize: 12, fontFamily: TABLE_THEME.fontSans }}>
                                <span
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                >
                                  <StackChipsIcon size={14} />
                                  {p.stack}
                                </span>
                              </div>
                            )}
                            {playerBusted ? (
                              <div
                                style={{
                                  marginTop: 4,
                                  fontSize: 10,
                                  letterSpacing: 0.2,
                                  color: '#fecaca',
                                  textTransform: 'uppercase',
                                }}
                              >
                                out of chips
                              </div>
                            ) : showDiscardState ? (
                              <div
                                style={{
                                  marginTop: 4,
                                  fontSize: 10,
                                  letterSpacing: 0.2,
                                  color: hasDiscardedThisStreet ? '#86efac' : '#cbd5e1',
                                }}
                              >
                                {hasDiscardedThisStreet ? 'discarded ✓' : 'discarding...'}
                              </div>
                            ) : null}
                            {isTurn ? (
                              <div
                                style={{
                                  marginTop: 4,
                                  fontSize: 10,
                                  letterSpacing: 0.3,
                                  color: '#bae6fd',
                                  textTransform: 'uppercase',
                                  animation: 'turn-pulse 1.2s ease-in-out infinite',
                                }}
                              >
                                to act
                              </div>
                            ) : null}
                          </div>
                          {renderReactionBadge(p.id)}
                          {renderBetPill(p.betThisStreet, seatBetOffsets[idx])}
                        </div>
                        <div
                          style={{
                            marginTop: 4,
                            display: 'flex',
                            justifyContent: 'center',
                            marginLeft: '1cm',
                          }}
                        >
                          {[0, 1].map((cardIdx) => {
                            const rot = cardIdx === 0 ? -18 : 16;
                            const margin = cardIdx === 0 ? -24 : 0;
                            const reveal =
                              isShowdown &&
                              hasContestedShowdown &&
                              p.status !== 'folded' &&
                              p.status !== 'out' &&
                              p.status !== 'busted' &&
                              p.status !== 'sitting_out' &&
                              p.holeCards.length >= 2;
                            const card = p.holeCards[cardIdx];
                            return (
                              <div
                                key={`${p.id}-down-${cardIdx}`}
                                style={{
                                  transform: `rotate(${rot}deg)`,
                                  marginRight: margin,
                                  perspective: 600,
                                }}
                              >
                                <div
                                  style={{
                                    position: 'relative',
                                    width: 44,
                                    height: 62,
                                    transformStyle: 'preserve-3d',
                                    transition: 'transform 0.6s ease',
                                    transform: reveal ? 'rotateY(180deg)' : 'rotateY(0deg)',
                                  }}
                                >
                                  <div
                                    style={{
                                      position: 'absolute',
                                      inset: 0,
                                      backfaceVisibility: 'hidden',
                                    }}
                                  >
                                    <CardBack size="medium" tone="gold" />
                                  </div>
                                  <div
                                    style={{
                                      position: 'absolute',
                                      inset: 0,
                                      backfaceVisibility: 'hidden',
                                      transform: 'rotateY(180deg)',
                                    }}
                                  >
                                    {card && (
                                      <CardView
                                        card={card}
                                        size="medium"
                                        highlight={winningCards.has(cardKey(card))}
                                      />
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {overflowPlayers.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 20,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    gap: 10,
                  }}
                >
                  {overflowPlayers.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        background: '#0f172a',
                        border: `1px solid ${TABLE_THEME.border}`,
                        fontSize: 12,
                        fontFamily: TABLE_THEME.fontSans,
                      }}
                    >
                      {p.name} (Seat {p.seat + 1})
                    </div>
                  ))}
                </div>
              )}
              {you && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: heroInfoBottomOffset - heroAreaOffsetPx,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      {(roleChipsBySeat.get(you.seat) ?? []).length > 0 && (
                        <div
                          style={{
                            position: 'absolute',
                            top: -26,
                            right: 4,
                            zIndex: 12,
                            display: 'flex',
                            gap: 4,
                            transform: 'none',
                            pointerEvents: 'none',
                          }}
                        >
                          {(roleChipsBySeat.get(you.seat) ?? []).map((chip, chipIdx) => (
                            <RoleChip
                              key={`${chip.label}-${chipIdx}`}
                              label={chip.label}
                              tone={chip.tone}
                            />
                          ))}
                        </div>
                      )}
                      <div
                        style={{
                          padding: '6px 10px 6px 60px',
                          borderRadius: 10,
                          background: youInfoDimmed ? 'rgba(3,8,11,0.58)' : 'rgba(3,8,11,0.82)',
                          border: isMyTurn
                            ? `2px solid ${TABLE_THEME.teal}`
                            : winnersById.has(you.id)
                              ? '2px solid #22c55e'
                              : `1px solid ${TABLE_THEME.border}`,
                          boxShadow: isMyTurn
                            ? '0 0 0 3px rgba(20,184,166,0.22), 0 0 32px rgba(20,184,166,0.44)'
                            : winnersById.has(you.id)
                              ? '0 0 0 2px rgba(34, 197, 94, 0.2)'
                              : undefined,
                          textAlign: 'center',
                          opacity: youInfoDimmed ? 0.7 : 1,
                          position: 'relative',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                        }}
                      >
                        {renderTurnTimer(isMyTurn)}
                        {youAvatarStyle && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 'calc(6px - 0.15cm)',
                              left: 'calc(8px - 0.2cm)',
                              overflow: 'hidden',
                              color: youAvatarColor,
                              ...youAvatarStyle,
                            }}
                          >
                            {suitSymbol(youAvatarSuit)}
                          </div>
                        )}
                        <div
                          style={{
                            fontWeight: 700,
                            fontFamily: TABLE_THEME.fontSans,
                            fontSize: 12,
                          }}
                        >
                          {you.name}
                        </div>
                        <div
                          data-testid="hero-stack"
                          style={{ fontSize: 12, fontFamily: TABLE_THEME.fontSans }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <StackChipsIcon size={14} />
                            {you.stack}
                          </span>
                        </div>
                        {youBusted ? (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 10,
                              letterSpacing: 0.2,
                              color: '#fecaca',
                              textTransform: 'uppercase',
                            }}
                          >
                            out of chips
                          </div>
                        ) : null}
                        {isMyTurn ? (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 10,
                              letterSpacing: 0.3,
                              color: '#bae6fd',
                              textTransform: 'uppercase',
                              animation: 'turn-pulse 1.2s ease-in-out infinite',
                            }}
                          >
                            your turn
                          </div>
                        ) : null}
                      </div>
                      {renderReactionBadge(you.id)}
                      {renderBetPill(you.betThisStreet, {
                        left: '50%',
                        top: -30,
                        transform: 'translate(-50%, -100%)',
                      })}
                    </div>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: heroCardsBottomOffset - heroAreaOffsetPx,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {discardPending && !discardSubmitted && (
                      <div
                        style={{ fontSize: 12, fontFamily: TABLE_THEME.fontSans, opacity: 0.85 }}
                      >
                        Select {discardLimit} card to discard ({selectedDiscardCount}/{discardLimit}
                        )
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: isPhone ? 8 : 10 }}>
                      {you.holeCards.map((c, idx) => {
                        const discardSelectable =
                          discardPending && !discardSubmitted && !animateHoleDeal;
                        const discardSelected = discardSelectable && selectedDiscardIndex === idx;
                        return (
                          <div
                            key={`${dealAnimationKey}-hole-${idx}`}
                            style={
                              (animateHoleDeal
                                ? {
                                    animation: `deal-card 700ms ease-out ${idx * 120}ms both`,
                                    '--deal-x': '0px',
                                    '--deal-y': '-10.5cm',
                                  }
                                : {}) as React.CSSProperties
                            }
                          >
                            <div
                              style={{
                                transform: `rotate(${idx === 0 ? -6 : 6}deg) translateY(${discardSelected ? '-8px' : '0px'})`,
                                cursor: discardPending && !discardSubmitted ? 'pointer' : 'default',
                                transition: 'transform 140ms ease, filter 140ms ease',
                                filter: discardSelectable
                                  ? discardSelected
                                    ? 'drop-shadow(0 0 10px rgba(248,113,113,0.5))'
                                    : 'drop-shadow(0 0 8px rgba(34,197,94,0.35))'
                                  : undefined,
                              }}
                              onClick={() => handleDiscardClick(idx)}
                            >
                              <CardView
                                card={c}
                                size="large"
                                outline={
                                  discardFlashIndex === idx
                                    ? 'red'
                                    : discardSelectable
                                      ? discardSelected
                                        ? 'red'
                                        : 'green'
                                      : undefined
                                }
                                fade={discardFlashIndex === idx}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          {(you || localNeedsRebuy) && (
            <div
              style={{
                position: pinActionTray ? 'fixed' : 'static',
                left: pinActionTray ? (isPhone ? 8 : 16) : undefined,
                right: pinActionTray ? (isPhone ? 8 : 16) : undefined,
                bottom: pinActionTray
                  ? `calc(${isPhone ? 8 : 12}px + env(safe-area-inset-bottom))`
                  : undefined,
                zIndex: pinActionTray ? 35 : 'auto',
                width: pinActionTray ? 'auto' : 'min(820px, 100%)',
                margin: pinActionTray ? 0 : '0 auto',
                background: 'transparent',
                border: 'none',
                borderRadius: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: isLandscapePhone ? 6 : isMobile ? 8 : 10,
                alignItems: 'stretch',
              }}
            >
              {rebuyTray}
              {isDiscardPhase ? (
                <div
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${TABLE_THEME.tealBorder}`,
                    background: TABLE_THEME.panelStrong,
                    padding: isPhone ? '10px 12px' : '12px 14px',
                    boxShadow: '0 0 0 1px rgba(20,184,166,0.25), 0 14px 28px rgba(8,47,73,0.28)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span
                      data-testid="turn-indicator"
                      style={{
                        borderRadius: 999,
                        border: '1px solid rgba(20,184,166,0.75)',
                        background: 'rgba(20,184,166,0.2)',
                        color: '#ccfbf1',
                        padding: '3px 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Discard
                    </span>
                    <span style={{ fontSize: 11, color: timerTone }}>
                      {tableTimerSeconds !== null ? `${tableTimerSeconds}s` : '--'}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: TABLE_THEME.text }}>
                    Select {discardLimit} card to discard ({selectedDiscardCount}/{discardLimit})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                    <button
                      type="button"
                      onClick={confirmDiscardSelection}
                      disabled={!canConfirmDiscard}
                      style={turnActionStyle(canConfirmDiscard, {
                        border: 'rgba(94,234,212,0.78)',
                        background: 'rgba(20,184,166,0.28)',
                        color: '#ccfbf1',
                        glow: 'rgba(20,184,166,0.3)',
                      })}
                    >
                      Confirm Discards
                    </button>
                  </div>
                </div>
              ) : null}
              {isBettingPhase ? (
                <div
                  style={{
                    width: '100%',
                    borderRadius: 8,
                    border: isMyTurn
                      ? `1px solid ${TABLE_THEME.tealBorder}`
                      : `1px solid ${TABLE_THEME.border}`,
                    background: TABLE_THEME.panelStrong,
                    padding: isMyTurn ? (isPhone ? '10px 12px' : '12px 14px') : '9px 12px',
                    boxShadow: isMyTurn
                      ? '0 0 0 1px rgba(20,184,166,0.2), 0 14px 28px rgba(20,184,166,0.16)'
                      : '0 10px 20px rgba(0,0,0,0.22)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: isMyTurn ? 8 : 4,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-start',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span
                      data-testid="turn-indicator"
                      style={{
                        borderRadius: 999,
                        border: isMyTurn
                          ? `1px solid ${TABLE_THEME.tealBorder}`
                          : `1px solid ${TABLE_THEME.border}`,
                        background: isMyTurn ? TABLE_THEME.tealSoft : TABLE_THEME.panelSoft,
                        color: isMyTurn ? '#ccfbf1' : TABLE_THEME.muted,
                        padding: '3px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {trayTurnStatusLabel}
                    </span>
                  </div>
                  {isMyTurn ? (
                    <div style={{ fontSize: 12, color: 'rgba(244,244,245,0.9)' }}>
                      {actionTrayStakeLine}
                    </div>
                  ) : null}
                  {isMyTurn ? (
                    <>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                          gap: 8,
                          alignItems: 'stretch',
                          width: '100%',
                        }}
                      >
                        <button
                          data-testid="action-fold"
                          type="button"
                          disabled={!canFold}
                          onClick={() => act('fold')}
                          style={turnActionStyle(canFold, {
                            border: 'rgba(248,113,113,0.86)',
                            background: 'rgba(127,29,29,0.58)',
                            color: '#fee2e2',
                            glow: 'rgba(248,113,113,0.35)',
                          })}
                        >
                          Fold
                        </button>
                        <button
                          data-testid={toCall === 0 ? 'action-check' : 'action-call'}
                          type="button"
                          disabled={!canCheckOrCall}
                          onClick={() => {
                            if (toCall === 0) {
                              act('check');
                              return;
                            }
                            act('call');
                          }}
                          style={turnActionStyle(canCheckOrCall, {
                            border: 'rgba(94,234,212,0.78)',
                            background: 'rgba(20,184,166,0.28)',
                            color: '#e0f2fe',
                            glow: 'rgba(20,184,166,0.3)',
                          })}
                        >
                          {checkOrCallLabel}
                        </button>
                        <button
                          data-testid={toCall === 0 ? 'action-call' : 'action-check'}
                          type="button"
                          disabled
                          aria-hidden="true"
                          style={{ display: 'none' }}
                        />
                        <button
                          type="button"
                          disabled={!canOpenRaiseDrawer}
                          onClick={toggleRaiseDrawer}
                          style={turnActionStyle(canOpenRaiseDrawer, {
                            border: 'rgba(148,163,184,0.82)',
                            background: 'rgba(255,255,255,0.06)',
                            color: '#e2e8f0',
                            glow: 'rgba(148,163,184,0.26)',
                          })}
                        >
                          {showRaiseDrawer ? `Close ${raiseActionLabel}` : raiseActionLabel}
                        </button>
                      </div>
                      {showRaiseDrawer ? (
                        <div
                          style={{
                            marginTop: 2,
                            borderRadius: 8,
                            border: `1px solid ${TABLE_THEME.border}`,
                            background: 'rgba(0,0,0,0.3)',
                            padding: isPhone ? '10px' : '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                          }}
                        >
                          <div style={{ fontSize: 12, color: '#e2e8f0' }}>
                            {hand?.currentBet === 0 ? 'Bet amount' : 'Raise to'}{' '}
                            <strong>{clampedRaiseTo}</strong>
                          </div>
                          <input
                            type="range"
                            min={minRaiseTo ?? undefined}
                            max={maxRaiseTo ?? undefined}
                            value={clampedRaiseTo}
                            step={1}
                            disabled={
                              !canOpenRaiseDrawer || minRaiseTo === null || maxRaiseTo === null
                            }
                            onChange={(event) => {
                              const next = Number.parseInt(event.target.value, 10);
                              setBetAmount(Number.isFinite(next) ? next : 0);
                            }}
                            style={{ width: '100%' }}
                          />
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                              gap: 6,
                            }}
                          >
                            {quickRaiseOptions.map((option) => (
                              <button
                                key={`${option.label}-${option.value}`}
                                type="button"
                                onClick={() => {
                                  setBetAmount(option.value);
                                  setConfirmAllIn(false);
                                }}
                                style={{
                                  borderRadius: 6,
                                  border: `1px solid ${TABLE_THEME.border}`,
                                  background: option.requiresConfirm
                                    ? 'rgba(127,29,29,0.46)'
                                    : TABLE_THEME.panelSoft,
                                  color: option.requiresConfirm ? '#fee2e2' : TABLE_THEME.text,
                                  padding: '7px 6px',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: isPhone ? '1fr' : '1fr auto',
                              gap: 8,
                            }}
                          >
                            <input
                              type="number"
                              value={betAmount}
                              min={minRaiseTo ?? undefined}
                              max={maxRaiseTo ?? undefined}
                              step={1}
                              disabled={!canOpenRaiseDrawer}
                              onChange={(event) => {
                                const next = Number.parseInt(event.target.value, 10);
                                setBetAmount(Number.isFinite(next) ? next : 0);
                              }}
                              style={{
                                minHeight: 42,
                                borderRadius: 6,
                                border: `1px solid ${TABLE_THEME.border}`,
                                background: 'rgba(0,0,0,0.32)',
                                color: TABLE_THEME.text,
                                padding: '8px 10px',
                                fontSize: 13,
                                outline: 'none',
                              }}
                            />
                            <button
                              data-testid="action-raise"
                              type="button"
                              disabled={!canRaise}
                              onClick={submitRaiseAction}
                              style={turnActionStyle(canRaise, {
                                border:
                                  maxRaiseTo !== null && clampedRaiseTo >= maxRaiseTo
                                    ? 'rgba(248,113,113,0.9)'
                                    : 'rgba(94,234,212,0.78)',
                                background:
                                  maxRaiseTo !== null && clampedRaiseTo >= maxRaiseTo
                                    ? 'rgba(127,29,29,0.58)'
                                    : 'rgba(20,184,166,0.28)',
                                color:
                                  maxRaiseTo !== null && clampedRaiseTo >= maxRaiseTo
                                    ? '#fee2e2'
                                    : '#ccfbf1',
                                glow:
                                  maxRaiseTo !== null && clampedRaiseTo >= maxRaiseTo
                                    ? 'rgba(248,113,113,0.35)'
                                    : 'rgba(20,184,166,0.3)',
                              })}
                            >
                              {maxRaiseTo !== null && clampedRaiseTo >= maxRaiseTo && !confirmAllIn
                                ? `Confirm all-in ${clampedRaiseTo}`
                                : `${raiseActionLabel} ${clampedRaiseTo}`}
                            </button>
                          </div>
                          <div style={{ fontSize: 11, color: 'rgba(203,213,225,0.9)' }}>
                            {raiseDisabledHint}
                          </div>
                        </div>
                      ) : null}
                      {!showRaiseDrawer ? (
                        <button
                          data-testid="action-raise"
                          type="button"
                          disabled
                          aria-hidden="true"
                          style={{ display: 'none' }}
                        />
                      ) : null}
                      <button
                        data-testid="action-allin"
                        type="button"
                        disabled
                        aria-hidden="true"
                        style={{ display: 'none' }}
                      />
                    </>
                  ) : (
                    hiddenBettingActionButtons
                  )}
                </div>
              ) : null}
              {isRevealPhase ? (
                <div
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${TABLE_THEME.tealBorder}`,
                    background: TABLE_THEME.panelStrong,
                    padding: isPhone ? '9px 10px' : '10px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                      fontSize: isPhone ? 13 : 14,
                      fontWeight: 800,
                      color: '#dcfce7',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {showdownSummary ?? 'Showdown in progress'}
                  </div>
                  <button
                    type="button"
                    onClick={() => send({ type: 'nextHand' })}
                    style={turnActionStyle(true, {
                      border: 'rgba(94,234,212,0.78)',
                      background: 'rgba(20,184,166,0.28)',
                      color: '#ccfbf1',
                      glow: 'rgba(20,184,166,0.3)',
                    })}
                  >
                    Next Hand
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : seated ? (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: centeredSectionMinHeight,
              paddingTop: 'clamp(0px, 2vh, 1cm)',
              paddingBottom: 'clamp(0px, 6vh, 2cm)',
            }}
          >
            {startGateTray ? (
              <div
                style={{
                  width: isMobile ? '100%' : 'min(720px, 100%)',
                  transform: isMobile ? 'none' : 'translateY(-3cm)',
                }}
              >
                {startGateTray}
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  transform: isMobile ? 'none' : 'translateY(-7cm)',
                }}
              >
                <div
                  style={{
                    fontFamily: TABLE_THEME.fontSans,
                    fontSize: 16,
                    fontWeight: 700,
                    opacity: 0.85,
                    marginTop: '0.6cm',
                  }}
                >
                  Waiting for next hand
                  <span style={{ display: 'inline-flex', marginLeft: 4 }}>
                    <span style={ellipsisDotStyle(0)}>.</span>
                    <span style={ellipsisDotStyle(200)}>.</span>
                    <span style={ellipsisDotStyle(400)}>.</span>
                  </span>
                </div>
              </div>
            )}
          </div>
          {rebuyTray || nextHandTray ? (
            <div
              style={{
                position: pinActionTray ? 'fixed' : 'static',
                left: pinActionTray ? (isPhone ? 8 : 16) : undefined,
                right: pinActionTray ? (isPhone ? 8 : 16) : undefined,
                bottom: pinActionTray
                  ? `calc(${isPhone ? 8 : 12}px + env(safe-area-inset-bottom))`
                  : undefined,
                zIndex: pinActionTray ? 35 : 'auto',
                width: pinActionTray ? 'auto' : 'min(820px, 100%)',
                margin: pinActionTray ? 0 : '0 auto',
              }}
            >
              {rebuyTray ?? nextHandTray}
            </div>
          ) : null}
        </>
      ) : null}
      <style>{`
        *,
        *::before,
        *::after {
          box-sizing: border-box;
        }
        html,
        body {
          margin: 0;
          padding: 0;
          background: #03080b;
          -webkit-text-size-adjust: 100%;
        }
        @keyframes deal-card {
          0% {
            opacity: 0;
            transform: translate(var(--deal-x, 0px), var(--deal-y, -200px)) scale(0.92);
          }
          100% {
            opacity: 1;
            transform: translate(0, 0) scale(1);
          }
        }
        @keyframes ellipsis-blink {
          0%,
          80%,
          100% {
            opacity: 0.2;
          }
          40% {
            opacity: 1;
          }
        }
        @keyframes turn-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
      `}</style>
    </div>
  );
};

const rasterPngCardPath = (card: Card) => {
  if (isHiddenCard(card)) return null;
  const rankMap: Record<Card['rank'], string> = {
    A: 'ace',
    K: 'king',
    Q: 'queen',
    J: 'jack',
    T: '10',
    '9': '9',
    '8': '8',
    '7': '7',
    '6': '6',
    '5': '5',
    '4': '4',
    '3': '3',
    '2': '2',
  };
  const suitMap: Record<Card['suit'], string> = {
    S: 'spades',
    H: 'hearts',
    D: 'diamonds',
    C: 'clubs',
  };
  const rank = rankMap[card.rank];
  const suit = suitMap[card.suit];
  return `/cards/english-pattern-png/english_pattern_${rank}_of_${suit}.png`;
};

const modernMinimalCardPath = (card: Card) => {
  if (isHiddenCard(card)) return null;
  const rankMap: Record<Card['rank'], string> = {
    A: 'ace',
    K: 'king',
    Q: 'queen',
    J: 'jack',
    T: '10',
    '9': '9',
    '8': '8',
    '7': '7',
    '6': '6',
    '5': '5',
    '4': '4',
    '3': '3',
    '2': '2',
  };
  const suitMap: Record<Card['suit'], string> = {
    S: 'spades',
    H: 'hearts',
    D: 'diamonds',
    C: 'clubs',
  };
  const rank = rankMap[card.rank];
  const suit = suitMap[card.suit];
  return `/cards/modern-minimal/${rank}_of_${suit}.png`;
};

let hasWarnedMissingCards = false;

const CardView = ({
  card,
  highlight = false,
  outline,
  fade = false,
  size = 'small',
}: {
  card: Card;
  highlight?: boolean;
  outline?: 'green' | 'red';
  fade?: boolean;
  size?: 'small' | 'medium' | 'large' | 'xlarge';
}) => {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const isRed = card.suit === 'H' || card.suit === 'D';
  const isHidden = isHiddenCard(card);
  const isLarge = size === 'large';
  const isClassicSize = size === 'large' || size === 'medium' || size === 'xlarge';
  const sizeMap = {
    small: { width: 28, height: 40, fontSize: 14, corner: 9, center: 16, pad: 2 },
    medium: { width: 44, height: 62, fontSize: 18, corner: 11, center: 22, pad: 3 },
    large: { width: 66, height: 92, fontSize: 24, corner: 12, center: 28, pad: 3 },
    xlarge: { width: 84, height: 118, fontSize: 32, corner: 19, center: 39, pad: 5 },
  };
  const sizing = sizeMap[size];
  const rankLabel = cardRankLabel(card.rank);
  const suit = suitSymbol(card.suit);
  const cardColor = isClassicSize ? (isRed ? '#dc2626' : '#111827') : isRed ? '#f87171' : '#e5e7eb';
  const cardBorder = highlight
    ? '2px solid #22c55e'
    : isClassicSize
      ? '1px solid #d1d5db'
      : `1px solid ${TABLE_THEME.border}`;
  const baseShadow = isClassicSize ? '0 6px 16px rgba(0,0,0,0.25)' : undefined;
  const outlineColor = outline === 'green' ? '#22c55e' : outline === 'red' ? '#ef4444' : null;
  const outlineShadow = outlineColor ? `0 0 0 2px ${outlineColor}` : undefined;
  const highlightShadow = highlight ? '0 0 0 2px rgba(34, 197, 94, 0.2)' : undefined;
  const cardShadow =
    [outlineShadow, highlightShadow, baseShadow].filter(Boolean).join(', ') || undefined;
  const cardOpacity = fade ? 0 : 1;
  const opacityTransition = 'opacity 0.5s ease';
  const cardImageSources = isClassicSize
    ? [rasterPngCardPath(card), modernMinimalCardPath(card)].filter((value): value is string =>
        Boolean(value)
      )
    : [];
  const imageUrl = cardImageSources[imageIndex];

  useEffect(() => {
    setImageFailed(false);
    setImageIndex(0);
  }, [card.rank, card.suit, size]);

  if (USE_CUSTOM_MINIMAL_DECK && isClassicSize && !isHidden) {
    const suitColor = isRed ? MINIMAL_DECK_PALETTE.orange : MINIMAL_DECK_PALETTE.navy;
    const isFaceCard = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
    const cornerFontSize = rankLabel === '10' ? 14 : 16;
    const cornerSuitSize = 14;
    const pipSize = 17;
    const pips = pipLayoutByRank[card.rank] ?? [];

    return (
      <div
        style={{
          width: sizing.width,
          height: sizing.height,
          borderRadius: 8,
          border: highlight ? '2px solid #22c55e' : `1px solid ${MINIMAL_DECK_PALETTE.border}`,
          background: MINIMAL_DECK_PALETTE.face,
          boxShadow: cardShadow,
          opacity: cardOpacity,
          transition: opacityTransition,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          viewBox="0 0 100 140"
          width="100%"
          height="100%"
          role="img"
          aria-label={`${rankLabel} of ${suit}`}
        >
          <rect x="0" y="0" width="100" height="140" rx="10" fill={MINIMAL_DECK_PALETTE.face} />
          <g
            fontFamily="var(--font-sans, Manrope, ui-sans-serif, system-ui)"
            fontWeight={700}
            fill={suitColor}
          >
            <text x="8" y="18" fontSize={cornerFontSize}>
              {rankLabel}
            </text>
          </g>
          <SuitPip suit={card.suit} x={13} y={30} size={cornerSuitSize} color={suitColor} />
          <g transform="translate(100 140) rotate(180)">
            <text
              x="8"
              y="18"
              fontSize={cornerFontSize}
              fontFamily="var(--font-sans, Manrope, ui-sans-serif, system-ui)"
              fontWeight={700}
              fill={suitColor}
            >
              {rankLabel}
            </text>
            <SuitPip suit={card.suit} x={13} y={30} size={cornerSuitSize} color={suitColor} />
          </g>
          {isFaceCard ? (
            <>
              <g opacity="0.55" fill={MINIMAL_DECK_PALETTE.accent}>
                <rect x="28" y="32" width="44" height="76" rx="12" transform="rotate(-18 50 70)" />
                <rect x="28" y="32" width="44" height="76" rx="12" transform="rotate(18 50 70)" />
              </g>
              <SuitPip suit={card.suit} x={50} y={70} size={26} color={suitColor} />
            </>
          ) : (
            <>
              {pips.map((pip, idx) => (
                <SuitPip
                  key={idx}
                  suit={card.suit}
                  x={pip.x}
                  y={pip.y}
                  size={pip.size ?? pipSize}
                  color={suitColor}
                />
              ))}
            </>
          )}
        </svg>
      </div>
    );
  }

  if (imageUrl && !imageFailed) {
    return (
      <div
        style={{
          width: sizing.width,
          height: sizing.height,
          borderRadius: 6,
          border: cardBorder,
          background: '#f8fafc',
          boxShadow: cardShadow,
          opacity: cardOpacity,
          transition: opacityTransition,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={imageUrl}
          alt={`${rankLabel} of ${suit}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => {
            if (imageIndex < cardImageSources.length - 1) {
              setImageIndex(imageIndex + 1);
              return;
            }
            if (typeof window !== 'undefined') {
              if (!hasWarnedMissingCards) {
                console.warn(`Card assets missing (falling back to text render): ${imageUrl}`);
                hasWarnedMissingCards = true;
              }
            }
            setImageFailed(true);
          }}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="role-chip"
      style={{
        width: sizing.width,
        height: sizing.height,
        borderRadius: 6,
        border: cardBorder,
        background: isClassicSize ? '#f8fafc' : '#111827',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: sizing.fontSize,
        color: cardColor,
        boxShadow: cardShadow,
        opacity: cardOpacity,
        transition: opacityTransition,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {!isClassicSize || isHidden ? (
        <>
          {card.rank}
          {suit}
        </>
      ) : (
        <>
          <div
            style={{
              position: 'absolute',
              top: sizing.pad,
              left: sizing.pad,
              fontSize: sizing.corner,
              lineHeight: 1,
              textAlign: 'left',
            }}
          >
            <div>{rankLabel}</div>
          </div>
          <div style={{ fontSize: sizing.center, opacity: 0.9 }}>{suit}</div>
          <div
            style={{
              position: 'absolute',
              bottom: sizing.pad,
              right: sizing.pad,
              fontSize: sizing.corner,
              lineHeight: 1,
              textAlign: 'right',
              transform: 'rotate(180deg)',
            }}
          >
            <div>{rankLabel}</div>
          </div>
        </>
      )}
    </div>
  );
};

const RoleChip = ({ label, tone }: { label: string; tone: 'dealer' | 'blind' }) => {
  const isDealer = tone === 'dealer';
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        background: isDealer ? TABLE_THEME.amberStrong : TABLE_THEME.teal,
        border: isDealer ? '1px solid #fef3c7' : '1px solid #ccfbf1',
        color: '#031014',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.2,
        fontFamily: TABLE_THEME.fontSans,
      }}
    >
      {label}
    </div>
  );
};

const StackChipsIcon = ({ size = 14 }: { size?: number }) => {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="16" cy="10" rx="10" ry="4" fill="#6b7280" stroke="#e5e7eb" strokeWidth="1" />
      <ellipse cx="16" cy="17" rx="10" ry="4" fill="#9ca3af" stroke="#e5e7eb" strokeWidth="1" />
      <ellipse cx="16" cy="24" rx="10" ry="4" fill="#6b7280" stroke="#e5e7eb" strokeWidth="1" />
      <ellipse cx="16" cy="10" rx="6.5" ry="2.5" fill="none" stroke="#f3f4f6" strokeWidth="1" />
      <ellipse cx="16" cy="17" rx="6.5" ry="2.5" fill="none" stroke="#f3f4f6" strokeWidth="1" />
      <ellipse cx="16" cy="24" rx="6.5" ry="2.5" fill="none" stroke="#f3f4f6" strokeWidth="1" />
    </svg>
  );
};

export default PokerGamePage;
