import { describe, expect, it } from 'vitest';
import {
  TABLE_CODE_ALPHABET,
  TABLE_CODE_LENGTH,
  generateTableCode,
  isValidTableCodeFormat,
  normalizeTableCode,
  PDH_PROTOCOL_VERSION,
  parseClientMessagePayload,
  parseServerMessagePayload,
} from '../src/index.js';

describe('protocol schemas', () => {
  it('accepts legacy client payloads without explicit version', () => {
    const parsed = parseClientMessagePayload({
      type: 'join',
      name: 'alice',
      buyIn: 5000,
    });

    expect(parsed.v).toBe(PDH_PROTOCOL_VERSION);
  });

  it('rejects unsupported protocol versions', () => {
    expect(() =>
      parseClientMessagePayload({
        v: 999,
        type: 'requestState',
      })
    ).toThrow(/Invalid client message/i);
  });

  it('validates server payload shape', () => {
    const parsed = parseServerMessagePayload({
      type: 'error',
      message: 'bad action',
    });

    expect(parsed.v).toBe(PDH_PROTOCOL_VERSION);
  });
});

describe('lobby table code helpers', () => {
  it('normalizes mixed code input', () => {
    expect(normalizeTableCode(' ab- c d ')).toBe('ABCD');
  });

  it('enforces the allowed code format', () => {
    expect(isValidTableCodeFormat('ABC234')).toBe(true);
    expect(isValidTableCodeFormat('ABCDO1')).toBe(false);
    expect(isValidTableCodeFormat('ABCD0I')).toBe(false);
  });

  it('generates fixed-length codes from the allowed alphabet', () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateTableCode();
      expect(code).toHaveLength(TABLE_CODE_LENGTH);
      for (const char of code) {
        expect(TABLE_CODE_ALPHABET.includes(char)).toBe(true);
      }
      expect(isValidTableCodeFormat(code)).toBe(true);
    }
  });
});
