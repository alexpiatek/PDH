import { describe, expect, it } from 'vitest';
import type { HandState, PlayerInHand } from '@pdh/engine';
import type { LegalActions } from '@pdh/protocol';
import { resolveBettingActionControls } from '../lib/actionControls';

const partialHand = {
  phase: 'betting',
  actionOnSeat: 0,
  currentBet: 800,
  minRaise: 800,
} as HandState;

const player = {
  seat: 0,
  stack: 5000,
  betThisStreet: 0,
} as PlayerInHand;

describe('betting action controls', () => {
  it('prefers server legalActions over public hand derivation in Nakama mode', () => {
    const legalActions: LegalActions = {
      phase: 'betting',
      isActor: true,
      betting: {
        canFold: true,
        canCheck: true,
        canCall: false,
        callAmount: 0,
        canBet: true,
        minBet: 800,
        maxBet: 5000,
        canRaise: false,
        minRaiseTo: null,
        maxRaiseTo: null,
        canAllIn: true,
        allInAmount: 5000,
        stack: 5000,
        committedThisStreet: 0,
        currentBet: 0,
      },
    };

    const controls = resolveBettingActionControls({
      hand: partialHand,
      player,
      legalActions,
      preferLegalActions: true,
      betAmount: 1600,
      raiseCapReached: false,
    });

    expect(controls.usesServerLegalActions).toBe(true);
    expect(controls.isMyTurn).toBe(true);
    expect(controls.toCall).toBe(0);
    expect(controls.canCheck).toBe(true);
    expect(controls.canCall).toBe(false);
    expect(controls.checkOrCallLabel).toBe('Check');
    expect(controls.raiseActionLabel).toBe('Bet');
    expect(controls.minRaiseTo).toBe(800);
    expect(controls.maxRaiseTo).toBe(5000);
  });

  it('falls back to legacy public-state derivation when legalActions is missing', () => {
    const controls = resolveBettingActionControls({
      hand: partialHand,
      player,
      legalActions: null,
      preferLegalActions: true,
      betAmount: 1600,
      raiseCapReached: false,
    });

    expect(controls.usesServerLegalActions).toBe(false);
    expect(controls.toCall).toBe(800);
    expect(controls.canCall).toBe(true);
    expect(controls.checkOrCallLabel).toBe('Call 800');
    expect(controls.raiseActionLabel).toBe('Raise');
  });
});
