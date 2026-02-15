import { z } from 'zod';

export const PDH_PROTOCOL_VERSION = 1 as const;
export const TABLE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' as const;
export const TABLE_CODE_LENGTH = 6 as const;
const TABLE_CODE_REGEX = new RegExp(`^[${TABLE_CODE_ALPHABET}]{${TABLE_CODE_LENGTH}}$`);

export function normalizeTableCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

export function isValidTableCodeFormat(code: string): boolean {
  return TABLE_CODE_REGEX.test(code);
}

export function generateTableCode(random: () => number = Math.random): string {
  let value = '';
  for (let i = 0; i < TABLE_CODE_LENGTH; i += 1) {
    const raw = random();
    const normalized = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999999) : 0;
    const index = Math.floor(normalized * TABLE_CODE_ALPHABET.length);
    value += TABLE_CODE_ALPHABET[index];
  }
  return value;
}

export enum MatchOpCode {
  ClientMessage = 1,
  ServerMessage = 2,
}

const clientActionSchema = z.enum(['fold', 'check', 'call', 'bet', 'raise', 'allIn']);
const seqSchema = z.number().int().positive();

const versionedMessage = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({
      v: z.literal(PDH_PROTOCOL_VERSION).optional(),
      ...shape,
    })
    .strict();

const joinClientMessageSchema = versionedMessage({
  type: z.literal('join'),
  name: z.string().trim().min(1),
  seat: z.number().int().min(0).optional(),
  buyIn: z.number().finite().positive(),
});

const reconnectClientMessageSchema = versionedMessage({
  type: z.literal('reconnect'),
  playerId: z.string().min(1),
});

const actionClientMessageSchema = versionedMessage({
  type: z.literal('action'),
  action: clientActionSchema,
  amount: z.number().finite().optional(),
  seq: seqSchema.optional(),
});

const discardClientMessageSchema = versionedMessage({
  type: z.literal('discard'),
  index: z.number().int().min(0),
  seq: seqSchema.optional(),
});

const nextHandClientMessageSchema = versionedMessage({
  type: z.literal('nextHand'),
  seq: seqSchema.optional(),
});

const requestStateClientMessageSchema = versionedMessage({
  type: z.literal('requestState'),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  joinClientMessageSchema,
  reconnectClientMessageSchema,
  actionClientMessageSchema,
  discardClientMessageSchema,
  nextHandClientMessageSchema,
  requestStateClientMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type MutatingClientMessage = Extract<
  ClientMessage,
  { type: 'action' | 'discard' | 'nextHand' }
>;

const publicStateSchema = z
  .object({
    id: z.string().min(1),
    seats: z.array(z.any().nullable()),
    buttonSeat: z.number().int(),
    hand: z.any().nullable(),
    log: z.array(z.any()),
    you: z.object({
      playerId: z.string().min(1),
    }),
  })
  .strict();

export type PublicState = z.infer<typeof publicStateSchema>;

const welcomeServerMessageSchema = versionedMessage({
  type: z.literal('welcome'),
  playerId: z.string().min(1),
  tableId: z.string().min(1),
});

const stateServerMessageSchema = versionedMessage({
  type: z.literal('state'),
  state: publicStateSchema,
});

const errorServerMessageSchema = versionedMessage({
  type: z.literal('error'),
  message: z.string().min(1),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  welcomeServerMessageSchema,
  stateServerMessageSchema,
  errorServerMessageSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

type VersionedMessage = { v?: number };

export function withProtocolVersion<T extends VersionedMessage>(message: T): T & { v: number } {
  if (message.v === undefined) {
    return { ...message, v: PDH_PROTOCOL_VERSION };
  }
  return message as T & { v: number };
}

function formatSchemaError(error: z.ZodError) {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function parseClientMessagePayload(value: unknown): ClientMessage {
  const parsed = clientMessageSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid client message: ${formatSchemaError(parsed.error)}`);
  }
  return withProtocolVersion(parsed.data);
}

export function parseServerMessagePayload(value: unknown): ServerMessage {
  const parsed = serverMessageSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid server message: ${formatSchemaError(parsed.error)}`);
  }
  return withProtocolVersion(parsed.data);
}

export function isClientMessage(value: unknown): value is ClientMessage {
  return clientMessageSchema.safeParse(value).success;
}

export function isServerMessage(value: unknown): value is ServerMessage {
  return serverMessageSchema.safeParse(value).success;
}

export function isMutatingClientMessage(message: ClientMessage): message is MutatingClientMessage {
  return message.type === 'action' || message.type === 'discard' || message.type === 'nextHand';
}
