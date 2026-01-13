import { describe, expect, it } from 'vitest';
import { evaluateSeven } from '../src/handEvaluator';
const C = (rank, suit) => ({ rank, suit });
describe('hand evaluation', () => {
    it('detects straight flush beats full house', () => {
        const straightFlush = [
            C('9', 'C'),
            C('8', 'C'),
            C('7', 'C'),
            C('6', 'C'),
            C('5', 'C'),
            C('2', 'D'),
            C('3', 'H'),
        ];
        const fullHouse = [
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
        const cards = [
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
});
