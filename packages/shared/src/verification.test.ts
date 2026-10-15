import { describe, expect, it } from 'vitest';
import { Verdict, WithheldReason } from './verification';

describe('WithheldReason', () => {
  it('admits every verdict except supported', () => {
    const withheld = Verdict.options.filter((v) => WithheldReason.safeParse(v).success);
    expect(withheld).toEqual(['partial', 'unsupported']);
  });

  it('admits a dangling citation, which never reaches the verifier', () => {
    expect(WithheldReason.safeParse('dangling-citation').success).toBe(true);
  });
});
