import { describe, expect, it } from 'vitest';
import { parseClientMessagePayload } from '../src/protocol';

describe('Nakama protocol shim', () => {
  it('rejects fractional client chip amounts', () => {
    expect(() =>
      parseClientMessagePayload({
        type: 'join',
        name: 'alice',
        buyIn: 5000.5,
      })
    ).toThrow('Invalid payload');

    expect(() =>
      parseClientMessagePayload({
        type: 'action',
        action: 'raise',
        amount: 1600.5,
        seq: 1,
      })
    ).toThrow('Invalid payload');

    expect(() =>
      parseClientMessagePayload({
        type: 'rebuy',
        amount: 10000.5,
        seq: 1,
      })
    ).toThrow('Invalid payload');
  });
});
