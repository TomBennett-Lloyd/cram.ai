import { describe, expect, it } from 'vitest';
import { WithheldReason } from './verification';
import { WithheldUnit } from './withheld';

const unit = { text: 'Worker bees are male.', citations: [], kind: 'answer-sentence' };

describe('WithheldUnit', () => {
  it('has one arm per withheld reason', () => {
    const reasons = WithheldUnit.options.map((arm) => arm.shape.reason.value);
    expect(reasons).toEqual(WithheldReason.options);
  });

  it('requires the policy on a partial entry', () => {
    expect(WithheldUnit.safeParse({ reason: 'partial', unit }).success).toBe(false);
    expect(WithheldUnit.safeParse({ reason: 'partial', policy: 'drop', unit }).success).toBe(true);
  });

  it('refuses a policy on an entry that was never judged partial', () => {
    expect(WithheldUnit.safeParse({ reason: 'unsupported', policy: 'drop', unit }).success).toBe(
      false,
    );
  });
});
