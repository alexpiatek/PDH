import type * as nkruntime from '@heroiclabs/nakama-runtime';
import { PokerTable, type TableState } from '@pdh/engine';
import type { ClientMessage, ServerMessage } from './protocol';

const enum OpCode {
  ClientMessage = 1,
  ServerMessage = 2,
}

const AUTO_DISCARD_INTERVAL_MS = 500;
export const DEFAULT_TABLE_ID = 'main';
export const DEFAULT_MATCH_MODULE = 'pdh';

interface MatchState {
  table: TableState;
  presences: Record<string, nkruntime.Presence>;
  lastAutoDiscardMs: number;
}

function hydrateTable(tableState: TableState): PokerTable {
  const table = new PokerTable(tableState.id);
  table.state = tableState;
  return table;
}

function sendToPresence(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  msg: ServerMessage
) {
  dispatcher.broadcastMessage(OpCode.ServerMessage, JSON.stringify(msg), [presence], null, true);
}

function broadcastState(dispatcher: nkruntime.MatchDispatcher, state: MatchState) {
  const table = hydrateTable(state.table);
  const presences = Object.values(state.presences);
  for (const presence of presences) {
    const playerId = presence.userId;
    const publicState = table.getPublicState(playerId);
    const msg: ServerMessage = {
      type: 'state',
      state: { ...publicState, you: { playerId } },
    };
    dispatcher.broadcastMessage(OpCode.ServerMessage, JSON.stringify(msg), [presence], null, true);
  }
}

function seatPlayer(table: PokerTable, playerId: string, name: string, buyIn: number, desiredSeat?: number) {
  const alreadySeated = table.state.seats.some((seat) => seat && seat.id === playerId);
  if (alreadySeated) {
    throw new Error('Already seated');
  }
  const seatIndex =
    desiredSeat !== undefined ? desiredSeat : table.state.seats.findIndex((seat) => seat === null);
  if (seatIndex < 0) throw new Error('No open seats');
  table.seatPlayer(seatIndex, { id: playerId, name, stack: buyIn });
  table.beginNextHandIfReady();
  return { seatIndex };
}

function parseClientMessage(nk: nkruntime.Nakama, message: nkruntime.MatchMessage): ClientMessage {
  const data = nk.binaryToString(message.data);
  return JSON.parse(data) as ClientMessage;
}

export function findExistingAuthoritativeMatchId(
  nk: nkruntime.Nakama,
  tableId: string
): string | null {
  const label = JSON.stringify({ tableId });
  const matches = nk.matchList(100, true, '', 0, 9, '') ?? [];
  for (const match of matches) {
    if (match.label !== label) {
      continue;
    }
    const matchId =
      (typeof match.matchId === 'string' ? match.matchId : undefined) ??
      (typeof match.match_id === 'string' ? match.match_id : undefined);
    if (matchId) return matchId;
  }
  return null;
}

export function ensureDefaultMatch(nk: nkruntime.Nakama): string {
  const existing = findExistingAuthoritativeMatchId(nk, DEFAULT_TABLE_ID);
  if (existing) {
    return existing;
  }
  return nk.matchCreate(DEFAULT_MATCH_MODULE, { tableId: DEFAULT_TABLE_ID });
}

export function ensureDefaultMatchAfterAuthenticate(
  ctx: unknown,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama
) {
  try {
    ensureDefaultMatch(nk);
  } catch (err: any) {
    logger.error('Failed to ensure default authoritative match: %v', err?.message ?? err);
  }
}

function matchInit(ctx, logger, nk, params) {
  const tableId = (params?.tableId as string | undefined) ?? DEFAULT_TABLE_ID;
  const table = new PokerTable(tableId);
  const state: MatchState = {
    table: table.state,
    presences: {},
    lastAutoDiscardMs: 0,
  };
  return {
    state,
    tickRate: 10,
    label: JSON.stringify({ tableId }),
  };
}

function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  return { state, accept: true };
}

function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  const table = hydrateTable(state.table);
  for (const presence of presences) {
    state.presences[presence.userId] = presence;
    table.setSittingOut(presence.userId, false);
    sendToPresence(dispatcher, presence, {
      type: 'welcome',
      playerId: presence.userId,
      tableId: table.state.id,
    });
  }
  state.table = table.state;
  broadcastState(dispatcher, state);
  return { state };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  const table = hydrateTable(state.table);
  for (const presence of presences) {
    delete state.presences[presence.userId];
    table.handleDisconnect(presence.userId);
  }
  state.table = table.state;
  broadcastState(dispatcher, state);
  return { state };
}

function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  const table = hydrateTable(state.table);
  let shouldBroadcast = false;

  for (const message of messages) {
    if (message.opCode !== OpCode.ClientMessage) continue;

    const presence = message.sender;
    let data: ClientMessage;
    try {
      data = parseClientMessage(nk, message);
    } catch (err) {
      sendToPresence(dispatcher, presence, { type: 'error', message: 'Invalid payload' });
      continue;
    }

    try {
      switch (data.type) {
        case 'join': {
          seatPlayer(table, presence.userId, data.name, data.buyIn, data.seat);
          table.setSittingOut(presence.userId, false);
          sendToPresence(dispatcher, presence, {
            type: 'welcome',
            playerId: presence.userId,
            tableId: table.state.id,
          });
          shouldBroadcast = true;
          break;
        }
        case 'reconnect': {
          table.setSittingOut(presence.userId, false);
          sendToPresence(dispatcher, presence, {
            type: 'welcome',
            playerId: presence.userId,
            tableId: table.state.id,
          });
          shouldBroadcast = true;
          break;
        }
        case 'action': {
          table.applyAction(presence.userId, {
            type: data.action as any,
            amount: data.amount,
          });
          shouldBroadcast = true;
          break;
        }
        case 'discard': {
          table.applyDiscard(presence.userId, data.index);
          shouldBroadcast = true;
          break;
        }
        case 'nextHand': {
          table.advanceToNextHand();
          shouldBroadcast = true;
          break;
        }
        case 'requestState': {
          const publicState = table.getPublicState(presence.userId);
          sendToPresence(dispatcher, presence, {
            type: 'state',
            state: { ...publicState, you: { playerId: presence.userId } },
          });
          break;
        }
        default:
          throw new Error('Unknown message');
      }
      table.beginNextHandIfReady();
    } catch (err: any) {
      sendToPresence(dispatcher, presence, {
        type: 'error',
        message: err?.message ?? 'error',
      });
    }
  }

  const now = Date.now();
  const advanced = table.advancePendingPhase(now);
  if (advanced) {
    shouldBroadcast = true;
  }

  if (!state.lastAutoDiscardMs) state.lastAutoDiscardMs = now;
  if (now - state.lastAutoDiscardMs >= AUTO_DISCARD_INTERVAL_MS) {
    const before = JSON.stringify(table.state.hand?.discardPending ?? []);
    table.autoDiscard(now);
    const after = JSON.stringify(table.state.hand?.discardPending ?? []);
    if (before !== after) {
      shouldBroadcast = true;
    }
    if (!table.state.hand) {
      table.beginNextHandIfReady();
      if (table.state.hand) {
        shouldBroadcast = true;
      }
    }
    state.lastAutoDiscardMs = now;
  }

  state.table = table.state;
  if (shouldBroadcast) {
    broadcastState(dispatcher, state);
  }

  return { state };
}

function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return { state };
}

function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  return { state, data: 'ok' };
}

export const pdhMatchHandler = {
  matchInit,
  matchJoinAttempt,
  matchJoin,
  matchLeave,
  matchLoop,
  matchTerminate,
  matchSignal,
};

(globalThis as any).matchInit = matchInit;
(globalThis as any).matchJoinAttempt = matchJoinAttempt;
(globalThis as any).matchJoin = matchJoin;
(globalThis as any).matchLeave = matchLeave;
(globalThis as any).matchLoop = matchLoop;
(globalThis as any).matchTerminate = matchTerminate;
(globalThis as any).matchSignal = matchSignal;
(globalThis as any).ensureDefaultMatchAfterAuthenticate = ensureDefaultMatchAfterAuthenticate;
