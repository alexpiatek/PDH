import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { PokerTable } from '@pdh/engine';
import { ClientMessage, ServerMessage } from './protocol';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const table = new PokerTable('main');
const clients = new Map<WebSocket, { playerId: string }>();
const START_COUNTDOWN_MS = 8000;
let startCountdownTimer: NodeJS.Timeout | null = null;
let startCountdownUntil: number | null = null;

const wss = new WebSocketServer({ port: PORT });
console.log(`WebSocket server listening on ws://localhost:${PORT}`);

function send(ws: WebSocket, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

function broadcast() {
  for (const [ws, ctx] of clients.entries()) {
    const state = table.getPublicState(ctx.playerId);
    send(ws, { type: 'state', state: { ...state, you: { playerId: ctx.playerId } } });
  }
}

function seatedReadyCount() {
  return table.state.seats.filter((s) => s && s.stack > 0 && !s.sittingOut).length;
}

function clearStartCountdown() {
  if (startCountdownTimer) {
    clearTimeout(startCountdownTimer);
    startCountdownTimer = null;
  }
  startCountdownUntil = null;
}

function scheduleStartCountdown() {
  clearStartCountdown();
  startCountdownUntil = Date.now() + START_COUNTDOWN_MS;
  startCountdownTimer = setTimeout(() => {
    startCountdownTimer = null;
    startCountdownUntil = null;
    if (!table.state.hand && seatedReadyCount() >= 2) {
      table.startHand();
      broadcast();
    }
  }, START_COUNTDOWN_MS);
}

function seatPlayer(name: string, buyIn: number, desiredSeat?: number) {
  const playerId = randomUUID();
  const seatIndex =
    desiredSeat !== undefined
      ? desiredSeat
      : table.state.seats.findIndex((s) => s === null);
  if (seatIndex === -1) throw new Error('No open seats');
  table.seatPlayer(seatIndex, { id: playerId, name, stack: buyIn });
  if (!table.state.hand) {
    if (seatedReadyCount() >= 2) {
      scheduleStartCountdown();
    } else {
      clearStartCountdown();
    }
  }
  return { playerId, seatIndex };
}

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

function isNameTaken(name: string) {
  const target = normalizeName(name);
  if (!target) return false;
  return table.state.seats.some((s) => s && normalizeName(s.name) === target);
}

function handleMessage(ws: WebSocket, raw: ClientMessage) {
  const ctx = clients.get(ws);
  try {
    switch (raw.type) {
      case 'join': {
        const trimmedName = raw.name?.trim();
        if (!trimmedName) {
          throw new Error('Name required. Please enter a player name.');
        }
        if (isNameTaken(trimmedName)) {
          throw new Error('Name already taken. Please enter a different name.');
        }
        const { playerId, seatIndex } = seatPlayer(trimmedName, raw.buyIn, raw.seat);
        clients.set(ws, { playerId });
        send(ws, { type: 'welcome', playerId, tableId: table.state.id });
        broadcast();
        break;
      }
      case 'reconnect': {
        clients.set(ws, { playerId: raw.playerId });
        send(ws, { type: 'welcome', playerId: raw.playerId, tableId: table.state.id });
        broadcast();
        break;
      }
      case 'action': {
        if (!ctx) throw new Error('Join first');
        table.applyAction(ctx.playerId, {
          type: raw.action as any,
          amount: raw.amount,
        });
        broadcast();
        break;
      }
      case 'discard': {
        if (!ctx) throw new Error('Join first');
        table.applyDiscard(ctx.playerId, raw.index);
        broadcast();
        break;
      }
      case 'nextHand': {
        if (!ctx) throw new Error('Join first');
        table.advanceToNextHand();
        broadcast();
        break;
      }
      case 'requestState': {
        if (!ctx) throw new Error('Join first');
        const state = table.getPublicState(ctx.playerId);
        send(ws, { type: 'state', state: { ...state, you: { playerId: ctx.playerId } } });
        break;
      }
      default:
        throw new Error('Unknown message');
    }
  } catch (err: any) {
    send(ws, { type: 'error', message: err.message ?? 'error' });
  }
}

wss.on('connection', (ws) => {
  clients.set(ws, { playerId: randomUUID() });
  send(ws, { type: 'welcome', playerId: clients.get(ws)!.playerId, tableId: table.state.id });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ClientMessage;
      handleMessage(ws, msg);
    } catch (err: any) {
      send(ws, { type: 'error', message: 'Invalid payload' });
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
  });
});

setInterval(() => {
  const before = JSON.stringify(table.state.hand?.discardPending ?? []);
  table.autoDiscard();
  const after = JSON.stringify(table.state.hand?.discardPending ?? []);
  if (before !== after) {
    broadcast();
  }
}, 500);
