import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { absoluteFields, absoluteRow, baselineRow, passed, Ratio } from './metric-row';

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

  it.each([
    { numerator: -1, denominator: 2 },
    { numerator: 0.5, denominator: 2 },
  ])('refuses a numerator that is not a count: $numerator', (ratio) => {
    expect(Ratio.safeParse(ratio).success).toBe(false);
  });
});

describe('absoluteRow', () => {
  const Row = absoluteRow(z.string());

  it('accepts one failure per item not passed', () => {
    expect(Row.safeParse(absoluteFields(2, ['x'], 'none')).success).toBe(true);
  });

  it('refuses a failure count that disagrees with its ratio', () => {
    const fields = absoluteFields(2, ['x'], 'none');
    expect(Row.safeParse({ ...fields, failures: [] }).success).toBe(false);
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
