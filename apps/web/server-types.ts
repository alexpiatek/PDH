export type ClientMessage =
  | { type: 'join'; name: string; seat?: number; buyIn: number }
  | { type: 'reconnect'; playerId: string }
  | { type: 'action'; action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn'; amount?: number }
  | { type: 'discard'; index: number }
  | { type: 'nextHand' }
  | { type: 'requestState' };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; tableId: string }
  | { type: 'state'; state: any }
  | { type: 'error'; message: string };
