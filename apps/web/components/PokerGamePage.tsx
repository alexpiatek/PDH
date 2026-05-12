import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, MoreHorizontal, Trophy } from 'lucide-react';
import { Client as NakamaClient } from '@heroiclabs/nakama-js';
import type { Match, Session, Socket as NakamaSocket } from '@heroiclabs/nakama-js';
import { Card, HandState, PlayerInHand, ShowdownPotResult, ShowdownWinner } from '@pdh/engine';
import { TABLE_CHAT_MAX_LENGTH, TABLE_REACTIONS } from '@pdh/protocol';
import type { ClientMessage, LegalActions, ServerMessage } from '../server-types';
import { BondiPokerLogo } from './BondiPokerLogo';
import { logClientEvent } from '../lib/clientTelemetry';
import { normalizePlayerName, readStoredPlayerName, storePlayerName } from '../lib/playerIdentity';
import { getPlayerInitials } from '../lib/playerInitials';
import { resolveBettingActionControls } from '../lib/actionControls';
import { nextAppliedStateVersion, shouldApplyStateSnapshot } from '../lib/stateVersion';

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
const NAKAMA_CLIENT_KEY = process.env.NEXT_PUBLIC_NAKAMA_CLIENT_KEY || 'defaultkey';
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
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);
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

const isMissingNakamaMatchError = (error: unknown) => {
  if (error && typeof error === 'object') {
    const maybeCode = (error as { code?: unknown }).code;
    if (maybeCode === 4 || maybeCode === '4') {
      return true;
    }
  }

  const message = errorMessage(error).toLowerCase();
  return message === 'code 4' || message.includes('not found');
};

const runtimeNakamaHost = () => {
  const configuredHost = NAKAMA_HOST.trim();
  if (typeof window === 'undefined') {
    return configuredHost;
  }

  const uiHost = window.location.hostname.toLowerCase();
  const apiHost = configuredHost.toLowerCase();
  if (!LOCAL_HOSTS.has(uiHost) && LOCAL_HOSTS.has(apiHost)) {
    return window.location.hostname;
  }
  return configuredHost;
};

const startupSanityError = () => {
  if (!USE_NAKAMA_BACKEND) return null;
  if (typeof window === 'undefined') return null;

  if (!runtimeNakamaHost()) {
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
  const apiHost = runtimeNakamaHost().toLowerCase();
  if (!LOCAL_HOSTS.has(uiHost) && LOCAL_HOSTS.has(apiHost)) {
    return `Nakama host ${runtimeNakamaHost()} is local, but UI host is ${window.location.hostname}`;
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
const formatHandTitle = (label?: string) =>
  (label ?? '')
    .trim()
    .split(/\s+/)
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index > 0 && ['a', 'an', 'by', 'of'].includes(lower)) {
        return lower;
      }
      return part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part;
    })
    .join(' ');

const formatChips = (amount: number) => new Intl.NumberFormat('en-US').format(amount);

const formatCompactChips = (amount: number) => {
  if (Math.abs(amount) >= 1000 && amount % 1000 === 0) {
    return `${amount / 1000}k`;
  }
  return formatChips(amount);
};

const formatSignedChips = (amount: number) =>
  amount > 0 ? `+${formatChips(amount)}` : amount < 0 ? `-${formatChips(Math.abs(amount))}` : '0';

const RANK_WORDS: Record<Card['rank'], string> = {
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  T: 'Ten',
  J: 'Jack',
  Q: 'Queen',
  K: 'King',
  A: 'Ace',
};

const RANK_PLURALS: Record<Card['rank'], string> = {
  '2': 'Twos',
  '3': 'Threes',
  '4': 'Fours',
  '5': 'Fives',
  '6': 'Sixes',
  '7': 'Sevens',
  '8': 'Eights',
  '9': 'Nines',
  T: 'Tens',
  J: 'Jacks',
  Q: 'Queens',
  K: 'Kings',
  A: 'Aces',
};

const SUIT_WORDS: Record<Card['suit'], string> = {
  H: 'Heart',
  D: 'Diamond',
  C: 'Club',
  S: 'Spade',
};

const rankOrder: Record<Card['rank'], number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const describeShowdownHand = (label?: string, bestFive?: Card[]) => {
  const title = formatHandTitle(label);
  if (!title) return 'Winning hand';
  const visibleBestFive = (bestFive ?? []).filter((card) => !isHiddenCard(card));
  const highCard = visibleBestFive.reduce<Card | null>((best, card) => {
    if (!best || rankOrder[card.rank] > rankOrder[best.rank]) return card;
    return best;
  }, null);

  if ((title === 'Flush' || title === 'Straight Flush') && visibleBestFive.length >= 5) {
    const suit = visibleBestFive[0]?.suit;
    const sameSuit = suit && visibleBestFive.every((card) => card.suit === suit);
    if (highCard && sameSuit) {
      return `${RANK_WORDS[highCard.rank]}-high ${SUIT_WORDS[suit]} ${title}`;
    }
  }

  if (title === 'Straight' && highCard) {
    return `${RANK_WORDS[highCard.rank]}-high Straight`;
  }

  if (title === 'One Pair' && visibleBestFive.length) {
    const pairRank = visibleBestFive.find(
      (card) => visibleBestFive.filter((other) => other.rank === card.rank).length === 2
    )?.rank;
    return pairRank ? `Pair of ${RANK_PLURALS[pairRank]}` : title;
  }

  return title;
};

const compactPotLabel = (label: string) => {
  const normalized = label.replace(/\s+pot\b/i, '').trim();
  if (/^main$/i.test(normalized)) return 'Main';
  const sideMatch = normalized.match(/^side\s*(\d+)?$/i);
  if (sideMatch) return sideMatch[1] ? `Side ${sideMatch[1]}` : 'Side';
  return normalized || label;
};

const formatPotMeta = (pots: ShowdownPotView[]) => {
  const sidePotCount = pots.filter((pot) => /^side/i.test(pot.label)).length;
  return pots
    .map((pot) => {
      const label = compactPotLabel(pot.label);
      const displayLabel = sidePotCount === 1 && label === 'Side 1' ? 'Side' : label;
      return `${displayLabel} ${formatChips(pot.amount)}`;
    })
    .join(' • ');
};

const formatRecapActionMessage = (message: string) =>
  message
    .replace(/\s+\([^)]*\)\s*$/, '')
    .replace(/\b(\d{4,})\b/g, (match) => formatCompactChips(Number(match)));

const joinPlayerNames = (names: string[]) => {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
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
  debugInitialState?: ServerStatePayload | null;
  debugPlayerId?: string | null;
  debugDisableNetwork?: boolean;
  debugStatus?: string;
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

const formatSeatTimer = (secondsLeft: number | null | undefined) =>
  typeof secondsLeft === 'number' ? ` · ${secondsLeft}s` : '';

type PlayerConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

const playerSeatStatusLabel = ({
  status,
  connectionStatus,
  reconnectSecondsLeft,
  isTurn,
  isHero,
  secondsLeft,
  isBetting,
  isDiscarding,
  hasDiscarded,
}: {
  status: PlayerInHand['status'];
  connectionStatus?: PlayerConnectionStatus | null;
  reconnectSecondsLeft?: number | null;
  isTurn: boolean;
  isHero?: boolean;
  secondsLeft: number | null;
  isBetting: boolean;
  isDiscarding?: boolean;
  hasDiscarded?: boolean;
}) => {
  if (connectionStatus === 'reconnecting') {
    return `RECONNECTING${formatSeatTimer(reconnectSecondsLeft)}`;
  }
  if (connectionStatus === 'disconnected') return 'DISCONNECTED';
  if (isTurn) {
    return `${isHero ? 'YOUR TURN' : 'TO ACT'}${formatSeatTimer(secondsLeft)}`;
  }
  if (status === 'folded') return 'FOLDED';
  if (status === 'allIn') return 'ALL-IN';
  if (status === 'sitting_out') return 'SITTING OUT';
  if (status === 'busted' || status === 'out') return 'WAITING';
  if (isDiscarding) return hasDiscarded ? 'DISCARDED' : 'DISCARDING';
  if (isBetting && status === 'active') return 'WAITING';
  return null;
};

const PlayerIdentityBadge = ({
  name,
  size,
  isActive = false,
  isWinner = false,
  isDimmed = false,
  secondsLeft,
  maxSeconds = 30,
  timerTone,
}: {
  name?: string | null;
  size: number;
  isActive?: boolean;
  isWinner?: boolean;
  isDimmed?: boolean;
  secondsLeft?: number | null;
  maxSeconds?: number;
  timerTone: string;
}) => {
  const initials = getPlayerInitials(name);
  const progress =
    isActive && typeof secondsLeft === 'number'
      ? Math.max(0, Math.min(1, secondsLeft / Math.max(1, maxSeconds)))
      : null;

  return (
    <div
      aria-label={`${name?.trim() || 'Unknown player'} initials ${initials}`}
      data-testid="player-initials-badge"
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: '50%',
        padding: isActive ? 2 : 1,
        background:
          progress !== null
            ? `conic-gradient(${timerTone} ${Math.round(progress * 360)}deg, rgba(148,163,184,0.24) 0deg)`
            : isWinner
              ? '#22c55e'
              : 'rgba(251,191,36,0.42)',
        boxShadow: isActive ? '0 0 18px rgba(20,184,166,0.42)' : '0 8px 18px rgba(0,0,0,0.34)',
        opacity: isDimmed ? 0.72 : 1,
      }}
    >
      <span
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.16)',
          background: 'linear-gradient(180deg, rgba(30,41,59,0.98), rgba(15,23,42,0.96))',
          color: '#f8fafc',
          display: 'grid',
          placeItems: 'center',
          fontFamily: TABLE_THEME.fontSans,
          fontWeight: 800,
          fontSize: size <= 32 ? 11 : 12,
          lineHeight: 1,
          letterSpacing: 0.4,
        }}
      >
        {initials}
      </span>
    </div>
  );
};

type ShowdownWinnerView = ShowdownWinner & {
  name: string;
  handTitle: string;
  cardLine: string;
  holeCards: Card[];
};

type ShowdownPotView = Omit<ShowdownPotResult, 'winners'> & {
  winners: ShowdownWinnerView[];
};

type ShowdownResultView = {
  winners: ShowdownWinnerView[];
  pots: ShowdownPotView[];
  hasSplitPot: boolean;
  hasSidePots: boolean;
};

type LastHandRecapLine = {
  street: string;
  text: string;
  tone?: 'winner' | 'danger';
};

const formatPotWinnerText = (pot: ShowdownPotView) => {
  const winners = pot.winners;
  if (!winners.length) return `${pot.label}: unresolved`;
  const names = joinPlayerNames(winners.map((winner) => winner.name));
  const amounts = [...new Set(winners.map((winner) => winner.amount))];
  const handTitles = [...new Set(winners.map((winner) => winner.handTitle).filter(Boolean))];
  const amountCopy =
    amounts.length === 1
      ? `${formatChips(amounts[0])}${winners.length > 1 ? ' each' : ''}`
      : winners.map((winner) => `${winner.name} ${formatChips(winner.amount)}`).join(', ');
  const handCopy =
    handTitles.length === 1 && handTitles[0] ? ` with ${handTitles[0]}` : ' with winning hands';
  return `${pot.label}: ${names} ${winners.length === 1 ? 'wins' : 'win'} ${amountCopy}${handCopy}`;
};

const ShowdownResultBanner = ({
  result,
  isPhone,
  onViewDetails,
}: {
  result: ShowdownResultView;
  isPhone: boolean;
  onViewDetails: () => void;
}) => {
  const { winners, pots, hasSplitPot } = result;
  const primaryWinner = [...winners].sort((a, b) => b.amount - a.amount)[0] ?? winners[0];
  const sameAmount =
    winners.length > 1 && new Set(winners.map((winner) => winner.amount)).size === 1;
  const splitNames = hasSplitPot ? joinPlayerNames(winners.map((winner) => winner.name)) : '';
  const mainLine = hasSplitPot
    ? sameAmount
      ? `Split pot • ${formatChips(winners[0]?.amount ?? 0)} each`
      : 'Split pot awarded'
    : `${primaryWinner.name} wins ${formatChips(primaryWinner.amount)}`;
  const subLine = hasSplitPot
    ? `${splitNames} • ${primaryWinner.handTitle || 'Winning hand'}`
    : primaryWinner.handTitle || 'Winning hand';
  const potMeta = formatPotMeta(pots);
  const visibleHoleCards = primaryWinner.holeCards
    .filter((card) => !isHiddenCard(card))
    .slice(0, 2);

  return (
    <div
      role="status"
      aria-live="assertive"
      data-testid="showdown-result-banner"
      style={{
        width: isPhone ? 352 : 620,
        maxWidth: 'calc(100vw - 24px)',
        borderRadius: 12,
        border: '1px solid rgba(251,191,36,0.56)',
        background:
          'linear-gradient(135deg, rgba(8,16,18,0.94), rgba(2,7,9,0.9)), radial-gradient(circle at 5% 0%, rgba(251,191,36,0.16), transparent 34%), radial-gradient(circle at 100% 100%, rgba(20,184,166,0.16), transparent 38%)',
        boxShadow:
          '0 18px 42px rgba(0,0,0,0.45), 0 0 0 1px rgba(94,234,212,0.12), inset 0 1px 0 rgba(255,255,255,0.08)',
        color: TABLE_THEME.text,
        padding: isPhone ? '8px 10px' : '10px 12px',
        fontFamily: TABLE_THEME.fontSans,
        animation: 'showdown-pop 220ms ease-out both',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: isPhone ? 8 : 12,
          minWidth: 0,
        }}
      >
        <div
          aria-label={`${primaryWinner.name} hole cards`}
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          {visibleHoleCards.length ? (
            visibleHoleCards.map((card, idx) => (
              <CardView
                key={`${primaryWinner.playerId}-banner-hole-${idx}-${card.rank}${card.suit}`}
                card={card}
                size={isPhone ? 'medium' : 'medium'}
                highlight
              />
            ))
          ) : (
            <div
              style={{
                width: 54,
                height: 42,
                borderRadius: 999,
                border: '1px solid rgba(251,191,36,0.48)',
                color: TABLE_THEME.amber,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Trophy size={19} strokeWidth={2.5} />
            </div>
          )}
        </div>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div
            style={{
              fontFamily: TABLE_THEME.fontDisplay,
              fontSize: isPhone ? 17 : 21,
              fontWeight: 900,
              lineHeight: 1.08,
              color: '#f8fafc',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {mainLine}
          </div>
          <div
            style={{
              marginTop: 3,
              color: '#dcfce7',
              fontSize: isPhone ? 12 : 14,
              fontWeight: 800,
              lineHeight: 1.15,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subLine}
          </div>
          {potMeta ? (
            <div
              style={{
                marginTop: 5,
                color: TABLE_THEME.muted,
                fontSize: isPhone ? 10 : 12,
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {potMeta}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onViewDetails}
          style={{
            flex: '0 0 auto',
            border: 'none',
            background: 'transparent',
            color: '#ccfbf1',
            padding: isPhone ? '6px 0 6px 4px' : '6px 0 6px 8px',
            fontSize: isPhone ? 11 : 12,
            fontWeight: 900,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          {isPhone ? 'Details' : 'View hand details'}
          <ChevronRight size={isPhone ? 14 : 15} strokeWidth={2.7} />
        </button>
      </div>
    </div>
  );
};

const LastHandRecap = ({
  lines,
  fullLog,
  potSummaries,
  isCollapsed,
  showDetails,
  isPhone,
  onToggleCollapsed,
  onViewDetails,
}: {
  lines: LastHandRecapLine[];
  fullLog: Array<{ message?: string }>;
  potSummaries: string[];
  isCollapsed: boolean;
  showDetails: boolean;
  isPhone: boolean;
  onToggleCollapsed: () => void;
  onViewDetails: () => void;
}) => {
  const compactLines = lines.slice(0, 4);
  const detailRows = fullLog
    .map((entry) => entry.message)
    .filter((message): message is string => Boolean(message));

  return (
    <section
      aria-label="Last hand recap"
      data-testid="last-hand-recap"
      style={{
        position: 'fixed',
        zIndex: 46,
        left: isPhone ? 10 : 24,
        right: isPhone ? 10 : undefined,
        bottom: isPhone ? 96 : 26,
        width: isPhone ? 'auto' : 392,
        maxHeight: isPhone ? '34dvh' : '38dvh',
        borderRadius: 8,
        border: `1px solid ${TABLE_THEME.border}`,
        background:
          'linear-gradient(180deg, rgba(8,13,17,0.93), rgba(2,7,9,0.88)), radial-gradient(circle at 0% 0%, rgba(94,234,212,0.1), transparent 32%)',
        boxShadow: '0 18px 42px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
        color: TABLE_THEME.text,
        fontFamily: TABLE_THEME.fontSans,
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        aria-expanded={!isCollapsed}
        onClick={onToggleCollapsed}
        style={{
          width: '100%',
          border: 'none',
          borderBottom: isCollapsed ? 'none' : `1px solid ${TABLE_THEME.border}`,
          background: 'transparent',
          color: TABLE_THEME.text,
          padding: isPhone ? '9px 10px' : '10px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          fontFamily: TABLE_THEME.fontDisplay,
          fontSize: isPhone ? 12 : 13,
          fontWeight: 900,
          letterSpacing: 0.45,
          textTransform: 'uppercase',
        }}
      >
        <span>Last Hand Recap</span>
        {isCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {!isCollapsed ? (
        <div
          style={{
            padding: isPhone ? '8px 10px 10px' : '10px 12px 12px',
            overflowY: showDetails ? 'auto' : 'hidden',
            maxHeight: isPhone ? 'calc(34dvh - 38px)' : 'calc(38dvh - 42px)',
          }}
        >
          <div style={{ display: 'grid', gap: isPhone ? 5 : 7 }}>
            {compactLines.map((line) => (
              <div
                key={`${line.street}-${line.text}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: isPhone ? '58px minmax(0, 1fr)' : '72px minmax(0, 1fr)',
                  gap: 8,
                  alignItems: 'baseline',
                  fontSize: isPhone ? 11 : 12,
                  lineHeight: 1.25,
                }}
              >
                <span style={{ color: TABLE_THEME.muted, fontWeight: 900 }}>{line.street}:</span>
                <span
                  style={{
                    minWidth: 0,
                    color: line.tone === 'winner' ? '#86efac' : TABLE_THEME.text,
                    fontWeight: line.tone === 'winner' ? 800 : 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {line.text}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onViewDetails}
            style={{
              marginTop: isPhone ? 8 : 10,
              border: 'none',
              background: 'transparent',
              color: '#5eead4',
              padding: 0,
              fontSize: isPhone ? 11 : 12,
              fontWeight: 900,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            View hand details
            <ChevronRight size={14} strokeWidth={2.7} />
          </button>
          {showDetails ? (
            <div
              data-testid="last-hand-detail-log"
              style={{
                marginTop: 10,
                paddingTop: 9,
                borderTop: `1px solid ${TABLE_THEME.border}`,
                display: 'grid',
                gap: 5,
              }}
            >
              {potSummaries.map((summary) => (
                <div
                  key={summary}
                  style={{
                    fontSize: isPhone ? 10 : 11,
                    lineHeight: 1.3,
                    color: '#ccfbf1',
                    fontWeight: 800,
                  }}
                >
                  {summary}
                </div>
              ))}
              {detailRows.map((message, idx) => (
                <div
                  key={`${idx}-${message}`}
                  style={{
                    fontSize: isPhone ? 10 : 11,
                    lineHeight: 1.3,
                    color: 'rgba(226,232,240,0.84)',
                  }}
                >
                  {formatRecapActionMessage(message)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

const NextHandCountdown = ({
  seconds,
  minSeconds,
  durationMs,
  ready,
  canReady,
  isPhone,
  onReady,
}: {
  seconds: number | null;
  minSeconds: number | null;
  durationMs: number;
  ready: boolean;
  canReady: boolean;
  isPhone: boolean;
  onReady: () => void;
}) => {
  const totalSeconds = Math.max(1, Math.ceil(durationMs / 1000));
  const displaySeconds = seconds ?? totalSeconds;
  const progress = Math.max(0, Math.min(1, displaySeconds / totalSeconds));
  const showMinHold = minSeconds !== null && minSeconds > 0;

  return (
    <div
      role="timer"
      aria-live="polite"
      data-testid="next-hand-countdown"
      style={{
        position: 'fixed',
        zIndex: 46,
        right: isPhone ? 10 : 24,
        bottom: `calc(${isPhone ? 18 : 26}px + env(safe-area-inset-bottom))`,
        width: isPhone ? 236 : 292,
        borderRadius: 8,
        border: `1px solid ${TABLE_THEME.border}`,
        background:
          'linear-gradient(180deg, rgba(8,13,17,0.9), rgba(2,7,9,0.84)), radial-gradient(circle at 100% 0%, rgba(94,234,212,0.1), transparent 34%)',
        boxShadow: '0 18px 42px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.06)',
        padding: isPhone ? '10px 11px' : '12px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        color: TABLE_THEME.text,
        fontFamily: TABLE_THEME.fontSans,
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', minWidth: 0, flexDirection: 'column', gap: 6 }}>
        <div
          style={{
            color: TABLE_THEME.muted,
            fontSize: isPhone ? 12 : 13,
            fontWeight: 800,
            lineHeight: 1.25,
          }}
        >
          {ready ? 'Ready for next hand' : 'Next hand in'}
          <br />
          {showMinHold ? `Results held ${minSeconds}s` : 'Server controlled'}
        </div>
        {canReady ? (
          <button
            type="button"
            disabled={ready}
            onClick={onReady}
            style={{
              alignSelf: 'flex-start',
              minHeight: 30,
              borderRadius: 7,
              border: ready
                ? `1px solid ${TABLE_THEME.border}`
                : `1px solid ${TABLE_THEME.tealBorder}`,
              background: ready ? 'rgba(255,255,255,0.045)' : TABLE_THEME.tealSoft,
              color: ready ? TABLE_THEME.muted : '#ccfbf1',
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 900,
              cursor: ready ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Ready
          </button>
        ) : null}
      </div>
      <div
        style={{
          width: isPhone ? 50 : 58,
          height: isPhone ? 50 : 58,
          borderRadius: '50%',
          padding: 4,
          background: `conic-gradient(${TABLE_THEME.teal} ${Math.round(
            progress * 360
          )}deg, rgba(148,163,184,0.22) 0deg)`,
          boxShadow: '0 0 18px rgba(94,234,212,0.18)',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: 'rgba(3,8,11,0.96)',
            display: 'grid',
            placeItems: 'center',
            color: '#99f6e4',
            fontSize: isPhone ? 18 : 22,
            fontWeight: 900,
          }}
        >
          {displaySeconds}s
        </div>
      </div>
    </div>
  );
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
  debugInitialState = null,
  debugPlayerId = null,
  debugDisableNetwork = false,
  debugStatus = 'Connected (test snapshot)',
}: PokerGamePageProps) => {
  const debugMode = Boolean(debugDisableNetwork || debugInitialState);
  const resolvedDebugPlayerId = debugPlayerId ?? debugInitialState?.you?.playerId ?? null;
  const connectionRef = useRef<{ send: (msg: ClientMessage) => void; close: () => void } | null>(
    null
  );
  const legacySocketRef = useRef<WebSocket | null>(null);
  const pendingMessagesRef = useRef<ClientMessage[]>([]);
  const nextMutatingSeqRef = useRef(1);
  const discardTimerRef = useRef<number | null>(null);
  const holeDealTimerRef = useRef<number | null>(null);
  const joinTimeoutRef = useRef<number | null>(null);
  const latestAppliedStateVersionRef = useRef<number | null>(null);
  const serverTimeOffsetMsRef = useRef(0);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(resolvedDebugPlayerId);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [tableScale, setTableScale] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [viewportHeight, setViewportHeight] = useState(800);
  const buyIn = 10000;
  const [state, setState] = useState<any>(debugInitialState);
  const [status, setStatus] = useState<string>(debugInitialState ? debugStatus : 'Disconnected');
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
  const [rebuyState, setRebuyState] = useState<'idle' | 'pending' | 'confirmed'>('idle');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<TableChatMessage[]>([]);
  const [mutedChatPlayerIds, setMutedChatPlayerIds] = useState<string[]>([]);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [lastHandRecapCollapsed, setLastHandRecapCollapsed] = useState(false);
  const [showLastHandDetails, setShowLastHandDetails] = useState(false);
  const resolvedForcedMatchId = forcedMatchId?.trim() || '';
  const hasLoggedTableJoinedRef = useRef(false);
  const hasLoggedFirstActionRef = useRef(false);
  const autoJoinAttemptedRef = useRef(false);
  const rebuyNextHandSentRef = useRef(false);
  const rebuyStateRef = useRef<'idle' | 'pending' | 'confirmed'>('idle');
  const [hasReceivedState, setHasReceivedState] = useState(Boolean(debugInitialState));

  const serverClockNow = () => Date.now() + serverTimeOffsetMsRef.current;

  const updateRebuyState = (next: 'idle' | 'pending' | 'confirmed') => {
    rebuyStateRef.current = next;
    setRebuyState(next);
  };

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
    if (debugMode) {
      connectionRef.current = null;
      legacySocketRef.current = null;
      pendingMessagesRef.current = [];
      setPlayerId(resolvedDebugPlayerId);
      setState(debugInitialState);
      setStatus(debugStatus);
      setHasReceivedState(Boolean(debugInitialState));
      return;
    }

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
        if (!shouldApplyStateSnapshot(latestAppliedStateVersionRef.current, msg.state)) {
          return;
        }
        latestAppliedStateVersionRef.current = nextAppliedStateVersion(
          latestAppliedStateVersionRef.current,
          msg.state
        );
        if (typeof msg.state.serverTimeMs === 'number' && Number.isFinite(msg.state.serverTimeMs)) {
          serverTimeOffsetMsRef.current = msg.state.serverTimeMs - Date.now();
          setClockNowMs(serverClockNow());
        }
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
        if (rebuyStateRef.current !== 'idle') {
          updateRebuyState('idle');
          rebuyNextHandSentRef.current = false;
        }
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

      const client = new NakamaClient(
        NAKAMA_CLIENT_KEY,
        runtimeNakamaHost(),
        NAKAMA_PORT,
        NAKAMA_USE_SSL
      );
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
                } else if (msg.type === 'rebuy') {
                  updateRebuyState('idle');
                  rebuyNextHandSentRef.current = false;
                  setStatus(`Rebuy failed: ${errorMessage(error)}`);
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
          if ((resolvedForcedMatchId || NAKAMA_MATCH_ID) && isMissingNakamaMatchError(error)) {
            if (typeof window !== 'undefined') {
              window.localStorage.removeItem(STORAGE_KEYS.matchId);
              window.setTimeout(() => {
                window.location.assign('/play');
              }, 900);
            }
            setStatus('Table no longer exists. Returning to lobby...');
            return;
          }
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
  }, [debugInitialState, debugMode, debugStatus, resolvedDebugPlayerId, resolvedForcedMatchId]);

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
  const serverLegalActions: LegalActions | null =
    USE_NAKAMA_BACKEND && state?.legalActions ? (state.legalActions as LegalActions) : null;
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
    return hand.players.find((p: PlayerInHand) => p.id === playerId) ?? null;
  }, [hand, playerId]);
  const showdownDeltasById = useMemo(() => {
    const payouts = new Map<string, number>();
    for (const w of hand?.showdownWinners ?? []) {
      payouts.set(w.playerId, (payouts.get(w.playerId) ?? 0) + w.amount);
    }
    const map = new Map<string, { net: number; payout: number; committed: number }>();
    for (const player of hand?.players ?? []) {
      const payout = payouts.get(player.id) ?? 0;
      const committed = player.totalCommitted ?? 0;
      const net = payout - committed;
      if (net !== 0 || payout > 0 || committed > 0) {
        map.set(player.id, { net, payout, committed });
      }
    }
    return map;
  }, [hand?.showdownWinners, hand?.players]);
  const winnersById = useMemo(() => {
    const map = new Map<
      string,
      { amount: number; net: number; bestFive?: Card[]; handLabel?: string }
    >();
    for (const w of hand?.showdownWinners ?? []) {
      const existing = map.get(w.playerId);
      const nextAmount = (existing?.amount ?? 0) + w.amount;
      map.set(w.playerId, {
        amount: nextAmount,
        net: showdownDeltasById.get(w.playerId)?.net ?? nextAmount,
        bestFive: w.bestFive ?? existing?.bestFive,
        handLabel: w.handLabel ?? existing?.handLabel,
      });
    }
    return map;
  }, [hand?.showdownWinners, showdownDeltasById]);
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
  const seatedPlayerCount = useMemo(() => {
    if (!Array.isArray(state?.seats)) return 0;
    return state.seats.filter((seat: any) => Boolean(seat && seat.stack > 0 && !seat.sittingOut))
      .length;
  }, [state?.seats]);
  const waitingForPlayers = seated && !hand && seatedPlayerCount < 2;
  const tableCode = typeof state?.id === 'string' ? state.id : '';
  const connectionStateByPlayerId = useMemo(() => {
    const map = new Map<
      string,
      {
        status: PlayerConnectionStatus;
        graceDeadlineMs: number | null;
      }
    >();
    const connections = state?.connections;
    if (connections && typeof connections === 'object') {
      for (const [id, connection] of Object.entries(connections as Record<string, any>)) {
        const status = connection?.status;
        if (status !== 'connected' && status !== 'reconnecting' && status !== 'disconnected') {
          continue;
        }
        map.set(id, {
          status,
          graceDeadlineMs:
            typeof connection?.graceDeadlineMs === 'number' ? connection.graceDeadlineMs : null,
        });
      }
    }
    for (const seat of state?.seats ?? []) {
      if (!seat?.id || map.has(seat.id)) continue;
      const status = seat.connectionStatus;
      if (status !== 'connected' && status !== 'reconnecting' && status !== 'disconnected') {
        continue;
      }
      map.set(seat.id, {
        status,
        graceDeadlineMs:
          typeof seat.reconnectGraceDeadlineMs === 'number' ? seat.reconnectGraceDeadlineMs : null,
      });
    }
    return map;
  }, [state?.connections, state?.seats]);
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

  const isMyTurn = serverLegalActions
    ? Boolean(serverLegalActions.isActor && serverLegalActions.betting)
    : Boolean(hand && you && hand.phase === 'betting' && hand.actionOnSeat === you.seat);
  const youInfoDimmed = Boolean(
    you &&
    (you.status === 'folded' ||
      you.status === 'out' ||
      you.status === 'busted' ||
      you.status === 'sitting_out' ||
      (hand?.phase === 'betting' && !isMyTurn))
  );
  const youBusted = Boolean(you && (you.status === 'busted' || you.status === 'sitting_out'));
  const serverDiscardActions =
    serverLegalActions?.phase === 'discard' ? serverLegalActions.discard : undefined;
  const serverDiscardValidIndexes =
    serverDiscardActions?.validIndexes && Array.isArray(serverDiscardActions.validIndexes)
      ? new Set(serverDiscardActions.validIndexes)
      : null;
  const discardPending = serverLegalActions
    ? Boolean(serverLegalActions.isActor && serverDiscardActions?.required)
    : Boolean(hand && you && hand.phase === 'discard' && hand.discardPending.includes(you.id));
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
  const betweenHandStartedAtMs =
    typeof state?.betweenHandStartedAtMs === 'number' ? state.betweenHandStartedAtMs : null;
  const betweenHandMinUntilMs =
    typeof state?.betweenHandMinUntilMs === 'number' ? state.betweenHandMinUntilMs : null;
  const betweenHandAutoStartAtMs =
    typeof state?.betweenHandAutoStartAtMs === 'number' ? state.betweenHandAutoStartAtMs : null;
  const readyForNextHandIds = useMemo(
    () =>
      new Set<string>(
        Array.isArray(state?.readyForNextHandPlayerIds)
          ? state.readyForNextHandPlayerIds.filter(
              (value: unknown): value is string => typeof value === 'string' && value.length > 0
            )
          : []
      ),
    [state?.readyForNextHandPlayerIds]
  );
  const betweenHandActive = Boolean(
    hand?.phase === 'showdown' &&
    betweenHandStartedAtMs !== null &&
    betweenHandMinUntilMs !== null &&
    betweenHandAutoStartAtMs !== null
  );
  const readyForNextHand = Boolean(playerId && readyForNextHandIds.has(playerId));
  const canReadyForNextHand = Boolean(
    seated &&
    localSeat &&
    betweenHandActive &&
    !localNeedsRebuy &&
    localSeatStack > 0 &&
    localSeatStatus === 'active'
  );
  const betweenHandCountdownSeconds = useMemo(() => {
    if (!betweenHandActive || betweenHandAutoStartAtMs === null) {
      return null;
    }
    return Math.max(0, Math.ceil((betweenHandAutoStartAtMs - clockNowMs) / 1000));
  }, [betweenHandActive, betweenHandAutoStartAtMs, clockNowMs]);
  const betweenHandMinSeconds = useMemo(() => {
    if (!betweenHandActive || betweenHandMinUntilMs === null) {
      return null;
    }
    return Math.max(0, Math.ceil((betweenHandMinUntilMs - clockNowMs) / 1000));
  }, [betweenHandActive, betweenHandMinUntilMs, clockNowMs]);
  const betweenHandDurationMs =
    betweenHandStartedAtMs !== null && betweenHandAutoStartAtMs !== null
      ? Math.max(1, betweenHandAutoStartAtMs - betweenHandStartedAtMs)
      : 12_000;
  const startGateReadyIds = useMemo(
    () => new Set<string>(startGate?.readyPlayerIds ?? []),
    [startGate?.readyPlayerIds]
  );
  const startGateAllReady = Boolean(
    startGate &&
    seatedPlayers.length >= startGate.minPlayers &&
    seatedPlayers.every((seat: any) => startGateReadyIds.has(seat.id))
  );
  const startGateCanEarlyStart = Boolean(startGateAllReady);
  const localReadyForStart = Boolean(playerId && startGateReadyIds.has(playerId));
  const isMobile = viewportWidth <= 900;
  const isPhone = viewportWidth <= 640;
  const isPortraitPhone = isPhone && viewportHeight > viewportWidth;
  const isLandscapePhone = isMobile && viewportHeight <= 520 && viewportWidth > viewportHeight;
  const pinActionTray = isMobile && !isLandscapePhone;
  const layoutTableWidth = isPortraitPhone
    ? 390
    : isLandscapePhone
      ? 780
      : isMobile
        ? BASE_TABLE_WIDTH
        : 920;
  const layoutTableHeight = isPortraitPhone
    ? 560
    : isLandscapePhone
      ? 300
      : isMobile
        ? BASE_TABLE_HEIGHT
        : 480;
  const tableTimerSeconds =
    hand?.phase === 'betting'
      ? actionSecondsLeft
      : hand?.phase === 'discard'
        ? discardSecondsLeft
        : null;
  const tableTimerMaxSeconds =
    hand?.phase === 'discard'
      ? Math.max(1, Math.ceil((state?.config?.discardTimeoutMs ?? 30_000) / 1000))
      : Math.max(1, Math.ceil((state?.config?.actionTimeoutMs ?? 30_000) / 1000));
  const isBettingPhase = hand?.phase === 'betting';
  const isDiscardPhase = hand?.phase === 'discard';
  const isRevealPhase = hand?.phase === 'showdown';
  const tableLabel = useMemo(() => {
    const sourceId = typeof state?.id === 'string' && state.id.trim() ? state.id.trim() : '';
    if (!sourceId) return `Table ${NAKAMA_TABLE_ID}`;
    return `Table ${sourceId}`;
  }, [state?.id]);
  const latestActionLine = useMemo(() => {
    const lines: Array<{ message?: string }> = hand?.log ?? state?.log ?? [];
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
  }, [hand?.log, state?.log]);
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
    if (hand?.phase === 'showdown') {
      setLastHandRecapCollapsed(false);
      setShowLastHandDetails(false);
      return;
    }
  }, [hand?.handId, hand?.phase]);

  useEffect(() => {
    if (rebuyState === 'idle') {
      return;
    }

    const rebuyConfirmed = seated && !localNeedsRebuy && localSeatStack > 0;
    if (!rebuyConfirmed) {
      return;
    }

    if (rebuyState !== 'confirmed') {
      updateRebuyState('confirmed');
    }

    if (rebuyNextHandSentRef.current) {
      return;
    }
    if (hand && hand.phase !== 'showdown') {
      return;
    }

    rebuyNextHandSentRef.current = true;
    setStatus('Rebuy confirmed. Entering the next hand...');
    sendReadyForNextHand();
  }, [hand?.handId, hand?.phase, localNeedsRebuy, localSeatStack, rebuyState, seated]);

  useEffect(() => {
    if (rebuyState === 'idle') {
      return;
    }
    if (localNeedsRebuy) {
      return;
    }
    if (hand && hand.phase !== 'showdown') {
      updateRebuyState('idle');
      rebuyNextHandSentRef.current = false;
    }
  }, [hand?.handId, hand?.phase, localNeedsRebuy, rebuyState]);

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
    if (
      !startGate &&
      (!hand || (hand.phase !== 'betting' && hand.phase !== 'discard' && hand.phase !== 'showdown'))
    ) {
      return;
    }
    setClockNowMs(serverClockNow());
    const intervalId = window.setInterval(() => {
      setClockNowMs(serverClockNow());
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

  const sendReadyForNextHand = () => {
    send(USE_NAKAMA_BACKEND ? { type: 'readyForNextHand', ready: true } : { type: 'nextHand' });
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
    if (rebuyState !== 'idle') {
      return;
    }
    logClientEvent('table_rebuy_click', {
      handId: hand?.handId ?? null,
      stack: localSeatStack,
      status: localSeatStatus,
    });
    rebuyNextHandSentRef.current = false;
    updateRebuyState('pending');
    setStatus('Rebuy requested. Waiting for confirmation...');
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
    if (!isDiscardIndexAllowed(idx)) return;
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
    if (!isDiscardIndexAllowed(idx)) return;
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
  const showdownResult = useMemo<ShowdownResultView | null>(() => {
    if (!hand?.showdownWinners?.length) return null;

    const winnerById = new Map(hand.showdownWinners.map((winner) => [winner.playerId, winner]));
    const playerById = new Map(hand.players.map((player) => [player.id, player]));
    const toWinnerView = (winner: ShowdownWinner): ShowdownWinnerView => {
      const aggregate = winnerById.get(winner.playerId);
      const bestFive = winner.bestFive ?? aggregate?.bestFive;
      const handLabel = winner.handLabel ?? aggregate?.handLabel;
      const holeCards = playerById.get(winner.playerId)?.holeCards ?? [];
      return {
        ...winner,
        bestFive,
        handLabel,
        name: playerNameById.get(winner.playerId) ?? winner.playerId,
        handTitle: describeShowdownHand(handLabel, bestFive),
        cardLine: bestFive?.map(cardText).join(' ') ?? '',
        holeCards,
      };
    };

    const winners = hand.showdownWinners.map(toWinnerView);
    const rawPots: ShowdownPotResult[] =
      hand.showdownPots?.length > 0
        ? hand.showdownPots
        : [
            {
              potId: 'pot-0',
              label: 'Main pot',
              amount: hand.showdownWinners.reduce((sum, winner) => sum + winner.amount, 0),
              eligible: hand.showdownWinners.map((winner) => winner.playerId),
              winners: hand.showdownWinners,
            },
          ];
    const pots = rawPots.map((pot) => ({
      ...pot,
      winners: pot.winners.map(toWinnerView),
    }));

    return {
      winners,
      pots,
      hasSplitPot: pots.some((pot) => pot.winners.length > 1),
      hasSidePots: pots.length > 1,
    };
  }, [hand?.players, hand?.showdownPots, hand?.showdownWinners, playerNameById]);
  const lastHandRecapLines = useMemo<LastHandRecapLine[]>(() => {
    if (!hand) return [];
    const streetOrder = ['Pre-flop', 'Flop', 'Turn'] as const;
    const actionsByStreet = new Map<(typeof streetOrder)[number], string[]>(
      streetOrder.map((street) => [street, []])
    );
    let currentStreet: (typeof streetOrder)[number] = 'Pre-flop';
    for (const entry of hand.log ?? []) {
      const message = entry.message;
      if (!message) continue;
      if (/^Starting betting on flop$/i.test(message) || /^Flop:/i.test(message)) {
        currentStreet = 'Flop';
        continue;
      }
      if (/^Starting betting on turn$/i.test(message) || /^Turn:/i.test(message)) {
        currentStreet = 'Turn';
        continue;
      }
      if (/^Starting betting on river$/i.test(message) || /^River:/i.test(message)) {
        continue;
      }
      if (
        /^Hand started$/i.test(message) ||
        /^Discard phase started/i.test(message) ||
        /posts (small|big) blind/i.test(message) ||
        /\bwins\b/i.test(message) ||
        /: \d+ -> \d+$/.test(message) ||
        /is out of chips$/i.test(message)
      ) {
        continue;
      }
      if (
        /(folded|checked|called|raised|bet|all-in|auto-folded|auto-checked|discarded)/i.test(
          message
        )
      ) {
        actionsByStreet.get(currentStreet)?.push(message);
      }
    }

    const lines: LastHandRecapLine[] = [];
    for (const street of streetOrder) {
      const actions = actionsByStreet.get(street) ?? [];
      if (!actions.length) continue;
      const allInActions = actions.filter((message) => /all-in/i.test(message));
      const text =
        allInActions.length >= 2
          ? allInActions.length === 2
            ? 'both players all-in'
            : 'multiple players all-in'
          : formatRecapActionMessage(actions[actions.length - 1]);
      lines.push({ street, text });
    }

    if (showdownResult?.winners.length) {
      const winner =
        [...showdownResult.winners].sort((a, b) => b.amount - a.amount)[0] ??
        showdownResult.winners[0];
      const resultStreet = hand.board.length >= 5 ? 'River' : formatStreetLabel(hand.street);
      const winnerNames = joinPlayerNames(showdownResult.winners.map((entry) => entry.name));
      lines.push({
        street: resultStreet === 'Preflop' ? 'Pre-flop' : resultStreet,
        text: showdownResult.hasSplitPot
          ? `${winnerNames} split${winner.handTitle ? ` with ${winner.handTitle}` : ''}`
          : `${winner.name} wins${winner.handTitle ? ` with ${winner.handTitle}` : ''}`,
        tone: 'winner',
      });
    }

    return lines.slice(-4);
  }, [hand, showdownResult]);

  const seatingPositions = isPortraitPhone
    ? [
        { left: '50%', top: '78%' },
        { left: '25%', top: '18%' },
        { left: '75%', top: '18%' },
        { left: '76%', top: '51%' },
        { left: '24%', top: '51%' },
        { left: '68%', top: '65%' },
        { left: '32%', top: '65%' },
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
        { left: '50%', top: -20, transform: 'translate(-50%, -100%)' },
        { left: '50%', top: 'calc(100% + 4px)', transform: 'translate(-50%, 0)' },
        { left: '50%', top: 'calc(100% + 4px)', transform: 'translate(-50%, 0)' },
        { left: '50%', top: 'calc(100% + 4px)', transform: 'translate(-50%, 0)' },
        { left: '50%', top: 'calc(100% + 4px)', transform: 'translate(-50%, 0)' },
        { left: '50%', top: -20, transform: 'translate(-50%, -100%)' },
        { left: '50%', top: -20, transform: 'translate(-50%, -100%)' },
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
  const infoAvatarSize = isPortraitPhone ? 20 : isPhone ? 28 : 34;
  const seatNameplateWidth = isPortraitPhone ? 108 : isPhone ? 146 : 162;
  const playerPanelMinHeight = isPortraitPhone ? 36 : isPhone ? 44 : 50;
  const playerPanelPadding = isPortraitPhone ? '3px 5px' : isPhone ? '5px 7px' : '6px 9px';
  const playerPanelRadius = isPortraitPhone ? 8 : 10;
  const playerPanelColumnGap = isPortraitPhone ? 5 : 7;
  const playerInfoTextSize = isPortraitPhone ? 9 : isPhone ? 10 : 11;
  const playerInfoStatusTextSize = isPortraitPhone ? 7 : 9;
  const playerInfoOffsetY = isPortraitPhone ? 0 : -30 + 38;
  const seatHoleCardSize = isPortraitPhone ? 'small' : 'medium';
  const seatHoleCardWidth = isPortraitPhone ? 34 : 44;
  const seatHoleCardHeight = isPortraitPhone ? 48 : 62;
  const seatHoleCardOverlap = isPortraitPhone ? -18 : -24;
  const heroAreaOffsetPx = 38 - 33;
  const ellipsisDotStyle = (delayMs: number): React.CSSProperties => ({
    display: 'inline-block',
    width: '0.35em',
    textAlign: 'center',
    animation: 'ellipsis-blink 1.2s infinite',
    animationDelay: `${delayMs}ms`,
  });
  const hasBottomActionTray = Boolean(
    localNeedsRebuy ||
    (!USE_NAKAMA_BACKEND && localReadyBetweenHands) ||
    canReadyForNextHand ||
    (you && ((isBettingPhase && isMyTurn) || isDiscardPhase || isRevealPhase))
  );
  const centeredSectionMinHeight = isMobile ? 'calc(100dvh - 160px)' : 'calc(100vh - 220px)';
  const heroInfoBottomOffset = isPhone
    ? hasBottomActionTray
      ? isPortraitPhone
        ? 214
        : 132
      : isPortraitPhone
        ? 150
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
        ? isPortraitPhone
          ? 118
          : 30
        : isPortraitPhone
          ? 42
          : 24
    : isMobile
      ? hasBottomActionTray
        ? 28
        : 22
      : 20;
  const actionBarReserve = !isMobile && you && isBettingPhase ? (showRaiseDrawer ? 220 : 150) : 0;
  const tableHorizontalPadding = isPhone ? (isPortraitPhone ? 28 : 16) : isMobile ? 28 : 64;
  const tableVerticalReserve = isMobile
    ? hasBottomActionTray
      ? isPortraitPhone
        ? 236
        : isLandscapePhone
          ? 210
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
    isPortraitPhone ? 300 : isLandscapePhone ? 330 : 360
  );
  const tableOuterWidthPx = Math.floor(Math.max(tableMinimumWidth, tableRawWidth));
  const tableOuterWidth = `${tableOuterWidthPx}px`;
  const tableOuterBorder = isPortraitPhone ? 5 : isPhone ? 6 : isMobile ? 8 : 10;
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
  const bettingControls = resolveBettingActionControls({
    hand,
    player: you,
    legalActions: serverLegalActions,
    preferLegalActions: USE_NAKAMA_BACKEND,
    betAmount,
    raiseCapReached,
  });
  const {
    toCall,
    currentBet: actionCurrentBet,
    minRaiseTo,
    maxRaiseTo,
    allInTotal,
    clampedRaiseTo,
    canFold,
    canCheck,
    canCall,
    canRaise,
    canCheckOrCall,
    canOpenRaiseDrawer,
    canShortOpenAllIn,
    isCallAllIn,
    raiseActionLabel,
    checkOrCallLabel,
  } = bettingControls;
  const raiseDisabledHint = (() => {
    if (!hand || hand.phase !== 'betting') return 'Betting controls unlock during betting rounds.';
    if (!isMyTurn) return 'Wait for your turn.';
    if (isCallAllIn) return 'The bet covers your stack. Your only call is all-in.';
    if (raiseCapReached) return 'Raise cap reached on this street.';
    if (minRaiseTo === null || maxRaiseTo === null) return 'Raise amount unavailable.';
    if (maxRaiseTo < minRaiseTo)
      return `Not enough chips to make the minimum ${raiseActionLabel.toLowerCase()}.`;
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
        ? `To call ${formatChips(toCall)} \u00b7 Pot ${formatChips(potAmount)}`
        : `Check available \u00b7 Pot ${formatChips(potAmount)}`
      : '';
  const discardLimit = serverDiscardActions?.count ?? 1;
  const isDiscardIndexAllowed = (idx: number) =>
    !serverDiscardValidIndexes || serverDiscardValidIndexes.has(idx);
  const selectedDiscardCount = selectedDiscardIndex === null ? 0 : 1;
  const selectedDiscardIsValid =
    selectedDiscardIndex !== null && isDiscardIndexAllowed(selectedDiscardIndex);
  const canConfirmDiscard = discardPending && selectedDiscardIsValid && !discardSubmitted;
  const quickRaiseOptions = useMemo(() => {
    if (!hand || minRaiseTo === null || maxRaiseTo === null) {
      return [] as Array<{ label: string; value: number; requiresConfirm?: boolean }>;
    }
    const clamp = (value: number) => Math.min(maxRaiseTo, Math.max(minRaiseTo, Math.floor(value)));
    const seed = [
      { label: '1/2 pot', value: clamp(actionCurrentBet + potAmount * 0.5) },
      { label: 'pot', value: clamp(actionCurrentBet + potAmount) },
      { label: '2x', value: clamp(Math.max(actionCurrentBet * 2, minRaiseTo)) },
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
  }, [hand?.handId, actionCurrentBet, minRaiseTo, maxRaiseTo, potAmount]);
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
  const youDisplayName = you?.name || localPlayerName || 'You';
  const youWinnerInfo = you ? winnersById.get(you.id) : undefined;
  const youSeatDelta = you ? showdownDeltasById.get(you.id) : undefined;
  const youShowDiscardState = Boolean(
    hand?.phase === 'discard' &&
    you &&
    you.status !== 'folded' &&
    you.status !== 'out' &&
    you.status !== 'busted' &&
    you.status !== 'sitting_out'
  );
  const youHasDiscardedThisStreet = Boolean(you && discardConfirmedPlayers.has(you.id));
  const youConnectionState = you ? (connectionStateByPlayerId.get(you.id) ?? null) : null;
  const youReconnectSecondsLeft =
    youConnectionState?.status === 'reconnecting' &&
    typeof youConnectionState.graceDeadlineMs === 'number'
      ? Math.max(0, Math.ceil((youConnectionState.graceDeadlineMs - clockNowMs) / 1000))
      : null;
  const youSeatStatusLabel = you
    ? playerSeatStatusLabel({
        status: you.status,
        connectionStatus: youConnectionState?.status ?? null,
        reconnectSecondsLeft: youReconnectSecondsLeft,
        isTurn: isMyTurn,
        isHero: true,
        secondsLeft: tableTimerSeconds,
        isBetting: isBettingPhase,
        isDiscarding: youShowDiscardState,
        hasDiscarded: youHasDiscardedThisStreet,
      })
    : null;
  const youSeatStatusColor = isMyTurn
    ? '#bae6fd'
    : youConnectionState?.status === 'reconnecting'
      ? '#fef3c7'
      : youConnectionState?.status === 'disconnected'
        ? '#cbd5e1'
        : youBusted || you?.status === 'folded'
          ? '#cbd5e1'
          : you?.status === 'allIn'
            ? '#fef3c7'
            : youShowDiscardState && youHasDiscardedThisStreet
              ? '#86efac'
              : TABLE_THEME.dim;
  const showYouSeatDelta = Boolean(
    isShowdown &&
    youSeatDelta &&
    youSeatDelta.net !== 0 &&
    (youWinnerInfo ||
      you?.status === 'allIn' ||
      youBusted ||
      (you?.status !== 'folded' && youSeatDelta.committed > 0))
  );
  const youDisplayStatusLabel =
    isShowdown && youSeatDelta && youSeatDelta.net < 0 && (you?.status === 'allIn' || youBusted)
      ? 'ALL-IN'
      : youSeatStatusLabel;
  const youDisplayStatusColor =
    isShowdown && youSeatDelta && youSeatDelta.net < 0 && (you?.status === 'allIn' || youBusted)
      ? '#fecaca'
      : youSeatStatusColor;
  const utilityEnabledCount =
    Number(soundEnabled) + Number(showActivityFeed) + Number(showTableChat);
  const rebuyButtonDisabled = rebuyState !== 'idle';
  const rebuyStatusCopy =
    rebuyState === 'confirmed'
      ? 'Rebuy confirmed'
      : rebuyState === 'pending'
        ? 'Confirming rebuy'
        : 'You are out of chips';
  const rebuyDetailCopy =
    rebuyState === 'confirmed'
      ? 'Your stack is restored. You will be seated when the next hand starts.'
      : rebuyState === 'pending'
        ? 'Waiting for the table to confirm your new stack.'
        : `${localPlayerName} can rebuy before the next hand.`;
  const rebuyButtonCopy =
    rebuyState === 'confirmed'
      ? 'Rebuy confirmed'
      : rebuyState === 'pending'
        ? 'Rebuy requested'
        : 'Rebuy 10,000';
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
          {rebuyStatusCopy}
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
          {rebuyDetailCopy}
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
          disabled={rebuyButtonDisabled}
          onClick={rebuy}
          aria-live="polite"
          style={turnActionStyle(!rebuyButtonDisabled, {
            border: 'rgba(94,234,212,0.78)',
            background: 'rgba(20,184,166,0.28)',
            color: '#ccfbf1',
            glow: 'rgba(20,184,166,0.3)',
          })}
        >
          {rebuyButtonCopy}
        </button>
        <button
          type="button"
          disabled={rebuyButtonDisabled}
          onClick={sitOut}
          style={turnActionStyle(!rebuyButtonDisabled, {
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
  const nextHandTray =
    !USE_NAKAMA_BACKEND && localReadyBetweenHands ? (
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
          onClick={sendReadyForNextHand}
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
  const startGateTray =
    startGate && seated ? (
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
              color:
                startGateSecondsLeft !== null && startGateSecondsLeft <= 3 ? '#fecaca' : '#ccfbf1',
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
                ? 'Everyone is ready. Starting now.'
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
          act(isCallAllIn ? 'allIn' : 'call');
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
  }, [act, canCall, canCheck, canFold, canOpenRaiseDrawer, isCallAllIn, seated]);

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
    if (!canRaise) {
      return;
    }
    const isAllInRaise = maxRaiseTo !== null && clampedRaiseTo >= maxRaiseTo;
    if (isAllInRaise && !confirmAllIn) {
      setConfirmAllIn(true);
      return;
    }
    act(isAllInRaise ? 'allIn' : raiseActionLabel === 'Bet' ? 'bet' : 'raise', clampedRaiseTo);
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
          ? '8px 8px calc(16px + env(safe-area-inset-bottom))'
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
              {!isPhone && hand ? ` \u00b7 Pot ${formatChips(potAmount)}` : ''}
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
                  ? 430
                  : 470
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
              borderRadius: isPortraitPhone ? 150 : isPhone ? 110 : 999,
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
                  top: isPortraitPhone ? '29%' : '40%',
                  left: '50%',
                  transform: isPortraitPhone
                    ? 'translate(-50%, -50%) translateY(-10px)'
                    : isShowdown
                      ? 'translate(-50%, -50%) translateY(calc(-19px - 3.75cm))'
                      : 'translate(-50%, -50%) translateY(calc(-19px - 2.1cm))',
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
                  Pot {formatChips(potAmount)}
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
              {isShowdown && showdownResult ? (
                <div
                  style={{
                    position: 'absolute',
                    top: isPortraitPhone ? '38%' : '40%',
                    left: '50%',
                    transform: isPortraitPhone
                      ? 'translate(-50%, -50%) translateY(calc(74px + 30mm))'
                      : isPhone
                        ? 'translate(-50%, -50%) translateY(calc(-19px - 2.55cm + 30mm))'
                        : 'translate(-50%, -50%) translateY(calc(-19px - 2.8cm + 30mm))',
                    zIndex: 18,
                  }}
                >
                  <ShowdownResultBanner
                    result={showdownResult}
                    isPhone={isPhone}
                    onViewDetails={() => {
                      setLastHandRecapCollapsed(false);
                      setShowLastHandDetails(true);
                    }}
                  />
                </div>
              ) : null}
              <div
                style={{
                  position: 'absolute',
                  top: isPortraitPhone ? '38%' : '40%',
                  left: '50%',
                  transform: isPortraitPhone
                    ? 'translate(-50%, -50%) translateY(calc(2px + 10mm))'
                    : 'translate(-50%, -50%) translateY(calc(-19px - 0.4cm + 10mm))',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: isPortraitPhone ? 12 : isPhone ? 14 : 16,
                  zIndex: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: isPortraitPhone ? 4 : '1mm',
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
                        size={isPortraitPhone ? 'medium' : isPhone ? 'large' : 'xlarge'}
                        highlight={isShowdown && winningCards.has(cardKey(c))}
                        dim={isShowdown && winningCards.size > 0 && !winningCards.has(cardKey(c))}
                      />
                    </div>
                  ))}
                </div>
                {latestActionLine && !isRevealPhase ? (
                  <div
                    style={{
                      maxWidth: isPortraitPhone ? 260 : 300,
                      borderRadius: 999,
                      border: `1px solid ${TABLE_THEME.border}`,
                      background: 'rgba(2,7,9,0.78)',
                      color: '#e2e8f0',
                      padding: isPortraitPhone ? '4px 9px' : '5px 10px',
                      fontSize: isPortraitPhone ? 10 : 11,
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
              </div>
              {tablePlayers.map((p, idx) => {
                const pos = seatingPositions[idx];
                const winner = winnersById.has(p.id);
                const winnerInfo = winnersById.get(p.id);
                const isYou = p.id === playerId;
                const roleChips = roleChipsBySeat.get(p.seat) ?? [];
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
                const connectionState = connectionStateByPlayerId.get(p.id) ?? null;
                const reconnectSecondsLeft =
                  connectionState?.status === 'reconnecting' &&
                  typeof connectionState.graceDeadlineMs === 'number'
                    ? Math.max(0, Math.ceil((connectionState.graceDeadlineMs - clockNowMs) / 1000))
                    : null;
                const statusLabel = playerSeatStatusLabel({
                  status: p.status,
                  connectionStatus: connectionState?.status ?? null,
                  reconnectSecondsLeft,
                  isTurn,
                  secondsLeft: tableTimerSeconds,
                  isBetting: isBettingPhase,
                  isDiscarding: showDiscardState,
                  hasDiscarded: hasDiscardedThisStreet,
                });
                const statusColor = isTurn
                  ? '#bae6fd'
                  : connectionState?.status === 'reconnecting'
                    ? '#fef3c7'
                    : connectionState?.status === 'disconnected'
                      ? '#cbd5e1'
                      : p.status === 'folded' || playerBusted
                        ? '#cbd5e1'
                        : p.status === 'allIn'
                          ? '#fef3c7'
                          : showDiscardState && hasDiscardedThisStreet
                            ? '#86efac'
                            : TABLE_THEME.dim;
                const displayName = p.name || 'Player';
                const seatDelta = showdownDeltasById.get(p.id);
                const showSeatDelta = Boolean(
                  isShowdown &&
                  seatDelta &&
                  seatDelta.net !== 0 &&
                  (winner ||
                    p.status === 'allIn' ||
                    playerBusted ||
                    (p.status !== 'folded' && seatDelta.committed > 0))
                );
                const displayStatusLabel =
                  isShowdown &&
                  seatDelta &&
                  seatDelta.net < 0 &&
                  (p.status === 'allIn' || playerBusted)
                    ? 'ALL-IN'
                    : statusLabel;
                const displayStatusColor =
                  isShowdown &&
                  seatDelta &&
                  seatDelta.net < 0 &&
                  (p.status === 'allIn' || playerBusted)
                    ? '#fecaca'
                    : statusColor;
                return (
                  <div
                    key={p.id}
                    style={{
                      position: 'absolute',
                      left: pos.left,
                      top: pos.top,
                      transform: `translate(-50%, -50%) translateY(${playerInfoOffsetY}px)`,
                      width: seatNameplateWidth,
                      textAlign: 'center',
                    }}
                  >
                    {!isYou && (
                      <div style={{ display: 'inline-block', width: seatNameplateWidth }}>
                        <div
                          style={{ position: 'relative', display: 'inline-block', width: '100%' }}
                        >
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
                              width: '100%',
                              minHeight: playerPanelMinHeight,
                              padding: playerPanelPadding,
                              borderRadius: playerPanelRadius,
                              background: infoDimmed ? 'rgba(3,8,11,0.58)' : 'rgba(3,8,11,0.82)',
                              border: isTurn
                                ? `2px solid ${TABLE_THEME.teal}`
                                : winner
                                  ? '2px solid #22c55e'
                                  : `1px solid ${TABLE_THEME.border}`,
                              boxShadow: isTurn
                                ? '0 0 0 3px rgba(20,184,166,0.22), 0 0 30px rgba(20,184,166,0.42)'
                                : winner
                                  ? '0 0 0 2px rgba(34,197,94,0.28), 0 0 34px rgba(34,197,94,0.42), 0 12px 30px rgba(0,0,0,0.34)'
                                  : undefined,
                              opacity: playerInactive ? 0.5 : infoDimmed ? 0.78 : 1,
                              textAlign: 'left',
                              display: 'grid',
                              gridTemplateColumns: `${infoAvatarSize}px minmax(0, 1fr)`,
                              alignItems: 'center',
                              columnGap: playerPanelColumnGap,
                            }}
                          >
                            {winner ? (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: -13,
                                  left: '50%',
                                  transform: 'translateX(-50%)',
                                  zIndex: 3,
                                  borderRadius: 999,
                                  border: '1px solid rgba(187,247,208,0.68)',
                                  background: 'rgba(20,83,45,0.92)',
                                  color: '#dcfce7',
                                  padding: '2px 7px',
                                  fontSize: 9,
                                  fontWeight: 900,
                                  lineHeight: 1.1,
                                  textTransform: 'uppercase',
                                  letterSpacing: 0.35,
                                  whiteSpace: 'nowrap',
                                  boxShadow: '0 8px 18px rgba(0,0,0,0.34)',
                                }}
                              >
                                {formatSignedChips(winnerInfo?.net ?? winnerInfo?.amount ?? 0)}
                              </div>
                            ) : null}
                            <PlayerIdentityBadge
                              name={displayName}
                              size={infoAvatarSize}
                              isActive={isTurn}
                              isWinner={winner}
                              isDimmed={infoDimmed || playerInactive}
                              secondsLeft={tableTimerSeconds}
                              maxSeconds={tableTimerMaxSeconds}
                              timerTone={timerTone}
                            />
                            <div
                              style={{
                                minWidth: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                              }}
                            >
                              <div
                                title={displayName}
                                style={{
                                  fontWeight: 800,
                                  fontFamily: TABLE_THEME.fontSans,
                                  fontSize: playerInfoTextSize,
                                  lineHeight: 1.15,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {displayName}
                              </div>
                              {p.id !== playerId && (
                                <div
                                  style={{
                                    fontSize: playerInfoTextSize,
                                    fontFamily: TABLE_THEME.fontSans,
                                    color: 'rgba(226,232,240,0.82)',
                                    lineHeight: 1.1,
                                  }}
                                >
                                  <span
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                  >
                                    <StackChipsIcon size={isPortraitPhone ? 11 : 14} />
                                    {p.stack}
                                  </span>
                                </div>
                              )}
                              {playerBusted ? (
                                <div
                                  style={{
                                    marginTop: 4,
                                    fontSize: playerInfoStatusTextSize,
                                    letterSpacing: 0.2,
                                    color: displayStatusColor,
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  {displayStatusLabel}
                                </div>
                              ) : showDiscardState ? (
                                <div
                                  style={{
                                    marginTop: 4,
                                    fontSize: playerInfoStatusTextSize,
                                    letterSpacing: 0.2,
                                    color: displayStatusColor,
                                  }}
                                >
                                  {displayStatusLabel}
                                </div>
                              ) : null}
                              {isTurn ? (
                                <div
                                  style={{
                                    marginTop: 4,
                                    fontSize: playerInfoStatusTextSize,
                                    letterSpacing: 0.3,
                                    color: displayStatusColor,
                                    textTransform: 'uppercase',
                                    animation: 'turn-pulse 1.2s ease-in-out infinite',
                                  }}
                                >
                                  {displayStatusLabel}
                                </div>
                              ) : null}
                              {displayStatusLabel &&
                              !playerBusted &&
                              !showDiscardState &&
                              !isTurn ? (
                                <div
                                  style={{
                                    marginTop: 4,
                                    fontSize: isPortraitPhone ? 8 : isPhone ? 9 : 10,
                                    letterSpacing: 0.35,
                                    color: displayStatusColor,
                                    textTransform: 'uppercase',
                                    lineHeight: 1.1,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {displayStatusLabel}
                                </div>
                              ) : null}
                              {showSeatDelta && !winner ? (
                                <div
                                  style={{
                                    marginTop: 3,
                                    fontSize: isPortraitPhone ? 9 : isPhone ? 10 : 11,
                                    fontWeight: 900,
                                    lineHeight: 1.1,
                                    color: (seatDelta?.net ?? 0) > 0 ? '#86efac' : '#f87171',
                                  }}
                                >
                                  {formatSignedChips(seatDelta?.net ?? 0)}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {renderReactionBadge(p.id)}
                          {renderBetPill(p.betThisStreet, seatBetOffsets[idx])}
                        </div>
                        <div
                          style={{
                            marginTop: 4,
                            display: 'flex',
                            justifyContent: 'center',
                            marginLeft: isPortraitPhone ? 0 : '1cm',
                          }}
                        >
                          {[0, 1].map((cardIdx) => {
                            const rot = cardIdx === 0 ? -18 : 16;
                            const margin = cardIdx === 0 ? seatHoleCardOverlap : 0;
                            const hasVisibleHoleCards = p.holeCards.some(
                              (card) => !isHiddenCard(card)
                            );
                            const reveal =
                              isShowdown &&
                              hasContestedShowdown &&
                              p.status !== 'folded' &&
                              hasVisibleHoleCards &&
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
                                    width: seatHoleCardWidth,
                                    height: seatHoleCardHeight,
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
                                    <CardBack size={seatHoleCardSize} tone="gold" />
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
                                        size={seatHoleCardSize}
                                        highlight={isShowdown && winningCards.has(cardKey(card))}
                                        dim={
                                          isShowdown &&
                                          winningCards.size > 0 &&
                                          !winningCards.has(cardKey(card))
                                        }
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
                    <div
                      style={{
                        position: 'relative',
                        display: 'inline-block',
                        width: seatNameplateWidth,
                      }}
                    >
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
                          width: '100%',
                          minHeight: playerPanelMinHeight,
                          padding: playerPanelPadding,
                          borderRadius: playerPanelRadius,
                          background: youInfoDimmed ? 'rgba(3,8,11,0.58)' : 'rgba(3,8,11,0.82)',
                          border: isMyTurn
                            ? `2px solid ${TABLE_THEME.teal}`
                            : winnersById.has(you.id)
                              ? '2px solid #22c55e'
                              : `1px solid ${TABLE_THEME.border}`,
                          boxShadow: isMyTurn
                            ? '0 0 0 3px rgba(20,184,166,0.22), 0 0 32px rgba(20,184,166,0.44)'
                            : winnersById.has(you.id)
                              ? '0 0 0 2px rgba(34,197,94,0.28), 0 0 34px rgba(34,197,94,0.42), 0 12px 30px rgba(0,0,0,0.34)'
                              : undefined,
                          textAlign: 'left',
                          opacity: youInfoDimmed ? 0.7 : 1,
                          position: 'relative',
                          display: 'grid',
                          gridTemplateColumns: `${infoAvatarSize}px minmax(0, 1fr)`,
                          alignItems: 'center',
                          columnGap: playerPanelColumnGap,
                        }}
                      >
                        {youWinnerInfo ? (
                          <div
                            style={{
                              position: 'absolute',
                              top: -13,
                              left: '50%',
                              transform: 'translateX(-50%)',
                              zIndex: 3,
                              borderRadius: 999,
                              border: '1px solid rgba(187,247,208,0.68)',
                              background: 'rgba(20,83,45,0.92)',
                              color: '#dcfce7',
                              padding: '2px 7px',
                              fontSize: 9,
                              fontWeight: 900,
                              lineHeight: 1.1,
                              textTransform: 'uppercase',
                              letterSpacing: 0.35,
                              whiteSpace: 'nowrap',
                              boxShadow: '0 8px 18px rgba(0,0,0,0.34)',
                            }}
                          >
                            {formatSignedChips(youWinnerInfo.net)}
                          </div>
                        ) : null}
                        <PlayerIdentityBadge
                          name={youDisplayName}
                          size={infoAvatarSize}
                          isActive={isMyTurn}
                          isWinner={winnersById.has(you.id)}
                          isDimmed={youInfoDimmed}
                          secondsLeft={tableTimerSeconds}
                          maxSeconds={tableTimerMaxSeconds}
                          timerTone={timerTone}
                        />
                        <div
                          style={{
                            minWidth: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 800,
                              fontFamily: TABLE_THEME.fontSans,
                              fontSize: playerInfoTextSize,
                              lineHeight: 1.15,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {youDisplayName}
                          </div>
                          <div
                            data-testid="hero-stack"
                            style={{
                              fontSize: playerInfoTextSize,
                              fontFamily: TABLE_THEME.fontSans,
                              color: 'rgba(226,232,240,0.82)',
                              lineHeight: 1.1,
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <StackChipsIcon size={isPortraitPhone ? 11 : 14} />
                              {you.stack}
                            </span>
                          </div>
                          {youBusted ? (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: playerInfoStatusTextSize,
                                letterSpacing: 0.2,
                                color: youDisplayStatusColor,
                                textTransform: 'uppercase',
                              }}
                            >
                              {youDisplayStatusLabel}
                            </div>
                          ) : null}
                          {isMyTurn ? (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: playerInfoStatusTextSize,
                                letterSpacing: 0.3,
                                color: youDisplayStatusColor,
                                textTransform: 'uppercase',
                                animation: 'turn-pulse 1.2s ease-in-out infinite',
                              }}
                            >
                              {youDisplayStatusLabel}
                            </div>
                          ) : null}
                          {youDisplayStatusLabel && !youBusted && !isMyTurn ? (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: isPortraitPhone ? 8 : isPhone ? 9 : 10,
                                letterSpacing: 0.35,
                                color: youDisplayStatusColor,
                                textTransform: 'uppercase',
                                lineHeight: 1.1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {youDisplayStatusLabel}
                            </div>
                          ) : null}
                          {showYouSeatDelta && !youWinnerInfo ? (
                            <div
                              style={{
                                marginTop: 3,
                                fontSize: isPortraitPhone ? 9 : isPhone ? 10 : 11,
                                fontWeight: 900,
                                lineHeight: 1.1,
                                color: (youSeatDelta?.net ?? 0) > 0 ? '#86efac' : '#f87171',
                              }}
                            >
                              {formatSignedChips(youSeatDelta?.net ?? 0)}
                            </div>
                          ) : null}
                        </div>
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
                    <div style={{ display: 'flex', gap: isPortraitPhone ? 4 : isPhone ? 8 : 10 }}>
                      {you.holeCards.map((c, idx) => {
                        const discardSelectable =
                          discardPending &&
                          !discardSubmitted &&
                          !animateHoleDeal &&
                          isDiscardIndexAllowed(idx);
                        const discardSelected = discardSelectable && selectedDiscardIndex === idx;
                        return (
                          <div
                            data-testid={`hero-hole-card-${idx}`}
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
                                cursor: discardSelectable ? 'pointer' : 'default',
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
                                size={isPortraitPhone ? 'medium' : 'large'}
                                highlight={isShowdown && winningCards.has(cardKey(c))}
                                dim={
                                  isShowdown &&
                                  winningCards.size > 0 &&
                                  !winningCards.has(cardKey(c))
                                }
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
            {isShowdown && showdownResult ? (
              <>
                <LastHandRecap
                  lines={lastHandRecapLines}
                  fullLog={hand?.log ?? []}
                  potSummaries={showdownResult.pots.map(formatPotWinnerText)}
                  isCollapsed={lastHandRecapCollapsed}
                  showDetails={showLastHandDetails}
                  isPhone={isPhone}
                  onToggleCollapsed={() => setLastHandRecapCollapsed((previous) => !previous)}
                  onViewDetails={() => {
                    setLastHandRecapCollapsed(false);
                    setShowLastHandDetails(true);
                  }}
                />
                {!localNeedsRebuy ? (
                  betweenHandActive ? (
                    <NextHandCountdown
                      seconds={betweenHandCountdownSeconds}
                      minSeconds={betweenHandMinSeconds}
                      durationMs={betweenHandDurationMs}
                      ready={readyForNextHand}
                      canReady={canReadyForNextHand}
                      isPhone={isPhone}
                      onReady={sendReadyForNextHand}
                    />
                  ) : null
                ) : null}
              </>
            ) : null}
          </div>
          {(you || localNeedsRebuy) && (
            <div
              data-testid="action-tray"
              style={{
                position: pinActionTray ? 'fixed' : 'static',
                left: pinActionTray ? (isPhone ? 8 : 16) : undefined,
                right: pinActionTray ? (isPhone ? 8 : 16) : undefined,
                bottom: pinActionTray
                  ? `calc(${isPhone ? 12 : 14}px + env(safe-area-inset-bottom))`
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
                      data-testid="confirm-discard"
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
                    padding: isMyTurn
                      ? isLandscapePhone
                        ? '8px 10px'
                        : isPhone
                          ? '10px 12px'
                          : '12px 14px'
                      : '9px 12px',
                    boxShadow: isMyTurn
                      ? '0 0 0 1px rgba(20,184,166,0.2), 0 14px 28px rgba(20,184,166,0.16)'
                      : '0 10px 20px rgba(0,0,0,0.22)',
                    display: isMyTurn ? 'flex' : 'contents',
                    flexDirection: 'column',
                    gap: isMyTurn ? 8 : 4,
                  }}
                >
                  {isMyTurn ? (
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
                          border: `1px solid ${TABLE_THEME.tealBorder}`,
                          background: TABLE_THEME.tealSoft,
                          color: '#ccfbf1',
                          padding: '3px 10px',
                          fontSize: 11,
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {trayTurnStatusLabel}
                      </span>
                    </div>
                  ) : (
                    <span data-testid="turn-indicator" style={{ display: 'none' }}>
                      {trayTurnStatusLabel}
                    </span>
                  )}
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
                            act(isCallAllIn ? 'allIn' : 'call');
                          }}
                          style={turnActionStyle(
                            canCheckOrCall,
                            isCallAllIn
                              ? {
                                  border: 'rgba(248,113,113,0.9)',
                                  background: 'rgba(127,29,29,0.58)',
                                  color: '#fee2e2',
                                  glow: 'rgba(248,113,113,0.35)',
                                }
                              : {
                                  border: 'rgba(94,234,212,0.78)',
                                  background: 'rgba(20,184,166,0.28)',
                                  color: '#e0f2fe',
                                  glow: 'rgba(20,184,166,0.3)',
                                }
                          )}
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
                          data-testid="action-raise-toggle"
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
                        {canShortOpenAllIn && allInTotal !== null ? (
                          <button
                            data-testid="action-allin"
                            type="button"
                            onClick={() => act('allIn', allInTotal)}
                            style={turnActionStyle(true, {
                              border: 'rgba(248,113,113,0.9)',
                              background: 'rgba(127,29,29,0.58)',
                              color: '#fee2e2',
                              glow: 'rgba(248,113,113,0.35)',
                            })}
                          >
                            All-in {you?.stack ?? allInTotal}
                          </button>
                        ) : null}
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
                            {raiseActionLabel === 'Bet' ? 'Bet amount' : 'Raise to'}{' '}
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
                                data-testid={
                                  option.requiresConfirm ? 'raise-option-allin' : undefined
                                }
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
                      {!canShortOpenAllIn ? (
                        <button
                          data-testid="action-allin"
                          type="button"
                          disabled
                          aria-hidden="true"
                          style={{ display: 'none' }}
                        />
                      ) : null}
                    </>
                  ) : (
                    hiddenBettingActionButtons
                  )}
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
                  {waitingForPlayers ? 'Waiting for another player' : 'Waiting for next hand'}
                  <span style={{ display: 'inline-flex', marginLeft: 4 }}>
                    <span style={ellipsisDotStyle(0)}>.</span>
                    <span style={ellipsisDotStyle(200)}>.</span>
                    <span style={ellipsisDotStyle(400)}>.</span>
                  </span>
                </div>
                {waitingForPlayers && tableCode ? (
                  <div
                    style={{
                      marginTop: 10,
                      fontFamily: TABLE_THEME.fontSans,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 1.2,
                      color: 'rgba(254,243,199,0.92)',
                      border: '1px solid rgba(251,191,36,0.35)',
                      borderRadius: 10,
                      background: 'rgba(9,13,23,0.72)',
                      padding: '7px 10px',
                    }}
                  >
                    Table code {tableCode}
                  </div>
                ) : null}
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
                  ? `calc(${isPhone ? 12 : 14}px + env(safe-area-inset-bottom))`
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
        @keyframes showdown-pop {
          0% {
            opacity: 0;
          }
          100% {
            opacity: 1;
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
  dim = false,
  size = 'small',
}: {
  card: Card;
  highlight?: boolean;
  outline?: 'green' | 'red';
  fade?: boolean;
  dim?: boolean;
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
  const highlightShadow = highlight
    ? '0 0 0 2px rgba(34,197,94,0.38), 0 0 18px rgba(34,197,94,0.5)'
    : undefined;
  const cardShadow =
    [outlineShadow, highlightShadow, baseShadow].filter(Boolean).join(', ') || undefined;
  const cardOpacity = fade ? 0 : dim ? 0.46 : 1;
  const cardFilter = dim ? 'saturate(0.72) brightness(0.74)' : undefined;
  const cardTransform = highlight ? 'translateY(-2px) scale(1.045)' : undefined;
  const opacityTransition = 'opacity 0.5s ease, transform 160ms ease, filter 160ms ease';
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
          filter: cardFilter,
          transform: cardTransform,
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
          filter: cardFilter,
          transform: cardTransform,
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
        filter: cardFilter,
        transform: cardTransform,
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
