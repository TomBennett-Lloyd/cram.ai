import { describe, expect, it } from 'vitest';
import { fuseByReciprocalRank, type RankedList } from './reciprocal-rank';

const unit = (...lists: (readonly string[])[]): readonly RankedList<string>[] =>
  lists.map((ids) => ({ ids, weight: 1 }));

describe('fuseByReciprocalRank', () => {
  it('returns nothing for no lists, and nothing for empty lists', () => {
    expect(fuseByReciprocalRank([])).toEqual([]);
    expect(fuseByReciprocalRank(unit([], []))).toEqual([]);
  });

  it('keeps a single list in its own order', () => {
    expect(fuseByReciprocalRank(unit(['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
  });

  it('ranks an id found by both lists above ids each list found alone', () => {
    expect(fuseByReciprocalRank(unit(['bm25-only', 'both'], ['vector-only', 'both']))).toEqual([
      'both',
      'bm25-only',
      'vector-only',
    ]);
  });

  it('breaks a tie by first appearance, reading the lists in the order given', () => {
    expect(fuseByReciprocalRank(unit(['a'], ['b']))).toEqual(['a', 'b']);
    expect(fuseByReciprocalRank(unit(['b'], ['a']))).toEqual(['b', 'a']);
  });

  it('lets rank depth in two lists beat the top of one, at the default constant', () => {
    // 2 / (rrfK + 2) > 1 / (rrfK + 1) for any constant above zero.
    expect(fuseByReciprocalRank(unit(['top', 'second'], ['other', 'second']))[0]).toBe('second');
  });

  it('lets the constant decide whether one first place beats two deep placements', () => {
    const lists = unit(['solo', 'x1', 'x2', 'deep'], ['y1', 'y2', 'y3', 'deep']);
    // rrfK 0 scores solo 1/1 against deep's 2/4.
    expect(fuseByReciprocalRank(lists, 0)[0]).toBe('solo');
    expect(fuseByReciprocalRank(lists)[0]).toBe('deep');
  });

  it('refuses a ranked list that holds the same id twice', () => {
    expect(() => fuseByReciprocalRank(unit(['a', 'a']))).toThrow(/same id twice/);
  });

  it('scales a list by its weight, so a heavier list’s first place beats two unit placements', () => {
    // 'both' scores 2 / 62: below solo's 3 / 61, above its 1 / 61.
    const lists = (weight: number) => [
      { ids: ['solo'], weight },
      { ids: ['y1', 'both'], weight: 1 },
      { ids: ['z1', 'both'], weight: 1 },
    ];
    expect(fuseByReciprocalRank(lists(3))[0]).toBe('solo');
    expect(fuseByReciprocalRank(lists(1))[0]).not.toBe('solo');
  });

  it('lets a light list rank below a unit list it would tie', () => {
    expect(
      fuseByReciprocalRank([
        { ids: ['light'], weight: 0.5 },
        { ids: ['unit'], weight: 1 },
      ]),
    ).toEqual(['unit', 'light']);
  });

  it('refuses a weight that is zero, negative or not finite', () => {
    for (const weight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => fuseByReciprocalRank([{ ids: ['a'], weight }]), String(weight)).toThrow(
        /weight must be positive/,
      );
  });
});
