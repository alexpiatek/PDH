export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type Phase = 'betting' | 'discard' | 'showdown' | 'complete';

export type PlayerStatus = 'active' | 'folded' | 'allIn' | 'out';

export interface Seat {
  seat: number;
  id: string;
  name: string;
  stack: number;
  sittingOut?: boolean;
}

export interface PlayerInHand {
  seat: number;
  id: string;
  name: string;
  stack: number;
  status: PlayerStatus;
  holeCards: Card[];
  betThisStreet: number;
  totalCommitted: number;
  hasActed: boolean;
}

export interface Pot {
  amount: number;
  eligible: string[]; // player ids
}

export interface HandLogEntry {
  message: string;
  ts: number;
}

export interface HandState {
  handId: string;
  buttonSeat: number;
  street: Street;
  phase: Phase;
  board: Card[];
  deck: Card[];
  players: PlayerInHand[];
  pots: Pot[];
  currentBet: number;
  minRaise: number;
  actionOnSeat: number;
  lastAggressorSeat: number | null;
  discardPending: string[];
  discardDeadline: number | null;
  log: HandLogEntry[];
}

export interface TableConfig {
  smallBlind: number;
  bigBlind: number;
  discardTimeoutMs: number;
}

export interface TableState {
  id: string;
  config: TableConfig;
  seats: (Seat | null)[];
  buttonSeat: number;
  hand: HandState | null;
  log: HandLogEntry[];
}

export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'allIn'; amount?: number };

export interface ShowdownResult {
  playerId: string;
  handStrength: number;
  bestFive: Card[];
}
