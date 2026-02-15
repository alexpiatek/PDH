import { Client as NakamaClient, Session } from '@heroiclabs/nakama-js';
import type { Socket as NakamaSocket } from '@heroiclabs/nakama-js';

export const LOBBY_RPC_CREATE_TABLE = 'rpc_create_table';
export const LOBBY_RPC_JOIN_BY_CODE = 'rpc_join_by_code';

const STORAGE_KEYS = {
  deviceId: 'pdh.nakama.device_id',
  sessionToken: 'pdh.nakama.session_token',
  refreshToken: 'pdh.nakama.refresh_token',
} as const;

const SESSION_EXPIRY_SKEW_SECONDS = 20;

export interface NakamaClientConfig {
  host: string;
  port: string;
  useSSL: boolean;
  clientKey: string;
}

export interface CreateTableRpcRequest {
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
}

export interface CreateTableRpcResponse {
  code: string;
  matchId: string;
}

export interface JoinByCodeRpcRequest {
  code: string;
}

export interface JoinByCodeRpcResponse {
  matchId: string;
}

let clientSingleton: NakamaClient | null = null;
let sessionSingleton: Session | null = null;
let socketSingleton: NakamaSocket | null = null;
let socketConnected = false;

let inFlightSessionPromise: Promise<Session> | null = null;
let inFlightSocketPromise: Promise<NakamaSocket> | null = null;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isAuthError(error: unknown): boolean {
  const message = formatNakamaError(error).toLowerCase();
  return message.includes('401') || message.includes('unauthorized') || message.includes('forbidden');
}

function ensureBrowserStorage() {
  if (typeof window === 'undefined') {
    throw new Error('Nakama client APIs are available in the browser only.');
  }
  return window.localStorage;
}

function readStoredSession(): Session | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const storage = window.localStorage;
  const token = storage.getItem(STORAGE_KEYS.sessionToken);
  const refreshToken = storage.getItem(STORAGE_KEYS.refreshToken);

  if (!token || !refreshToken) {
    return null;
  }

  try {
    return Session.restore(token, refreshToken);
  } catch {
    storage.removeItem(STORAGE_KEYS.sessionToken);
    storage.removeItem(STORAGE_KEYS.refreshToken);
    return null;
  }
}

function persistSession(session: Session): void {
  const storage = ensureBrowserStorage();
  storage.setItem(STORAGE_KEYS.sessionToken, session.token);
  storage.setItem(STORAGE_KEYS.refreshToken, session.refresh_token);
}

function clearSessionCache(): void {
  sessionSingleton = null;
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEYS.sessionToken);
  window.localStorage.removeItem(STORAGE_KEYS.refreshToken);
}

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pdh-device-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
}

function getOrCreateDeviceId(): string {
  const storage = ensureBrowserStorage();
  const existing = storage.getItem(STORAGE_KEYS.deviceId);
  if (existing) {
    return existing;
  }

  const created = createDeviceId();
  storage.setItem(STORAGE_KEYS.deviceId, created);
  return created;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function authenticateDeviceWithRetries(client: NakamaClient, deviceId: string): Promise<Session> {
  try {
    return await client.authenticateDevice(deviceId, true);
  } catch (createError) {
    let lastError: unknown = createError;
    for (const delayMs of [50, 150, 350, 700]) {
      await sleep(delayMs);
      try {
        return await client.authenticateDevice(deviceId, false);
      } catch (loginError) {
        lastError = loginError;
      }
    }
    throw lastError;
  }
}

export function getNakamaConfig(): NakamaClientConfig {
  return {
    host: process.env.NEXT_PUBLIC_NAKAMA_HOST || process.env.NAKAMA_HOST || '127.0.0.1',
    port: process.env.NEXT_PUBLIC_NAKAMA_PORT || process.env.NAKAMA_PORT || '7350',
    useSSL: parseBoolean(
      process.env.NEXT_PUBLIC_NAKAMA_USE_SSL || process.env.NAKAMA_USE_SSL,
      false
    ),
    clientKey:
      process.env.NEXT_PUBLIC_NAKAMA_CLIENT_KEY ||
      process.env.NEXT_PUBLIC_NAKAMA_SERVER_KEY ||
      process.env.NAKAMA_CLIENT_KEY ||
      'defaultkey',
  };
}

export function getNakamaClient(): NakamaClient {
  if (!clientSingleton) {
    const config = getNakamaConfig();
    clientSingleton = new NakamaClient(
      config.clientKey,
      config.host,
      config.port,
      config.useSSL,
      7000,
      false
    );
  }
  return clientSingleton;
}

function isSessionUsable(session: Session): boolean {
  return !session.isexpired(nowInSeconds() + SESSION_EXPIRY_SKEW_SECONDS);
}

async function getFreshSession(client: NakamaClient): Promise<Session> {
  const deviceId = getOrCreateDeviceId();
  const cached = readStoredSession();

  if (cached && isSessionUsable(cached)) {
    sessionSingleton = cached;
    return cached;
  }

  if (cached && !cached.isrefreshexpired(nowInSeconds() + SESSION_EXPIRY_SKEW_SECONDS)) {
    try {
      const refreshed = await client.sessionRefresh(cached);
      sessionSingleton = refreshed;
      persistSession(refreshed);
      return refreshed;
    } catch {
      clearSessionCache();
    }
  }

  const authenticated = await authenticateDeviceWithRetries(client, deviceId);
  sessionSingleton = authenticated;
  persistSession(authenticated);
  return authenticated;
}

export async function ensureNakamaSession(): Promise<Session> {
  if (sessionSingleton && isSessionUsable(sessionSingleton)) {
    return sessionSingleton;
  }

  if (inFlightSessionPromise) {
    return inFlightSessionPromise;
  }

  const client = getNakamaClient();
  inFlightSessionPromise = getFreshSession(client).finally(() => {
    inFlightSessionPromise = null;
  });

  return inFlightSessionPromise;
}

function attachSocketLifecycleHooks(socket: NakamaSocket): void {
  const existingDisconnect = socket.ondisconnect;
  socket.ondisconnect = (event: Event) => {
    socketConnected = false;
    if (typeof existingDisconnect === 'function') {
      existingDisconnect(event);
    }
  };
}

export async function ensureNakamaSocket(): Promise<NakamaSocket> {
  if (socketSingleton && socketConnected) {
    return socketSingleton;
  }

  if (inFlightSocketPromise) {
    return inFlightSocketPromise;
  }

  inFlightSocketPromise = (async () => {
    const client = getNakamaClient();
    let session = await ensureNakamaSession();

    if (!socketSingleton) {
      socketSingleton = client.createSocket(getNakamaConfig().useSSL, false);
      attachSocketLifecycleHooks(socketSingleton);
    }

    try {
      await socketSingleton.connect(session, true);
      socketConnected = true;
      return socketSingleton;
    } catch (error) {
      if (!isAuthError(error)) {
        throw error;
      }

      clearSessionCache();
      session = await ensureNakamaSession();
      await socketSingleton.connect(session, true);
      socketConnected = true;
      return socketSingleton;
    }
  })().finally(() => {
    inFlightSocketPromise = null;
  });

  return inFlightSocketPromise;
}

function parseRpcPayload<T>(payload: unknown): T {
  if (typeof payload === 'string') {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed === 'string') {
      return JSON.parse(parsed) as T;
    }
    return parsed as T;
  }

  return payload as T;
}

export async function callNakamaRpc<T>(rpcId: string, input: Record<string, unknown>): Promise<T> {
  const client = getNakamaClient();
  let session = await ensureNakamaSession();

  try {
    const response = await client.rpc(session, rpcId, input);
    return parseRpcPayload<T>(response.payload);
  } catch (error) {
    if (!isAuthError(error)) {
      throw error;
    }

    clearSessionCache();
    session = await ensureNakamaSession();
    const retried = await client.rpc(session, rpcId, input);
    return parseRpcPayload<T>(retried.payload);
  }
}

export async function createLobbyTable(input: CreateTableRpcRequest): Promise<CreateTableRpcResponse> {
  return callNakamaRpc<CreateTableRpcResponse>(LOBBY_RPC_CREATE_TABLE, input);
}

export async function resolveLobbyCode(input: JoinByCodeRpcRequest): Promise<JoinByCodeRpcResponse> {
  return callNakamaRpc<JoinByCodeRpcResponse>(LOBBY_RPC_JOIN_BY_CODE, input);
}

export async function ensureNakamaReady() {
  const session = await ensureNakamaSession();
  const socket = await ensureNakamaSocket();
  return { session, socket };
}

export function formatNakamaError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const status = (error as { status?: unknown }).status;
    const statusText = (error as { statusText?: unknown }).statusText;
    if (typeof status === 'number') {
      return `HTTP ${status}${typeof statusText === 'string' && statusText ? ` ${statusText}` : ''}`;
    }

    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }

    const nestedError = (error as { error?: unknown }).error;
    if (typeof nestedError === 'string') {
      return nestedError;
    }
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
