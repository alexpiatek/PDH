import { useEffect, useMemo, useRef, useState } from 'react';
import type { NextPage } from 'next';
import { Card, HandState, PlayerInHand } from '@pdh/engine';
import { ClientMessage, ServerMessage } from '../server-types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';

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

const cardText = (c: Card) => `${c.rank}${suitSymbol(c.suit)}`;

const Home: NextPage = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState('Player');
  const [buyIn, setBuyIn] = useState(2000);
  const [state, setState] = useState<any>(null);
  const [status, setStatus] = useState<string>('Disconnected');
  const [betAmount, setBetAmount] = useState<number>(200);
  const [showNextHand, setShowNextHand] = useState(false);

  useEffect(() => {
    const existing = typeof window !== 'undefined' ? localStorage.getItem('playerId') : null;
    if (existing) setPlayerId(existing);
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus('Connected');
      if (existing) {
        ws.send(JSON.stringify({ type: 'reconnect', playerId: existing }));
      }
    };
    ws.onclose = () => setStatus('Disconnected');
    ws.onmessage = (ev) => {
      const msg: ServerMessage = JSON.parse(ev.data.toString());
      if (msg.type === 'welcome') {
        setPlayerId(msg.playerId);
        if (typeof window !== 'undefined') {
          localStorage.setItem('playerId', msg.playerId);
        }
      }
      if (msg.type === 'state') {
        setState(msg.state);
      }
      if (msg.type === 'error') {
        setStatus(msg.message);
      }
    };
    return () => {
      ws.close();
    };
  }, []);

  const hand: HandState | null = state?.hand ?? null;
  const you = useMemo(() => {
    if (!hand || !playerId) return null;
    return hand.players.find((p: PlayerInHand) => p.id === playerId);
  }, [hand, playerId]);
  const winnersById = useMemo(() => {
    const map = new Map<string, { bestFive?: Card[] }>();
    for (const w of hand?.showdownWinners ?? []) {
      map.set(w.playerId, { bestFive: w.bestFive });
    }
    return map;
  }, [hand?.showdownWinners]);
  const seated = useMemo(() => {
    if (!playerId) return false;
    return Boolean(state?.seats?.some((s: any) => s && s.id === playerId));
  }, [state, playerId]);

  const isMyTurn = hand && you && hand.phase === 'betting' && hand.actionOnSeat === you.seat;
  const discardPending = hand && you && hand.phase === 'discard' && hand.discardPending.includes(you.id);
  const toCall = hand && you ? Math.max(0, hand.currentBet - you.betThisStreet) : 0;
  const isShowdown = hand?.phase === 'showdown';

  useEffect(() => {
    if (!hand) {
      setShowNextHand(false);
      return;
    }
    if (hand.phase !== 'showdown') {
      setShowNextHand(false);
      return;
    }
    setShowNextHand(false);
    const timeoutId = window.setTimeout(() => setShowNextHand(true), 15000);
    return () => window.clearTimeout(timeoutId);
  }, [hand?.phase, hand?.handId]);

  const send = (msg: ClientMessage) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(msg));
  };

  const join = () => {
    send({ type: 'join', name, buyIn });
  };

  const act = (action: ClientMessage['action'], amount?: number) => {
    send({ type: 'action', action, amount });
  };

  const discard = (idx: number) => {
    send({ type: 'discard', index: idx });
  };

  const communityCards = hand?.board ?? [];
  const cardKey = (card: Card) => `${card.rank}${card.suit}`;
  const winningCards = useMemo(() => {
    const keys = new Set<string>();
    for (const w of hand?.showdownWinners ?? []) {
      for (const c of w.bestFive ?? []) {
        keys.add(cardKey(c));
      }
    }
    return keys;
  }, [hand?.showdownWinners]);

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', padding: 20, background: '#0b132b', color: '#e5e7eb', minHeight: '100vh' }}>
      <h1>PDH - Discard Hold&apos;em</h1>
      <p>Status: {status}</p>
      {!seated && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ padding: 8 }} />
          <input
            type="number"
            value={buyIn}
            onChange={(e) => setBuyIn(Number(e.target.value))}
            placeholder="Buy-in"
            style={{ padding: 8, width: 120 }}
          />
          <button onClick={join} style={{ padding: '8px 12px' }}>
            Join
          </button>
        </div>
      )}
      {hand ? (
        <div>
          <div style={{ marginBottom: 12 }}>
            <strong>Street:</strong> {hand.street} | <strong>Phase:</strong> {hand.phase}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {communityCards.map((c, idx) => (
              <CardView key={idx} card={c} highlight={isShowdown && winningCards.has(cardKey(c))} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {hand.players.map((p) => {
              const bestFive = winnersById.get(p.id)?.bestFive ?? [];
              const winner = winnersById.has(p.id);
              return (
                <div
                  key={p.id}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background: p.id === playerId ? '#1f2a44' : '#162040',
                    border: winner
                      ? '2px solid #22c55e'
                      : hand.actionOnSeat === p.seat && hand.phase === 'betting'
                        ? '2px solid #10b981'
                        : '1px solid #2c3e66',
                    boxShadow: winner ? '0 0 0 2px rgba(34, 197, 94, 0.2)' : undefined,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                  <div>Seat {p.seat}</div>
                  <div>Status: {p.status}</div>
                  <div>Stack: {p.stack}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {p.holeCards.map((c, idx) => (
                      <CardView key={idx} card={c} highlight={winner && bestFive.some((b) => cardKey(b) === cardKey(c))} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {you && (
            <div style={{ marginTop: 16, padding: 12, border: '1px solid #2c3e66', borderRadius: 8 }}>
              <div style={{ marginBottom: 8 }}>Your actions</div>
              {discardPending ? (
                <div>
                  <div>Choose a card to discard</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {you.holeCards.map((c, idx) => (
                      <button key={idx} onClick={() => discard(idx)} style={{ padding: 8 }}>
                        Discard {cardText(c)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button disabled={!isMyTurn} onClick={() => act('fold')} style={{ padding: '8px 12px' }}>
                    Fold
                  </button>
                  <button disabled={!isMyTurn || toCall !== 0} onClick={() => act('check')} style={{ padding: '8px 12px' }}>
                    Check
                  </button>
                  <button disabled={!isMyTurn || toCall === 0} onClick={() => act('call')} style={{ padding: '8px 12px' }}>
                    Call {toCall}
                  </button>
                  <input
                    type="number"
                    value={betAmount}
                    onChange={(e) => setBetAmount(Number(e.target.value))}
                    style={{ padding: 8, width: 100 }}
                  />
                  <button disabled={!isMyTurn} onClick={() => act(hand && hand.currentBet === 0 ? 'bet' : 'raise', betAmount)} style={{ padding: '8px 12px' }}>
                    {hand && hand.currentBet === 0 ? 'Bet' : 'Raise'} to {betAmount}
                  </button>
                  <button disabled={!isMyTurn} onClick={() => act('allIn', betAmount)} style={{ padding: '8px 12px', background: '#ef4444', color: 'white' }}>
                    All-in
                  </button>
                </div>
              )}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600 }}>Game log</div>
            <div style={{ maxHeight: 160, overflowY: 'auto', padding: 8, background: '#0f172a', borderRadius: 8 }}>
              {(state?.log ?? []).slice(-20).map((l: any, idx: number) => (
                <div key={idx} style={{ fontSize: 12, opacity: 0.85 }}>
                  {l.message}
                </div>
              ))}
            </div>
          </div>
          {isShowdown && showNextHand && (
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => send({ type: 'nextHand' })}
                style={{
                  padding: '10px 16px',
                  background: '#22c55e',
                  color: '#0b132b',
                  fontWeight: 700,
                  borderRadius: 8,
                }}
              >
                Next hand
              </button>
            </div>
          )}
        </div>
      ) : (
        <p>{seated ? 'Waiting for next hand...' : 'Waiting for hand...'}</p>
      )}
    </div>
  );
};

const CardView = ({ card, highlight = false }: { card: Card; highlight?: boolean }) => {
  const isRed = card.suit === 'H' || card.suit === 'D';
  return (
    <div
      style={{
        width: 36,
        height: 52,
        borderRadius: 6,
        border: highlight ? '2px solid #22c55e' : '1px solid #2c3e66',
        background: '#111827',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        color: isRed ? '#f87171' : '#e5e7eb',
        boxShadow: highlight ? '0 0 0 2px rgba(34, 197, 94, 0.2)' : undefined,
      }}
    >
      {card.rank}
      {suitSymbol(card.suit)}
    </div>
  );
};

export default Home;
