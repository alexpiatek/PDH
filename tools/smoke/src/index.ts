import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client as NakamaClient } from '@heroiclabs/nakama-js';
import type { Session, Socket as NakamaSocket } from '@heroiclabs/nakama-js';
import type { WebSocketAdapter } from '@heroiclabs/nakama-js';
import WebSocket from 'ws';

const enum MatchOpCode {
  ClientMessage = 1,
  ServerMessage = 2,
}

interface SmokeState {
  tableId: string;
  tick: number;
  counter: number;
  connectedPlayers: number;
  players: string[];
  lastActor: string | null;
}

interface SmokeServerMessage {
  type: 'state' | 'error';
  state?: SmokeState;
  message?: string;
}

interface SmokeClientContext {
  index: number;
  userId: string;
  session: Session;
  socket: NakamaSocket;
  latestState: SmokeState | null;
  errors: string[];
}

interface SmokeOptions {
  host: string;
  port: number;
  useSsl: boolean;
  serverKey: string;
  clients: number;
  tableId: string;
  matchModule: string;
  rpcId: string;
  authMethod: 'device';
  timeoutMs: number;
  verbose: boolean;
}

const textDecoder = new TextDecoder();

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
        const message = JSON.parse(payloadText) as any;

        if (message.match_data?.data) {
          message.match_data.data = new Uint8Array(Buffer.from(message.match_data.data, 'base64'));
        } else if (message.party_data?.data) {
          message.party_data.data = new Uint8Array(Buffer.from(message.party_data.data, 'base64'));
        }

        this.onMessage?.(message);
      } catch (error) {
        this.onError?.(error);
      }
    });
  }

  send(message: any): void {
    if (!this.socket) {
      throw new Error('WebSocket is not connected');
    }

    if (message.match_data_send) {
      message.match_data_send.op_code = message.match_data_send.op_code.toString();
      const payload = message.match_data_send.data;
      if (payload instanceof Uint8Array) {
        message.match_data_send.data = Buffer.from(payload).toString('base64');
      } else if (payload) {
        message.match_data_send.data = Buffer.from(String(payload), 'utf8').toString('base64');
      }
    } else if (message.party_data_send) {
      message.party_data_send.op_code = message.party_data_send.op_code.toString();
      const payload = message.party_data_send.data;
      if (payload instanceof Uint8Array) {
        message.party_data_send.data = Buffer.from(payload).toString('base64');
      } else if (payload) {
        message.party_data_send.data = Buffer.from(String(payload), 'utf8').toString('base64');
      }
    }

    this.socket.send(JSON.stringify(message));
  }
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function parseArgs(argv: string[]): SmokeOptions {
  const options: SmokeOptions = {
    host: process.env.SMOKE_HOST ?? '127.0.0.1',
    port: parseInteger(process.env.SMOKE_PORT, 7350),
    useSsl: parseBoolean(process.env.SMOKE_USE_SSL, false),
    serverKey:
      process.env.SMOKE_SERVER_KEY ??
      process.env.NAKAMA_SOCKET_SERVER_KEY ??
      'dev_socket_server_key_change_me',
    clients: parseInteger(process.env.SMOKE_CLIENTS, 4),
    tableId: process.env.SMOKE_TABLE_ID ?? 'smoke-main',
    matchModule: process.env.SMOKE_MATCH_MODULE ?? 'pdh_smoke',
    rpcId: process.env.SMOKE_RPC_ID ?? 'pdh_smoke_ensure_match',
    authMethod: 'device',
    timeoutMs: parseInteger(process.env.SMOKE_TIMEOUT_MS, 20000),
    verbose: parseBoolean(process.env.SMOKE_VERBOSE, false),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--url': {
        if (!next) throw new Error('--url requires a value');
        const parsed = new URL(next);
        options.host = parsed.hostname;
        options.useSsl = parsed.protocol === 'https:';
        options.port = parsed.port ? Number(parsed.port) : options.useSsl ? 443 : 80;
        i += 1;
        break;
      }
      case '--host': {
        if (!next) throw new Error('--host requires a value');
        options.host = next;
        i += 1;
        break;
      }
      case '--port': {
        if (!next) throw new Error('--port requires a value');
        options.port = parseInteger(next, options.port);
        i += 1;
        break;
      }
      case '--ssl': {
        if (!next) throw new Error('--ssl requires true/false');
        options.useSsl = parseBoolean(next, options.useSsl);
        i += 1;
        break;
      }
      case '--server-key': {
        if (!next) throw new Error('--server-key requires a value');
        options.serverKey = next;
        i += 1;
        break;
      }
      case '--clients': {
        if (!next) throw new Error('--clients requires a number');
        options.clients = parseInteger(next, options.clients);
        i += 1;
        break;
      }
      case '--table-id': {
        if (!next) throw new Error('--table-id requires a value');
        options.tableId = next;
        i += 1;
        break;
      }
      case '--module': {
        if (!next) throw new Error('--module requires a value');
        options.matchModule = next;
        i += 1;
        break;
      }
      case '--rpc-id': {
        if (!next) throw new Error('--rpc-id requires a value');
        options.rpcId = next;
        i += 1;
        break;
      }
      case '--auth': {
        if (!next) throw new Error('--auth requires a value');
        if (next !== 'device') {
          throw new Error(`Unsupported auth method: ${next}. Only 'device' is implemented.`);
        }
        options.authMethod = 'device';
        i += 1;
        break;
      }
      case '--timeout-ms': {
        if (!next) throw new Error('--timeout-ms requires a number');
        options.timeoutMs = parseInteger(next, options.timeoutMs);
        i += 1;
        break;
      }
      case '--verbose': {
        options.verbose = true;
        break;
      }
      case '--help': {
        printHelp();
        process.exit(0);
      }
      default: {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
  }

  if (options.clients < 4) {
    throw new Error(`--clients must be >= 4 (got ${options.clients})`);
  }

  return options;
}

function printHelp() {
  // Keep this short because it is also printed on argument failures.
  console.log('Smoke test options:');
  console.log('  --url https://host[:port]');
  console.log('  --host 127.0.0.1 --port 7350 --ssl false');
  console.log('  --clients 4 --server-key <key> --table-id smoke-main');
  console.log('  --module pdh_smoke --rpc-id pdh_smoke_ensure_match --auth device');
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function withStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`${label} failed: ${formatUnknownError(error)}`);
  }
}

async function waitFor(
  description: string,
  condition: () => boolean,
  timeoutMs: number,
  intervalMs = 100
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

function decodeStateMessage(data: Uint8Array): SmokeServerMessage {
  const payload = textDecoder.decode(data);
  return JSON.parse(payload) as SmokeServerMessage;
}

function logVerbose(options: SmokeOptions, message: string) {
  if (options.verbose) {
    console.log(`[smoke] ${message}`);
  }
}

async function authenticateClient(options: SmokeOptions, index: number) {
  const client = new NakamaClient(
    options.serverKey,
    options.host,
    String(options.port),
    options.useSsl,
    7000,
    false
  );
  const deviceId = `smoke-${index}-${randomUUID()}`;
  const session = await client.authenticateDevice(deviceId, true);
  return { client, session };
}

function labelForTable(tableId: string) {
  return JSON.stringify({ tableId, mode: 'smoke' });
}

async function findMatchId(
  client: NakamaClient,
  session: Session,
  tableId: string
): Promise<string | null> {
  const list = await client.listMatches(session, 20, true, labelForTable(tableId), 0, 64);
  const match = (list.matches ?? []).find((entry) => Boolean(entry.match_id || entry.matchId));
  return (match?.match_id ?? (match as any)?.matchId ?? null) as string | null;
}

async function ensureMatchId(
  options: SmokeOptions,
  client: NakamaClient,
  session: Session
): Promise<string> {
  let rpcError: unknown;
  try {
    const rpc = await client.rpc(
      session,
      options.rpcId,
      JSON.stringify({ tableId: options.tableId, module: options.matchModule })
    );
    logVerbose(options, `RPC response: ${JSON.stringify(rpc)}`);

    let payload: { matchId?: string } = {};
    if (typeof rpc.payload === 'string' && rpc.payload.length > 0) {
      try {
        payload = JSON.parse(rpc.payload) as { matchId?: string };
      } catch {
        // Some SDK paths can return an already materialized object through payload.
        payload = {};
      }
    } else if (rpc.payload && typeof rpc.payload === 'object') {
      payload = rpc.payload as { matchId?: string };
    }

    if (payload.matchId) {
      return payload.matchId;
    }
  } catch (error) {
    rpcError = error;
    logVerbose(
      options,
      `RPC ensure match failed, falling back to listMatches: ${formatUnknownError(error)}`
    );
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const listed = await findMatchId(client, session, options.tableId);
    if (listed) return listed;
    await delay(100);
  }

  throw new Error(
    `Unable to resolve a smoke match for tableId=${options.tableId}. ` +
      `RPC ${options.rpcId} failed or returned no matchId: ${formatUnknownError(rpcError)}`
  );
}

async function connectAndJoin(
  options: SmokeOptions,
  index: number,
  matchId: string
): Promise<SmokeClientContext> {
  const { client, session } = await authenticateClient(options, index);
  const socket = client.createSocket(options.useSsl, false, new NodeWebSocketAdapter());

  const context: SmokeClientContext = {
    index,
    userId: session.user_id,
    session,
    socket,
    latestState: null,
    errors: [],
  };

  socket.onmatchdata = (matchData) => {
    const opCode = (matchData as any).op_code ?? (matchData as any).opCode;
    if (opCode !== MatchOpCode.ServerMessage) return;
    try {
      const msg = decodeStateMessage((matchData as any).data as Uint8Array);
      if (msg.type === 'state' && msg.state) {
        context.latestState = msg.state;
      }
      if (msg.type === 'error' && msg.message) {
        context.errors.push(msg.message);
      }
    } catch (error) {
      context.errors.push(`invalid match payload: ${(error as Error).message}`);
    }
  };

  socket.onerror = (error) => {
    const message = typeof error === 'string' ? error : JSON.stringify(error);
    context.errors.push(`socket error: ${message}`);
  };

  socket.ondisconnect = () => {
    context.errors.push('socket disconnected unexpectedly');
  };

  await socket.connect(session, true);
  await socket.joinMatch(matchId);
  await socket.sendMatchState(
    matchId,
    MatchOpCode.ClientMessage,
    JSON.stringify({ type: 'requestState' })
  );

  return context;
}

async function incrementFromAllClients(clients: SmokeClientContext[], matchId: string) {
  for (const client of clients) {
    await client.socket.sendMatchState(
      matchId,
      MatchOpCode.ClientMessage,
      JSON.stringify({ type: 'inc', amount: 1 })
    );
  }
}

function failIfAnyClientErrors(clients: SmokeClientContext[]) {
  const withErrors = clients.filter((client) => client.errors.length > 0);
  if (withErrors.length === 0) return;

  const rendered = withErrors
    .map((client) => `client${client.index}(${client.userId}): ${client.errors.join('; ')}`)
    .join(' | ');
  throw new Error(`Client runtime errors observed: ${rendered}`);
}

function verifyReplicatedState(
  clients: SmokeClientContext[],
  expectedClients: number,
  expectedCounter: number
) {
  const states = clients.map((client) => client.latestState);
  if (states.some((state) => !state)) {
    throw new Error('One or more clients did not receive a state payload.');
  }

  const nonNullStates = states as SmokeState[];
  const counters = new Set(nonNullStates.map((state) => state.counter));
  const connectedCounts = new Set(nonNullStates.map((state) => state.connectedPlayers));
  const canonicalPlayers = [...nonNullStates[0].players].sort().join(',');

  for (const state of nonNullStates) {
    const players = [...state.players].sort().join(',');
    if (players !== canonicalPlayers) {
      throw new Error('Players list mismatch across clients.');
    }
  }

  if (counters.size !== 1 || !counters.has(expectedCounter)) {
    throw new Error(
      `Counter mismatch across clients. Expected ${expectedCounter}, got ${[...counters].join(',')}`
    );
  }

  if (connectedCounts.size !== 1 || !connectedCounts.has(expectedClients)) {
    throw new Error(
      `Connected player mismatch across clients. Expected ${expectedClients}, got ${[
        ...connectedCounts,
      ].join(',')}`
    );
  }
}

async function cleanup(clients: SmokeClientContext[], matchId: string) {
  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.socket.leaveMatch(matchId);
      } catch {
        // Best effort cleanup.
      }
      try {
        await client.socket.disconnect(false);
      } catch {
        // Best effort cleanup.
      }
    })
  );
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  console.log(
    `Smoke test target: ${options.useSsl ? 'https' : 'http'}://${options.host}:${options.port} ` +
      `(clients=${options.clients}, auth=${options.authMethod}, tableId=${options.tableId})`
  );

  const lead = await withStep('lead client authentication', () => authenticateClient(options, 0));
  const matchId = await withStep('match discovery/creation', () =>
    ensureMatchId(options, lead.client, lead.session)
  );
  logVerbose(options, `Resolved match id: ${matchId}`);

  const clients: SmokeClientContext[] = [];

  try {
    clients.push(
      await withStep('lead client connect/join', () => connectAndJoin(options, 0, matchId))
    );

    for (let i = 1; i < options.clients; i += 1) {
      const index = i;
      clients.push(
        await withStep(`client${index} connect/join`, () => connectAndJoin(options, index, matchId))
      );
    }

    try {
      await waitFor(
        'all clients to observe full connected player count',
        () =>
          clients.every(
            (client) => client.latestState && client.latestState.connectedPlayers >= options.clients
          ),
        options.timeoutMs
      );
    } catch (error) {
      const observed = clients.map((client) => ({
        index: client.index,
        latestState: client.latestState,
        errors: client.errors,
      }));
      throw new Error(`${formatUnknownError(error)} | observed=${JSON.stringify(observed)}`);
    }

    await withStep('increment broadcast', () => incrementFromAllClients(clients, matchId));

    try {
      await waitFor(
        `counter to reach ${options.clients} on all clients`,
        () => clients.every((client) => client.latestState?.counter === options.clients),
        options.timeoutMs
      );
    } catch (error) {
      const observed = clients.map((client) => ({
        index: client.index,
        latestState: client.latestState,
        errors: client.errors,
      }));
      throw new Error(`${formatUnknownError(error)} | observed=${JSON.stringify(observed)}`);
    }

    failIfAnyClientErrors(clients);
    verifyReplicatedState(clients, options.clients, options.clients);

    console.log('PASS: multiplayer smoke test succeeded');
    console.log(`- matchId: ${matchId}`);
    console.log(`- clients connected: ${options.clients}`);
    console.log(`- replicated counter: ${options.clients}`);
  } finally {
    await cleanup(clients, matchId);
  }
}

run().catch((error) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  console.error('FAIL: multiplayer smoke test failed');
  console.error(`Reason: ${message}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
