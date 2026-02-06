import { describe, expect, it } from 'vitest';
import { evaluateSeven } from '../src/handEvaluator';
import { Card } from '../src/types';

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('hand evaluation', () => {
  it('detects straight flush beats full house', () => {
    const straightFlush: Card[] = [
      C('9', 'C'),
      C('8', 'C'),
      C('7', 'C'),
      C('6', 'C'),
      C('5', 'C'),
      C('2', 'D'),
      C('3', 'H'),
    ];
    const fullHouse: Card[] = [
      C('A', 'S'),
      C('A', 'D'),
      C('A', 'H'),
      C('K', 'C'),
      C('K', 'D'),
      C('4', 'C'),
      C('2', 'S'),
    ];
    const sf = evaluateSeven(straightFlush);
    const fh = evaluateSeven(fullHouse);
    expect(sf.category).toBe(8);
    expect(fh.category).toBe(6);
    expect(sf.score).toBeGreaterThan(fh.score);
  });

  it('handles wheel straight', () => {
    const cards: Card[] = [
      C('A', 'S'),
      C('2', 'D'),
      C('3', 'H'),
      C('4', 'C'),
      C('5', 'D'),
      C('K', 'S'),
      C('Q', 'S'),
    ];
    const result = evaluateSeven(cards);
    expect(result.category).toBe(4);
    expect(result.bestFive.map((c) => c.rank)).toContain('5');
  });

  it('detects a flush in seven cards', () => {
    const cards: Card[] = [
      C('A', 'H'),
      C('K', 'H'),
      C('Q', 'H'),
      C('9', 'H'),
      C('5', 'H'),
      C('2', 'S'),
      C('3', 'D'),
    ];
    const result = evaluateSeven(cards);
    expect(result.category).toBe(5);
  });

  it('flush beats straight', () => {
    const flush: Card[] = [
      C('A', 'H'),
      C('K', 'H'),
      C('Q', 'H'),
      C('9', 'H'),
      C('5', 'H'),
      C('2', 'S'),
      C('3', 'D'),
    ];
    const straight: Card[] = [
      C('9', 'S'),
      C('8', 'D'),
      C('7', 'H'),
      C('6', 'C'),
      C('5', 'D'),
      C('2', 'C'),
      C('K', 'S'),
    ];
    const flushEval = evaluateSeven(flush);
    const straightEval = evaluateSeven(straight);
    expect(flushEval.category).toBe(5);
    expect(straightEval.category).toBe(4);
    expect(flushEval.score).toBeGreaterThan(straightEval.score);
  });
});
