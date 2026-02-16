import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Client as NakamaClient } from '@heroiclabs/nakama-js';
import type { Match, Session, Socket as NakamaSocket } from '@heroiclabs/nakama-js';
import { Card, HandState, PlayerInHand } from '@pdh/engine';
import { TABLE_CHAT_MAX_LENGTH, TABLE_REACTIONS } from '@pdh/protocol';
import { ClientMessage, ServerMessage } from '../server-types';
import { logClientEvent } from '../lib/clientTelemetry';
import { useFeatureFlags } from '../lib/featureFlags';
import { normalizePlayerName, readStoredPlayerName, storePlayerName } from '../lib/playerIdentity';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';
const NETWORK_BACKEND = (
  process.env.NEXT_PUBLIC_NETWORK_BACKEND ||
  (process.env.NEXT_PUBLIC_NAKAMA_HOST ? 'nakama' : 'legacy')
).toLowerCase();
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
      const statusText = typeof maybeStatusText === 'string' && maybeStatusText
        ? ` ${maybeStatusText}`
        : '';
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
const avatarSuitColor = (suit: Card['suit']) => (suit === 'H' || suit === 'D' ? '#dc2626' : '#111827');

const cardRankLabel = (rank: Card['rank']) => (rank === 'T' ? '10' : rank);
const cardText = (c: Card) => `${cardRankLabel(c.rank)}${suitSymbol(c.suit)}`;
type PlayerActionType = Extract<ClientMessage, { type: 'action' }>['action'];
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

const SuitPip = ({ suit, x, y, size, color }: { suit: Card['suit']; x: number; y: number; size: number; color: string }) => {
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

const ACTION_TONE_STYLES: Record<ActionTone, { background: string; border: string; color: string }> = {
  raise: { background: 'rgba(30, 41, 59, 0.9)', border: '#38bdf8', color: '#e0f2fe' },
  call: { background: 'rgba(30, 41, 59, 0.9)', border: '#a3e635', color: '#f7fee7' },
  allin: { background: 'rgba(88, 28, 28, 0.9)', border: '#f97316', color: '#fff7ed' },
  fold: { background: 'rgba(63, 29, 29, 0.9)', border: '#ef4444', color: '#fee2e2' },
  check: { background: 'rgba(30, 41, 59, 0.9)', border: '#94a3b8', color: '#e2e8f0' },
  bet: { background: 'rgba(30, 41, 59, 0.9)', border: '#facc15', color: '#fef9c3' },
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
  const sizing = size === 'small'
    ? { width: 30, height: 44, radius: 6, inset: 3 }
    : { width: 36, height: 52, radius: 7, inset: 4 };
  const palette =
    tone === 'red'
      ? { base: '#b91c1c', dark: '#7f1d1d', border: '#f8fafc', pattern: 'rgba(254,226,226,0.35)' }
      : tone === 'gold'
        ? { base: '#9a6a24', dark: '#6b4517', border: '#fef3c7', pattern: 'rgba(252,211,77,0.28)' }
        : { base: '#0f172a', dark: '#1f2937', border: '#f8fafc', pattern: 'rgba(148,163,184,0.25)' };
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
  const { uiTableV2, uiDiscardOverlayV2 } = useFeatureFlags();
  const connectionRef = useRef<{ send: (msg: ClientMessage) => void; close: () => void } | null>(null);
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
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<TableChatMessage[]>([]);
  const [mutedChatPlayerIds, setMutedChatPlayerIds] = useState<string[]>([]);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const resolvedForcedMatchId = forcedMatchId?.trim() || '';
  const hasLoggedTableJoinedRef = useRef(false);
  const hasLoggedFirstActionRef = useRef(false);
  const autoJoinAttemptedRef = useRef(false);
  const [hasReceivedState, setHasReceivedState] = useState(false);

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
    window.localStorage.setItem(UI_STORAGE_KEYS.mutedChatPlayerIds, JSON.stringify(mutedChatPlayerIds));
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
    if (msg.type !== 'action' && msg.type !== 'discard' && msg.type !== 'nextHand') {
      return msg;
    }
    if (typeof msg.seq === 'number' && Number.isInteger(msg.seq) && msg.seq > 0) {
      return msg;
    }
    return { ...msg, seq: reserveMutatingSeq() };
  };

  useEffect(() => {
    const existing = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.playerId) : null;
    const storedNextMutatingSeq =
      typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEYS.nextMutatingSeq) : null;
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
        clearJoinTimeout();
        setPlayerId(msg.playerId);
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEYS.playerId, msg.playerId);
        }
      }
      if (msg.type === 'state') {
        clearJoinTimeout();
        setHasReceivedState(true);
        const statePlayerId =
          msg.state &&
          typeof msg.state === 'object' &&
          'you' in msg.state &&
          msg.state.you &&
          typeof msg.state.you === 'object' &&
          'playerId' in msg.state.you &&
          typeof msg.state.you.playerId === 'string'
            ? msg.state.you.playerId
            : null;
        if (statePlayerId) {
          setPlayerId(statePlayerId);
          if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEYS.playerId, statePlayerId);
          }
        }
        setState(msg.state);
      }
      if (msg.type === 'error') {
        clearJoinTimeout();
        setStatus(msg.message);
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
          ws.send(JSON.stringify(msg));
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

      const storedMatchId =
        typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEYS.matchId) : null;
      if (storedMatchId) {
        try {
          return await socket.joinMatch(storedMatchId);
        } catch {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(STORAGE_KEYS.matchId);
          }
        }
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
      const session = await client.authenticateDevice(getOrCreateDeviceId(), true);
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
                setStatus(`Send failed: ${errorMessage(error)}`);
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
  useEffect(() => {
    if (!seated) {
      setShowUtilitiesPanel(false);
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

  const isMyTurn = Boolean(hand && you && hand.phase === 'betting' && hand.actionOnSeat === you.seat);
  const youInfoDimmed = Boolean(hand && hand.phase === 'betting' && !isMyTurn);
  const discardPending = hand && you && hand.phase === 'discard' && hand.discardPending.includes(you.id);
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
      if (player.status === 'folded' || player.status === 'out') {
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
      hand.players.filter((p) => p.status !== 'folded' && p.status !== 'out').length > 1,
  );
  const raiseCapReached = Boolean(hand && hand.raisesThisStreet >= 2);
  const allInTotal = you ? you.stack + you.betThisStreet : 0;
  const allInWouldRaise = Boolean(hand && hand.currentBet > 0 && allInTotal > hand.currentBet);
  const cardsRemaining = you?.holeCards.length ?? 0;
  const discardMilestones = [5, 4, 3, 2] as const;
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
  const tableTimerSeconds =
    hand?.phase === 'betting' ? actionSecondsLeft : hand?.phase === 'discard' ? discardSecondsLeft : null;
  const tableStateTitle = useMemo(() => {
    if (!hand) return '';
    if (hand.phase === 'betting') {
      if (isMyTurn) {
        return `Your turn · ${currentStreetLabel}`;
      }
      return `${actionOnPlayer?.name ?? 'Player'} to act · ${currentStreetLabel}`;
    }
    if (hand.phase === 'discard') {
      if (discardPending && !discardSubmitted) {
        return `Discard 1 · ${currentStreetLabel}`;
      }
      return `Waiting for discards · ${currentStreetLabel}`;
    }
    if (hand.phase === 'showdown') {
      return 'Showdown';
    }
    return currentStreetLabel;
  }, [hand, isMyTurn, currentStreetLabel, actionOnPlayer, discardPending, discardSubmitted]);
  const tableStateSubtitle = useMemo(() => {
    if (!hand) return '';
    if (hand.phase === 'betting') {
      const livePot = hand.players.reduce((sum, player) => sum + player.totalCommitted, 0);
      return `Pot ${livePot} · To call ${toCall} · Current bet ${hand.currentBet}`;
    }
    if (hand.phase === 'discard') {
      return `${hand.discardPending.length} pending discard${hand.discardPending.length === 1 ? '' : 's'}`;
    }
    if (hand.phase === 'showdown') {
      return hand.showdownWinners.length > 0 ? 'Hand complete' : 'Determining winners...';
    }
    return '';
  }, [hand, toCall]);
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
    const timeoutId = window.setTimeout(() => send({ type: 'nextHand' }), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [hand?.phase, hand?.handId]);

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
    if (!hand || (hand.phase !== 'betting' && hand.phase !== 'discard')) {
      return;
    }
    setClockNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [hand?.handId, hand?.phase, hand?.actionDeadline, hand?.discardDeadline]);

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
    const timeoutId = window.setTimeout(() => {
      setReactionCooldownUntil(0);
    }, Math.max(0, reactionCooldownUntil - Date.now()));
    return () => window.clearTimeout(timeoutId);
  }, [reactionCooldownUntil]);

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const updateScale = () => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nextScale = Math.min(rect.width / BASE_TABLE_WIDTH, rect.height / BASE_TABLE_HEIGHT);
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
  }, []);

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
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  useEffect(() => {
    if (!isMyTurn || suggestedRaiseTo === null) return;
    setBetAmount(suggestedRaiseTo);
  }, [isMyTurn, hand?.handId, hand?.currentBet, hand?.minRaise, suggestedRaiseTo]);

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
      setStatus('Join timed out. Please try again.');
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
      setStatus('Join timed out. Please try again.');
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

  const discard = (idx: number) => {
    send({ type: 'discard', index: idx });
  };

  const submitDiscard = (idx: number) => {
    if (!discardPending || discardSubmitted) return;
    logFirstAction('discard', { discardIndex: idx });
    setDiscardSubmitted(true);
    setDiscardFlashIndex(idx);
    setSelectedDiscardIndex(null);
    if (discardTimerRef.current) {
      window.clearTimeout(discardTimerRef.current);
    }
    discardTimerRef.current = window.setTimeout(() => {
      setDiscardFlashIndex(null);
      discardTimerRef.current = null;
      discard(idx);
    }, 500);
  };

  const handleDiscardClick = (idx: number) => {
    if (!discardPending || discardSubmitted) return;
    if (uiDiscardOverlayV2) {
      setSelectedDiscardIndex(idx);
      return;
    }
    submitDiscard(idx);
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
    if (!action) return null;
    const tone = ACTION_TONE_STYLES[action.tone];
    return (
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '100%',
          transform: 'translate(calc(8px - 0.3cm), calc(-50% - 1cm))',
          padding: '4px 8px',
          borderRadius: 8,
          background: tone.background,
          border: `1px solid ${tone.border}`,
          color: tone.color,
          fontSize: 11,
          fontFamily: '"Inter", sans-serif',
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
          fontFamily: '"Inter", sans-serif',
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
    return `${winnerSeat?.name ?? topWinner.playerId} won ${topWinner.amount}${label}`;
  }, [hand?.showdownWinners, hand?.players]);

  const seatingPositions = [
    { left: '50%', top: '82%' },
    { left: '14%', top: '22%' },
    { left: '86%', top: '22%' },
    { left: '92%', top: '52%' },
    { left: '8%', top: '52%' },
    { left: '80%', top: '78%' },
    { left: '20%', top: '78%' },
  ];
  const orderedPlayers = hand
    ? [
        ...(you ? [you] : []),
        ...hand.players.filter((p) => p.id !== playerId),
      ]
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
    const nextOccupiedSeat = (start: number) => {
      for (let i = 1; i <= max; i += 1) {
        const idx = (start + i) % max;
        if (seats[idx]) return idx;
      }
      return null;
    };
    const active = hand.players.filter((p) => p.status !== 'folded' && p.status !== 'out');
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
      border: youIsWinner ? '3px solid #22c55e' : '3px solid #314066',
      boxShadow: '0 0 18px rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Inter", sans-serif',
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
  const isMobile = viewportWidth <= 900;
  const isPhone = viewportWidth <= 640;
  const centeredSectionMinHeight = isMobile ? 'calc(100vh - 220px)' : 'calc(100vh - 260px)';
  const tableOuterWidth = `min(${BASE_TABLE_WIDTH}px, calc(100vw - ${isPhone ? 16 : 36}px))`;
  const tableOuterBorder = isPhone ? 6 : isMobile ? 8 : 10;
  const actionButtonBaseStyle: React.CSSProperties = {
    padding: isPhone ? '12px 14px' : '10px 16px',
    fontWeight: 700,
    minHeight: 44,
    borderRadius: 12,
    border: '1px solid rgba(71,85,105,0.9)',
    background: 'rgba(15,23,42,0.82)',
    color: '#e2e8f0',
    fontFamily:
      'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
    fontSize: isPhone ? 13 : 14,
    letterSpacing: 0.2,
    transition: 'all 140ms ease',
    boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
    cursor: 'pointer',
  };
  const actionInputStyle: React.CSSProperties = {
    padding: isPhone ? 10 : 8,
    width: isPhone ? 112 : 124,
    minHeight: 44,
    borderRadius: 12,
    border: '1px solid rgba(71,85,105,0.9)',
    background: 'rgba(2,6,12,0.62)',
    color: '#f8fafc',
    fontSize: isPhone ? 13 : 14,
    fontFamily:
      'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
    outline: 'none',
  };
  const minRaiseTo = hand ? (hand.currentBet === 0 ? hand.minRaise : hand.currentBet + hand.minRaise) : null;
  const maxRaiseTo = you ? you.stack + you.betThisStreet : null;
  const normalizedBetAmount = Number.isFinite(betAmount) ? Math.max(0, Math.floor(betAmount)) : 0;
  const canFold = Boolean(isMyTurn);
  const canCheck = Boolean(isMyTurn && toCall === 0);
  const canCall = Boolean(isMyTurn && toCall > 0);
  const canRaise = Boolean(
    isMyTurn &&
      hand &&
      !raiseCapReached &&
      minRaiseTo !== null &&
      maxRaiseTo !== null &&
      normalizedBetAmount >= minRaiseTo &&
      normalizedBetAmount <= maxRaiseTo &&
      normalizedBetAmount > hand.currentBet
  );
  const canAllIn = Boolean(isMyTurn && you && you.stack > 0 && !(raiseCapReached && allInWouldRaise));
  const raiseActionLabel = hand && hand.currentBet === 0 ? 'Bet' : 'Raise';
  const raiseDisabledHint = (() => {
    if (!hand || hand.phase !== 'betting') return 'Betting controls unlock during betting rounds.';
    if (!isMyTurn) return 'Wait for your turn.';
    if (raiseCapReached) return 'Raise cap reached on this street.';
    if (minRaiseTo === null || maxRaiseTo === null) return 'Raise amount unavailable.';
    if (normalizedBetAmount < minRaiseTo) return `Enter at least ${minRaiseTo}.`;
    if (normalizedBetAmount > maxRaiseTo) return `Max raise is ${maxRaiseTo} (all-in).`;
    return 'Raise available.';
  })();
  const actionGuideTitle = (() => {
    if (!hand || hand.phase !== 'betting') return 'Action guide';
    if (!isMyTurn) return `${actionOnPlayer?.name ?? 'Player'} is acting`;
    if (toCall === 0) return 'Your turn: no bet to call';
    if (you && toCall >= you.stack) return 'Your turn: all-in pressure';
    return 'Your turn: decision point';
  })();
  const actionGuideLine = (() => {
    if (!hand || hand.phase !== 'betting') return 'Wait for betting to start.';
    if (!isMyTurn) {
      return toCall === 0
        ? 'When action reaches you: check or bet.'
        : `When action reaches you: fold, call ${toCall}, or raise.`;
    }
    if (toCall === 0) {
      return raiseCapReached
        ? 'Check is available. Raises are capped this street.'
        : `Check for free, or ${raiseActionLabel.toLowerCase()} at least ${minRaiseTo ?? 0}.`;
    }
    return `Call ${toCall} to continue, or fold. ${
      raiseCapReached ? 'Raises capped this street.' : `Raise to at least ${minRaiseTo ?? 0}.`
    }`;
  })();
  const actionGuideTip = (() => {
    if (!hand || hand.phase !== 'betting') return 'Tip: watch the timer and act early.';
    if (!isMyTurn) return `Current bet ${hand.currentBet} · your call ${toCall}.`;
    if (toCall === 0) return 'Tip: checking keeps the pot stable; betting applies pressure.';
    if (you && toCall > Math.floor(you.stack * 0.45)) return 'Tip: large bets often justify tighter calls.';
    return 'Tip: small calls keep your range wider.';
  })();
  const disabledActionStyle: React.CSSProperties = {
    opacity: 0.48,
    cursor: 'not-allowed',
    transform: 'none',
    boxShadow: 'none',
  };
  const actionKeycapStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 16,
    padding: '1px 4px',
    borderRadius: 5,
    border: '1px solid rgba(148,163,184,0.7)',
    background: 'rgba(2,6,12,0.52)',
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1.1,
  };
  const turnActionStyle = (
    enabled: boolean,
    tone: { border: string; background: string; color: string; glow: string }
  ): React.CSSProperties => ({
    ...actionButtonBaseStyle,
    border: `1px solid ${enabled ? tone.border : 'rgba(71,85,105,0.82)'}`,
    background: enabled ? tone.background : 'rgba(15,23,42,0.58)',
    color: enabled ? tone.color : 'rgba(148,163,184,0.86)',
    boxShadow: enabled
      ? `0 0 0 1px ${tone.glow}, 0 12px 26px rgba(2,6,23,0.4)`
      : 'none',
    transform: enabled ? 'translateY(-1px)' : 'none',
    ...(enabled ? null : disabledActionStyle),
  });
  const reactionOnCooldown = reactionCooldownUntil > Date.now();
  const timerTone =
    tableTimerSeconds !== null ? (tableTimerSeconds <= 5 ? '#fda4af' : '#d1fae5') : 'rgba(226,232,240,0.72)';
  const toCallValue = hand?.phase === 'betting' ? String(toCall) : '--';
  const currentBetValue = hand?.phase === 'betting' ? String(hand.currentBet) : '--';
  const utilityEnabledCount =
    Number(soundEnabled) + Number(showActivityFeed) + Number(showTableChat);
  const actionableCount = Number(canFold) + Number(canCheck) + Number(canCall) + Number(canRaise) + Number(canAllIn);

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
      if (target && (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable)) {
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
      if (key === 'r' && canRaise) {
        event.preventDefault();
        act(hand.currentBet === 0 ? 'bet' : 'raise', normalizedBetAmount);
        return;
      }
      if (key === 'a' && canAllIn) {
        event.preventDefault();
        act('allIn');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [act, canAllIn, canCall, canCheck, canFold, canRaise, hand, normalizedBetAmount, seated]);

  return (
    <div
      style={{
        fontFamily:
          'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
        color: '#e5e7eb',
        minHeight: '100vh',
        overflowX: 'hidden',
        background:
          'linear-gradient(rgba(8, 6, 10, 0.65), rgba(8, 6, 10, 0.7)), ' +
          'url(\"/Casino floor background.png\")',
        backgroundPosition: 'center, center',
        backgroundRepeat: 'no-repeat, no-repeat',
        backgroundSize: 'cover, cover',
        padding: isPhone ? '12px 10px calc(20px + env(safe-area-inset-bottom))' : '18px 18px calc(30px + env(safe-area-inset-bottom))',
      }}
    >
      <div
        style={{
          width: 'min(100%, 980px)',
          margin: '0 auto',
          marginBottom: isMobile ? 12 : 18,
          padding: isPhone ? '12px 10px' : '14px 16px',
          borderRadius: 24,
          border: '1px solid rgba(251,191,36,0.22)',
          background: 'rgba(9,13,23,0.62)',
          boxShadow: '0 16px 44px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: isPhone ? 'column' : 'row',
            justifyContent: 'space-between',
            alignItems: isPhone ? 'flex-start' : 'center',
            gap: isPhone ? 12 : 16,
          }}
        >
          <div style={{ minWidth: 0, width: '100%' }}>
            <div style={{ textAlign: 'left', maxWidth: isMobile ? '100%' : 'min(70vw, 560px)' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              border: '1px solid rgba(251,191,36,0.4)',
              background: 'rgba(251,191,36,0.1)',
              color: '#fde68a',
              padding: '3px 12px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontFamily:
                'var(--font-display, "Sora", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
            }}
          >
            Bondi Poker
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: isPhone ? 'clamp(28px, 9vw, 34px)' : 'clamp(34px, 4vw, 44px)',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              lineHeight: 1.05,
              color: '#f8fafc',
              fontFamily:
                'var(--font-display, "Sora", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
            }}
          >
            Private Table
          </div>
          <div style={{ marginTop: 4 }}>
            <div
              style={{
                fontSize: isPhone ? 13 : 15,
                color: 'rgba(226,232,240,0.85)',
                fontFamily:
                  'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
              }}
            >
              Hold&apos;em with Hidden Discards
            </div>
          </div>
            </div>
            {seated ? (
              <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {hand?.phase === 'betting' ? (
                  <span
                    style={{
                      borderRadius: 999,
                      border: isMyTurn
                        ? '1px solid rgba(34,197,94,0.78)'
                        : '1px solid rgba(56,189,248,0.6)',
                      background: isMyTurn ? 'rgba(21,128,61,0.28)' : 'rgba(14,116,144,0.26)',
                      color: isMyTurn ? '#dcfce7' : '#e0f2fe',
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      animation: isMyTurn ? 'turn-pulse 1.2s ease-in-out infinite' : undefined,
                    }}
                  >
                    {isMyTurn ? 'Your Turn' : `${actionOnPlayer?.name ?? 'Player'} Acting`}
                  </span>
                ) : null}
                <span
                  style={{
                    borderRadius: 999,
                    border: '1px solid rgba(148,163,184,0.45)',
                    background: 'rgba(15,23,42,0.52)',
                    color: 'rgba(203,213,225,0.9)',
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {status}
                </span>
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: isPhone ? 'flex-start' : 'flex-end',
              gap: 8,
              width: isPhone ? '100%' : 'auto',
            }}
          >
            {seated ? (
              <button
                type="button"
                onClick={() => setShowUtilitiesPanel((previous) => !previous)}
                style={{
                  borderRadius: 12,
                  border: '1px solid rgba(56,189,248,0.62)',
                  background: showUtilitiesPanel ? 'rgba(14,116,144,0.3)' : 'rgba(15,23,42,0.65)',
                  color: '#e0f2fe',
                  padding: isPhone ? '9px 12px' : '10px 14px',
                  fontFamily:
                    'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.2,
                  cursor: 'pointer',
                }}
              >
                {showUtilitiesPanel ? 'Hide Extras' : 'Extras'} ({utilityEnabledCount})
              </button>
            ) : null}
            {showExitButton ? (
              <button
                type="button"
                onClick={handleExitTable}
                aria-label="Exit table and return to game entry"
                style={{
                  borderRadius: 12,
                  border: '1px solid rgba(251,191,36,0.6)',
                  background: 'rgba(251,191,36,0.2)',
                  color: '#fef3c7',
                  padding: isPhone ? '9px 12px' : '10px 14px',
                  fontFamily: '"Inter", sans-serif',
                  fontSize: isPhone ? 12 : 13,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  cursor: 'pointer',
                }}
              >
                Exit Table
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {uiTableV2 && hand && seated ? (
        <div
          style={{
            width: 'min(100%, 980px)',
            margin: '0 auto',
            marginBottom: 14,
            padding: isPhone ? '10px 10px' : '12px 14px',
            borderRadius: 16,
            border: '1px solid rgba(20,184,166,0.35)',
            background: 'rgba(8,17,28,0.75)',
            boxShadow: '0 14px 34px rgba(0,0,0,0.28)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: isPhone ? 'column' : 'row',
              justifyContent: 'space-between',
              alignItems: isPhone ? 'flex-start' : 'center',
              gap: isPhone ? 8 : 10,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: isPhone ? 14 : 15,
                  fontWeight: 700,
                  color: '#f8fafc',
                  fontFamily:
                    'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                }}
              >
                {tableStateTitle}
              </div>
              <div
                style={{
                  marginTop: 2,
                  fontSize: 12,
                  color: 'rgba(226,232,240,0.82)',
                  fontFamily:
                    'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                }}
              >
                {tableStateSubtitle}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(64px, auto))',
                gap: 8,
                width: isPhone ? '100%' : 'auto',
              }}
            >
              <div
                style={{
                  borderRadius: 10,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: 'rgba(2,6,12,0.35)',
                  padding: '6px 8px',
                }}
              >
                <div style={{ fontSize: 10, color: 'rgba(203,213,225,0.82)', textTransform: 'uppercase' }}>Street</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{currentStreetLabel}</div>
              </div>
              <div
                style={{
                  borderRadius: 10,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: 'rgba(2,6,12,0.35)',
                  padding: '6px 8px',
                }}
              >
                <div style={{ fontSize: 10, color: 'rgba(203,213,225,0.82)', textTransform: 'uppercase' }}>Pot</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{potAmount}</div>
              </div>
              <div
                style={{
                  borderRadius: 10,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: 'rgba(2,6,12,0.35)',
                  padding: '6px 8px',
                }}
              >
                <div style={{ fontSize: 10, color: 'rgba(203,213,225,0.82)', textTransform: 'uppercase' }}>To Call</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{toCallValue}</div>
              </div>
              <div
                style={{
                  borderRadius: 10,
                  border: '1px solid rgba(148,163,184,0.35)',
                  background: 'rgba(2,6,12,0.35)',
                  padding: '6px 8px',
                }}
              >
                <div style={{ fontSize: 10, color: 'rgba(203,213,225,0.82)', textTransform: 'uppercase' }}>Timer</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: timerTone }}>
                  {tableTimerSeconds !== null ? `${tableTimerSeconds}s` : '--'}
                </div>
              </div>
            </div>
          </div>

          {you ? (
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px solid rgba(71,85,105,0.45)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'rgba(186,230,253,0.85)',
                }}
              >
                Discard Track
              </span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {discardMilestones.map((milestone, index) => {
                  const isCurrent = cardsRemaining === milestone;
                  const isComplete = cardsRemaining < milestone;
                  return (
                    <div key={milestone} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          minWidth: 26,
                          textAlign: 'center',
                          borderRadius: 999,
                          border: isCurrent
                            ? '1px solid rgba(20,184,166,0.9)'
                            : '1px solid rgba(148,163,184,0.5)',
                          background: isCurrent
                            ? 'rgba(20,184,166,0.2)'
                            : isComplete
                              ? 'rgba(34,197,94,0.16)'
                              : 'rgba(15,23,42,0.65)',
                          color: isCurrent ? '#ccfbf1' : isComplete ? '#bbf7d0' : '#cbd5e1',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 6px',
                        }}
                      >
                        {milestone}
                      </span>
                      {index < discardMilestones.length - 1 ? (
                        <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.8)' }}>→</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <span style={{ fontSize: 11, color: 'rgba(226,232,240,0.78)' }}>
                Live cards: {cardsRemaining}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {seated && showUtilitiesPanel ? (
        <div
          style={{
            width: 'min(100%, 980px)',
            margin: '0 auto',
            marginBottom: 12,
            padding: isPhone ? '10px' : '12px',
            borderRadius: 14,
            border: '1px solid rgba(56,189,248,0.35)',
            background: 'rgba(4,12,22,0.78)',
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
                borderRadius: 10,
                border: '1px solid rgba(148,163,184,0.55)',
                background: soundEnabled ? 'rgba(15,118,110,0.34)' : 'rgba(30,41,59,0.62)',
                color: '#e2e8f0',
                padding: '7px 10px',
                fontFamily: '"Inter", sans-serif',
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
                borderRadius: 10,
                border: '1px solid rgba(148,163,184,0.55)',
                background: showActivityFeed ? 'rgba(56,189,248,0.26)' : 'rgba(30,41,59,0.62)',
                color: '#e2e8f0',
                padding: '7px 10px',
                fontFamily: '"Inter", sans-serif',
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
                borderRadius: 10,
                border: '1px solid rgba(148,163,184,0.55)',
                background: showTableChat ? 'rgba(20,184,166,0.26)' : 'rgba(30,41,59,0.62)',
                color: '#e2e8f0',
                padding: '7px 10px',
                fontFamily: '"Inter", sans-serif',
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
                color: 'rgba(186,230,253,0.82)',
                fontFamily:
                  'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
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
                  border: '1px solid rgba(20,184,166,0.55)',
                  background: 'rgba(15,23,42,0.75)',
                  color: '#ccfbf1',
                  padding: isPhone ? '6px 10px' : '6px 12px',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 0.4,
                  fontFamily: '"Inter", sans-serif',
                  cursor: reactionOnCooldown || !seated ? 'not-allowed' : 'pointer',
                  opacity: reactionOnCooldown || !seated ? 0.5 : 1,
                }}
              >
                {TABLE_REACTION_LABELS[reaction]}
              </button>
            ))}
            {reactionOnCooldown ? (
              <span style={{ fontSize: 11, color: 'rgba(226,232,240,0.68)' }}>Cooling down...</span>
            ) : null}
          </div>

          {showActivityFeed ? (
            <div
              style={{
                borderRadius: 10,
                border: '1px solid rgba(148,163,184,0.35)',
                background: 'rgba(9, 12, 20, 0.72)',
                padding: '8px 10px',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  color: 'rgba(186,230,253,0.82)',
                  marginBottom: 6,
                }}
              >
                Activity
              </div>
              <div style={{ maxHeight: isPhone ? 88 : 100, overflowY: 'auto' }}>
                {(state?.log ?? []).slice(-8).map((l: any, idx: number) => (
                  <div key={idx} style={{ fontSize: 12, opacity: 0.85, marginBottom: 4, fontFamily: '"Inter", sans-serif' }}>
                    {l.message}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {showTableChat ? (
            <div
              style={{
                borderRadius: 12,
                border: '1px solid rgba(56,189,248,0.4)',
                background: 'rgba(8,15,24,0.74)',
                padding: isPhone ? '10px 10px' : '11px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                    color: 'rgba(186,230,253,0.82)',
                    fontFamily:
                      'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
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
                  <div style={{ fontSize: 12, color: 'rgba(203,213,225,0.74)' }}>
                    No chat yet. Say hi.
                  </div>
                ) : (
                  visibleChatMessages.slice(-18).map((entry) => {
                    const senderName =
                      playerNameById.get(entry.playerId) ?? (entry.playerId === playerId ? 'You' : 'Player');
                    const isSelf = entry.playerId === playerId;
                    const senderMuted = mutedChatPlayerSet.has(entry.playerId);
                    return (
                      <div
                        key={entry.id}
                        style={{
                          borderRadius: 8,
                          border: '1px solid rgba(51,65,85,0.8)',
                          background: 'rgba(2,6,12,0.5)',
                          padding: '6px 8px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#bfdbfe' }}>{senderName}</span>
                          {!isSelf ? (
                            <button
                              type="button"
                              onClick={() => toggleMuteChatPlayer(entry.playerId)}
                              style={{
                                borderRadius: 999,
                                border: '1px solid rgba(148,163,184,0.5)',
                                background: 'rgba(30,41,59,0.58)',
                                color: '#e2e8f0',
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
                        <div style={{ marginTop: 3, fontSize: 12, color: 'rgba(226,232,240,0.9)' }}>
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
                    borderRadius: 10,
                    border: '1px solid rgba(71,85,105,0.85)',
                    background: 'rgba(2,6,12,0.62)',
                    color: '#f8fafc',
                    padding: '8px 10px',
                    fontSize: 13,
                    outline: 'none',
                    fontFamily:
                      'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                  }}
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || !seated}
                  style={{
                    minHeight: 40,
                    borderRadius: 10,
                    border: '1px solid rgba(56,189,248,0.75)',
                    background: 'rgba(14,116,144,0.3)',
                    color: '#e0f2fe',
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
              gap: 8,
              transform: isMobile ? 'none' : 'translateY(-2.4cm)',
              width: isPhone ? '100%' : 'min(94vw, 560px)',
            }}
          >
            <div style={{ display: 'flex', gap: 10, flexDirection: isPhone ? 'column' : 'row', width: isPhone ? 'min(92vw, 360px)' : 'auto' }}>
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
                  borderRadius: 12,
                  border: nameError ? '1px solid #fca5a5' : '1px solid rgba(251,191,36,0.4)',
                  background: 'rgba(9,13,23,0.82)',
                  color: '#f8fafc',
                  caretColor: '#f8fafc',
                  fontSize: 16,
                  fontFamily:
                    'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
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
                  borderRadius: 12,
                  border: '1px solid rgba(251,191,36,0.62)',
                  background: 'linear-gradient(135deg, rgba(251,191,36,0.35), rgba(217,119,6,0.45))',
                  color: '#fef3c7',
                  fontWeight: 700,
                  fontFamily:
                    'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                  letterSpacing: 0.5,
                  boxShadow: '0 10px 24px rgba(217,119,6,0.3)',
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
                color: 'rgba(226,232,240,0.8)',
                fontFamily:
                  'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                alignSelf: 'center',
                textAlign: 'center',
                marginLeft: 0,
              }}
            >
              Waiting for hand...
            </div>
            {status && !status.startsWith('Connected') && (
              <div
                style={{
                  fontSize: 12,
                  fontFamily:
                    'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                  color: status.toLowerCase().includes('error') || status.toLowerCase().includes('failed') ? '#fca5a5' : '#e2e8f0',
                  textAlign: 'center',
                }}
              >
                {status}
              </div>
            )}
          </div>
        </div>
      )}
      {hand ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            ref={tableRef}
            style={{
              position: 'relative',
              width: tableOuterWidth,
              maxWidth: BASE_TABLE_WIDTH,
              aspectRatio: `${BASE_TABLE_WIDTH} / ${BASE_TABLE_HEIGHT}`,
              height: 'auto',
              minHeight: isPhone ? 250 : 300,
              margin: '0 auto',
              marginTop: isMobile ? 8 : '1cm',
              borderRadius: isPhone ? 120 : 999,
              background: 'radial-gradient(circle at 50% 45%, #1f5a2f 0%, #184524 50%, #11331a 100%)',
              border: `${tableOuterBorder}px solid #2d2a40`,
              boxShadow: '0 30px 80px rgba(0,0,0,0.45), inset 0 0 40px rgba(0,0,0,0.5)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: BASE_TABLE_WIDTH,
                height: BASE_TABLE_HEIGHT,
                transform: `translate(-50%, -50%) scale(${tableScale})`,
                transformOrigin: 'center',
              }}
            >
            <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%) translateY(calc(-19px - 0.4cm))', display: 'flex', gap: '1mm' }}>
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
                  <CardView key={idx} card={c} size="xlarge" highlight={isShowdown && winningCards.has(cardKey(c))} />
                </div>
              ))}
            </div>
            <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%) translateY(calc(-19px - 3.2cm))' }}>
              <img
                src="/Casino dealer.png"
                alt="Dealer"
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 999,
                  objectFit: 'cover',
                  border: '2px solid rgba(255,255,255,0.7)',
                  boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
                  background: 'rgba(8, 12, 22, 0.6)',
                }}
              />
            </div>
            <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%) translateY(calc(-19px + 1.8cm)) translateX(-3.5cm)' }}>
              <div style={{ width: '3.22cm', height: '0.92cm', padding: 0, borderRadius: 999, background: '#0f172a', border: '1px solid #2c3e66', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.04mm', fontSize: 15, lineHeight: 1.1 }}>
                  <span style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'translateY(-0.8mm)' }} aria-hidden="true">
                    <svg viewBox="0 0 48 26" width="24" height="24" role="img" focusable="false" aria-hidden="true">
                      <g>
                        <ellipse cx="12" cy="6" rx="8" ry="3" fill="#b91c1c" stroke="#fee2e2" strokeWidth="1" />
                        <ellipse cx="12" cy="10" rx="8" ry="3" fill="#dc2626" stroke="#fee2e2" strokeWidth="1" />
                        <ellipse cx="12" cy="14" rx="8" ry="3" fill="#b91c1c" stroke="#fee2e2" strokeWidth="1" />
                        <ellipse cx="12" cy="6" rx="5" ry="1.7" fill="none" stroke="#fff7f7" strokeWidth="0.8" />
                        <rect x="6.2" y="4.4" width="2.4" height="2.4" rx="0.4" fill="#f9fafb" />
                        <rect x="15.4" y="4.4" width="2.4" height="2.4" rx="0.4" fill="#f9fafb" />
                        <rect x="10.3" y="7" width="2.6" height="2.2" rx="0.4" fill="#f9fafb" />
                      </g>
                      <g>
                        <ellipse cx="26" cy="12" rx="8" ry="3" fill="#111827" stroke="#e5e7eb" strokeWidth="1" />
                        <ellipse cx="26" cy="16" rx="8" ry="3" fill="#1f2937" stroke="#e5e7eb" strokeWidth="1" />
                        <ellipse cx="26" cy="12" rx="5" ry="1.7" fill="none" stroke="#f3f4f6" strokeWidth="0.8" />
                        <rect x="20.2" y="10.4" width="2.4" height="2.4" rx="0.4" fill="#f9fafb" />
                        <rect x="29.4" y="10.4" width="2.4" height="2.4" rx="0.4" fill="#f9fafb" />
                      </g>
                      <g>
                        <ellipse cx="40" cy="10" rx="7.5" ry="2.8" fill="#1d4ed8" stroke="#dbeafe" strokeWidth="1" />
                        <ellipse cx="40" cy="14" rx="7.5" ry="2.8" fill="#2563eb" stroke="#dbeafe" strokeWidth="1" />
                        <ellipse cx="40" cy="10" rx="4.7" ry="1.6" fill="none" stroke="#eff6ff" strokeWidth="0.8" />
                        <rect x="34.8" y="8.6" width="2.2" height="2.2" rx="0.4" fill="#f9fafb" />
                        <rect x="42.8" y="8.6" width="2.2" height="2.2" rx="0.4" fill="#f9fafb" />
                      </g>
                    </svg>
                  </span>
                  <span
                    style={{
                      marginTop: '-2.2mm',
                      minWidth: 24,
                      maxWidth: '2.2cm',
                      fontSize: 12,
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {potAmount}
                  </span>
                </span>
              </div>
            </div>
            {isShowdown && showdownSummary && (
              <div
                style={{
                  position: 'absolute',
                  top: '40%',
                  left: '50%',
                  transform: 'translate(-50%, -50%) translateY(calc(-19px + 1.7cm)) translateX(4cm)',
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
                    fontFamily: '"Inter", sans-serif',
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
              const avatarBorder = winner ? '3px solid #22c55e' : '3px solid #314066';
              const avatarSuit = avatarSuitForId(p.id);
              const avatarColor = avatarSuitColor(avatarSuit);
              const isTurn = Boolean(hand && hand.phase === 'betting' && hand.actionOnSeat === p.seat);
              const infoDimmed = Boolean(hand && hand.phase === 'betting' && !isTurn);
              const showDiscardState =
                hand?.phase === 'discard' && p.status !== 'folded' && p.status !== 'out';
              const hasDiscardedThisStreet = showDiscardState && discardConfirmedPlayers.has(p.id);
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
                fontFamily: '"Inter", sans-serif',
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
                              top: -8,
                              right: -8,
                              display: 'flex',
                              gap: 4,
                              transform: 'translate(-0.4cm, -0.5cm)',
                            }}
                          >
                            {roleChips.map((chip, chipIdx) => (
                              <RoleChip key={`${chip.label}-${chipIdx}`} label={chip.label} tone={chip.tone} />
                            ))}
                          </div>
                        )}
                        <div
                          style={{
                            position: 'relative',
                            padding: '6px 10px 6px 60px',
                            borderRadius: 10,
                            background: infoDimmed ? 'rgba(10, 16, 30, 0.6)' : 'rgba(10, 16, 30, 0.85)',
                            border: isTurn
                              ? '1px solid rgba(56,189,248,0.95)'
                              : winner
                                ? '2px solid #22c55e'
                                : '1px solid #2c3e66',
                            boxShadow: isTurn
                              ? '0 0 0 2px rgba(56,189,248,0.32), 0 0 24px rgba(14,165,233,0.38)'
                              : winner
                                ? '0 0 0 2px rgba(34, 197, 94, 0.2)'
                                : undefined,
                            opacity: infoDimmed ? 0.7 : 1,
                            textAlign: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                          }}
                        >
                        <div style={{ position: 'absolute', top: 'calc(6px - 0.15cm)', left: 'calc(8px - 0.2cm)', overflow: 'hidden', ...avatarStyle }}>
                          {suitSymbol(avatarSuit)}
                        </div>
                          <div style={{ fontWeight: 700, fontFamily: '"Inter", sans-serif', fontSize: 12 }}>{p.name}</div>
                          {p.id !== playerId && (
                            <div style={{ fontSize: 12, fontFamily: '"Inter", sans-serif' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <StackChipsIcon size={14} />
                                {p.stack}
                              </span>
                            </div>
                          )}
                          {showDiscardState ? (
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
                              acting now
                            </div>
                          ) : null}
                        </div>
                        {renderReactionBadge(p.id)}
                        {renderActionBadge(actionByPlayerId.get(p.id))}
                      </div>
                      <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center', marginLeft: '1cm' }}>
                        {[0, 1].map((cardIdx) => {
                          const rot = cardIdx === 0 ? -18 : 16;
                          const margin = cardIdx === 0 ? -24 : 0;
                          const reveal =
                            isShowdown &&
                            hasContestedShowdown &&
                            p.status !== 'folded' &&
                            p.status !== 'out' &&
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
                                <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden' }}>
                                  <CardBack size="medium" tone="gold" />
                                </div>
                                <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                                  {card && (
                                    <CardView card={card} size="medium" highlight={winningCards.has(cardKey(card))} />
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
              <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10 }}>
                {overflowPlayers.map((p) => (
                  <div key={p.id} style={{ padding: '6px 10px', borderRadius: 8, background: '#0f172a', border: '1px solid #2c3e66', fontSize: 12, fontFamily: '"Inter", sans-serif' }}>
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
                    bottom: 142 - heroAreaOffsetPx,
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
                          top: -8,
                          right: -8,
                          display: 'flex',
                          gap: 4,
                          transform: 'translate(-0.4cm, -0.5cm)',
                        }}
                      >
                        {(roleChipsBySeat.get(you.seat) ?? []).map((chip, chipIdx) => (
                          <RoleChip key={`${chip.label}-${chipIdx}`} label={chip.label} tone={chip.tone} />
                        ))}
                      </div>
                    )}
                    <div
                      style={{
                        padding: '6px 10px 6px 60px',
                        borderRadius: 10,
                        background: youInfoDimmed ? 'rgba(10, 16, 30, 0.6)' : 'rgba(10, 16, 30, 0.85)',
                        border: isMyTurn
                          ? '1px solid rgba(56,189,248,0.95)'
                          : winnersById.has(you.id)
                            ? '2px solid #22c55e'
                            : '1px solid #2c3e66',
                        boxShadow: isMyTurn
                          ? '0 0 0 2px rgba(56,189,248,0.34), 0 0 26px rgba(14,165,233,0.38)'
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
                      <div style={{ fontWeight: 700, fontFamily: '"Inter", sans-serif', fontSize: 12 }}>{you.name}</div>
                      <div style={{ fontSize: 12, fontFamily: '"Inter", sans-serif' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <StackChipsIcon size={14} />
                          {you.stack}
                        </span>
                      </div>
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
                          act now
                        </div>
                      ) : null}
                    </div>
                    {renderReactionBadge(you.id)}
                    {renderActionBadge(actionByPlayerId.get(you.id))}
                  </div>
                </div>
                <div
                  style={{
                    position: 'absolute',
                    bottom: 21 - heroAreaOffsetPx,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {discardPending && !discardSubmitted && (
                    <div style={{ fontSize: 12, fontFamily: '"Inter", sans-serif', opacity: 0.85 }}>
                      {uiDiscardOverlayV2 ? 'Select one card, then confirm discard' : 'Click a card to discard'}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10 }}>
                    {you.holeCards.map((c, idx) => (
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
                            transform: `rotate(${idx === 0 ? -6 : 6}deg)`,
                            cursor: discardPending && !discardSubmitted ? 'pointer' : 'default',
                          }}
                          onClick={() => handleDiscardClick(idx)}
                        >
                          <CardView
                            card={c}
                            size="large"
                            outline={
                              discardFlashIndex === idx
                                ? 'red'
                                : discardPending && !discardSubmitted && !animateHoleDeal
                                  ? uiDiscardOverlayV2
                                    ? selectedDiscardIndex === idx
                                      ? 'green'
                                      : undefined
                                    : 'green'
                                  : undefined
                            }
                            fade={discardFlashIndex === idx}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            </div>
          </div>
          {you && (
            <div
              style={{
                width: 'min(980px, 100%)',
                margin: '0 auto',
                background: 'transparent',
                border: 'none',
                borderRadius: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: isMobile ? 8 : 10,
                alignItems: 'stretch',
              }}
            >
              {discardPending ? (
                <div
                  style={{
                    borderRadius: 12,
                    border: '1px solid rgba(20,184,166,0.45)',
                    background: 'rgba(8,15,24,0.74)',
                    padding: '10px 12px',
                    fontSize: 12,
                    color: 'rgba(226,232,240,0.9)',
                  }}
                >
                  {uiDiscardOverlayV2
                    ? 'Discard step: select one of your cards and confirm discard.'
                    : 'Discard step: tap a card to discard.'}
                </div>
              ) : (
                <div
                  style={{
                    width: '100%',
                    position: isMobile ? 'sticky' : 'static',
                    bottom: isPhone
                      ? 'calc(8px + env(safe-area-inset-bottom))'
                      : 'calc(12px + env(safe-area-inset-bottom))',
                    zIndex: isMobile ? 30 : 'auto',
                    borderRadius: 12,
                    border: isMyTurn
                      ? '1px solid rgba(56,189,248,0.76)'
                      : '1px solid rgba(56,189,248,0.45)',
                    background: isMyTurn ? 'rgba(8,15,24,0.84)' : 'rgba(8,15,24,0.72)',
                    padding: isPhone ? '10px 12px' : '12px 14px',
                    boxShadow: isMyTurn ? '0 0 0 1px rgba(56,189,248,0.18), 0 14px 28px rgba(2,132,199,0.16)' : undefined,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      borderRadius: 10,
                      border: '1px solid rgba(71,85,105,0.7)',
                      background: 'rgba(2,6,12,0.55)',
                      padding: '8px 10px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.13em',
                        color: isMyTurn ? '#7dd3fc' : 'rgba(148,163,184,0.92)',
                        fontFamily:
                          'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                      }}
                    >
                      Action Guide
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#f8fafc',
                        fontFamily:
                          'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                      }}
                    >
                      {actionGuideTitle}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 12,
                        color: 'rgba(226,232,240,0.92)',
                        fontFamily:
                          'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                      }}
                    >
                      {actionGuideLine}
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 11,
                        color: 'rgba(186,230,253,0.9)',
                        fontFamily:
                          'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                      }}
                    >
                      {actionGuideTip}
                    </div>
                    {hand?.phase === 'betting' ? (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11,
                          color: isMyTurn ? 'rgba(125,211,252,0.96)' : 'rgba(148,163,184,0.9)',
                          letterSpacing: 0.2,
                        }}
                      >
                        {isMyTurn
                          ? `${actionableCount} option${actionableCount === 1 ? '' : 's'} ready now.`
                          : `Waiting for your turn. Current bet ${currentBetValue}.`}
                      </div>
                    ) : null}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isPhone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))',
                      gap: 8,
                      alignItems: 'stretch',
                      width: '100%',
                    }}
                  >
                    <button
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
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        Fold
                        <span style={actionKeycapStyle}>F</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!canCheck}
                      onClick={() => act('check')}
                      style={turnActionStyle(canCheck, {
                        border: 'rgba(148,163,184,0.82)',
                        background: 'rgba(30,41,59,0.78)',
                        color: '#e2e8f0',
                        glow: 'rgba(148,163,184,0.26)',
                      })}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        Check
                        <span style={actionKeycapStyle}>C</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!canCall}
                      onClick={() => act('call')}
                      style={turnActionStyle(canCall, {
                        border: 'rgba(163,230,53,0.88)',
                        background: 'rgba(54,83,20,0.58)',
                        color: '#ecfccb',
                        glow: 'rgba(163,230,53,0.34)',
                      })}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        Call {toCall}
                        <span style={actionKeycapStyle}>C</span>
                      </span>
                    </button>
                    <div style={{ gridColumn: isPhone ? 'span 2' : 'span 1' }}>
                      <input
                        type="number"
                        value={betAmount}
                        min={minRaiseTo ?? undefined}
                        max={maxRaiseTo ?? undefined}
                        step={1}
                        disabled={!isMyTurn || raiseCapReached}
                        onChange={(e) => {
                          const next = Number.parseInt(e.target.value, 10);
                          setBetAmount(Number.isFinite(next) ? next : 0);
                        }}
                        onBlur={() => {
                          if (minRaiseTo === null || maxRaiseTo === null) {
                            return;
                          }
                          setBetAmount((previous) => {
                            const normalized = Number.isFinite(previous) ? Math.floor(previous) : minRaiseTo;
                            return Math.min(maxRaiseTo, Math.max(minRaiseTo, normalized));
                          });
                        }}
                        style={{
                          ...actionInputStyle,
                          width: '100%',
                          border:
                            isMyTurn && !raiseCapReached
                              ? '1px solid rgba(56,189,248,0.8)'
                              : '1px solid rgba(71,85,105,0.9)',
                          background:
                            isMyTurn && !raiseCapReached
                              ? 'rgba(8,47,73,0.48)'
                              : 'rgba(2,6,12,0.62)',
                          ...(isMyTurn && !raiseCapReached ? null : disabledActionStyle),
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!canRaise}
                      onClick={() => act(hand && hand.currentBet === 0 ? 'bet' : 'raise', normalizedBetAmount)}
                      style={turnActionStyle(canRaise, {
                        border: 'rgba(56,189,248,0.86)',
                        background: 'rgba(14,116,144,0.58)',
                        color: '#e0f2fe',
                        glow: 'rgba(56,189,248,0.36)',
                      })}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {raiseActionLabel} to {normalizedBetAmount}
                        <span style={actionKeycapStyle}>R</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!canAllIn}
                      onClick={() => act('allIn')}
                      style={turnActionStyle(canAllIn, {
                        border: 'rgba(248,113,113,0.95)',
                        background: 'rgba(185,28,28,0.76)',
                        color: '#fff1f2',
                        glow: 'rgba(248,113,113,0.38)',
                      })}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        All-in {you ? you.stack + you.betThisStreet : ''}
                        <span style={actionKeycapStyle}>A</span>
                      </span>
                    </button>
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      color: 'rgba(203,213,225,0.9)',
                      fontFamily:
                        'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                    }}
                  >
                    {minRaiseTo !== null && maxRaiseTo !== null
                      ? `Raise range ${minRaiseTo} - ${maxRaiseTo}. ${raiseDisabledHint}`
                      : raiseDisabledHint}
                  </div>
                </div>
              )}
              {!showUtilitiesPanel ? (
                <div
                  style={{
                    fontSize: 11,
                    color: 'rgba(186,230,253,0.9)',
                    textAlign: isMobile ? 'center' : 'left',
                    letterSpacing: 0.2,
                  }}
                >
                  Extras are hidden to keep gameplay clear. Use the top Extras button for chat, feed, reactions, and sound.
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : seated ? (
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: isMobile ? 'none' : 'translateY(-7cm)' }}>
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 16, fontWeight: 700, opacity: 0.85, marginTop: '0.6cm' }}>
              Waiting for next hand
              <span style={{ display: 'inline-flex', marginLeft: 4 }}>
                <span style={ellipsisDotStyle(0)}>.</span>
                <span style={ellipsisDotStyle(200)}>.</span>
                <span style={ellipsisDotStyle(400)}>.</span>
              </span>
            </div>
          </div>
        </div>
      ) : null}
      {uiDiscardOverlayV2 && discardPending && you ? (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: isPhone ? 'calc(10px + env(safe-area-inset-bottom))' : 'calc(14px + env(safe-area-inset-bottom))',
            transform: 'translateX(-50%)',
            zIndex: 95,
            width: isPhone ? 'calc(100vw - 20px)' : 'min(560px, calc(100vw - 30px))',
            borderRadius: 14,
            border: '1px solid rgba(20,184,166,0.55)',
            background: 'rgba(2,6,14,0.92)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
            padding: isPhone ? '10px 12px' : '12px 14px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#ccfbf1',
                  fontFamily:
                    'var(--font-sans, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
                }}
              >
                Discard 1 Card
              </div>
              <div style={{ marginTop: 2, fontSize: 12, color: 'rgba(226,232,240,0.82)' }}>
                {selectedDiscardIndex === null
                  ? 'Tap a card to select it.'
                  : `Card ${selectedDiscardIndex + 1} selected.`}
              </div>
            </div>

            <div style={{ display: 'inline-flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setSelectedDiscardIndex(null)}
                disabled={selectedDiscardIndex === null || discardSubmitted}
                style={{
                  borderRadius: 10,
                  border: '1px solid rgba(148,163,184,0.55)',
                  background: 'rgba(30,41,59,0.55)',
                  color: '#e2e8f0',
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: selectedDiscardIndex === null || discardSubmitted ? 'not-allowed' : 'pointer',
                  opacity: selectedDiscardIndex === null || discardSubmitted ? 0.55 : 1,
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={confirmDiscardSelection}
                disabled={selectedDiscardIndex === null || discardSubmitted}
                style={{
                  borderRadius: 10,
                  border: '1px solid rgba(20,184,166,0.75)',
                  background: 'rgba(20,184,166,0.2)',
                  color: '#ccfbf1',
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: selectedDiscardIndex === null || discardSubmitted ? 'not-allowed' : 'pointer',
                  opacity: selectedDiscardIndex === null || discardSubmitted ? 0.55 : 1,
                }}
              >
                Confirm Discard
              </button>
            </div>
          </div>
        </div>
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
          background: #090406;
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
    xlarge: { width: 72, height: 102, fontSize: 29, corner: 18, center: 36, pad: 4 },
  };
  const sizing = sizeMap[size];
  const rankLabel = cardRankLabel(card.rank);
  const suit = suitSymbol(card.suit);
  const cardColor = isClassicSize ? (isRed ? '#dc2626' : '#111827') : isRed ? '#f87171' : '#e5e7eb';
  const cardBorder = highlight ? '2px solid #22c55e' : isClassicSize ? '1px solid #d1d5db' : '1px solid #2c3e66';
  const baseShadow = isClassicSize ? '0 6px 16px rgba(0,0,0,0.25)' : undefined;
  const outlineColor = outline === 'green' ? '#22c55e' : outline === 'red' ? '#ef4444' : null;
  const outlineShadow = outlineColor ? `0 0 0 2px ${outlineColor}` : undefined;
  const highlightShadow = highlight ? '0 0 0 2px rgba(34, 197, 94, 0.2)' : undefined;
  const cardShadow = [outlineShadow, highlightShadow, baseShadow].filter(Boolean).join(', ') || undefined;
  const cardOpacity = fade ? 0 : 1;
  const opacityTransition = 'opacity 0.5s ease';
  const cardImageSources = isClassicSize
    ? [rasterPngCardPath(card), modernMinimalCardPath(card)].filter((value): value is string => Boolean(value))
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
        <svg viewBox="0 0 100 140" width="100%" height="100%" role="img" aria-label={`${rankLabel} of ${suit}`}>
          <rect x="0" y="0" width="100" height="140" rx="10" fill={MINIMAL_DECK_PALETTE.face} />
          <g fontFamily='"Inter", sans-serif' fontWeight={700} fill={suitColor}>
            <text x="8" y="18" fontSize={cornerFontSize}>
              {rankLabel}
            </text>
          </g>
          <SuitPip suit={card.suit} x={13} y={30} size={cornerSuitSize} color={suitColor} />
          <g transform="translate(100 140) rotate(180)">
            <text x="8" y="18" fontSize={cornerFontSize} fontFamily='"Inter", sans-serif' fontWeight={700} fill={suitColor}>
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
                <SuitPip key={idx} suit={card.suit} x={pip.x} y={pip.y} size={pip.size ?? pipSize} color={suitColor} />
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
        background: isDealer ? '#ef4444' : '#9ca3af',
        border: isDealer ? '1px solid #fecaca' : '1px solid #e5e7eb',
        color: isDealer ? '#ffffff' : '#111827',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.2,
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
