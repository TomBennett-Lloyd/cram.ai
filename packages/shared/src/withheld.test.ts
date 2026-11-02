import { describe, expect, it } from 'vitest';
import { WithheldReason } from './verification';
import { WithheldSentence, WithheldUnit } from './withheld';

const unit = { text: 'Worker bees are male.', citations: [], kind: 'lecture-summary' };
const reasonsOf = (arms: readonly { shape: { reason: { value: string } } }[]) =>
  arms.map((arm) => arm.shape.reason.value);

describe('WithheldUnit and WithheldSentence', () => {
  it('between them have an arm for every withheld reason, and no other', () => {
    const reasons = new Set([
      ...reasonsOf(WithheldUnit.options),
      ...reasonsOf(WithheldSentence.options),
    ]);
    expect([...reasons].sort()).toEqual([...WithheldReason.options].sort());
  });
});

describe('WithheldUnit', () => {
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

describe('WithheldSentence', () => {
  it('names the slide of a contradicted sentence and of a dropped pointer', () => {
    for (const reason of ['contradicted', 'dangling-citation']) {
      expect(WithheldSentence.safeParse({ reason, text: 'Drones are male.' }).success).toBe(false);
      expect(
        WithheldSentence.safeParse({ reason, text: 'Drones are male.', sourceId: 'l1/4' }).success,
      ).toBe(true);
    }
  });

  it('refuses a slide on an unsupported or ungrounded sentence, and a partial one outright', () => {
    for (const reason of ['unsupported', 'ungrounded'])
      expect(
        WithheldSentence.safeParse({ reason, text: 'Drones are male.', sourceId: 'l1/4' }).success,
      ).toBe(false);
    expect(
      WithheldSentence.safeParse({ reason: 'partial', text: 'Drones are male.' }).success,
    ).toBe(false);
  });

  it('refuses blank text', () => {
    expect(WithheldSentence.safeParse({ reason: 'ungrounded', text: ' ' }).success).toBe(false);
  });
});
