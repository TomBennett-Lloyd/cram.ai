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

  it('keeps accented letters and digits inside their term', () => {
    expect(ftsMatchExpression('café x2')).toBe('"café" OR "x2"');
    expect(ftsMatchExpression('café')).toBe('"café"');
  });

  it('returns undefined for text with no term', () => {
    expect(ftsMatchExpression('')).toBeUndefined();
    expect(ftsMatchExpression('?! -- "" ()')).toBeUndefined();
  });
});
