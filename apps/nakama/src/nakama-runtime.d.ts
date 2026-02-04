declare module '@heroiclabs/nakama-runtime' {
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
  }

  export interface Logger {
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
  }

  export interface Initializer {
    registerMatch(name: string, handler: MatchHandler): void;
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
