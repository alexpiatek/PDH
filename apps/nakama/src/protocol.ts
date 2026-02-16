import type {
  ClientMessage as SharedClientMessage,
  MutatingClientMessage as SharedMutatingClientMessage,
  PublicState as SharedPublicState,
  ServerMessage as SharedServerMessage,
} from '@pdh/protocol';

export const PDH_PROTOCOL_VERSION = 1 as const;
export const TABLE_REACTIONS = ['gg', 'wow', 'nice', 'oops', 'fire'] as const;
export const TABLE_CHAT_MAX_LENGTH = 140 as const;

export enum MatchOpCode {
  ClientMessage = 1,
  ServerMessage = 2,
}

export type ClientMessage = SharedClientMessage;
export type MutatingClientMessage = SharedMutatingClientMessage;
export type ServerMessage = SharedServerMessage;
export type PublicState = SharedPublicState;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function hasValidOptionalSequence(value: Record<string, unknown>): boolean {
  return value.seq === undefined || isPositiveInt(value.seq);
}

function hasSupportedVersion(value: Record<string, unknown>): boolean {
  return value.v === undefined || value.v === PDH_PROTOCOL_VERSION;
}

export function withProtocolVersion<T extends { v?: number }>(message: T): T & { v: number } {
  if (message.v === undefined) {
    return { ...message, v: PDH_PROTOCOL_VERSION };
  }
  return message as T & { v: number };
}

export function isMutatingClientMessage(message: ClientMessage): message is MutatingClientMessage {
  return message.type === 'action' || message.type === 'discard' || message.type === 'nextHand';
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isObject(value) || typeof value.type !== 'string') return false;
  if (!hasSupportedVersion(value)) return false;

  switch (value.type) {
    case 'join':
      return (
        typeof value.name === 'string' &&
        value.name.trim().length > 0 &&
        isFiniteNumber(value.buyIn) &&
        value.buyIn > 0 &&
        (value.seat === undefined || (Number.isInteger(value.seat) && Number(value.seat) >= 0))
      );
    case 'reconnect':
      return typeof value.playerId === 'string' && value.playerId.length > 0;
    case 'action':
      return (
        ['fold', 'check', 'call', 'bet', 'raise', 'allIn'].includes(String(value.action)) &&
        (value.amount === undefined || isFiniteNumber(value.amount)) &&
        hasValidOptionalSequence(value)
      );
    case 'discard':
      return (
        Number.isInteger(value.index) &&
        Number(value.index) >= 0 &&
        hasValidOptionalSequence(value)
      );
    case 'nextHand':
      return hasValidOptionalSequence(value);
    case 'reaction':
      return (
        typeof value.emoji === 'string' &&
        TABLE_REACTIONS.includes(value.emoji as (typeof TABLE_REACTIONS)[number])
      );
    case 'chat':
      return (
        typeof value.message === 'string' &&
        value.message.trim().length > 0 &&
        value.message.trim().length <= TABLE_CHAT_MAX_LENGTH
      );
    case 'requestState':
      return true;
    default:
      return false;
  }
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isObject(value) || typeof value.type !== 'string') return false;
  if (!hasSupportedVersion(value)) return false;

  switch (value.type) {
    case 'welcome':
      return (
        typeof value.playerId === 'string' &&
        value.playerId.length > 0 &&
        typeof value.tableId === 'string' &&
        value.tableId.length > 0
      );
    case 'state':
      return isObject(value.state);
    case 'error':
      return typeof value.message === 'string' && value.message.length > 0;
    case 'reaction':
      return (
        typeof value.playerId === 'string' &&
        value.playerId.length > 0 &&
        typeof value.emoji === 'string' &&
        TABLE_REACTIONS.includes(value.emoji as (typeof TABLE_REACTIONS)[number]) &&
        Number.isInteger(value.ts) &&
        Number(value.ts) >= 0
      );
    case 'chat':
      return (
        typeof value.playerId === 'string' &&
        value.playerId.length > 0 &&
        typeof value.message === 'string' &&
        value.message.trim().length > 0 &&
        value.message.trim().length <= TABLE_CHAT_MAX_LENGTH &&
        Number.isInteger(value.ts) &&
        Number(value.ts) >= 0
      );
    default:
      return false;
  }
}

export function parseClientMessagePayload(value: unknown): ClientMessage {
  if (!isClientMessage(value)) {
    throw new Error('Invalid payload');
  }
  return withProtocolVersion(value);
}

export function parseServerMessagePayload(value: unknown): ServerMessage {
  if (!isServerMessage(value)) {
    throw new Error('Invalid payload');
  }
  return withProtocolVersion(value);
}
