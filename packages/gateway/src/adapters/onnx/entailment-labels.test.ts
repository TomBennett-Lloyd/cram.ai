import { describe, expect, it } from 'vitest';
import { entailmentScores, labelIndexOf } from './entailment-labels';

describe('labelIndexOf', () => {
  it("reads the provisional verifier's order from its id2label (ADR 0003 A7)", () => {
    expect(labelIndexOf({ 0: 'contradiction', 1: 'entailment', 2: 'neutral' })).toEqual({
      contradiction: 0,
      entailment: 1,
      neutral: 2,
    });
  });

  it('matches labels case-insensitively', () => {
    expect(labelIndexOf({ 0: 'ENTAILMENT', 1: 'Neutral', 2: 'contradiction' })).toEqual({
      entailment: 0,
      neutral: 1,
      contradiction: 2,
    });
  });

  it.each<[string, Record<string, string>]>([
    ['a two-class head', { 0: 'entailment', 1: 'contradiction' }],
    ['a fourth class', { 0: 'entailment', 1: 'neutral', 2: 'contradiction', 3: 'other' }],
    ['a generic label', { 0: 'LABEL_0', 1: 'neutral', 2: 'contradiction' }],
    ['a repeated label', { 0: 'entailment', 1: 'entailment', 2: 'contradiction' }],
    ['an index past the head', { 0: 'entailment', 1: 'neutral', 3: 'contradiction' }],
    ['a non-canonical index', { 0: 'entailment', 1: 'neutral', '02': 'contradiction' }],
    ['a negative index', { 0: 'entailment', 1: 'neutral', '-1': 'contradiction' }],
    ['a non-numeric index', { 0: 'entailment', 1: 'neutral', x: 'contradiction' }],
  ])('refuses %s', (_, id2label) => {
    expect(labelIndexOf(id2label)).toBeNull();
  });
});

describe('entailmentScores', () => {
  const index = { contradiction: 0, entailment: 1, neutral: 2 };

  it('places each softmax probability by the label index', () => {
    const scores = entailmentScores(Float32Array.from([0, Math.log(2), Math.log(3)]), index);
    expect(scores.contradiction).toBeCloseTo(1 / 6);
    expect(scores.entailment).toBeCloseTo(2 / 6);
    expect(scores.neutral).toBeCloseTo(3 / 6);
  });

  it('stays finite for logits whose exponent would overflow', () => {
    expect(entailmentScores(Float32Array.from([0, 1000, 0]), index)).toEqual({
      contradiction: 0,
      entailment: 1,
      neutral: 0,
    });
  });
});
