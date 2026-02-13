import { PokerTable, type Card, type HandState } from '../src';

export const cardKey = (card: Card) => `${card.rank}${card.suit}`;

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function createTableWithPlayers(
  playerCount = 3,
  stack = 10000,
  seed = 0x12345678,
  config?: ConstructorParameters<typeof PokerTable>[1]
) {
  if (playerCount < 2 || playerCount > 9) {
    throw new Error('playerCount must be between 2 and 9');
  }
  const table = new PokerTable('t', config);
  for (let i = 0; i < playerCount; i += 1) {
    table.seatPlayer(i, { id: `p${i}`, name: `P${i}`, stack });
  }
  table.startHand(createSeededRng(seed));
  return table;
}

export function actingPlayer(hand: HandState) {
  const player = hand.players.find((p) => p.seat === hand.actionOnSeat);
  if (!player) {
    throw new Error(`No acting player at seat ${hand.actionOnSeat}`);
  }
  return player;
}

export function settleBettingStreetWithCalls(table: PokerTable) {
  const hand = table.state.hand;
  if (!hand) throw new Error('No hand in progress');
  if (hand.phase !== 'betting') throw new Error('Hand is not in betting phase');

  let safety = 64;
  while (!hand.pendingNextPhaseAt && safety > 0) {
    const player = actingPlayer(hand);
    const toCall = hand.currentBet - player.betThisStreet;
    if (toCall > 0) {
      table.applyAction(player.id, { type: 'call' });
    } else {
      table.applyAction(player.id, { type: 'check' });
    }
    safety -= 1;
  }

  if (!hand.pendingNextPhaseAt) {
    throw new Error('Betting round did not settle in expected number of actions');
  }

  table.advancePendingPhase(hand.pendingNextPhaseAt);
}

export function discardAllPending(table: PokerTable): string[] {
  const hand = table.state.hand;
  if (!hand) throw new Error('No hand in progress');
  if (hand.phase !== 'discard') throw new Error('Hand is not in discard phase');

  const discardedBy = [...hand.discardPending];
  for (const playerId of discardedBy) {
    table.applyDiscard(playerId, 0);
  }
  return discardedBy;
}

export function discardedCardKeys(hand: HandState): Set<string> {
  const keys = new Set<string>();
  for (const entry of hand.auditLog ?? []) {
    const match = entry.message.match(/discarded ([2-9TJQKA][SHDC])/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

export function advanceToShowdownWithCallsAndFirstDiscards(table: PokerTable) {
  let safety = 64;
  while (table.state.hand && table.state.hand.phase !== 'showdown' && safety > 0) {
    const hand = table.state.hand;
    if (!hand) break;

    if (hand.phase === 'betting') {
      settleBettingStreetWithCalls(table);
    } else if (hand.phase === 'discard') {
      discardAllPending(table);
    } else {
      throw new Error(`Unexpected phase: ${hand.phase}`);
    }

    safety -= 1;
  }

  if (!table.state.hand || table.state.hand.phase !== 'showdown') {
    throw new Error('Expected to reach showdown');
  }

  return table.state.hand;
}
