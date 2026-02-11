import type { Card, HandState, PlayerInHand, TableState } from './types';

export const PROTOCOL_VERSION = 1 as const;

export const MatchOpCode = {
  ClientMessage: 1,
  ServerMessage: 2,
} as const;

export type MatchOpCodeValue = (typeof MatchOpCode)[keyof typeof MatchOpCode];

export type ProtocolErrorCode =
  | 'INVALID_PAYLOAD'
  | 'NAME_REQUIRED'
  | 'NAME_TAKEN'
  | 'NO_OPEN_SEATS'
  | 'JOIN_REQUIRED'
  | 'INVALID_ACTION'
  | 'INTERNAL';

export type ClientActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn';

type ClientMessageBase = { protocolVersion?: number };

export type ClientMessage = ClientMessageBase &
  (
    | { type: 'join'; name: string; seat?: number; buyIn: number }
    | { type: 'reconnect'; playerId: string }
    | { type: 'action'; action: ClientActionType; amount?: number }
    | { type: 'discard'; index: number }
    | { type: 'nextHand' }
    | { type: 'requestState' }
  );

export interface HiddenCard {
  rank: 'X';
  suit: 'X';
}

export type PublicCard = Card | HiddenCard;
export type PublicPlayerInHand = Omit<PlayerInHand, 'holeCards'> & { holeCards: PublicCard[] };
export type PublicHandState = Omit<HandState, 'players' | 'deck' | 'auditLog'> & {
  players: PublicPlayerInHand[];
  deck: Card[];
};

export interface PublicState {
  id: string;
  seats: TableState['seats'];
  buttonSeat: number;
  hand: PublicHandState | null;
  log: HandState['log'];
  you: { playerId: string };
}

type ServerMessageBase = { protocolVersion?: number };

export type ServerMessage = ServerMessageBase &
  (
    | { type: 'welcome'; playerId: string; tableId: string }
    | { type: 'state'; state: PublicState }
    | { type: 'error'; code: ProtocolErrorCode; message: string }
  );

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isObject(value) || typeof value.type !== 'string') return false;
  if (
    value.protocolVersion !== undefined &&
    (!isFiniteNumber(value.protocolVersion) || value.protocolVersion < 1)
  ) {
    return false;
  }

  switch (value.type) {
    case 'join':
      return (
        typeof value.name === 'string' &&
        isFiniteNumber(value.buyIn) &&
        (value.seat === undefined || Number.isInteger(value.seat))
      );
    case 'reconnect':
      return typeof value.playerId === 'string';
    case 'action':
      return (
        ['fold', 'check', 'call', 'bet', 'raise', 'allIn'].includes(String(value.action)) &&
        (value.amount === undefined || isFiniteNumber(value.amount))
      );
    case 'discard':
      return Number.isInteger(value.index);
    case 'nextHand':
    case 'requestState':
      return true;
    default:
      return false;
  }
}
