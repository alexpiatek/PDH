import { Card } from './types';

const rankValue: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export interface EvaluatedHand {
  score: number;
  bestFive: Card[];
  category: number;
}

function encode(values: number[]): number {
  // Base-15 encoding for kickers
  return values.reduce((acc, v) => acc * 15 + v, 0);
}

function isStraight(values: number[]): { straight: boolean; high: number } {
  const uniq = [...new Set(values)].sort((a, b) => b - a);
  // Wheel straight check
  if (uniq.includes(14)) {
    uniq.push(1);
  }
  let run = 1;
  for (let i = 0; i < uniq.length - 1; i += 1) {
    if (uniq[i] - 1 === uniq[i + 1]) {
      run += 1;
      if (run >= 5) {
        return { straight: true, high: uniq[i + 1] === 1 ? 5 : uniq[i + 1] + 4 };
      }
    } else {
      run = 1;
    }
  }
  return { straight: false, high: 0 };
}

function evaluateFive(cards: Card[]): { category: number; rankValues: number[] } {
  const counts: Record<number, number> = {};
  const suits: Record<string, Card[]> = {};
  const vals: number[] = [];
  for (const c of cards) {
    const v = rankValue[c.rank];
    counts[v] = (counts[v] || 0) + 1;
    vals.push(v);
    if (!suits[c.suit]) suits[c.suit] = [];
    suits[c.suit].push(c);
  }
  vals.sort((a, b) => b - a);
  const flushSuit = Object.entries(suits).find(([, arr]) => arr.length >= 5)?.[0] ?? null;
  const flushValues = flushSuit ? suits[flushSuit].map((c) => rankValue[c.rank]).sort((a, b) => b - a).slice(0, 5) : [];

  const { straight, high } = isStraight(vals);
  const isFlush = !!flushSuit;
  const isStraightFlush = isFlush && straight;

  const groups = Object.entries(counts)
    .map(([v, c]) => ({ v: Number(v), c }))
    .sort((a, b) => {
      if (b.c === a.c) return b.v - a.v;
      return b.c - a.c;
    });

  if (isStraightFlush) {
    return { category: 8, rankValues: [high] };
  }
  if (groups[0].c === 4) {
    const quad = groups[0].v;
    const kicker = groups.find((g) => g.v !== quad)?.v ?? 0;
    return { category: 7, rankValues: [quad, kicker] };
  }
  if (groups[0].c === 3 && groups[1]?.c >= 2) {
    return { category: 6, rankValues: [groups[0].v, groups[1].v] };
  }
  if (isFlush) {
    return { category: 5, rankValues: flushValues.slice(0, 5) };
  }
  if (straight) {
    return { category: 4, rankValues: [high] };
  }
  if (groups[0].c === 3) {
    const trip = groups[0].v;
    const kickers = groups.filter((g) => g.v !== trip).map((g) => g.v).sort((a, b) => b - a);
    return { category: 3, rankValues: [trip, ...kickers.slice(0, 2)] };
  }
  if (groups[0].c === 2 && groups[1]?.c === 2) {
    const [highPair, lowPair] = [groups[0].v, groups[1].v].sort((a, b) => b - a);
    const kicker = groups.find((g) => g.v !== highPair && g.v !== lowPair)?.v ?? 0;
    return { category: 2, rankValues: [highPair, lowPair, kicker] };
  }
  if (groups[0].c === 2) {
    const pair = groups[0].v;
    const kickers = groups.filter((g) => g.v !== pair).map((g) => g.v).sort((a, b) => b - a);
    return { category: 1, rankValues: [pair, ...kickers.slice(0, 3)] };
  }
  return { category: 0, rankValues: vals.slice(0, 5) };
}

export function evaluateSeven(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error('Need at least 5 cards');
  }
  let best: EvaluatedHand | null = null;
  // 7 choose 5 = 21 combos
  for (let i = 0; i < cards.length - 4; i += 1) {
    for (let j = i + 1; j < cards.length - 3; j += 1) {
      for (let k = j + 1; k < cards.length - 2; k += 1) {
        for (let l = k + 1; l < cards.length - 1; l += 1) {
          for (let m = l + 1; m < cards.length; m += 1) {
            const combo = [cards[i], cards[j], cards[k], cards[l], cards[m]];
            const { category, rankValues } = evaluateFive(combo);
            const score = category * 1e10 + encode(rankValues);
            if (!best || score > best.score) {
              best = { score, bestFive: combo, category };
            }
          }
        }
      }
    }
  }
  if (!best) {
    throw new Error('Failed to evaluate hand');
  }
  return best;
}
