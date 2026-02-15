declare module '@heroiclabs/nakama-runtime' {
  export interface MatchListEntry {
    matchId?: string;
    match_id?: string;
    authoritative?: boolean;
    label?: string;
    size?: number;
  }

  export interface StorageObject {
    collection?: string;
    key?: string;
    userId?: string;
    user_id?: string;
    value?: unknown;
    version?: string;
    permissionRead?: number;
    permission_write?: number;
  }

  export interface StorageReadRequest {
    collection: string;
    key: string;
    userId: string;
  }

  export interface StorageWriteRequest {
    collection: string;
    key: string;
    userId: string;
    value: Record<string, unknown>;
    permissionRead: number;
    permissionWrite: number;
  }

  export interface Presence {
    userId: string;
    sessionId?: string;
    username?: string;
    node?: string;
  }

  export interface MatchMessage {
    sender: Presence;
    opCode: number;
    data: Uint8Array;
  }

  export interface MatchDispatcher {
    broadcastMessage(
      opCode: number,
      data: string,
      presences?: Presence[] | null,
      sender?: Presence | null,
      reliable?: boolean
    ): void;
  }

  export interface Nakama {
    binaryToString(data: Uint8Array): string;
    matchCreate(module: string, params: Record<string, unknown>): string;
    matchList(
      limit: number,
      authoritative: boolean,
      label: string,
      minSize: number,
      maxSize: number,
      query?: string
    ): MatchListEntry[];
    matchGet?(matchId: string): MatchListEntry | null;
    storageRead?(objects: StorageReadRequest[]): StorageObject[];
    storageWrite?(objects: StorageWriteRequest[]): StorageObject[];
  }

  export interface Logger {
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
  }

  export interface Initializer {
    registerMatch(name: string, handler: MatchHandler): void;
    registerRpc(name: string, fn: (...args: any[]) => string): void;
    registerAfterAuthenticateDevice?(fn: (...args: any[]) => void): void;
  }

  export type MatchHandler = {
    matchInit: (...args: any[]) => any;
    matchJoinAttempt: (...args: any[]) => any;
    matchJoin: (...args: any[]) => any;
    matchLeave: (...args: any[]) => any;
    matchLoop: (...args: any[]) => any;
    matchTerminate: (...args: any[]) => any;
    matchSignal: (...args: any[]) => any;
  };

  export type InitModule = (ctx: any, logger: Logger, nk: Nakama, initializer: Initializer) => void;
}
