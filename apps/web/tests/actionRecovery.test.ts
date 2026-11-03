import { describe, expect, it } from 'vitest';
import { isActionStateMismatch } from '../lib/actionRecovery';

describe('rejected action recovery', () => {
  it('refreshes a stale turn, discard phase or repeated action without resubmitting it', () => {
    for (const message of [
      'Not your turn',
      'Not in betting phase',
      'Not in discard phase',
      'Player not pending discard',
      'Duplicate or stale action sequence',
      '  NOT YOUR TURN.  ',
    ]) {
      expect(isActionStateMismatch(message), message).toBe(true);
    }
  });
  it('keeps connection, admission, persistence and chip errors visible', () => {
    for (const message of [
      'Connection failed',
      'Storage write rejected',
      'Player not seated',
      'Insufficient chips',
      'Raise is below the minimum',
      'Not your turn: unexpected internal error',
      '',
    ]) {
      expect(isActionStateMismatch(message), message).toBe(false);
    }
  });
});
