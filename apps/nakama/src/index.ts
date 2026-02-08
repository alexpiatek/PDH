import type * as nkruntime from '@heroiclabs/nakama-runtime';
import { PokerTable } from '@pdh/engine';
import type { ClientMessage, ServerMessage } from './protocol';

const enum OpCode {
  ClientMessage = 1,
  ServerMessage = 2,
}

const AUTO_DISCARD_INTERVAL_MS = 500;

interface MatchState {
  table: PokerTable;
  presences: Record<string, nkruntime.Presence>;
  lastAutoDiscardMs: number;
}

function sendToPresence(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  msg: ServerMessage
) {
  dispatcher.broadcastMessage(OpCode.ServerMessage, JSON.stringify(msg), [presence], null, true);
}

function broadcastState(dispatcher: nkruntime.MatchDispatcher, state: MatchState) {
  const presences = Object.values(state.presences);
  for (const presence of presences) {
    const playerId = presence.userId;
    const publicState = state.table.getPublicState(playerId);
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

const InitModule: nkruntime.InitModule = (ctx, logger, nk, initializer) => {
  initializer.registerMatch('pdh', {
    matchInit: (ctx, logger, nk, params) => {
      const tableId = (params?.tableId as string | undefined) ?? 'main';
      const state: MatchState = {
        table: new PokerTable(tableId),
        presences: {},
        lastAutoDiscardMs: 0,
      };
      return {
        state,
        tickRate: 10,
        label: JSON.stringify({ tableId }),
      };
    },
    matchJoinAttempt: (ctx, logger, nk, dispatcher, tick, state, presence, metadata) => {
      return { state, accept: true };
    },
    matchJoin: (ctx, logger, nk, dispatcher, tick, state, presences) => {
      for (const presence of presences) {
        state.presences[presence.userId] = presence;
        state.table.setSittingOut(presence.userId, false);
        sendToPresence(dispatcher, presence, {
          type: 'welcome',
          playerId: presence.userId,
          tableId: state.table.state.id,
        });
      }
      broadcastState(dispatcher, state);
      return { state };
    },
    matchLeave: (ctx, logger, nk, dispatcher, tick, state, presences) => {
      for (const presence of presences) {
        delete state.presences[presence.userId];
        state.table.handleDisconnect(presence.userId);
      }
      broadcastState(dispatcher, state);
      return { state };
    },
    matchLoop: (ctx, logger, nk, dispatcher, tick, state, messages) => {
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
              seatPlayer(state.table, presence.userId, data.name, data.buyIn, data.seat);
              state.table.setSittingOut(presence.userId, false);
              sendToPresence(dispatcher, presence, {
                type: 'welcome',
                playerId: presence.userId,
                tableId: state.table.state.id,
              });
              shouldBroadcast = true;
              break;
            }
            case 'reconnect': {
              state.table.setSittingOut(presence.userId, false);
              sendToPresence(dispatcher, presence, {
                type: 'welcome',
                playerId: presence.userId,
                tableId: state.table.state.id,
              });
              shouldBroadcast = true;
              break;
            }
            case 'action': {
              state.table.applyAction(presence.userId, {
                type: data.action as any,
                amount: data.amount,
              });
              shouldBroadcast = true;
              break;
            }
            case 'discard': {
              state.table.applyDiscard(presence.userId, data.index);
              shouldBroadcast = true;
              break;
            }
            case 'nextHand': {
              state.table.advanceToNextHand();
              shouldBroadcast = true;
              break;
            }
            case 'requestState': {
              const publicState = state.table.getPublicState(presence.userId);
              sendToPresence(dispatcher, presence, {
                type: 'state',
                state: { ...publicState, you: { playerId: presence.userId } },
              });
              break;
            }
            default:
              throw new Error('Unknown message');
          }
          state.table.beginNextHandIfReady();
        } catch (err: any) {
          sendToPresence(dispatcher, presence, {
            type: 'error',
            message: err?.message ?? 'error',
          });
        }
      }

      const now = Date.now();
      if (!state.lastAutoDiscardMs) state.lastAutoDiscardMs = now;
      if (now - state.lastAutoDiscardMs >= AUTO_DISCARD_INTERVAL_MS) {
        const before = JSON.stringify(state.table.state.hand?.discardPending ?? []);
        state.table.autoDiscard();
        const after = JSON.stringify(state.table.state.hand?.discardPending ?? []);
        if (before !== after) {
          shouldBroadcast = true;
        }
        if (!state.table.state.hand) {
          state.table.beginNextHandIfReady();
          if (state.table.state.hand) {
            shouldBroadcast = true;
          }
        }
        state.lastAutoDiscardMs = now;
      }

      if (shouldBroadcast) {
        broadcastState(dispatcher, state);
      }

      return { state };
    },
    matchTerminate: (ctx, logger, nk, dispatcher, tick, state, graceSeconds) => {
      return { state };
    },
    matchSignal: (ctx, logger, nk, dispatcher, tick, state, data) => {
      return { state, data: 'ok' };
    },
  });

  logger.info('PDH Nakama module loaded');
};

globalThis.InitModule = InitModule;
