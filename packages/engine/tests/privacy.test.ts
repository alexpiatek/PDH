import { describe, expect, it } from 'vitest';
import { PokerTable, type Card } from '../src';
import { createTableWithPlayers } from './testUtils';

const isMasked = (card: Card) => card.rank === 'X' && card.suit === 'X';
const key = (card: Card) => `${card.rank}${card.suit}`;
const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('public state card privacy', () => {
  it('shows each player only their own private cards before showdown', () => {
    const table = createTableWithPlayers(3, 10000, 0xabcddcba);
    const hand = table.state.hand!;
    const p0State = table.getPublicState('p0').hand!;
    const p1State = table.getPublicState('p1').hand!;
    const observerState = table.getPublicState().hand!;

    for (const player of p0State.players) {
      if (player.id === 'p0') {
        expect(player.holeCards.map(key)).toEqual(
          hand.players.find((p) => p.id === 'p0')!.holeCards.map(key)
        );
      } else {
        expect(player.holeCards.every(isMasked)).toBe(true);
      }
    }

    for (const player of p1State.players) {
      if (player.id === 'p1') {
        expect(player.holeCards.map(key)).toEqual(
          hand.players.find((p) => p.id === 'p1')!.holeCards.map(key)
        );
      } else {
        expect(player.holeCards.every(isMasked)).toBe(true);
      }
    }

    expect(observerState.players.every((player) => player.holeCards.every(isMasked))).toBe(true);
  });

  it('does not reveal folded, sitting-out, or busted cards during contested showdown', () => {
    const table = createTableWithPlayers(5, 10000, 0x1234abcd);
    const hand = table.state.hand!;
    hand.phase = 'showdown';
    hand.street = 'showdown';

    hand.players[0].status = 'active';
    hand.players[1].status = 'allIn';
    hand.players[2].status = 'folded';
    hand.players[3].status = 'sitting_out';
    hand.players[4].status = 'busted';

    const publicHand = table.getPublicState('p0').hand!;
    const byId = new Map(publicHand.players.map((player) => [player.id, player]));

    expect(byId.get('p0')!.holeCards.map(key)).toEqual(hand.players[0].holeCards.map(key));
    expect(byId.get('p1')!.holeCards.map(key)).toEqual(hand.players[1].holeCards.map(key));
    expect(byId.get('p2')!.holeCards.every(isMasked)).toBe(true);
    expect(byId.get('p3')!.holeCards.every(isMasked)).toBe(true);
    expect(byId.get('p4')!.holeCards.every(isMasked)).toBe(true);
  });

  it('reveals a legal showdown loser even after they bust during settlement', () => {
    const table = new PokerTable('t', { smallBlind: 100, bigBlind: 200 });
    table.seatPlayer(0, { id: 'winner', name: 'Winner', stack: 1000 });
    table.seatPlayer(1, { id: 'loser', name: 'Loser', stack: 1000 });
    table.startHand(() => 0.1);

    const hand = table.state.hand!;
    hand.board = [C('A', 'S'), C('K', 'S'), C('Q', 'S'), C('J', 'S'), C('2', 'D')];
    const winner = hand.players.find((p) => p.id === 'winner')!;
    const loser = hand.players.find((p) => p.id === 'loser')!;
    winner.holeCards = [C('T', 'S'), C('9', 'D')];
    loser.holeCards = [C('3', 'C'), C('4', 'D')];
    winner.stack = 0;
    loser.stack = 0;
    winner.totalCommitted = 1000;
    loser.totalCommitted = 1000;
    winner.status = 'allIn';
    loser.status = 'allIn';
    table.state.seats[winner.seat]!.stack = 0;
    table.state.seats[loser.seat]!.stack = 0;

    (table as any).finishHand();

    expect(table.state.seats[loser.seat]?.status).toBe('busted');
    expect(loser.status).toBe('busted');

    const publicHand = table.getPublicState().hand!;
    const byId = new Map(publicHand.players.map((player) => [player.id, player]));

    expect(byId.get('winner')!.holeCards.map(key)).toEqual(winner.holeCards.map(key));
    expect(byId.get('loser')!.holeCards.map(key)).toEqual(loser.holeCards.map(key));
  });
});
