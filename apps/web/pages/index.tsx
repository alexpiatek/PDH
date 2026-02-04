import { useEffect, useMemo, useRef, useState } from 'react';
import type { NextPage } from 'next';
import type { Socket } from '@heroiclabs/nakama-js';
import { Card, HandState, PlayerInHand } from '@pdh/engine';
import { ClientMessage, ServerMessage } from '../server-types';

const NAKAMA_HOST = process.env.NEXT_PUBLIC_NAKAMA_HOST || '127.0.0.1';
const NAKAMA_PORT = Number(process.env.NEXT_PUBLIC_NAKAMA_PORT || '7350');
const NAKAMA_SERVER_KEY = process.env.NEXT_PUBLIC_NAKAMA_SERVER_KEY || 'defaultkey';
const NAKAMA_USE_SSL = (process.env.NEXT_PUBLIC_NAKAMA_USE_SSL || 'false') === 'true';
const DEVICE_ID_KEY = 'nakamaDeviceId';
const MATCH_ID_KEY = 'nakamaMatchId';
const PLAYER_ID_KEY = 'playerId';

const enum OpCode {
  ClientMessage = 1,
  ServerMessage = 2,
}

const cardText = (c: Card) => `${c.rank}${c.suit}`;

const Home: NextPage = () => {
  const socketRef = useRef<Socket | null>(null);
  const matchIdRef = useRef<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState('Player');
  const [buyIn, setBuyIn] = useState(2000);
  const [state, setState] = useState<any>(null);
  const [status, setStatus] = useState<string>('Disconnected');
  const [betAmount, setBetAmount] = useState<number>(200);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const textDecoder = new TextDecoder();

    const deviceId =
      localStorage.getItem(DEVICE_ID_KEY) ||
      (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2));
    localStorage.setItem(DEVICE_ID_KEY, deviceId);

    const connect = async () => {
      try {
        const { Client } = await import('@heroiclabs/nakama-js');
        const client = new Client(NAKAMA_SERVER_KEY, NAKAMA_HOST, NAKAMA_PORT, NAKAMA_USE_SSL);
        const socket = client.createSocket(NAKAMA_USE_SSL, true);
        socketRef.current = socket;
        setStatus('Connecting');

        socket.onerror = () => {
          if (!cancelled) setStatus('Error');
        };
        socket.ondisconnect = () => {
          if (!cancelled) setStatus('Disconnected');
        };
        socket.onmatchdata = (matchData) => {
          if (matchData.op_code !== OpCode.ServerMessage) return;
          const payload = textDecoder.decode(matchData.data);
          const msg: ServerMessage = JSON.parse(payload);
          if (msg.type === 'welcome') {
            setPlayerId(msg.playerId);
            localStorage.setItem(PLAYER_ID_KEY, msg.playerId);
          }
          if (msg.type === 'state') {
            setState(msg.state);
          }
          if (msg.type === 'error') {
            setStatus(msg.message);
          }
        };

        const session = await client.authenticateDevice(deviceId, true);
        if (cancelled) return;
        setPlayerId(session.user_id);
        localStorage.setItem(PLAYER_ID_KEY, session.user_id);

        await socket.connect(session, true);
        if (cancelled) return;
        setStatus('Connected');

        let matchId = localStorage.getItem(MATCH_ID_KEY);
        let match;
        if (matchId) {
          try {
            match = await socket.joinMatch(matchId);
          } catch (err) {
            match = await socket.createMatch('pdh');
          }
        } else {
          match = await socket.createMatch('pdh');
        }

        if (cancelled) return;
        matchId = match.match_id;
        matchIdRef.current = matchId;
        localStorage.setItem(MATCH_ID_KEY, matchId);
        socket.sendMatchState(matchId, OpCode.ClientMessage, JSON.stringify({ type: 'requestState' }));
      } catch (err: any) {
        if (!cancelled) setStatus(err?.message ?? 'Error');
      }
    };

    connect();
    return () => {
      cancelled = true;
      socketRef.current?.disconnect(true);
    };
  }, []);

  const hand: HandState | null = state?.hand ?? null;
  const you = useMemo(() => {
    if (!hand || !playerId) return null;
    return hand.players.find((p: PlayerInHand) => p.id === playerId);
  }, [hand, playerId]);
  const seated = useMemo(() => {
    if (!playerId) return false;
    return Boolean(state?.seats?.some((s: any) => s && s.id === playerId));
  }, [state, playerId]);

  const isMyTurn = hand && you && hand.phase === 'betting' && hand.actionOnSeat === you.seat;
  const discardPending = hand && you && hand.phase === 'discard' && hand.discardPending.includes(you.id);
  const toCall = hand && you ? Math.max(0, hand.currentBet - you.betThisStreet) : 0;

  const send = (msg: ClientMessage) => {
    const socket = socketRef.current;
    const matchId = matchIdRef.current;
    if (!socket || !matchId) return;
    socket.sendMatchState(matchId, OpCode.ClientMessage, JSON.stringify(msg));
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
              <CardView key={idx} card={c} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {hand.players.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: p.id === playerId ? '#1f2a44' : '#162040',
                  border: hand.actionOnSeat === p.seat && hand.phase === 'betting' ? '2px solid #10b981' : '1px solid #2c3e66',
                }}
              >
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div>Seat {p.seat}</div>
                <div>Status: {p.status}</div>
                <div>Stack: {p.stack}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {p.holeCards.map((c, idx) => (
                    <CardView key={idx} card={c} />
                  ))}
                </div>
              </div>
            ))}
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
        </div>
      ) : (
        <p>{seated ? 'Waiting for next hand...' : 'Waiting for hand...'}</p>
      )}
    </div>
  );
};

const CardView = ({ card }: { card: Card }) => (
  <div
    style={{
      width: 36,
      height: 52,
      borderRadius: 6,
      border: '1px solid #2c3e66',
      background: '#111827',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
    }}
  >
    {card.rank}
    {card.suit}
  </div>
);

export default Home;
