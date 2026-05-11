import { describe, expect, it } from 'vitest';
import { PokerTable } from '../src/table';

const rng = () => 0.1;

function createThreePlayerTable(stacks: [number, number, number] = [5000, 5000, 5000]) {
  const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
  table.seatPlayer(0, { id: 'p0', name: 'UTG', stack: stacks[0] });
  table.seatPlayer(1, { id: 'p1', name: 'SB', stack: stacks[1] });
  table.seatPlayer(2, { id: 'p2', name: 'BB', stack: stacks[2] });
  table.startHand(rng);
  return table;
}

describe('server legal actions', () => {
  it('allows the preflop actor facing a blind to fold, call, raise, and all-in', () => {
    const table = createThreePlayerTable();

    const legal = table.getLegalActionsForPlayer('p0');

    expect(legal.phase).toBe('betting');
    expect(legal.isActor).toBe(true);
    expect(legal.betting).toMatchObject({
      canFold: true,
      canCheck: false,
      canCall: true,
      callAmount: 800,
      canBet: false,
      minBet: null,
      maxBet: null,
      canRaise: true,
      minRaiseTo: 1600,
      maxRaiseTo: 5000,
      canAllIn: true,
      allInAmount: 5000,
      stack: 5000,
      committedThisStreet: 0,
      currentBet: 800,
    });
  });

  it('shows check and not call zero when the actor has matched the current bet', () => {
    const table = new PokerTable('t', { smallBlind: 400, bigBlind: 800 });
    table.seatPlayer(0, { id: 'button', name: 'Button', stack: 5000 });
    table.seatPlayer(1, { id: 'bb', name: 'Big Blind', stack: 5000 });
    table.startHand(rng);

    table.applyAction('button', { type: 'call' });

    const legal = table.getLegalActionsForPlayer('bb');
    expect(legal.isActor).toBe(true);
    expect(legal.betting).toMatchObject({
      canCheck: true,
      canCall: false,
      callAmount: 0,
    });
  });

  it('reports call amount and raise-to bounds when facing a bet', () => {
    const table = createThreePlayerTable();

    table.applyAction('p0', { type: 'raise', amount: 1600 });

    const legal = table.getLegalActionsForPlayer('p1');
    expect(legal.isActor).toBe(true);
    expect(legal.betting).toMatchObject({
      canCall: true,
      callAmount: 1200,
      canRaise: true,
      minRaiseTo: 2400,
      maxRaiseTo: 5000,
      currentBet: 1600,
      committedThisStreet: 400,
      stack: 4600,
    });
  });

  it('reports short-stack all-in call behavior without exposing an invalid raise', () => {
    const table = createThreePlayerTable([5000, 1200, 5000]);

    table.applyAction('p0', { type: 'raise', amount: 2400 });

    const legal = table.getLegalActionsForPlayer('p1');
    expect(legal.isActor).toBe(true);
    expect(legal.betting).toMatchObject({
      canCall: true,
      callAmount: 2000,
      canRaise: false,
      minRaiseTo: 4000,
      maxRaiseTo: 1200,
      canAllIn: true,
      allInAmount: 1200,
      stack: 800,
      committedThisStreet: 400,
      currentBet: 2400,
    });
  });

  it('returns no betting actions for a non-actor', () => {
    const table = createThreePlayerTable();

    const legal = table.getLegalActionsForPlayer('p1');

    expect(legal).toMatchObject({
      phase: 'betting',
      isActor: false,
      reason: 'not_your_turn',
    });
    expect(legal.betting).toBeUndefined();
  });

  it('prevents folded, busted, disconnected, and sitting-out players from acting', () => {
    const foldedTable = createThreePlayerTable();
    foldedTable.state.hand!.players.find((player) => player.id === 'p0')!.status = 'folded';
    expect(foldedTable.getLegalActionsForPlayer('p0')).toMatchObject({
      isActor: false,
      reason: 'folded',
    });

    const bustedTable = createThreePlayerTable();
    bustedTable.state.seats[0]!.stack = 0;
    bustedTable.state.seats[0]!.status = 'busted';
    bustedTable.state.seats[0]!.sittingOut = true;
    expect(bustedTable.getLegalActionsForPlayer('p0')).toMatchObject({
      isActor: false,
      reason: 'busted',
    });

    const sittingOutTable = createThreePlayerTable();
    sittingOutTable.state.seats[0]!.status = 'sitting_out';
    sittingOutTable.state.seats[0]!.sittingOut = true;
    expect(sittingOutTable.getLegalActionsForPlayer('p0')).toMatchObject({
      isActor: false,
      reason: 'sitting_out',
    });

    const disconnectedTable = createThreePlayerTable();
    expect(
      disconnectedTable.getLegalActionsForPlayer('p0', { connectionStatus: 'disconnected' })
    ).toMatchObject({
      isActor: false,
      reason: 'disconnected',
    });
  });

  it('returns discard requirements only for the pending discard player', () => {
    const table = createThreePlayerTable();
    const hand = table.state.hand!;
    hand.phase = 'discard';
    hand.actionOnSeat = -1;
    hand.actionDeadline = null;
    hand.discardPending = ['p0'];
    hand.discardDeadline = 123_456;

    const pending = table.getLegalActionsForPlayer('p0');
    expect(pending).toEqual({
      phase: 'discard',
      isActor: true,
      discard: {
        required: true,
        count: 1,
        validIndexes: [0, 1, 2, 3, 4],
        deadlineMs: 123_456,
      },
    });

    const waiting = table.getLegalActionsForPlayer('p1');
    expect(waiting).toMatchObject({
      phase: 'discard',
      isActor: false,
      reason: 'not_your_turn',
    });
    expect(waiting.discard).toBeUndefined();
  });

  it('returns no betting actions during showdown, between-hand, and waiting states', () => {
    const waitingTable = new PokerTable('waiting', { smallBlind: 400, bigBlind: 800 });
    waitingTable.seatPlayer(0, { id: 'p0', name: 'P0', stack: 5000 });
    expect(waitingTable.getLegalActionsForPlayer('p0')).toMatchObject({
      phase: 'waiting',
      isActor: false,
      reason: 'waiting_for_players',
    });
    expect(waitingTable.getLegalActionsForPlayer('p0').betting).toBeUndefined();

    const showdownTable = createThreePlayerTable();
    showdownTable.state.hand!.phase = 'showdown';
    expect(showdownTable.getLegalActionsForPlayer('p0')).toMatchObject({
      phase: 'showdown',
      isActor: false,
      reason: 'showdown',
    });
    expect(showdownTable.getLegalActionsForPlayer('p0').betting).toBeUndefined();

    expect(showdownTable.getLegalActionsForPlayer('p0', { betweenHand: true })).toMatchObject({
      phase: 'between_hands',
      isActor: false,
      reason: 'between_hands',
    });
    expect(
      showdownTable.getLegalActionsForPlayer('p0', { betweenHand: true }).betting
    ).toBeUndefined();
  });
});
