import { describe, expect, it } from 'vitest';
import { getPlayerInitials } from '../lib/playerInitials';

describe('getPlayerInitials', () => {
  it('uses the first character from the first two name parts', () => {
    expect(getPlayerInitials('Alex Mobile')).toBe('AM');
    expect(getPlayerInitials('Brad Laptop')).toBe('BL');
  });

  it('uses one or two characters for single-name players', () => {
    expect(getPlayerInitials('Alex')).toBe('AL');
    expect(getPlayerInitials('Q')).toBe('Q');
  });

  it('falls back for empty or unknown names', () => {
    expect(getPlayerInitials('   ')).toBe('?');
    expect(getPlayerInitials(null)).toBe('?');
    expect(getPlayerInitials(undefined)).toBe('?');
  });
});
