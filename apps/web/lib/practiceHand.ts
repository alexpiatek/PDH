import type { Card } from '@pdh/engine';

export const PRACTICE_HAND: Card[] = [
  { rank: 'A', suit: 'S' },
  { rank: 'K', suit: 'H' },
  { rank: 'Q', suit: 'C' },
  { rank: 'J', suit: 'D' },
  { rank: 'T', suit: 'S' },
];
export const PRACTICE_BOARD: Card[] = [
  { rank: 'K', suit: 'C' },
  { rank: '8', suit: 'H' },
  { rank: '3', suit: 'D' },
  { rank: 'Q', suit: 'H' },
  { rank: 'A', suit: 'D' },
];
export function discardPracticeCard(hand: Card[], index: number): Card[] {
  if (hand.length <= 2 || !Number.isInteger(index) || index < 0 || index >= hand.length)
    return hand;
  return hand.filter((_, i) => i !== index);
}
