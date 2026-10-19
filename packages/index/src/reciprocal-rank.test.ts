import { describe, expect, it } from 'vitest';
import { fuseByReciprocalRank } from './reciprocal-rank';

describe('fuseByReciprocalRank', () => {
  it('returns nothing for no lists, and nothing for empty lists', () => {
    expect(fuseByReciprocalRank([])).toEqual([]);
    expect(fuseByReciprocalRank([[], []])).toEqual([]);
  });

  it('keeps a single list in its own order', () => {
    expect(fuseByReciprocalRank([['c', 'a', 'b']])).toEqual(['c', 'a', 'b']);
  });

  it('ranks an id found by both lists above ids each list found alone', () => {
    expect(
      fuseByReciprocalRank([
        ['bm25-only', 'both'],
        ['vector-only', 'both'],
      ]),
    ).toEqual(['both', 'bm25-only', 'vector-only']);
  });

  it('breaks a tie by first appearance, reading the lists in the order given', () => {
    expect(fuseByReciprocalRank([['a'], ['b']])).toEqual(['a', 'b']);
    expect(fuseByReciprocalRank([['b'], ['a']])).toEqual(['b', 'a']);
  });

  it('lets rank depth in two lists beat the top of one, at the default constant', () => {
    // 2 / (rrfK + 2) > 1 / (rrfK + 1) for any constant above zero.
    expect(
      fuseByReciprocalRank([
        ['top', 'second'],
        ['other', 'second'],
      ])[0],
    ).toBe('second');
  });

  it('lets the constant decide whether one first place beats two deep placements', () => {
    const lists = [
      ['solo', 'x1', 'x2', 'deep'],
      ['y1', 'y2', 'y3', 'deep'],
    ];
    // rrfK 0 scores solo 1/1 against deep's 2/4.
    expect(fuseByReciprocalRank(lists, 0)[0]).toBe('solo');
    expect(fuseByReciprocalRank(lists)[0]).toBe('deep');
  });

  it('refuses a ranked list that holds the same id twice', () => {
    expect(() => fuseByReciprocalRank([['a', 'a']])).toThrow(/same id twice/);
  });
});
