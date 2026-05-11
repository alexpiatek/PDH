import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { PokerTable } from '@pdh/engine';
import { TABLE_CHAT_MAX_LENGTH } from '@pdh/protocol';
import {
  parseClientMessagePayload,
  withProtocolVersion,
  type ClientMessage,
  type ServerMessage,
} from './protocol';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const AUDIT_LOG_TOKEN = process.env.AUDIT_LOG_TOKEN || '';
const table = new PokerTable('main');
const clients = new Map<WebSocket, { playerId: string }>();
const lastReactionAtByPlayer = new Map<string, number>();
const lastChatAtByPlayer = new Map<string, number>();
const REACTION_COOLDOWN_MS = 2500;
const CHAT_COOLDOWN_MS = 800;
const DEFAULT_LEGACY_BUY_IN = 10000;

function advanceToNextHandFromClient(raw: Extract<ClientMessage, { type: 'nextHand' }>) {
  const hand = table.state.hand;
  if (raw.handId && (!hand || hand.handId !== raw.handId)) {
    console.log(
      JSON.stringify({
        event: 'legacy.next_hand.stale_ignored',
        requestedHandId: raw.handId,
        currentHandId: hand?.handId ?? null,
        currentPhase: hand?.phase ?? null,
      })
    );
    return false;
  }
  table.advanceToNextHand();
  return true;
}

const server = createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }
  if (req.url.startsWith('/admin/audit-log')) {
    const remoteAddr = req.socket.remoteAddress ?? '';
    const isLocal =
      remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
    if (!isLocal) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    if (!AUDIT_LOG_TOKEN) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      res.end('Method Not Allowed');
      return;
    }
    const tokenHeader = req.headers['x-audit-token'];
    const authHeader = req.headers.authorization;
    const token =
      typeof tokenHeader === 'string'
        ? tokenHeader
        : Array.isArray(tokenHeader)
          ? tokenHeader[0]
          : undefined;
    const bearer =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : undefined;
    const provided = token || bearer;
    if (!provided || provided !== AUDIT_LOG_TOKEN) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ hands: table.state.auditHands ?? [] }));
    return;
  }
  res.statusCode = 404;
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });
server.listen(PORT, () => {
  console.log(`WebSocket server listening on ws://localhost:${PORT}`);
});

function send(ws: WebSocket, msg: ServerMessage) {
  ws.send(JSON.stringify(withProtocolVersion(msg)));
}

function broadcastServerMessage(msg: ServerMessage) {
  for (const [ws] of clients.entries()) {
    send(ws, msg);
  }
}

function broadcast() {
  for (const [ws, ctx] of clients.entries()) {
    const state = table.getPublicState(ctx.playerId);
    send(ws, { type: 'state', state: { ...state, you: { playerId: ctx.playerId } } });
  }
}

function seatPlayer(name: string, desiredSeat?: number) {
  const playerId = randomUUID();
  const seatIndex =
    desiredSeat !== undefined ? desiredSeat : table.state.seats.findIndex((s) => s === null);
  if (seatIndex === -1) throw new Error('No open seats');
  table.seatPlayer(seatIndex, { id: playerId, name, stack: DEFAULT_LEGACY_BUY_IN });
  table.beginNextHandIfReady();
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
        const { playerId, seatIndex } = seatPlayer(trimmedName, raw.seat);
        clients.set(ws, { playerId });
        send(ws, { type: 'welcome', playerId, tableId: table.state.id });
        broadcast();
        break;
      }
      case 'reconnect': {
        if (!ctx || ctx.playerId !== raw.playerId) {
          throw new Error('Reconnect unavailable on legacy server');
        }
        table.setSittingOut(raw.playerId, false);
        table.beginNextHandIfReady();
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
        if (advanceToNextHandFromClient(raw)) {
          broadcast();
        }
        break;
      }
      case 'rebuy': {
        if (!ctx) throw new Error('Join first');
        table.rebuy(ctx.playerId, DEFAULT_LEGACY_BUY_IN);
        broadcast();
        break;
      }
      case 'sitOut': {
        if (!ctx) throw new Error('Join first');
        table.sitOut(ctx.playerId);
        broadcast();
        break;
      }
      case 'readyForHand': {
        if (!ctx) throw new Error('Join first');
        table.setReadyForHand(ctx.playerId, raw.ready);
        table.advanceStartGate();
        broadcast();
        break;
      }
      case 'reaction': {
        if (!ctx) throw new Error('Join first');
        const now = Date.now();
        const last = lastReactionAtByPlayer.get(ctx.playerId) ?? 0;
        if (now - last < REACTION_COOLDOWN_MS) {
          throw new Error('Reaction cooldown active');
        }
        lastReactionAtByPlayer.set(ctx.playerId, now);
        broadcastServerMessage({
          type: 'reaction',
          playerId: ctx.playerId,
          emoji: raw.emoji,
          ts: now,
        });
        break;
      }
      case 'chat': {
        if (!ctx) throw new Error('Join first');
        const text = raw.message.trim().replace(/\s+/g, ' ').slice(0, TABLE_CHAT_MAX_LENGTH);
        if (!text) {
          throw new Error('Chat message cannot be empty');
        }
        const now = Date.now();
        const last = lastChatAtByPlayer.get(ctx.playerId) ?? 0;
        if (now - last < CHAT_COOLDOWN_MS) {
          throw new Error('Chat cooldown active');
        }
        lastChatAtByPlayer.set(ctx.playerId, now);
        broadcastServerMessage({
          type: 'chat',
          playerId: ctx.playerId,
          message: text,
          ts: now,
        });
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
      const msg = parseClientMessagePayload(JSON.parse(data.toString())) as ClientMessage;
      handleMessage(ws, msg);
    } catch (err: any) {
      send(ws, { type: 'error', message: 'Invalid payload' });
    }
  });
  ws.on('close', () => {
    const ctx = clients.get(ws);
    if (ctx) {
      lastReactionAtByPlayer.delete(ctx.playerId);
      lastChatAtByPlayer.delete(ctx.playerId);
      table.handleDisconnect(ctx.playerId);
      broadcast();
    }
    clients.delete(ws);
  });
});

setInterval(() => {
  const startGateBefore = JSON.stringify(table.state.startGate);
  const startedFromGate = table.advanceStartGate();
  const advanced = table.advancePendingPhase();
  const autoAction = table.autoAction();
  const before = JSON.stringify(table.state.hand?.discardPending ?? []);
  table.autoDiscard();
  const after = JSON.stringify(table.state.hand?.discardPending ?? []);
  const startGateAfter = JSON.stringify(table.state.startGate);
  if (startedFromGate || startGateBefore !== startGateAfter || advanced || autoAction || before !== after) {
    broadcast();
  }
}, 500);
