import { describe, expect, it } from 'vitest';
import { absoluteFields, baselineRow, passed, Ratio } from './metric-row';

describe('Ratio', () => {
  it('refuses a numerator above its denominator', () => {
    expect(Ratio.safeParse({ numerator: 3, denominator: 2 }).success).toBe(false);
  });

  it('refuses a zero denominator, which is not-measurable instead', () => {
    expect(Ratio.safeParse({ numerator: 0, denominator: 0 }).success).toBe(false);
  });

  it('accepts a numerator equal to its denominator', () => {
    expect(Ratio.safeParse({ numerator: 2, denominator: 2 }).success).toBe(true);
  });
});

describe('baselineRow', () => {
  it('is not-measurable, with the reason, when nothing was counted', () => {
    expect(baselineRow(0, 0, 'none')).toEqual({ status: 'not-measurable', reason: 'none' });
  });

  it('is measured against the baseline when something was counted', () => {
    expect(baselineRow(0, 1, 'none')).toEqual({
      status: 'measured',
      bar: 'baseline',
      ratio: { numerator: 0, denominator: 1 },
    });
  });
});

describe('passed', () => {
  it('passes a measured row with no failure', () => {
    expect(passed(absoluteFields(1, [], 'none'))).toBe(true);
  });

  it('fails a measured row with a failure', () => {
    expect(passed(absoluteFields(1, ['x'], 'none'))).toBe(false);
  });

  it('never passes a not-measurable row', () => {
    expect(passed(absoluteFields(0, [], 'none'))).toBe(false);
  });
});
