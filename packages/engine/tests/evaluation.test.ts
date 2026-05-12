import { describe, expect, it } from 'vitest';
import { evaluateSeven, HAND_CATEGORY_LABELS } from '../src/handEvaluator';
import { Card } from '../src/types';

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const card = (short: string): Card => C(short[0] as Card['rank'], short[1] as Card['suit']);
const cards = (shorts: string): Card[] => shorts.split(' ').map(card);

type GoldenPlayer = {
  id: string;
  hole: string;
  label: string;
};

type GoldenVector = {
  name: string;
  board: string;
  players: GoldenPlayer[];
  winners: string[];
  winningLabel: string;
};

const evaluateHoldem = (board: string, hole: string) => {
  const result = evaluateSeven([...cards(board), ...cards(hole)]);
  return {
    ...result,
    label: HAND_CATEGORY_LABELS[result.category],
    bestFiveKeys: result.bestFive.map((c) => `${c.rank}${c.suit}`),
  };
};

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

  const goldenVectors: GoldenVector[] = [
    {
      name: 'royal flush outranks a lower straight flush',
      board: '9H TH JH QH 2C',
      players: [
        { id: 'royal', hole: 'AH KH', label: 'Straight Flush' },
        { id: 'lower-straight-flush', hole: '8H 7H', label: 'Straight Flush' },
      ],
      winners: ['royal'],
      winningLabel: 'Straight Flush',
    },
    {
      name: 'four of a kind uses the highest kicker',
      board: 'AS AD AH AC 2D',
      players: [
        { id: 'king-kicker', hole: 'KS 3C', label: 'Four of a Kind' },
        { id: 'queen-kicker', hole: 'QS JC', label: 'Four of a Kind' },
      ],
      winners: ['king-kicker'],
      winningLabel: 'Four of a Kind',
    },
    {
      name: 'full house compares trips before pair',
      board: 'AS AD KH KD 2C',
      players: [
        { id: 'aces-full', hole: 'AH 3S', label: 'Full House' },
        { id: 'kings-full', hole: 'KC QS', label: 'Full House' },
      ],
      winners: ['aces-full'],
      winningLabel: 'Full House',
    },
    {
      name: 'flush compares highest cards in order',
      board: 'AH QH 9H 4H 2C',
      players: [
        { id: 'king-high-flush', hole: 'KH 3S', label: 'Flush' },
        { id: 'jack-high-flush', hole: 'JH AS', label: 'Flush' },
      ],
      winners: ['king-high-flush'],
      winningLabel: 'Flush',
    },
    {
      name: 'six-high straight beats wheel straight',
      board: 'AS 2D 3H 4C 9S',
      players: [
        { id: 'wheel', hole: '5D KC', label: 'Straight' },
        { id: 'six-high', hole: '5H 6C', label: 'Straight' },
      ],
      winners: ['six-high'],
      winningLabel: 'Straight',
    },
    {
      name: 'three of a kind compares both kickers',
      board: '7S 7D 7C 2H 3D',
      players: [
        { id: 'ace-king', hole: 'AS KD', label: 'Three of a Kind' },
        { id: 'ace-queen', hole: 'AH QD', label: 'Three of a Kind' },
      ],
      winners: ['ace-king'],
      winningLabel: 'Three of a Kind',
    },
    {
      name: 'two pair compares the kicker after both pairs match',
      board: 'KS KD 4H 4C 2D',
      players: [
        { id: 'ace-kicker', hole: 'AS 3C', label: 'Two Pair' },
        { id: 'queen-kicker', hole: 'QS JC', label: 'Two Pair' },
      ],
      winners: ['ace-kicker'],
      winningLabel: 'Two Pair',
    },
    {
      name: 'one pair compares all remaining kickers',
      board: '9S 9D 5C 3H 2D',
      players: [
        { id: 'ace-king', hole: 'AS KD', label: 'One Pair' },
        { id: 'ace-queen', hole: 'AH QD', label: 'One Pair' },
      ],
      winners: ['ace-king'],
      winningLabel: 'One Pair',
    },
    {
      name: 'high card compares remaining cards in order',
      board: 'AS 9D 7C 4H 2S',
      players: [
        { id: 'king-queen', hole: 'KC QD', label: 'High Card' },
        { id: 'king-jack', hole: 'KH JD', label: 'High Card' },
      ],
      winners: ['king-queen'],
      winningLabel: 'High Card',
    },
    {
      name: 'board-play straight splits the pot',
      board: '6S 7D 8H 9C TS',
      players: [
        { id: 'pocket-kings', hole: 'KC KD', label: 'Straight' },
        { id: 'pocket-queens', hole: 'QC QD', label: 'Straight' },
      ],
      winners: ['pocket-kings', 'pocket-queens'],
      winningLabel: 'Straight',
    },
    {
      name: 'same best five cards split when each player uses one matching-rank hole card',
      board: '9S TD JH QC 2D',
      players: [
        { id: 'king-three', hole: 'KS 3C', label: 'Straight' },
        { id: 'king-four', hole: 'KH 4C', label: 'Straight' },
      ],
      winners: ['king-three', 'king-four'],
      winningLabel: 'Straight',
    },
    {
      name: 'flush outranks straight',
      board: '8H KH 9H 4H 5D',
      players: [
        { id: 'flush', hole: '2H AC', label: 'Flush' },
        { id: 'straight', hole: '6S 7D', label: 'Straight' },
      ],
      winners: ['flush'],
      winningLabel: 'Flush',
    },
    {
      name: 'full house outranks flush',
      board: 'AH AD KH QH 2H',
      players: [
        { id: 'full-house', hole: 'AS KD', label: 'Full House' },
        { id: 'flush', hole: 'JH 9H', label: 'Flush' },
      ],
      winners: ['full-house'],
      winningLabel: 'Full House',
    },
    {
      name: 'one-pair kicker edge compares the third kicker',
      board: 'AS AD KH QD 2C',
      players: [
        { id: 'jack-kicker', hole: 'JS 9C', label: 'One Pair' },
        { id: 'ten-kicker', hole: 'TS 9D', label: 'One Pair' },
      ],
      winners: ['jack-kicker'],
      winningLabel: 'One Pair',
    },
    {
      name: 'best five can come from the board plus one hole card',
      board: 'AS KD QH JC 2D',
      players: [
        { id: 'one-card-straight', hole: 'TS 3C', label: 'Straight' },
        { id: 'top-pair', hole: 'AH 9C', label: 'One Pair' },
      ],
      winners: ['one-card-straight'],
      winningLabel: 'Straight',
    },
    {
      name: 'both hole cards can matter to the winning flush',
      board: 'AH 9H 6H 2C 3D',
      players: [
        { id: 'king-queen-flush', hole: 'KH QH', label: 'Flush' },
        { id: 'jack-ten-flush', hole: 'JH TH', label: 'Flush' },
      ],
      winners: ['king-queen-flush'],
      winningLabel: 'Flush',
    },
  ];

  it.each(goldenVectors)('$name', ({ board, players, winners, winningLabel }) => {
    const results = players.map((player) => ({
      player,
      evaluation: evaluateHoldem(board, player.hole),
    }));

    for (const { player, evaluation } of results) {
      expect(evaluation.label).toBe(player.label);
    }

    const bestScore = Math.max(...results.map((r) => r.evaluation.score));
    const actualWinners = results
      .filter((r) => r.evaluation.score === bestScore)
      .map((r) => r.player.id)
      .sort();

    expect(actualWinners).toEqual([...winners].sort());
    for (const winner of actualWinners) {
      const result = results.find((r) => r.player.id === winner);
      expect(result?.evaluation.label).toBe(winningLabel);
    }
  });

  it('selects the expected best five for one-hole and two-hole golden vectors', () => {
    const oneHoleStraight = evaluateHoldem('AS KD QH JC 2D', 'TS 3C');
    expect(oneHoleStraight.label).toBe('Straight');
    expect(oneHoleStraight.bestFiveKeys).toEqual(expect.arrayContaining(['AS', 'KD', 'QH', 'JC', 'TS']));

    const twoHoleFlush = evaluateHoldem('AH 9H 6H 2C 3D', 'KH QH');
    expect(twoHoleFlush.label).toBe('Flush');
    expect(twoHoleFlush.bestFiveKeys).toEqual(expect.arrayContaining(['AH', 'KH', 'QH', '9H', '6H']));
  });
});
