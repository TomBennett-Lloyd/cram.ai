import { describe, expect, it } from 'vitest';
import { type EntailmentScores, nliVerdict, PROVISIONAL_NLI_THRESHOLDS } from './nli-verdict';

const t = PROVISIONAL_NLI_THRESHOLDS;
const entailed: EntailmentScores = { entailment: 0.9, neutral: 0.05, contradiction: 0.05 };
const neutral: EntailmentScores = { entailment: 0.1, neutral: 0.8, contradiction: 0.1 };
const contradicted: EntailmentScores = { entailment: 0.05, neutral: 0.05, contradiction: 0.9 };

const atEntailment = (entailment: number): EntailmentScores => ({
  entailment,
  neutral: 1 - entailment,
  contradiction: 0,
});
const atContradiction = (contradiction: number): EntailmentScores => ({
  entailment: 0,
  neutral: 1 - contradiction,
  contradiction,
});

describe('nliVerdict', () => {
  it('is supported when every claim is entailed', () => {
    expect(nliVerdict([entailed, entailed], t)).toBe('supported');
  });

  it('is partial when some claims are entailed and the rest are neutral', () => {
    expect(nliVerdict([entailed, neutral], t)).toBe('partial');
  });

  it('is unsupported when no claim is entailed', () => {
    expect(nliVerdict([neutral], t)).toBe('unsupported');
  });

  it('is unsupported when any claim is contradicted, whatever the others are', () => {
    expect(nliVerdict([entailed, contradicted], t)).toBe('unsupported');
  });

  it('is unsupported for no claims at all', () => {
    expect(nliVerdict([], t)).toBe('unsupported');
  });

  it('counts entailment exactly at its threshold as entailed, and just below as not', () => {
    expect(nliVerdict([atEntailment(t.entailedAt)], t)).toBe('supported');
    expect(nliVerdict([atEntailment(t.entailedAt - 0.01)], t)).toBe('unsupported');
  });

  it('counts contradiction exactly at its threshold as contradicted, and just below as not', () => {
    expect(nliVerdict([entailed, atContradiction(t.contradictedAt)], t)).toBe('unsupported');
    expect(nliVerdict([entailed, atContradiction(t.contradictedAt - 0.01)], t)).toBe('partial');
  });

  it('lets contradiction outrank entailment when a claim clears both thresholds', () => {
    const low = { entailedAt: 0.3, contradictedAt: 0.3 };
    const both = { entailment: 0.4, neutral: 0.2, contradiction: 0.4 };
    expect(nliVerdict([both], low)).toBe('unsupported');
  });
});
