import { describe, expect, it } from 'vitest';
import { discardConfirmDisabledReason, discardObligationKey } from '../lib/discardControls';

describe('discard controls', () => {
  it('reports one explicit disabled reason for confirm discard', () => {
    expect(
      discardConfirmDisabledReason({
        pending: false,
        selectedIndex: 0,
        selectedIndexValid: true,
        requestInFlight: false,
        disconnected: false,
      })
    ).toBe('not_pending_discard');
    expect(
      discardConfirmDisabledReason({
        pending: true,
        selectedIndex: null,
        selectedIndexValid: false,
        requestInFlight: false,
        disconnected: false,
      })
    ).toBe('no_selected_card');
    expect(
      discardConfirmDisabledReason({
        pending: true,
        selectedIndex: 4,
        selectedIndexValid: false,
        requestInFlight: false,
        disconnected: false,
      })
    ).toBe('invalid_selected_index');
    expect(
      discardConfirmDisabledReason({
        pending: true,
        selectedIndex: 1,
        selectedIndexValid: true,
        requestInFlight: true,
        disconnected: false,
      })
    ).toBe('request_in_flight');
    expect(
      discardConfirmDisabledReason({
        pending: true,
        selectedIndex: null,
        selectedIndexValid: false,
        requestInFlight: true,
        disconnected: false,
      })
    ).toBe('request_in_flight');
    expect(
      discardConfirmDisabledReason({
        pending: true,
        selectedIndex: 1,
        selectedIndexValid: true,
        requestInFlight: false,
        disconnected: true,
      })
    ).toBe('disconnected');
    expect(
      discardConfirmDisabledReason({
        pending: true,
        selectedIndex: 1,
        selectedIndexValid: true,
        requestInFlight: false,
        disconnected: false,
      })
    ).toBeNull();
  });

  it('keeps the same obligation through unrelated table updates', () => {
    const first = discardObligationKey({
      handId: 'h1',
      street: 'turn',
      playerId: 'p1',
      pending: true,
      holeCardsLength: 4,
    });
    const afterUnrelatedStateVersion = discardObligationKey({
      handId: 'h1',
      street: 'turn',
      playerId: 'p1',
      pending: true,
      holeCardsLength: 4,
    });

    expect(afterUnrelatedStateVersion).toBe(first);
  });

  it('changes obligation between all-in discard streets in the same hand', () => {
    const flop = discardObligationKey({
      handId: 'h1',
      street: 'flop',
      playerId: 'p1',
      pending: true,
      holeCardsLength: 5,
    });
    const turn = discardObligationKey({
      handId: 'h1',
      street: 'turn',
      playerId: 'p1',
      pending: true,
      holeCardsLength: 4,
    });
    const river = discardObligationKey({
      handId: 'h1',
      street: 'river',
      playerId: 'p1',
      pending: true,
      holeCardsLength: 3,
    });

    expect(turn).not.toBe(flop);
    expect(river).not.toBe(turn);
  });
});
