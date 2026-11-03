import { describe, expect, it } from 'vitest';
import { ftsMatchExpression } from './fts-query';

describe('ftsMatchExpression', () => {
  it('quotes each term and joins them with OR', () => {
    expect(ftsMatchExpression('What is osmosis')).toBe('"what" OR "is" OR "osmosis"');
  });

  it('neutralises FTS5 operators and quotes in the text', () => {
    expect(ftsMatchExpression('NEAR("a" b) AND -c* ^d')).toBe(
      '"near" OR "a" OR "b" OR "and" OR "c" OR "d"',
    );
  });

  it('keeps one copy of a repeated term, whatever its case', () => {
    expect(ftsMatchExpression('Cell cell CELL')).toBe('"cell"');
  });

  it('quotes each term as the index stores it: digits kept, diacritics folded, split at a spacing mark', () => {
    expect(ftsMatchExpression('café x2')).toBe('"cafe" OR "x2"');
    expect(ftsMatchExpression('Café cafe\u0301 CAFE')).toBe('"cafe"');
    expect(ftsMatchExpression('किताब')).toBe('"क" OR "त" OR "ब"');
  });

  it('returns undefined for text with no term', () => {
    expect(ftsMatchExpression('')).toBeUndefined();
    expect(ftsMatchExpression('?! -- "" ()')).toBeUndefined();
  });
});
