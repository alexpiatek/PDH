import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client as NakamaClient } from '@heroiclabs/nakama-js';
import type {
  MatchData,
  Session,
  Socket as NakamaSocket,
  WebSocketAdapter,
} from '@heroiclabs/nakama-js';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const enum MatchOpCode {
  ClientMessage = 1,
  ServerMessage = 2,
}

interface SeatState {
  seat: number;
  id: string;
  name: string;
  stack: number;
  sittingOut?: boolean;
}

interface HandPlayerState {
  seat: number;
  id: string;
  name: string;
  stack: number;
  betThisStreet: number;
}

interface HandState {
  handId: string;
  street: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  phase: 'betting' | 'discard' | 'showdown' | 'complete';
  actionOnSeat: number;
  currentBet: number;
  players: HandPlayerState[];
}

interface PublicState {
  id: string;
  seats: Array<SeatState | null>;
  hand: HandState | null;
  you: { playerId: string };
}

type ClientMessage =
  | { type: 'join'; name: string; seat?: number; buyIn: number }
  | {
      type: 'action';
      action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn';
      amount?: number;
      seq?: number;
    }
  | { type: 'reconnect'; playerId: string }
  | { type: 'requestState' };

type ServerMessage =
  | { type: 'welcome'; playerId: string; tableId: string }
  | { type: 'state'; state: PublicState }
  | { type: 'error'; message: string };

interface TestClient {
  name: string;
  userId: string;
  deviceId: string;
  session: Session;
  client: NakamaClient;
  socket: NakamaSocket;
  latestState: PublicState | null;
  latestMatchId: string | null;
  errors: string[];
  allowDisconnect: boolean;
}

interface EnsureMatchRpcResult {
  tableId: string;
  module: string;
  matchId: string;
  created: boolean;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const ITEST_HOST = process.env.ITEST_NAKAMA_HOST ?? '127.0.0.1';
const ITEST_PORT = process.env.ITEST_NAKAMA_PORT ?? '17350';
const ITEST_USE_SSL = parseBoolean(process.env.ITEST_NAKAMA_USE_SSL, false);
const ITEST_SERVER_KEY = process.env.ITEST_NAKAMA_SERVER_KEY ?? 'dev_socket_server_key_change_me';
const ITEST_MATCH_MODULE = process.env.ITEST_NAKAMA_MATCH_MODULE ?? 'pdh';
const ITEST_MATCH_RPC_ID = process.env.ITEST_NAKAMA_MATCH_RPC_ID ?? 'pdh_ensure_match';
const ITEST_TIMEOUT_MS = parseInteger(process.env.ITEST_TIMEOUT_MS, 30000);

const createdClients: TestClient[] = [];

class NodeWebSocketAdapter implements WebSocketAdapter {
  onClose: ((evt: unknown) => void) | null = null;
  onError: ((evt: unknown) => void) | null = null;
  onMessage: ((message: unknown) => void) | null = null;
  onOpen: ((evt: unknown) => void) | null = null;
  private socket?: WebSocket;

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
  }

  connect(scheme: string, host: string, port: string, createStatus: boolean, token: string): void {
    const url = `${scheme}${host}:${port}/ws?lang=en&status=${encodeURIComponent(
      createStatus.toString()
    )}&token=${encodeURIComponent(token)}`;
    this.socket = new WebSocket(url);

    this.socket.on('open', () => {
      this.onOpen?.({ type: 'open' });
    });

    this.socket.on('error', (error) => {
      this.onError?.(error);
    });

    this.socket.on('close', (code, reason) => {
      this.onClose?.({ type: 'close', code, reason: reason.toString('utf8') });
    });

    this.socket.on('message', (data) => {
      try {
        const payloadText = typeof data === 'string' ? data : data.toString('utf8');
        const message = JSON.parse(payloadText) as Record<string, unknown>;

        const matchData = message.match_data as { data?: string } | undefined;
        if (matchData?.data) {
          message.match_data = {
            ...matchData,
            data: new Uint8Array(Buffer.from(matchData.data, 'base64')),
          };
        }

        this.onMessage?.(message);
      } catch (error) {
        this.onError?.(error);
      }
    });
  }

  send(message: Record<string, any>): void {
    if (!this.socket) {
      throw new Error('WebSocket is not connected');
    }

    const outbound = { ...message };
    const matchDataSend = outbound.match_data_send as
      | { op_code: number | string; data?: string | Uint8Array }
      | undefined;

    if (matchDataSend) {
      matchDataSend.op_code = matchDataSend.op_code.toString();
      if (matchDataSend.data instanceof Uint8Array) {
        matchDataSend.data = Buffer.from(matchDataSend.data).toString('base64');
      } else if (typeof matchDataSend.data === 'string') {
        matchDataSend.data = Buffer.from(matchDataSend.data, 'utf8').toString('base64');
      }
    }

    this.socket.send(JSON.stringify(outbound));
  }
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decodeServerMessage(data: string | Uint8Array): ServerMessage {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const text = textDecoder.decode(bytes);
  return JSON.parse(text) as ServerMessage;
}

function isServerMessage(matchData: MatchData | Record<string, unknown>) {
  const opCode = (matchData as any).op_code ?? (matchData as any).opCode;
  return Number(opCode) === MatchOpCode.ServerMessage;
}

function extractMatchId(matchData: MatchData | Record<string, unknown>) {
  return ((matchData as any).match_id ?? (matchData as any).matchId ?? null) as string | null;
}

function extractMatchPayloadData(matchData: MatchData | Record<string, unknown>) {
  const payload = (matchData as any).data;
  if (payload instanceof Uint8Array || typeof payload === 'string') {
    return payload;
  }
  if (Array.isArray(payload)) {
    return new Uint8Array(payload);
  }
  throw new Error('Match payload data missing');
}

function describeClientState(client: TestClient) {
  const hand = client.latestState?.hand;
  return {
    userId: client.userId,
    tableId: client.latestState?.id,
    phase: hand?.phase,
    street: hand?.street,
    actionOnSeat: hand?.actionOnSeat,
    errors: [...client.errors],
  };
}

async function waitFor(
  description: string,
  condition: () => boolean,
  timeoutMs = ITEST_TIMEOUT_MS,
  intervalMs = 80
) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    if (condition()) {
      return;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms`);
}

async function sendClientMessage(client: TestClient, matchId: string, msg: ClientMessage) {
  await client.socket.sendMatchState(
    matchId,
    MatchOpCode.ClientMessage,
    textEncoder.encode(JSON.stringify(msg))
  );
}

async function requestState(client: TestClient, matchId: string) {
  await sendClientMessage(client, matchId, { type: 'requestState' });
}

async function requestStateFromAll(clients: TestClient[], matchId: string) {
  await Promise.all(clients.map((client) => requestState(client, matchId)));
}

function nextActionSeq(seqByUser: Map<string, number>, userId: string) {
  const next = (seqByUser.get(userId) ?? 0) + 1;
  seqByUser.set(userId, next);
  return next;
}

function findClientByUserId(clients: TestClient[], userId: string) {
  const found = clients.find((client) => client.userId === userId);
  if (!found) {
    throw new Error(`Client not found for userId=${userId}`);
  }
  return found;
}

function handFrom(client: TestClient): HandState {
  const hand = client.latestState?.hand;
  if (!hand) {
    throw new Error(`No hand state for client=${client.name}`);
  }
  return hand;
}

async function advancePreflopToFlopBetting(
  clients: TestClient[],
  matchId: string,
  seqByUser: Map<string, number>
) {
  for (let i = 0; i < 64; i += 1) {
    await requestStateFromAll(clients, matchId);

    const hand = handFrom(clients[0]);
    if (hand.street === 'flop' && hand.phase === 'betting') {
      return;
    }

    if (hand.street !== 'preflop' || hand.phase !== 'betting') {
      await delay(100);
      continue;
    }

    const actor = hand.players.find((player) => player.seat === hand.actionOnSeat);
    if (!actor) {
      await delay(100);
      continue;
    }

    const actorClient = findClientByUserId(clients, actor.id);
    const toCall = Math.max(0, hand.currentBet - actor.betThisStreet);
    await sendClientMessage(actorClient, matchId, {
      type: 'action',
      action: toCall > 0 ? 'call' : 'check',
      seq: nextActionSeq(seqByUser, actorClient.userId),
    });
    await delay(80);
  }

  throw new Error(
    `Failed to advance to flop betting. states=${JSON.stringify(clients.map(describeClientState))}`
  );
}

function makeTestClient(name: string, userId: string, deviceId: string, session: Session) {
  const client = new NakamaClient(
    ITEST_SERVER_KEY,
    ITEST_HOST,
    ITEST_PORT,
    ITEST_USE_SSL,
    7000,
    false
  );
  const socket = client.createSocket(ITEST_USE_SSL, false, new NodeWebSocketAdapter());

  const context: TestClient = {
    name,
    userId,
    deviceId,
    session,
    client,
    socket,
    latestState: null,
    latestMatchId: null,
    errors: [],
    allowDisconnect: false,
  };

  socket.onmatchdata = (matchData: MatchData) => {
    if (!isServerMessage(matchData)) return;
    const message = decodeServerMessage(extractMatchPayloadData(matchData));
    if (message.type === 'state') {
      context.latestState = message.state;
      context.latestMatchId = extractMatchId(matchData);
      return;
    }
    if (message.type === 'error') {
      context.errors.push(message.message);
    }
  };

  socket.ondisconnect = () => {
    if (!context.allowDisconnect) {
      context.errors.push('socket disconnected unexpectedly');
    }
  };

  socket.onerror = (error) => {
    const rendered = typeof error === 'string' ? error : JSON.stringify(error);
    context.errors.push(`socket error: ${rendered}`);
  };

  return context;
}

async function connectClient(client: TestClient) {
  await client.socket.connect(client.session, true);
}

async function disconnectClient(client: TestClient) {
  client.allowDisconnect = true;
  try {
    await client.socket.disconnect(false);
  } catch {
    // Best effort disconnect during cleanup.
  }
}

async function reconnectClient(client: TestClient) {
  const replacement = client.client.createSocket(ITEST_USE_SSL, false, new NodeWebSocketAdapter());
  client.socket = replacement;
  client.allowDisconnect = false;

  replacement.onmatchdata = (matchData: MatchData) => {
    if (!isServerMessage(matchData)) return;
    const message = decodeServerMessage(extractMatchPayloadData(matchData));
    if (message.type === 'state') {
      client.latestState = message.state;
      client.latestMatchId = extractMatchId(matchData);
      return;
    }
    if (message.type === 'error') {
      client.errors.push(message.message);
    }
  };

  replacement.ondisconnect = () => {
    if (!client.allowDisconnect) {
      client.errors.push('socket disconnected unexpectedly');
    }
  };

  replacement.onerror = (error) => {
    const rendered = typeof error === 'string' ? error : JSON.stringify(error);
    client.errors.push(`socket error: ${rendered}`);
  };

  await replacement.connect(client.session, true);
}

describe('pdh integration via nakama apis', () => {
  afterEach(async () => {
    await Promise.all(createdClients.map((client) => disconnectClient(client)));
    createdClients.length = 0;
  });

  it('authenticates, creates and joins a match, enforces action rules, and supports reconnect sync', async () => {
    const authClient = new NakamaClient(
      ITEST_SERVER_KEY,
      ITEST_HOST,
      ITEST_PORT,
      ITEST_USE_SSL,
      7000,
      false
    );

    const aliceDeviceId = `itest-alice-${randomUUID()}`;
    const bobDeviceId = `itest-bob-${randomUUID()}`;

    const aliceRegistered = await authClient.authenticateDevice(aliceDeviceId, true, 'itest-alice');
    const aliceLoggedIn = await authClient.authenticateDevice(aliceDeviceId, false);
    expect(aliceLoggedIn.user_id).toBe(aliceRegistered.user_id);

    const bobRegistered = await authClient.authenticateDevice(bobDeviceId, true, 'itest-bob');
    const bobLoggedIn = await authClient.authenticateDevice(bobDeviceId, false);
    expect(bobLoggedIn.user_id).toBe(bobRegistered.user_id);

    const alice = makeTestClient('alice', aliceLoggedIn.user_id, aliceDeviceId, aliceLoggedIn);
    const bob = makeTestClient('bob', bobLoggedIn.user_id, bobDeviceId, bobLoggedIn);
    createdClients.push(alice, bob);
    const seqByUser = new Map<string, number>();

    await connectClient(alice);
    const tableId = `itest-table-${randomUUID()}`;
    const matchRpc = await authClient.rpc(
      aliceLoggedIn,
      ITEST_MATCH_RPC_ID,
      JSON.stringify({ tableId, module: ITEST_MATCH_MODULE })
    );
    const ensuredMatch = parseEnsureMatchResult(matchRpc.payload);
    const matchId = ensuredMatch.matchId;
    expect(ensuredMatch.tableId).toBe(tableId);
    expect(ensuredMatch.module).toBe(ITEST_MATCH_MODULE);
    expect(ensuredMatch.created).toBe(true);
    expect(matchId).toBeTruthy();
    await alice.socket.joinMatch(matchId);

    await connectClient(bob);
    await bob.socket.joinMatch(matchId);

    await sendClientMessage(alice, matchId, { type: 'join', name: 'Alice', buyIn: 5000, seat: 0 });
    await sendClientMessage(bob, matchId, { type: 'join', name: 'Bob', buyIn: 5000, seat: 1 });

    await waitFor(
      'both players to see preflop betting state',
      asyncCondition(() => {
        const aliceHand = alice.latestState?.hand;
        const bobHand = bob.latestState?.hand;
        return (
          Boolean(aliceHand && bobHand) &&
          aliceHand?.street === 'preflop' &&
          bobHand?.street === 'preflop' &&
          aliceHand?.phase === 'betting' &&
          bobHand?.phase === 'betting'
        );
      })
    );

    const preflop = handFrom(alice);
    const currentActor = preflop.players.find((player) => player.seat === preflop.actionOnSeat);
    expect(currentActor).toBeTruthy();

    const illegalActor = currentActor?.id === alice.userId ? bob : alice;
    illegalActor.errors.length = 0;
    await sendClientMessage(illegalActor, matchId, {
      type: 'action',
      action: 'check',
      seq: nextActionSeq(seqByUser, illegalActor.userId),
    });

    await waitFor(
      'illegal action rejection',
      () => illegalActor.errors.some((msg) => msg.includes('Not your turn')),
      ITEST_TIMEOUT_MS
    );

    await advancePreflopToFlopBetting([alice, bob], matchId, seqByUser);

    await waitFor(
      'both players to observe flop betting',
      asyncCondition(() => {
        const aliceHand = alice.latestState?.hand;
        const bobHand = bob.latestState?.hand;
        return (
          aliceHand?.street === 'flop' &&
          bobHand?.street === 'flop' &&
          aliceHand?.phase === 'betting' &&
          bobHand?.phase === 'betting'
        );
      })
    );

    await disconnectClient(bob);
    await waitFor(
      'alice to observe bob sitting out after disconnect',
      asyncCondition(() => {
        const bobSeat = alice.latestState?.seats.find((seat) => seat?.id === bob.userId);
        return Boolean(bobSeat?.sittingOut);
      })
    );

    await reconnectClient(bob);
    await bob.socket.joinMatch(matchId);
    await sendClientMessage(bob, matchId, { type: 'reconnect', playerId: bob.userId });
    await requestStateFromAll([alice, bob], matchId);

    await waitFor(
      'state sync for reconnected client',
      asyncCondition(() => {
        const bobSeat = bob.latestState?.seats.find((seat) => seat?.id === bob.userId);
        const aliceViewOfBob = alice.latestState?.seats.find((seat) => seat?.id === bob.userId);
        return (
          bob.latestState?.you.playerId === bob.userId &&
          bob.latestState?.id === alice.latestState?.id &&
          bobSeat?.sittingOut === false &&
          aliceViewOfBob?.sittingOut === false
        );
      })
    );
  }, 90000);
});

function asyncCondition(fn: () => boolean) {
  return () => {
    try {
      return fn();
    } catch {
      return false;
    }
  };
}

function parseEnsureMatchResult(payload: unknown): EnsureMatchRpcResult {
  if (typeof payload === 'string') {
    const parsed = JSON.parse(payload) as EnsureMatchRpcResult | string;
    if (typeof parsed === 'string') {
      return JSON.parse(parsed) as EnsureMatchRpcResult;
    }
    return parsed;
  }
  return payload as EnsureMatchRpcResult;
}
