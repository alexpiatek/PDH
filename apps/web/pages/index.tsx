import { useEffect, useMemo, useRef, useState } from 'react';
import type { NextPage } from 'next';
import { Client as NakamaClient } from '@heroiclabs/nakama-js';
import type { Match, Session, Socket as NakamaSocket } from '@heroiclabs/nakama-js';
import { Card, HandState, PlayerInHand } from '@pdh/engine';
import { ClientMessage, ServerMessage } from '../server-types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';
const NETWORK_BACKEND = (
  process.env.NEXT_PUBLIC_NETWORK_BACKEND ||
  (process.env.NEXT_PUBLIC_NAKAMA_HOST ? 'nakama' : 'legacy')
).toLowerCase();
const NAKAMA_HOST = process.env.NEXT_PUBLIC_NAKAMA_HOST || '127.0.0.1';
const NAKAMA_PORT = process.env.NEXT_PUBLIC_NAKAMA_PORT || '7350';
const NAKAMA_SERVER_KEY = process.env.NEXT_PUBLIC_NAKAMA_SERVER_KEY || 'defaultkey';
const NAKAMA_MATCH_MODULE = process.env.NEXT_PUBLIC_NAKAMA_MATCH_MODULE || 'pdh';
const NAKAMA_TABLE_ID = process.env.NEXT_PUBLIC_NAKAMA_TABLE_ID || 'main';
const NAKAMA_MATCH_ID = process.env.NEXT_PUBLIC_NAKAMA_MATCH_ID;

const STORAGE_KEYS = {
  playerId: 'playerId',
  matchId: 'nakamaMatchId',
  deviceId: 'nakamaDeviceId',
} as const;

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
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return 'unknown error';
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
const isHiddenCard = (card: Card) =>
  (card as unknown as { rank: string }).rank === 'X' ||
  (card as unknown as { suit: string }).suit === 'X';

const MINIMAL_DECK_PALETTE = {
  face: '#f6f7f2',
  border: '#e2e8f0',
  navy: '#0b1d3a',
  orange: '#f15a29',
  accent: '#cbd5e1',
};
const USE_CUSTOM_MINIMAL_DECK = true;

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

const Home: NextPage = () => {
  const connectionRef = useRef<{ send: (msg: ClientMessage) => void; close: () => void } | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const buyIn = 10000;
  const [state, setState] = useState<any>(null);
  const [status, setStatus] = useState<string>('Disconnected');
  const [betAmount, setBetAmount] = useState<number>(200);

  useEffect(() => {
    const existing = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.playerId) : null;
    if (existing) {
      setPlayerId(existing);
    }

    let disposed = false;

    const onServerMessage = (msg: ServerMessage) => {
      if (msg.type === 'welcome') {
        setPlayerId(msg.playerId);
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEYS.playerId, msg.playerId);
        }
      }
      if (msg.type === 'state') {
        setState(msg.state);
      }
      if (msg.type === 'error') {
        setStatus(msg.message);
      }
    };

    const connectLegacyWebSocket = () => {
      const ws = new WebSocket(WS_URL);
      connectionRef.current = {
        send: (msg) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify(msg));
        },
        close: () => {
          ws.close();
        },
      };
      ws.onopen = () => {
        if (disposed) return;
        setStatus('Connected (legacy)');
        if (existing) {
          ws.send(JSON.stringify({ type: 'reconnect', playerId: existing }));
        } else {
          ws.send(JSON.stringify({ type: 'requestState' }));
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        setStatus('Disconnected');
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

    const joinOrCreateNakamaMatch = async (client: NakamaClient, session: Session, socket: NakamaSocket): Promise<Match> => {
      if (NAKAMA_MATCH_ID) {
        return socket.joinMatch(NAKAMA_MATCH_ID);
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
      const list = await client.listMatches(session, 10, true, label, 0, 9);
      const existingMatch = (list.matches ?? []).find((match) => Boolean(match.match_id));
      if (existingMatch?.match_id) {
        return socket.joinMatch(existingMatch.match_id);
      }

      const created = await socket.createMatch(NAKAMA_MATCH_MODULE);
      if (!created.authoritative) {
        throw new Error(
          `Created non-authoritative match. Check NEXT_PUBLIC_NAKAMA_MATCH_MODULE=${NAKAMA_MATCH_MODULE}.`
        );
      }
      return created;
    };

    const connectNakama = async () => {
      setStatus('Connecting to Nakama...');

      const client = new NakamaClient(NAKAMA_SERVER_KEY, NAKAMA_HOST, NAKAMA_PORT, NAKAMA_USE_SSL);
      const session = await client.authenticateDevice(getOrCreateDeviceId(), true);
      if (disposed) return;

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
      connectionRef.current?.close();
      connectionRef.current = null;
    };
  }, []);

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

  const isMyTurn = Boolean(hand && you && hand.phase === 'betting' && hand.actionOnSeat === you.seat);
  const youInfoDimmed = Boolean(hand && hand.phase === 'betting' && !isMyTurn);
  const discardPending = hand && you && hand.phase === 'discard' && hand.discardPending.includes(you.id);
  const toCall = hand && you ? Math.max(0, hand.currentBet - you.betThisStreet) : 0;
  const isShowdown = hand?.phase === 'showdown';
  const raiseCapReached = Boolean(hand && hand.raisesThisStreet >= 2);
  const allInTotal = you ? you.stack + you.betThisStreet : 0;
  const allInWouldRaise = Boolean(hand && hand.currentBet > 0 && allInTotal > hand.currentBet);
  const suggestedRaiseTo = useMemo(() => {
    if (!hand) return null;
    if (hand.currentBet === 0) return hand.minRaise;
    return hand.currentBet + hand.minRaise;
  }, [hand?.currentBet, hand?.minRaise]);

  useEffect(() => {
    if (!hand) {
      return;
    }
    if (hand.phase !== 'showdown') {
      return;
    }
    const timeoutId = window.setTimeout(() => send({ type: 'nextHand' }), 10000);
    return () => window.clearTimeout(timeoutId);
  }, [hand?.phase, hand?.handId]);

  useEffect(() => {
    if (!isMyTurn || suggestedRaiseTo === null) return;
    setBetAmount(suggestedRaiseTo);
  }, [isMyTurn, hand?.handId, hand?.currentBet, hand?.minRaise, suggestedRaiseTo]);

  const send = (msg: ClientMessage) => {
    connectionRef.current?.send(msg);
  };

  const join = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    send({ type: 'join', name: trimmed, buyIn });
  };

  const act = (action: PlayerActionType, amount?: number) => {
    send({ type: 'action', action, amount });
  };

  const discard = (idx: number) => {
    send({ type: 'discard', index: idx });
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
    const label = topWinner.handLabel ? ` - ${topWinner.handLabel}` : '';
    return `${winnerSeat?.name ?? topWinner.playerId} wins ${topWinner.amount}${label}`;
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
  const playerInfoOffsetY = -19;
  const youAvatarStyle = useMemo(() => {
    if (!you) return null;
    const youIsWinner = winnersById.has(you.id);
    return {
      width: infoAvatarSize,
      height: infoAvatarSize,
      borderRadius: '50%',
      background: '#101827',
      border: youIsWinner ? '3px solid #22c55e' : '3px solid #314066',
      boxShadow: '0 0 18px rgba(0,0,0,0.45)',
    };
  }, [you, winnersById, infoAvatarSize]);

  return (
    <div
      style={{
        fontFamily: '"Bebas Neue", "Oswald", "Trebuchet MS", sans-serif',
        color: '#e5e7eb',
        minHeight: '100vh',
        background: 'radial-gradient(1200px 600px at 50% -10%, #1b3a66 0%, #0b1223 55%, #05070f 100%)',
        padding: '18px 18px 30px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 32, letterSpacing: 1 }}>Resolute Hold&apos;em</div>
          <div style={{ fontSize: 14, opacity: 0.7, fontFamily: '"Inter", sans-serif' }}>Status: {status}</div>
        </div>
        {!seated && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="enter player name"
              style={{ padding: 8, color: '#111827', caretColor: '#111827' }}
            />
            <button onClick={join} disabled={!name.trim()} style={{ padding: '8px 12px' }}>
              Join
            </button>
          </div>
        )}
      </div>
      {hand ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              position: 'relative',
              width: 'min(1200px, 96vw)',
              height: 'min(62vh, 620px)',
              margin: '0 auto',
              borderRadius: 999,
              background: 'radial-gradient(circle at 50% 45%, #1f5a2f 0%, #184524 50%, #11331a 100%)',
              border: '10px solid #2d2a40',
              boxShadow: '0 30px 80px rgba(0,0,0,0.45), inset 0 0 40px rgba(0,0,0,0.5)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                padding: '6px 12px',
                borderRadius: 999,
                background: '#14321e',
                border: '1px solid #2a6241',
                color: '#e5e7eb',
                fontSize: 14,
                letterSpacing: 1,
              }}
            >
              Stage: {hand.street} | Phase: {hand.phase}
            </div>
            <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', gap: '1mm' }}>
              {communityCards.map((c, idx) => (
                <CardView key={idx} card={c} size="xlarge" highlight={isShowdown && winningCards.has(cardKey(c))} />
              ))}
            </div>
            <div style={{ position: 'absolute', top: '52%', left: '50%', transform: 'translate(-50%, -50%) translateY(-171px)' }}>
              <div style={{ padding: '6px 14px', borderRadius: 999, background: '#0f172a', border: '1px solid #2c3e66' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 24, height: 24, display: 'inline-block' }} aria-hidden="true">
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
                  <span>{potAmount}</span>
                </span>
              </div>
            </div>
            {isShowdown && showdownSummary && (
              <div style={{ position: 'absolute', top: '60%', left: '50%', transform: 'translate(-50%, -50%)' }}>
                <div style={{ padding: '6px 14px', borderRadius: 999, background: '#123b2f', border: '1px solid #22c55e', color: '#d1fae5' }}>
                  {showdownSummary}
                </div>
              </div>
            )}
            {tablePlayers.map((p, idx) => {
              const pos = seatingPositions[idx];
              const bestFive = winnersById.get(p.id)?.bestFive ?? [];
              const winner = winnersById.has(p.id);
              const isYou = p.id === playerId;
              const roleChips = roleChipsBySeat.get(p.seat) ?? [];
              const avatarSize = infoAvatarSize;
              const avatarBorder = winner ? '3px solid #22c55e' : '3px solid #314066';
              const isTurn = Boolean(hand && hand.phase === 'betting' && hand.actionOnSeat === p.seat);
              const infoDimmed = Boolean(hand && hand.phase === 'betting' && !isTurn);
              const avatarStyle = {
                width: avatarSize,
                height: avatarSize,
                borderRadius: '50%',
                background: '#101827',
                border: avatarBorder,
                boxShadow: '0 0 18px rgba(0,0,0,0.45)',
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
                          border: winner ? '2px solid #22c55e' : '1px solid #2c3e66',
                          boxShadow: winner ? '0 0 0 2px rgba(34, 197, 94, 0.2)' : undefined,
                          opacity: infoDimmed ? 0.7 : 1,
                        }}
                    >
                        <div style={{ position: 'absolute', top: 6, left: 8, ...avatarStyle }} />
                        <div style={{ fontWeight: 700, fontFamily: '"Inter", sans-serif', fontSize: 12 }}>{p.name}</div>
                        <div style={{ fontSize: 12, fontFamily: '"Inter", sans-serif' }}>{p.status}</div>
                        {p.id !== playerId && (
                          <div style={{ fontSize: 12, fontFamily: '"Inter", sans-serif' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <StackChipsIcon size={14} />
                              {p.stack}
                            </span>
                          </div>
                        )}
                        {isShowdown && winner && (
                          <div style={{ marginTop: 4, fontSize: 12, color: '#86efac', fontFamily: '"Inter", sans-serif' }}>
                            {winnersById.get(p.id)?.handLabel}
                          </div>
                        )}
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
              <div
                style={{
                  position: 'absolute',
                  bottom: 14,
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
                      border: winnersById.has(you.id) ? '2px solid #22c55e' : '1px solid #2c3e66',
                      boxShadow: winnersById.has(you.id) ? '0 0 0 2px rgba(34, 197, 94, 0.2)' : undefined,
                      textAlign: 'left',
                      opacity: youInfoDimmed ? 0.7 : 1,
                      position: 'relative',
                    }}
                  >
                    {youAvatarStyle && <div style={{ position: 'absolute', top: 6, left: 8, ...youAvatarStyle }} />}
                    <div style={{ fontWeight: 700, fontFamily: '"Inter", sans-serif', fontSize: 12 }}>{you.name}</div>
                    <div style={{ fontSize: 12, fontFamily: '"Inter", sans-serif' }}>{you.status}</div>
                    <div style={{ fontSize: 12, fontFamily: '"Inter", sans-serif' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <StackChipsIcon size={14} />
                        {you.stack}
                      </span>
                    </div>
                    {isShowdown && winnersById.has(you.id) && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#86efac', fontFamily: '"Inter", sans-serif' }}>
                        {winnersById.get(you.id)?.handLabel}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {you.holeCards.map((c, idx) => (
                    <div key={idx} style={{ transform: `rotate(${idx === 0 ? -6 : 6}deg)` }}>
                      <CardView card={c} size="large" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ position: 'absolute', bottom: -218, left: -9.4, width: 374, background: 'rgba(9, 12, 20, 0.8)', border: '1px solid #27324e', borderRadius: 10, padding: 8 }}>
              <div style={{ fontSize: 14, fontFamily: '"Inter", sans-serif', opacity: 0.8, marginBottom: 6 }}>Dealer</div>
              <div style={{ maxHeight: 80, overflowY: 'auto' }}>
                {(state?.log ?? []).slice(-5).map((l: any, idx: number) => (
                  <div key={idx} style={{ fontSize: 12, opacity: 0.85, marginBottom: 4, fontFamily: '"Inter", sans-serif' }}>
                    {l.message}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {you && (
            <div
              style={{
                width: 'min(1200px, 96vw)',
                margin: '0 auto',
                background: 'transparent',
                border: 'none',
                borderRadius: 0,
                padding: 0,
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {discardPending ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ fontFamily: '"Inter", sans-serif' }}>Choose a card to discard</div>
                  {you.holeCards.map((c, idx) => (
                    <button key={idx} onClick={() => discard(idx)} style={{ padding: '8px 12px' }}>
                      Discard {cardText(c)}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button disabled={!isMyTurn} onClick={() => act('fold')} style={{ padding: '10px 18px', fontWeight: 700 }}>
                    Fold
                  </button>
                  <button disabled={!isMyTurn || toCall !== 0} onClick={() => act('check')} style={{ padding: '10px 18px', fontWeight: 700 }}>
                    Check
                  </button>
                  <button disabled={!isMyTurn || toCall === 0} onClick={() => act('call')} style={{ padding: '10px 18px', fontWeight: 700 }}>
                    Call {toCall}
                  </button>
                  <input
                    type="number"
                    value={betAmount}
                    onChange={(e) => setBetAmount(Number(e.target.value))}
                    style={{ padding: 8, width: 120 }}
                  />
                  <button
                    disabled={!isMyTurn || (hand && raiseCapReached)}
                    onClick={() => act(hand && hand.currentBet === 0 ? 'bet' : 'raise', betAmount)}
                    style={{ padding: '10px 18px', fontWeight: 700 }}
                  >
                    {hand && hand.currentBet === 0 ? 'Bet' : 'Raise'} to {betAmount}
                  </button>
                  <button
                    disabled={!isMyTurn || (raiseCapReached && allInWouldRaise)}
                    onClick={() => act('allIn')}
                    style={{ padding: '10px 18px', background: '#ef4444', color: 'white', fontWeight: 700 }}
                  >
                    All-in {you ? you.stack + you.betThisStreet : ''}
                  </button>
                </div>
              )}
              <div style={{ padding: '6px 10px', borderRadius: 8, background: '#122145', border: '1px solid #2c3e66', fontFamily: '"Inter", sans-serif' }}>
                Stack: {you.stack}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontFamily: '"Inter", sans-serif' }}>{seated ? 'Waiting for next hand...' : 'Waiting for hand...'}</div>
      )}
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
  size = 'small',
}: {
  card: Card;
  highlight?: boolean;
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
    large: { width: 60, height: 84, fontSize: 24, corner: 12, center: 28, pad: 3 },
    xlarge: { width: 66, height: 93, fontSize: 27, corner: 17, center: 33, pad: 4 },
  };
  const sizing = sizeMap[size];
  const rankLabel = cardRankLabel(card.rank);
  const suit = suitSymbol(card.suit);
  const cardColor = isClassicSize ? (isRed ? '#dc2626' : '#111827') : isRed ? '#f87171' : '#e5e7eb';
  const cardBorder = highlight ? '2px solid #22c55e' : isClassicSize ? '1px solid #d1d5db' : '1px solid #2c3e66';
  const cardShadow = highlight
    ? '0 0 0 2px rgba(34, 197, 94, 0.2)'
      : isClassicSize
        ? '0 6px 16px rgba(0,0,0,0.25)'
        : undefined;
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
              // eslint-disable-next-line no-console
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

export default Home;
