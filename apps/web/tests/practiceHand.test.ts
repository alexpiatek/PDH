import { describe, expect, it } from 'vitest';
import { evaluateSeven, type Card } from '@pdh/engine';
import { discardPracticeCard, PRACTICE_BOARD, PRACTICE_HAND } from '../lib/practiceHand';

describe('guided practice hand', () => {
  it('supports every discard path and scores the actual remaining cards with the engine', () => {
    let outcomes = 0;
    const walk = (hand: Card[]) => {
      if (hand.length === 2) {
        const result = evaluateSeven([...hand, ...PRACTICE_BOARD]);
        expect(result.bestFive).toHaveLength(5);
        for (const card of result.bestFive)
          expect([...hand, ...PRACTICE_BOARD]).toContainEqual(card);
        expect(discardPracticeCard(hand, 0)).toEqual(hand);
        outcomes++;
        return;
      }
      hand.forEach((card, index) => {
        const next = discardPracticeCard(hand, index);
        expect(next).toHaveLength(hand.length - 1);
        expect(next).not.toContainEqual(card);
        walk(next);
      });
    };
    walk(PRACTICE_HAND);
    expect(outcomes).toBe(60);
    expect(PRACTICE_HAND).toHaveLength(5);
    expect(new Set([...PRACTICE_HAND, ...PRACTICE_BOARD].map((c) => c.rank + c.suit)).size).toBe(
      10
    );
  });

  it('ignores invalid selections without consuming a card', () => {
    for (const index of [-1, 5, 0.5, NaN, Infinity]) {
      expect(discardPracticeCard(PRACTICE_HAND, index)).toBe(PRACTICE_HAND);
    }
  });
});
