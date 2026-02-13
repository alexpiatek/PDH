import type { HandState, TableState } from '@pdh/engine';

export type ClientMessage =
  | { type: 'join'; name: string; seat?: number; buyIn: number }
  | { type: 'reconnect'; playerId: string }
  | {
      type: 'action';
      action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn';
      amount?: number;
    }
  | { type: 'discard'; index: number }
  | { type: 'nextHand' }
  | { type: 'requestState' };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; tableId: string }
  | { type: 'state'; state: PublicState }
  | { type: 'error'; message: string };

export interface PublicState {
  id: string;
  seats: TableState['seats'];
  buttonSeat: number;
  hand: HandState | null;
  log: HandState['log'];
  you: { playerId: string };
}
